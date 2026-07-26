import { NextResponse } from "next/server";
import { parseImageProviderConfig } from "@/lib/image-providers";
import { compileScreenImagePrompt } from "@/lib/skill-suite/prompts";
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
const inFlight = new Map<string, Promise<GeneratedImageAsset>>();
const completedRequestIds = new Set<string>();

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
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
    if (completedRequestIds.has(body.requestId)) {
      throw new ServiceError("该生图请求已完成，已阻止使用同一请求号重复扣费。", {
        statusCode: 409,
        code: "IMAGE_REQUEST_ALREADY_COMPLETED"
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
    let operation = inFlight.get(body.requestId);
    if (!operation) {
      operation = generateImageFromPrompt({
        prompt,
        negativePrompt: body.execution.negativePrompt,
        imageType: "detail_page",
        referenceImages: body.referenceImages,
        imageProviderConfig
      });
      inFlight.set(body.requestId, operation);
    }
    try {
      const image = await operation;
      completedRequestIds.add(body.requestId);
      forgetCompletedRequest(body.requestId);
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

function forgetCompletedRequest(requestId: string) {
  setTimeout(() => {
    completedRequestIds.delete(requestId);
  }, 60_000);
}
