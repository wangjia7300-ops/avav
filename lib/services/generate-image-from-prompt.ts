import { IMAGE_PROVIDER_PRESETS } from "@/lib/image-providers";
import {
  assertPublicEndpoint,
  isPrivateEndpointHostname
} from "@/lib/services/endpoint-guard";
import { ServiceError } from "@/lib/services/errors";
import type {
  GeneratedImageAsset,
  ImageProviderConfig
} from "@/lib/types";
import { sanitizeDataImages } from "@/lib/uploads/sanitize-image";
import sharp, { type Metadata } from "sharp";

type ImageType = "detail_page";

type GenerateImageFromPromptInput = {
  prompt: string;
  /** @deprecated 即梦/Seedream 没有独立 negative_prompt；约束已由服务端编译进 prompt。 */
  negativePrompt?: string;
  imageType: ImageType;
  referenceImages?: readonly string[];
  imageProviderConfig?: ImageProviderConfig | null;
  signal?: AbortSignal;
};

type ResolvedImageConfig = {
  providerId: "openai" | "volcengine" | "custom";
  apiKey: string;
  baseURL: string;
  imageModel: string;
};

type UpstreamImagePayload = {
  model?: string;
  output_format?: string;
  size?: string;
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
    size?: string;
  }>;
  error?: {
    code?: string;
  };
};

const IMAGE_REQUEST_TIMEOUT_MS = Number(process.env.IMAGE_REQUEST_TIMEOUT_MS) || 180_000;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_NEGATIVE_PROMPT_LENGTH = 6_000;
const MAX_BASE64_LENGTH = 28_000_000;
const MAX_UPSTREAM_JSON_BYTES = 32 * 1024 * 1024;
const MAX_GENERATED_IMAGE_EDGE = 8_000;
const MAX_GENERATED_IMAGE_PIXELS = 24_000_000;
const PROVIDER_SOURCE_SIZES = {
  openai: { width: 1_024, height: 1_536 },
  volcengine: { width: 1_440, height: 2_560 },
  // 自定义供应商在界面契约中定义为 OpenAI Images API 兼容端点，
  // 因此使用兼容性最高的竖图尺寸，再由服务端确定性裁成 9:16。
  custom: { width: 1_024, height: 1_536 }
} as const satisfies Record<ResolvedImageConfig["providerId"], ImageDimensions>;
const OPENAI_CROPPED_SIZE = { width: 864, height: 1_536 } as const;
// OpenAI 兼容接口的原生 2:3 输出需要保留中央 84.375% 才能交付为 9:16。
// 允许同等或更小幅度的居中裁切，防止横图/方图被静默裁坏。
const MIN_GENERATED_IMAGE_RETAINED_FRACTION = 0.84;
const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const SUPPORTED_OUTPUT_FORMATS = new Set(["jpeg", "png", "webp"]);

type ImageDimensions = {
  width: number;
  height: number;
};

type ProviderImageRequest =
  | {
      path: "/images/generations" | "/images/edits";
      body: Record<string, unknown>;
      contentType: "json";
    }
  | {
      path: "/images/generations" | "/images/edits";
      body: FormData;
      contentType: "multipart";
    };

async function assertPublicCustomEndpoint(baseURL: string) {
  await assertPublicEndpoint(baseURL, {
    invalidMessage: "自定义生图 Endpoint 必须解析到公开网络地址。",
    invalidCode: "IMAGE_ENDPOINT_INVALID",
    unreachableMessage: "无法解析自定义生图 Endpoint，请检查地址后重试。",
    unreachableCode: "IMAGE_ENDPOINT_UNREACHABLE"
  });
}

function normalizeBaseURL(value: string) {
  return value.trim().replace(/\/+$/g, "").replace(/\/images\/generations$/i, "");
}

function resolveCustomBaseURL(value: string) {
  let endpoint: URL;

  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new ServiceError("自定义生图 Endpoint 格式不正确。", {
      statusCode: 400,
      code: "IMAGE_ENDPOINT_INVALID"
    });
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    isPrivateEndpointHostname(endpoint.hostname)
  ) {
    throw new ServiceError("自定义生图 Endpoint 必须是可公开访问的 HTTPS 地址。", {
      statusCode: 400,
      code: "IMAGE_ENDPOINT_INVALID"
    });
  }

  return normalizeBaseURL(endpoint.toString());
}

function resolveImageApiConfig(imageProviderConfig?: ImageProviderConfig | null): ResolvedImageConfig {
  if (!imageProviderConfig) {
    throw new ServiceError("请先在生图 API 设置中完成独立配置。", {
      statusCode: 401,
      code: "IMAGE_API_KEY_MISSING"
    });
  }

  if (
    imageProviderConfig.scope !== "image_generation" ||
    typeof imageProviderConfig.apiKey !== "string" ||
    typeof imageProviderConfig.baseURL !== "string" ||
    typeof imageProviderConfig.imageModel !== "string"
  ) {
    throw new ServiceError("生图供应商配置格式不正确。", {
      statusCode: 400,
      code: "IMAGE_CONFIG_INVALID"
    });
  }

  const providerId = imageProviderConfig.providerId;
  if (providerId !== "openai" && providerId !== "volcengine" && providerId !== "custom") {
    throw new ServiceError("当前供应商暂不支持图片生成，请改用 OpenAI、火山方舟或兼容 Images API 的自定义供应商。", {
      statusCode: 400,
      code: "IMAGE_PROVIDER_UNSUPPORTED"
    });
  }

  const apiKey = imageProviderConfig.apiKey.trim();
  const imageModel = imageProviderConfig.imageModel.trim();

  if (!apiKey) {
    throw new ServiceError("请先填写生图 API Key。", {
      statusCode: 401,
      code: "IMAGE_API_KEY_MISSING"
    });
  }

  if (!imageModel) {
    throw new ServiceError("请先在生图 API 设置中填写生图模型或生图接入点 ID。", {
      statusCode: 400,
      code: "IMAGE_MODEL_MISSING"
    });
  }

  if (providerId === "custom") {
    return {
      providerId: "custom",
      apiKey,
      baseURL: resolveCustomBaseURL(imageProviderConfig.baseURL),
      imageModel
    };
  }

  const preset = IMAGE_PROVIDER_PRESETS.find((provider) => provider.id === providerId);
  if (!preset) {
    throw new ServiceError("不支持当前生图供应商。", {
      statusCode: 400,
      code: "IMAGE_PROVIDER_UNSUPPORTED"
    });
  }

  return {
    providerId,
    apiKey,
    baseURL: preset.baseURL,
    imageModel
  };
}

async function normalizeReferenceImages(referenceImages?: readonly string[]) {
  if (referenceImages === undefined) return [];

  if (!Array.isArray(referenceImages)) {
    throw new ServiceError("产品参考图格式不正确。", {
      statusCode: 400,
      code: "IMAGE_REFERENCE_INVALID"
    });
  }

  referenceImages.forEach((value, index) => {
    if (typeof value !== "string") {
      throw new ServiceError(`第 ${index + 1} 张产品参考图格式不正确。`, {
        statusCode: 400,
        code: "IMAGE_REFERENCE_INVALID"
      });
    }
  });
  const sanitized = await sanitizeDataImages(referenceImages);
  return sanitized.map((image) => image.dataUrl);
}

function buildImagePrompt(input: GenerateImageFromPromptInput) {
  const prompt = input.prompt.trim();
  const negativePrompt = input.negativePrompt?.trim() ?? "";

  if (!prompt) {
    throw new ServiceError("生图提示词不能为空。", {
      statusCode: 400,
      code: "IMAGE_PROMPT_EMPTY"
    });
  }

  if (prompt.length > MAX_PROMPT_LENGTH || negativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH) {
    throw new ServiceError("生图提示词过长，请先精简后重试。", {
      statusCode: 400,
      code: "IMAGE_PROMPT_TOO_LONG"
    });
  }

  // Ark Seedream Images API 没有独立 negative_prompt 参数。调用方保留
  // legacy 字段只用于长度校验/幂等指纹，不能再二次拼入正向指令。
  return prompt;
}

function applyProviderFraming(
  prompt: string,
  providerId: ResolvedImageConfig["providerId"]
) {
  if (providerId === "volcengine") return prompt;

  return [
    prompt,
    "Provider framing contract: the API source canvas is 1024x1536 and will be center-cropped to 864x1536 (exact 9:16). Disregard any other pixel dimensions mentioned in upstream production notes for this render. Keep the complete product silhouette, every required Chinese text block, logo, badges, and all decision-critical details inside the central 84% of the source width (x=8%–92%). Treat both outer side strips as expendable crop area; place only background there. Do not place text or product edges in the crop area."
  ].join("\n\n");
}

function resolveRequestedSize(config: ResolvedImageConfig) {
  const dimensions = PROVIDER_SOURCE_SIZES[config.providerId];
  return `${dimensions.width}x${dimensions.height}`;
}

function openAIEditFormData(
  config: ResolvedImageConfig,
  prompt: string,
  size: string,
  referenceImages: readonly string[]
) {
  const form = new FormData();
  form.append("model", config.imageModel);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", "medium");
  form.append("output_format", "png");

  if (config.providerId === "openai") {
    form.append("input_fidelity", "high");
  }

  referenceImages.forEach((dataUrl, index) => {
    const match = DATA_URL_PATTERN.exec(dataUrl);
    if (!match) return;
    const mimeType = match[1].toLowerCase();
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
    const bytes = Buffer.from(match[2], "base64");
    form.append(
      "image[]",
      new Blob([bytes], { type: mimeType }),
      `reference-${index + 1}.${extension}`
    );
  });

  return form;
}

function buildProviderRequest(
  config: ResolvedImageConfig,
  prompt: string,
  size: string,
  referenceImages: readonly string[]
): ProviderImageRequest {
  if (config.providerId === "volcengine") {
    return {
      path: "/images/generations",
      contentType: "json",
      body: {
        model: config.imageModel,
        prompt,
        ...(referenceImages.length
          ? {
              image:
                referenceImages.length === 1
                  ? referenceImages[0]
                  : referenceImages
            }
          : {}),
        size,
        sequential_image_generation: "disabled",
        stream: false,
        response_format: "b64_json",
        watermark: false
      }
    };
  }

  if (config.providerId === "openai" || config.providerId === "custom") {
    if (referenceImages.length) {
      return {
        path: "/images/edits",
        contentType: "multipart",
        body: openAIEditFormData(config, prompt, size, referenceImages)
      };
    }

    return {
      path: "/images/generations",
      contentType: "json",
      body: {
        model: config.imageModel,
        prompt,
        size,
        n: 1,
        quality: "medium",
        output_format: "png"
      }
    };
  }

  throw new ServiceError("不支持当前生图供应商。", {
    statusCode: 400,
    code: "IMAGE_PROVIDER_UNSUPPORTED"
  });
}

function mapUpstreamFailure(
  status: number,
  code: string | undefined,
  context: {
    hasReferenceImages: boolean;
  }
) {
  if (
    code === "InputTextSensitiveContentDetected" ||
    code === "OutputImageSensitiveContentDetected"
  ) {
    return new ServiceError("提示词或生成内容未通过安全审核，请调整描述后重试。", {
      statusCode: 422,
      code: "IMAGE_CONTENT_REJECTED"
    });
  }

  if (status === 401) {
    return new ServiceError("生图 API Key 无效或已失效，请重新检查。", {
      statusCode: 401,
      code: "IMAGE_AUTH_FAILED"
    });
  }

  if (status === 403) {
    return new ServiceError("当前 API Key 没有生图模型的访问权限。", {
      statusCode: 403,
      code: "IMAGE_PERMISSION_DENIED"
    });
  }

  if (status === 404) {
    return new ServiceError("未找到生图模型或接入点，请检查生图模型配置。", {
      statusCode: 404,
      code: "IMAGE_MODEL_NOT_FOUND"
    });
  }

  if (status === 429) {
    return new ServiceError("生图服务当前限流或额度不足，请稍后重试。", {
      statusCode: 429,
      code: "IMAGE_RATE_LIMITED"
    });
  }

  if (status === 400 && context.hasReferenceImages) {
    return new ServiceError(
      "当前生图模型未接受产品参考图或 9:16 尺寸参数，请检查模型是否支持图生图后重试。",
      {
        statusCode: 400,
        code: "IMAGE_PROVIDER_CAPABILITY_REJECTED"
      }
    );
  }

  return new ServiceError("生图服务暂时不可用，请稍后重试。", {
    statusCode: status >= 500 ? 502 : 400,
    code: "IMAGE_GENERATION_FAILED"
  });
}

function parseSizeMetadata(value?: string): ImageDimensions | null {
  if (!value) return null;

  const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(value);
  if (!match) {
    throw new ServiceError("生图接口返回了无法校验的尺寸信息。", {
      statusCode: 502,
      code: "IMAGE_SIZE_INVALID"
    });
  }

  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!width || !height) {
    throw new ServiceError("生图接口返回了无效尺寸。", {
      statusCode: 502,
      code: "IMAGE_SIZE_INVALID"
    });
  }

  return { width, height };
}

function imageResponseError(message: string, code: string) {
  return new ServiceError(message, {
    statusCode: 502,
    code
  });
}

function sameDimensions(left: ImageDimensions, right: ImageDimensions) {
  return left.width === right.width && left.height === right.height;
}

function orientedDimensions(metadata: Metadata): ImageDimensions {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const swapsAxes =
    metadata.orientation !== undefined &&
    metadata.orientation >= 5 &&
    metadata.orientation <= 8;

  return swapsAxes
    ? { width: height, height: width }
    : { width, height };
}

function deliveryDimensions(config: ResolvedImageConfig): ImageDimensions {
  return config.providerId === "volcengine"
    ? PROVIDER_SOURCE_SIZES.volcengine
    : OPENAI_CROPPED_SIZE;
}

function retainedFractionForCover(
  source: ImageDimensions,
  target: ImageDimensions
) {
  const sourceRatio = source.width / source.height;
  const targetRatio = target.width / target.height;
  return sourceRatio >= targetRatio
    ? targetRatio / sourceRatio
    : sourceRatio / targetRatio;
}

function validateGeneratedMetadata(
  metadata: Metadata,
  config: ResolvedImageConfig,
  reportedSize?: string
) {
  const dimensions = orientedDimensions(metadata);
  if (!SUPPORTED_OUTPUT_FORMATS.has(metadata.format ?? "")) {
    throw imageResponseError(
      "生图接口返回了不支持的图片格式。",
      "IMAGE_FORMAT_UNSUPPORTED"
    );
  }
  if ((metadata.pages ?? 1) > 1) {
    throw imageResponseError(
      "生图接口返回了多帧图片，已阻止展示。",
      "IMAGE_RESULT_MULTIFRAME"
    );
  }
  if (
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width > MAX_GENERATED_IMAGE_EDGE ||
    dimensions.height > MAX_GENERATED_IMAGE_EDGE ||
    dimensions.width * dimensions.height > MAX_GENERATED_IMAGE_PIXELS
  ) {
    throw imageResponseError(
      "生成图片超过最大边长 8000px 或 2400 万像素，已阻止解码。",
      "IMAGE_RESULT_DIMENSIONS_EXCEEDED"
    );
  }

  const requestedDimensions = PROVIDER_SOURCE_SIZES[config.providerId];
  if (
    config.providerId !== "custom" &&
    !sameDimensions(dimensions, requestedDimensions)
  ) {
    throw imageResponseError(
      `生图接口返回 ${dimensions.width}x${dimensions.height}，预期为 ${requestedDimensions.width}x${requestedDimensions.height}，已阻止展示。`,
      "IMAGE_SIZE_MISMATCH"
    );
  }

  if (config.providerId === "custom") {
    const target = deliveryDimensions(config);
    if (
      dimensions.width < target.width ||
      dimensions.height < target.height
    ) {
      throw imageResponseError(
        `生图接口返回 ${dimensions.width}x${dimensions.height}，低于交付所需的 ${target.width}x${target.height}，已阻止放大展示。`,
        "IMAGE_SIZE_MISMATCH"
      );
    }
    if (
      retainedFractionForCover(dimensions, target) <
      MIN_GENERATED_IMAGE_RETAINED_FRACTION
    ) {
      throw imageResponseError(
        `生图接口返回 ${dimensions.width}x${dimensions.height}，画面比例偏差过大，已阻止过度裁切。`,
        "IMAGE_SIZE_MISMATCH"
      );
    }
  }

  const reportedDimensions = parseSizeMetadata(reportedSize);
  if (
    reportedDimensions &&
    !sameDimensions(reportedDimensions, dimensions) &&
    !sameDimensions(reportedDimensions, requestedDimensions)
  ) {
    throw imageResponseError(
      "生图接口返回的尺寸元数据既不匹配实际图片，也不匹配本次请求。",
      "IMAGE_SIZE_MISMATCH"
    );
  }

  return dimensions;
}

async function sanitizeGeneratedImage(
  value: string,
  config: ResolvedImageConfig,
  reportedSize?: string
) {
  if (
    value.length > MAX_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw imageResponseError(
      "生成图片编码无效或体积过大，请降低分辨率后重试。",
      "IMAGE_RESULT_TOO_LARGE"
    );
  }

  const input = Buffer.from(value, "base64");
  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: false,
      sequentialRead: true
    }).metadata();
  } catch {
    throw imageResponseError(
      "生成图片无法安全解码，可能已损坏。",
      "IMAGE_RESULT_DECODE_FAILED"
    );
  }

  validateGeneratedMetadata(metadata, config, reportedSize);
  const targetDimensions = deliveryDimensions(config);

  try {
    const pipeline = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_GENERATED_IMAGE_PIXELS,
      sequentialRead: true
    })
      .rotate()
      .resize({
        width: targetDimensions.width,
        height: targetDimensions.height,
        fit: "cover",
        position: "centre",
        withoutEnlargement: true
      })
      .toColourspace("srgb");

    const result = await pipeline
      .webp({
        quality: 92,
        alphaQuality: 100,
        smartSubsample: true,
        effort: 4
      })
      .toBuffer({ resolveWithObject: true });

    if (
      result.info.width !== targetDimensions.width ||
      result.info.height !== targetDimensions.height
    ) {
      throw imageResponseError(
        "生成图片服务端标准化后的尺寸不正确，已阻止展示。",
        "IMAGE_SIZE_MISMATCH"
      );
    }

    return {
      dataUrl: `data:image/webp;base64,${result.data.toString("base64")}`,
      mimeType: "image/webp",
      dimensions: targetDimensions
    };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw imageResponseError(
      "生成图片未能通过完整解码与隐私清洗，已阻止展示。",
      "IMAGE_RESULT_DECODE_FAILED"
    );
  }
}

async function parseGeneratedImage(
  payload: UpstreamImagePayload,
  config: ResolvedImageConfig,
  referenceImagesUsed: number
): Promise<GeneratedImageAsset> {
  const image = payload.data?.[0];

  if (image?.b64_json) {
    const sanitized = await sanitizeGeneratedImage(
      image.b64_json,
      config,
      image.size || payload.size
    );
    return {
      imageUrl: sanitized.dataUrl,
      mimeType: sanitized.mimeType,
      model: payload.model || config.imageModel,
      size: `${sanitized.dimensions.width}x${sanitized.dimensions.height}`,
      width: sanitized.dimensions.width,
      height: sanitized.dimensions.height,
      referenceImagesUsed,
      revisedPrompt: image.revised_prompt,
      createdAt: new Date().toISOString()
    };
  }

  if (image?.url) {
    throw new ServiceError(
      "生图接口只返回了 URL，无法在安全边界内校验图片真实像素，已阻止展示；请让供应商返回 base64 图片。",
      {
        statusCode: 502,
        code: "IMAGE_RESULT_UNVERIFIABLE"
      }
    );
  }

  throw new ServiceError("生图接口没有返回图片，请重试。", {
    statusCode: 502,
    code: "IMAGE_RESULT_EMPTY"
  });
}

async function readUpstreamImagePayload(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const bytes = Number.parseInt(declaredLength, 10);
    if (bytes > MAX_UPSTREAM_JSON_BYTES) {
      throw imageResponseError(
        "生图接口响应超过 32MiB 安全上限，已停止读取。",
        "IMAGE_RESPONSE_TOO_LARGE"
      );
    }
  }

  if (!response.body) {
    throw imageResponseError(
      "生图接口返回了空响应。",
      "IMAGE_RESPONSE_INVALID"
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_UPSTREAM_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw imageResponseError(
          "生图接口响应超过 32MiB 安全上限，已停止读取。",
          "IMAGE_RESPONSE_TOO_LARGE"
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(
        chunks.map((chunk) =>
          Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        ),
        totalBytes
      )
    );
  } catch {
    throw imageResponseError(
      "生图接口响应不是有效的 UTF-8 JSON。",
      "IMAGE_RESPONSE_INVALID"
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    throw imageResponseError(
      "生图接口响应不是有效 JSON。",
      "IMAGE_RESPONSE_INVALID"
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw imageResponseError(
      "生图接口响应结构不正确。",
      "IMAGE_RESPONSE_INVALID"
    );
  }

  return payload as UpstreamImagePayload;
}

function testConfig(
  providerId: ResolvedImageConfig["providerId"],
  imageModel = "test-image-model"
): ResolvedImageConfig {
  return {
    providerId,
    apiKey: "",
    baseURL: "",
    imageModel
  };
}

export const __imageGenerationTestUtils = {
  maxUpstreamJsonBytes: MAX_UPSTREAM_JSON_BYTES,
  buildImagePrompt(prompt: string, negativePrompt = "") {
    return buildImagePrompt({
      prompt,
      negativePrompt,
      imageType: "detail_page"
    });
  },
  buildProviderRequest(
    providerId: ResolvedImageConfig["providerId"],
    referenceImages: readonly string[] = [],
    imageModel?: string
  ) {
    const config = testConfig(providerId, imageModel);
    const size = resolveRequestedSize(config);
    return {
      size,
      request: buildProviderRequest(config, "test prompt", size, referenceImages)
    };
  },
  readUpstreamImagePayload,
  parseGeneratedImage(
    payload: UpstreamImagePayload,
    providerId: ResolvedImageConfig["providerId"],
    imageModel?: string
  ) {
    return parseGeneratedImage(payload, testConfig(providerId, imageModel), 1);
  },
  applyProviderFraming(
    providerId: ResolvedImageConfig["providerId"],
    prompt = "test prompt"
  ) {
    return applyProviderFraming(prompt, providerId);
  }
} as const;

export async function generateImageFromPrompt(
  input: GenerateImageFromPromptInput
): Promise<GeneratedImageAsset> {
  if (input.signal?.aborted) {
    throw new ServiceError("生图请求已中断。", {
      statusCode: 499,
      code: "IMAGE_GENERATION_ABORTED"
    });
  }
  const referenceImages = await normalizeReferenceImages(input.referenceImages);

  if (!referenceImages.length) {
    throw new ServiceError("缺少产品参考图，已阻止纯文本生图以避免产品外观漂移。", {
      statusCode: 400,
      code: "IMAGE_REFERENCE_REQUIRED"
    });
  }

  const config = resolveImageApiConfig(input.imageProviderConfig);
  const prompt = applyProviderFraming(
    buildImagePrompt({ ...input, referenceImages }),
    config.providerId
  );
  const size = resolveRequestedSize(config);
  const providerRequest = buildProviderRequest(
    config,
    prompt,
    size,
    referenceImages
  );

  if (config.providerId === "custom") {
    await assertPublicCustomEndpoint(config.baseURL);
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, IMAGE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseURL}${providerRequest.path}`, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(providerRequest.contentType === "json"
          ? { "Content-Type": "application/json" }
          : {})
      },
      body:
        providerRequest.contentType === "json"
          ? JSON.stringify(providerRequest.body)
          : providerRequest.body,
      signal: controller.signal
    });
    let payload: UpstreamImagePayload;
    try {
      payload = await readUpstreamImagePayload(response);
    } catch (error) {
      if (
        !response.ok &&
        error instanceof ServiceError &&
        error.code === "IMAGE_RESPONSE_INVALID"
      ) {
        throw mapUpstreamFailure(response.status, undefined, {
          hasReferenceImages: referenceImages.length > 0
        });
      }
      throw error;
    }

    if (!response.ok) {
      throw mapUpstreamFailure(response.status, payload?.error?.code, {
        hasReferenceImages: referenceImages.length > 0
      });
    }

    return await parseGeneratedImage(
      payload,
      config,
      referenceImages.length
    );
  } catch (error) {
    if (error instanceof ServiceError) throw error;

    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      if (input.signal?.aborted && !timedOut) {
        throw new ServiceError("生图请求已中断。", {
          statusCode: 499,
          code: "IMAGE_GENERATION_ABORTED"
        });
      }
      throw new ServiceError("生图请求超时，请稍后重试。", {
        statusCode: 504,
        code: "IMAGE_GENERATION_TIMEOUT"
      });
    }

    throw new ServiceError("无法连接生图服务，请检查网络后重试。", {
      statusCode: 502,
      code: "IMAGE_NETWORK_ERROR"
    });
  } finally {
    clearTimeout(timeoutId);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
}
