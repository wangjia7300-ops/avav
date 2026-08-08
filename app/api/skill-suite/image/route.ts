import { createHash } from "node:crypto";
import { parseImageProviderConfig } from "@/lib/image-providers";
import {
  API_BODY_LIMITS,
  assertLocalApiRequest,
  readJsonRequestBody
} from "@/lib/security/request-guard";
import { compileScreenImagePrompt } from "@/lib/skill-suite/jimeng-prompt-translator";
import { jsonNoStore } from "@/lib/skill-suite/server/http";
import { generateImageFromPrompt } from "@/lib/services/generate-image-from-prompt";
import { serializeApiError, ServiceError } from "@/lib/services/errors";
import type {
  DetailScreen,
  EvidenceFact,
  GeneratedImageAsset,
  ScreenExecution
} from "@/lib/types";

export const maxDuration = 300;

// 注意：幂等状态是进程内存级的，仅在单进程长驻部署下有效；
// 多实例 / Serverless 需改用带 TTL 的外部存储。
const COMPLETED_REQUEST_TTL_MS = 10 * 60_000;
// 仅保留最近一组15屏的回放结果，避免 base64 成图长期占用进程内存。
const MAX_COMPLETED_REQUESTS = 16;
type IdempotentImageOperation = {
  fingerprint: string;
  promise: Promise<GeneratedImageAsset>;
};
type CompletedImageOperation = {
  fingerprint: string;
  image: GeneratedImageAsset;
  expiresAt: number;
};
const inFlight = new Map<string, IdempotentImageOperation>();
const completedRequests = new Map<string, CompletedImageOperation>();

export async function POST(request: Request) {
  try {
    assertLocalApiRequest(request, {
      method: "POST",
      requireJson: true,
      maxContentLength: API_BODY_LIMITS.imageGeneration
    });
    const body = (await readJsonRequestBody(
      request,
      API_BODY_LIMITS.imageGeneration
    )) as {
      requestId?: string;
      screen?: DetailScreen;
      execution?: ScreenExecution;
      facts?: EvidenceFact[];
      referenceImages?: string[];
      imageProviderConfig?: unknown;
    };
    if (!body.requestId || !/^[A-Za-z0-9_-]{16,128}$/.test(body.requestId)) {
      throw new ServiceError("缺少有效的生图幂等键，已阻止重复扣费。", {
        statusCode: 400,
        code: "IMAGE_IDEMPOTENCY_REQUIRED"
      });
    }
    const imageProviderConfig = parseImageProviderConfig(body.imageProviderConfig);
    if (!imageProviderConfig) {
      throw new ServiceError("请先在“生图模型”中完成独立配置。", {
        statusCode: 401,
        code: "IMAGE_CONFIG_REQUIRED"
      });
    }
    if (
      !body.screen ||
      !body.execution ||
      body.execution.screenId !== body.screen.id ||
      !body.execution.copyFinal ||
      !Array.isArray(body.execution.copyFinal.keyPoints) ||
      !Array.isArray(body.facts)
    ) {
      throw new ServiceError("本屏策划、执行结果或事实库不完整。", {
        statusCode: 400,
        code: "IMAGE_INPUT_INVALID"
      });
    }
    if (
      !Array.isArray(body.referenceImages) ||
      body.referenceImages.length < 1 ||
      body.referenceImages.some(
        (image) =>
          typeof image !== "string" ||
          !/^data:image\/(?:png|jpeg|webp);base64,/i.test(image)
      )
    ) {
      throw new ServiceError("生图必须携带本次上传的产品参考图。", {
        statusCode: 400,
        code: "IMAGE_REFERENCE_REQUIRED"
      });
    }

    const currentCopy = body.screen.copy;
    const transportedCopy = body.execution.copyFinal;
    if (
      transportedCopy.headline !== currentCopy.headline ||
      transportedCopy.subheadline !== currentCopy.subheadline ||
      transportedCopy.body !== currentCopy.body ||
      transportedCopy.keyPoints.length !== currentCopy.keyPoints.length ||
      transportedCopy.keyPoints.some(
        (point, index) => point !== currentCopy.keyPoints[index]
      )
    ) {
      throw new ServiceError(
        "本屏执行稿仍引用旧文案，请重新生成本屏交付后再生图。",
        {
          statusCode: 409,
          code: "IMAGE_PROMPT_STALE"
        }
      );
    }

    const prompt = compileScreenImagePrompt({
      screen: body.screen,
      execution: body.execution,
      facts: body.facts
    });
    if (body.execution.englishPrompt !== prompt) {
      throw new ServiceError("本屏最终提示词不是当前策划的单次编译结果，请重新生成本屏交付。", {
        statusCode: 409,
        code: "IMAGE_PROMPT_STALE"
      });
    }

    const fingerprint = buildRequestFingerprint({
      screenId: body.screen.id,
      prompt,
      negativePrompt: body.execution.negativePrompt,
      providerId: imageProviderConfig.providerId,
      imageModel: imageProviderConfig.imageModel,
      referenceImages: body.referenceImages
    });
    const completed = completedRequests.get(body.requestId);
    if (completed) {
      if (completed.expiresAt <= Date.now()) {
        completedRequests.delete(body.requestId);
      } else {
        assertMatchingFingerprint(completed.fingerprint, fingerprint);
        return jsonNoStore({
          success: true,
          data: completed.image,
          meta: { replayed: true }
        });
      }
    }

    let operation = inFlight.get(body.requestId);
    if (operation) {
      assertMatchingFingerprint(operation.fingerprint, fingerprint);
    } else {
      operation = {
        fingerprint,
        promise: generateImageFromPrompt({
          prompt,
          negativePrompt: body.execution.negativePrompt,
          imageType: "detail_page",
          referenceImages: body.referenceImages,
          imageProviderConfig,
          signal: request.signal
        })
      };
      inFlight.set(body.requestId, operation);
    }
    try {
      const image = await operation.promise;
      rememberCompletedRequest(body.requestId, fingerprint, image);
      return jsonNoStore({ success: true, data: image });
    } finally {
      if (inFlight.get(body.requestId) === operation) {
        inFlight.delete(body.requestId);
      }
    }
  } catch (error) {
    const failure = serializeApiError(
      error,
      "生图失败，请检查独立生图模型配置后重试。"
    );
    return jsonNoStore(failure.body, failure.status);
  }
}

function buildRequestFingerprint(input: {
  screenId: string;
  prompt: string;
  negativePrompt: string;
  providerId: string;
  imageModel: string;
  referenceImages: readonly string[];
}) {
  const hash = createHash("sha256");
  [
    input.screenId,
    input.prompt,
    input.negativePrompt,
    input.providerId,
    input.imageModel
  ].forEach((value) => {
    hash.update(value);
    hash.update("\0");
  });
  input.referenceImages.forEach((image) => {
    hash.update(image);
    hash.update("\0");
  });
  return hash.digest("hex");
}

function assertMatchingFingerprint(current: string, incoming: string) {
  if (current !== incoming) {
    throw new ServiceError("同一生图请求号不能用于不同的页面或输入。", {
      statusCode: 409,
      code: "IMAGE_IDEMPOTENCY_CONFLICT"
    });
  }
}

function rememberCompletedRequest(
  requestId: string,
  fingerprint: string,
  image: GeneratedImageAsset
) {
  while (completedRequests.size >= MAX_COMPLETED_REQUESTS) {
    const oldest = completedRequests.keys().next().value;
    if (!oldest) break;
    completedRequests.delete(oldest);
  }

  const expiresAt = Date.now() + COMPLETED_REQUEST_TTL_MS;
  completedRequests.set(requestId, { fingerprint, image, expiresAt });
  const timer = setTimeout(() => {
    if (completedRequests.get(requestId)?.expiresAt === expiresAt) {
      completedRequests.delete(requestId);
    }
  }, COMPLETED_REQUEST_TTL_MS);
  timer.unref?.();
}
