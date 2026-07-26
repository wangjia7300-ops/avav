import {
  MAX_TOTAL_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_COUNT
} from "@/lib/config";
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

type ImageType = "detail_page";

type GenerateImageFromPromptInput = {
  prompt: string;
  negativePrompt?: string;
  imageType: ImageType;
  referenceImages?: readonly string[];
  imageProviderConfig?: ImageProviderConfig | null;
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
const MAX_ASPECT_RATIO_RELATIVE_ERROR = 0.01;
const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;

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

function estimateBase64Bytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function inferBase64MimeType(value: string) {
  if (value.startsWith("iVBOR")) return "image/png";
  if (value.startsWith("/9j/")) return "image/jpeg";
  if (value.startsWith("UklGR")) return "image/webp";
  return null;
}

function normalizeReferenceImages(referenceImages?: readonly string[]) {
  if (referenceImages === undefined) return [];

  if (!Array.isArray(referenceImages)) {
    throw new ServiceError("产品参考图格式不正确。", {
      statusCode: 400,
      code: "IMAGE_REFERENCE_INVALID"
    });
  }

  if (referenceImages.length > MAX_UPLOAD_IMAGE_COUNT) {
    throw new ServiceError(`生图最多支持 ${MAX_UPLOAD_IMAGE_COUNT} 张产品参考图。`, {
      statusCode: 400,
      code: "IMAGE_REFERENCE_LIMIT_EXCEEDED"
    });
  }

  let totalBytes = 0;
  const uniqueReferences: string[] = [];
  const seenReferences = new Set<string>();

  referenceImages.forEach((value, index) => {
    if (typeof value !== "string") {
      throw new ServiceError(`第 ${index + 1} 张产品参考图格式不正确。`, {
        statusCode: 400,
        code: "IMAGE_REFERENCE_INVALID"
      });
    }

    const match = DATA_URL_PATTERN.exec(value);
    if (!match) {
      throw new ServiceError("产品参考图必须是 JPG、PNG 或 WEBP 的 data URL。", {
        statusCode: 400,
        code: "IMAGE_REFERENCE_INVALID"
      });
    }

    const declaredMimeType = match[1].toLowerCase();
    const base64 = match[2];
    const detectedMimeType = inferBase64MimeType(base64);
    if (detectedMimeType !== declaredMimeType) {
      throw new ServiceError(`第 ${index + 1} 张产品参考图的内容与文件类型不一致。`, {
        statusCode: 400,
        code: "IMAGE_REFERENCE_INVALID"
      });
    }

    const estimatedBytes = estimateBase64Bytes(base64);
    if (!estimatedBytes || estimatedBytes > MAX_UPLOAD_IMAGE_BYTES) {
      throw new ServiceError(`第 ${index + 1} 张产品参考图过大，请压缩后重试。`, {
        statusCode: 413,
        code: "IMAGE_REFERENCE_TOO_LARGE"
      });
    }

    totalBytes += estimatedBytes;
    if (!seenReferences.has(value)) {
      seenReferences.add(value);
      uniqueReferences.push(value);
    }
  });

  if (totalBytes > MAX_TOTAL_UPLOAD_IMAGE_BYTES) {
    throw new ServiceError("产品参考图总大小过大，请移除或压缩部分图片后重试。", {
      statusCode: 413,
      code: "IMAGE_REFERENCE_TOTAL_TOO_LARGE"
    });
  }

  return uniqueReferences;
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

  return [
    prompt,
    negativePrompt ? `需要避免：${negativePrompt}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function resolveRequestedSize(config: ResolvedImageConfig) {
  if (config.providerId === "volcengine") {
    return "1440x2560";
  }

  if (
    config.providerId === "openai" &&
    !/^gpt-image-2(?:$|-)/i.test(config.imageModel)
  ) {
    throw new ServiceError(
      "当前 OpenAI 生图模型不支持严格 9:16 自定义尺寸；请改用 GPT Image 2 或支持 1440x2560 的火山方舟模型。",
      {
        statusCode: 400,
        code: "IMAGE_ASPECT_RATIO_UNSUPPORTED"
      }
    );
  }

  if (config.providerId === "openai" && /^gpt-image-2(?:$|-)/i.test(config.imageModel)) {
    return "1440x2560";
  }

  return "1440x2560";
}

function supportsOpenAIReferenceImages(model: string) {
  return /^(?:gpt-image-|chatgpt-image-)/i.test(model.trim());
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

  if (!/^gpt-image-2(?:$|-)/i.test(config.imageModel)) {
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
    if (referenceImages.length && !supportsOpenAIReferenceImages(config.imageModel)) {
      throw new ServiceError(
        "当前生图模型不支持产品参考图，请改用 GPT Image 模型或火山方舟 Seedream。",
        {
          statusCode: 400,
          code: "IMAGE_REFERENCE_UNSUPPORTED"
        }
      );
    }

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

function detectBase64MimeType(value: string) {
  const mimeType = inferBase64MimeType(value);
  if (mimeType) return mimeType;

  throw new ServiceError("生图接口返回了不支持的图片格式。", {
    statusCode: 502,
    code: "IMAGE_FORMAT_UNSUPPORTED"
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

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda || offset + 2 > buffer.length) break;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }

    offset += segmentLength;
  }

  return null;
}

function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }

  if (
    chunkType === "VP8 " &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }

  if (chunkType === "VP8L" && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff)
    };
  }

  return null;
}

function readBase64Dimensions(value: string, mimeType: string): ImageDimensions {
  const buffer = Buffer.from(value, "base64");
  let dimensions: ImageDimensions | null = null;

  if (mimeType === "image/png" && buffer.length >= 24) {
    dimensions = {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  } else if (mimeType === "image/jpeg") {
    dimensions = readJpegDimensions(buffer);
  } else if (mimeType === "image/webp") {
    dimensions = readWebpDimensions(buffer);
  }

  if (!dimensions?.width || !dimensions.height) {
    throw new ServiceError("无法读取生成图片的实际尺寸。", {
      statusCode: 502,
      code: "IMAGE_SIZE_INVALID"
    });
  }

  return dimensions;
}

function verifyImageDimensions(
  dimensions: ImageDimensions
) {
  const expectedRatio = 9 / 16;
  const actualRatio = dimensions.width / dimensions.height;
  const relativeError = Math.abs(actualRatio - expectedRatio) / expectedRatio;

  if (relativeError > MAX_ASPECT_RATIO_RELATIVE_ERROR) {
    throw new ServiceError(
      `生图接口返回 ${dimensions.width}x${dimensions.height}，不符合 9:16 画幅要求，已阻止展示。`,
      {
        statusCode: 502,
        code: "IMAGE_ASPECT_RATIO_MISMATCH"
      }
    );
  }
}

function verifiedOutputDimensions(
  reportedSize: string | undefined,
  actualDimensions: ImageDimensions | null
) {
  const reportedDimensions = parseSizeMetadata(reportedSize);

  if (
    reportedDimensions &&
    actualDimensions &&
    (reportedDimensions.width !== actualDimensions.width ||
      reportedDimensions.height !== actualDimensions.height)
  ) {
    throw new ServiceError("生图接口返回的尺寸元数据与实际图片不一致。", {
      statusCode: 502,
      code: "IMAGE_SIZE_MISMATCH"
    });
  }

  const dimensions = actualDimensions ?? reportedDimensions;
  if (!dimensions) {
    throw new ServiceError("生图接口未返回可校验的尺寸信息。", {
      statusCode: 502,
      code: "IMAGE_SIZE_MISSING"
    });
  }

  verifyImageDimensions(dimensions);
  return dimensions;
}

function parseGeneratedImage(
  payload: UpstreamImagePayload,
  config: ResolvedImageConfig,
  referenceImagesUsed: number
): GeneratedImageAsset {
  const image = payload.data?.[0];

  if (image?.b64_json) {
    if (image.b64_json.length > MAX_BASE64_LENGTH) {
      throw new ServiceError("生成图片体积过大，请降低分辨率后重试。", {
        statusCode: 502,
        code: "IMAGE_RESULT_TOO_LARGE"
      });
    }

    const mimeType = detectBase64MimeType(image.b64_json);
    const dimensions = verifiedOutputDimensions(
      image.size || payload.size,
      readBase64Dimensions(image.b64_json, mimeType)
    );
    return {
      imageUrl: `data:${mimeType};base64,${image.b64_json}`,
      mimeType,
      model: payload.model || config.imageModel,
      size: `${dimensions.width}x${dimensions.height}`,
      width: dimensions.width,
      height: dimensions.height,
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

export async function generateImageFromPrompt(
  input: GenerateImageFromPromptInput
): Promise<GeneratedImageAsset> {
  const referenceImages = normalizeReferenceImages(input.referenceImages);

  if (!referenceImages.length) {
    throw new ServiceError("缺少产品参考图，已阻止纯文本生图以避免产品外观漂移。", {
      statusCode: 400,
      code: "IMAGE_REFERENCE_REQUIRED"
    });
  }

  const prompt = buildImagePrompt({ ...input, referenceImages });

  const config = resolveImageApiConfig(input.imageProviderConfig);
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
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);

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
    const payload = (await response.json().catch(() => null)) as UpstreamImagePayload | null;

    if (!response.ok || !payload) {
      throw mapUpstreamFailure(response.status, payload?.error?.code, {
        hasReferenceImages: referenceImages.length > 0
      });
    }

    return parseGeneratedImage(
      payload,
      config,
      referenceImages.length
    );
  } catch (error) {
    if (error instanceof ServiceError) throw error;

    if (error instanceof DOMException && error.name === "AbortError") {
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
  }
}
