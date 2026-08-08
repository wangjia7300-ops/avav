import type { ImageProviderConfig, ImageProviderId } from "@/lib/types";

export type ImageProviderPreset = {
  id: ImageProviderId;
  name: string;
  baseURL: string;
  defaultModel: string;
  description: string;
  modelPlaceholder: string;
};

export const IMAGE_PROVIDER_PRESETS: ImageProviderPreset[] = [
  {
    id: "volcengine",
    name: "火山方舟 Ark",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "",
    description: "使用 Seedream 图片生成模型，与策划模型的接入点完全独立。",
    modelPlaceholder: "Seedream Model ID 或生图 ep-... 接入点 ID"
  },
  {
    id: "openai",
    name: "OpenAI Images",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-image-2",
    description: "使用 OpenAI 原生竖图尺寸生成，并在服务端按安全区裁为严格 9:16。",
    modelPlaceholder: "例如：gpt-image-2（旧配置仍保留原模型）"
  },
  {
    id: "custom",
    name: "自定义 Images API",
    baseURL: "",
    defaultModel: "",
    description: "连接兼容 OpenAI Images API 的公开 HTTPS 服务；按竖图尺寸生成后裁为 9:16。",
    modelPlaceholder: "输入兼容 Images API 的生图模型"
  }
];

const IMAGE_PROVIDER_IDS = new Set<ImageProviderId>(["openai", "volcengine", "custom"]);

export function getImageProviderPreset(providerId: ImageProviderId) {
  return IMAGE_PROVIDER_PRESETS.find((provider) => provider.id === providerId);
}

export function createImageProviderDraft(
  providerId: ImageProviderId = "volcengine"
): ImageProviderConfig {
  const preset = getImageProviderPreset(providerId);

  return {
    scope: "image_generation",
    providerId,
    apiKey: "",
    baseURL: preset?.baseURL ?? "",
    imageModel: preset?.defaultModel ?? ""
  };
}

export function normalizeImageProviderConfig(
  config: ImageProviderConfig
): ImageProviderConfig {
  return {
    scope: config.scope,
    providerId: config.providerId,
    apiKey: config.apiKey.trim(),
    baseURL: config.baseURL.trim(),
    imageModel: config.imageModel.trim()
  };
}

export function parseImageProviderConfig(value: unknown): ImageProviderConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (
    candidate.scope !== "image_generation" ||
    typeof candidate.providerId !== "string" ||
    !IMAGE_PROVIDER_IDS.has(candidate.providerId as ImageProviderId) ||
    typeof candidate.apiKey !== "string" ||
    typeof candidate.baseURL !== "string" ||
    typeof candidate.imageModel !== "string"
  ) {
    return null;
  }

  return normalizeImageProviderConfig(candidate as ImageProviderConfig);
}

export function isImageProviderConfigComplete(config: ImageProviderConfig) {
  const normalized = normalizeImageProviderConfig(config);

  if (
    normalized.scope !== "image_generation" ||
    !normalized.apiKey ||
    !normalized.imageModel
  ) {
    return false;
  }
  if (normalized.providerId !== "custom") return true;

  return /^https:\/\//i.test(normalized.baseURL);
}

export function imageProviderConfigSignature(config: ImageProviderConfig) {
  const normalized = normalizeImageProviderConfig(config);

  return [
    normalized.scope,
    normalized.providerId,
    normalized.baseURL,
    normalized.imageModel,
    normalized.apiKey
  ].join("\u0000");
}
