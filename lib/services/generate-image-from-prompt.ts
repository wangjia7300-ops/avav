import OpenAI from "openai";
import { ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig, GeneratedImageAsset } from "@/lib/types";

type GenerateImageFromPromptInput = {
  prompt: string;
  negativePrompt?: string;
  imageType?: "main_image" | "detail_page";
  providerConfig?: AIProviderConfig | null;
  size?: string;
};

function resolveImageApiConfig(providerConfig?: AIProviderConfig | null) {
  if (providerConfig?.apiKey && providerConfig.providerId === "openai") {
    return {
      apiKey: providerConfig.apiKey,
      baseURL: providerConfig.baseURL || "https://api.openai.com/v1"
    };
  }

  if (providerConfig?.apiKey && /api\.openai\.com\/v1\/?$/i.test(providerConfig.baseURL)) {
    return {
      apiKey: providerConfig.apiKey,
      baseURL: providerConfig.baseURL
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://api.openai.com/v1"
    };
  }

  throw new ServiceError("未配置 OpenAI 生图 API Key。请在页面选择 OpenAI 供应商，或在 .env.local 中设置 OPENAI_API_KEY。", {
    statusCode: 401,
    code: "IMAGE_API_KEY_MISSING"
  });
}

function normalizeImageSize(imageType?: "main_image" | "detail_page", size?: string) {
  if (size) return size;
  return imageType === "detail_page" ? "1024x1536" : "1024x1024";
}

function buildImagePrompt(prompt: string, negativePrompt?: string) {
  const cleanPrompt = prompt.trim();
  const cleanNegative = negativePrompt?.trim();

  if (!cleanPrompt) {
    throw new ServiceError("生图提示词不能为空。", {
      statusCode: 400,
      code: "IMAGE_PROMPT_EMPTY"
    });
  }

  if (cleanPrompt.length > 12000) {
    throw new ServiceError("生图提示词过长，请先精简提示词后再生成图片。", {
      statusCode: 400,
      code: "IMAGE_PROMPT_TOO_LONG"
    });
  }

  return cleanNegative
    ? `${cleanPrompt}\n\n负面约束：${cleanNegative}`
    : cleanPrompt;
}

function mimeTypeFromFormat(format: "png" | "jpeg" | "webp") {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

export async function generateImageFromPrompt(
  input: GenerateImageFromPromptInput
): Promise<GeneratedImageAsset> {
  const config = resolveImageApiConfig(input.providerConfig);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = normalizeImageSize(input.imageType, input.size);
  const outputFormat: "png" | "jpeg" | "webp" = "png";

  try {
    const response = await client.images.generate(
      {
        model,
        prompt: buildImagePrompt(input.prompt, input.negativePrompt),
        size,
        n: 1,
        quality: "medium",
        output_format: outputFormat
      },
      {
        timeout: Number(process.env.IMAGE_REQUEST_TIMEOUT_MS) || 180000
      }
    );

    const image = response.data?.[0];
    const mimeType = mimeTypeFromFormat(response.output_format ?? outputFormat);

    if (image?.b64_json) {
      return {
        imageUrl: `data:${mimeType};base64,${image.b64_json}`,
        mimeType,
        model,
        size,
        revisedPrompt: image.revised_prompt,
        createdAt: new Date().toISOString()
      };
    }

    if (image?.url) {
      return {
        imageUrl: image.url,
        mimeType,
        model,
        size,
        revisedPrompt: image.revised_prompt,
        createdAt: new Date().toISOString()
      };
    }

    throw new ServiceError("生图接口没有返回图片数据，请重试。", {
      statusCode: 502,
      code: "IMAGE_RESULT_EMPTY"
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "未知错误";
    throw new ServiceError(`生图失败：${message}`, {
      statusCode: 502,
      code: "IMAGE_GENERATION_FAILED"
    });
  }
}
