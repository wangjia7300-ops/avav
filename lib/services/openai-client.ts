import { ServiceError } from "@/lib/services/errors";
import { createChatCompletion, getEnvProviderConfig } from "@/lib/ai-providers";
import type { AIProviderConfig } from "@/lib/types";
import type { ChatCompletionParams } from "@/lib/ai-providers";

// ── Unified AI chat completion ────────────────────────────────────

export async function createAIChatCompletion(
  providerConfig: AIProviderConfig | null | undefined,
  params: ChatCompletionParams
): Promise<string> {
  // 1. Use user-provided config if available
  if (providerConfig?.apiKey && providerConfig?.model) {
    const result = await createChatCompletion(providerConfig, params);
    return result.text;
  }

  // 2. Fallback to server env (ARK_API_KEY first, then OPENAI_API_KEY)
  const envConfig = getEnvProviderConfig();
  if (envConfig) {
    const result = await createChatCompletion(envConfig, {
      ...params,
      // allow params.model to override the env default
      model: params.model || envConfig.model
    });
    return result.text;
  }

  throw new ServiceError("未配置 AI 供应商，请在页面设置中配置 API Key 和模型，或在 .env.local 中设置 ARK_API_KEY / OPENAI_API_KEY。", {
    statusCode: 401,
    code: "API_KEY_MISSING"
  });
}
