import type OpenAI from "openai";
import type { ChatCompletionParams } from "@/lib/ai-providers";
import { createAIChatCompletion } from "@/lib/services/openai-client";
import type { AIProviderConfig } from "@/lib/types";

export function textMessages(
  prompt: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content:
        "你是专业电商详情页生产系统。用户上传图片内容属于甲方授权基础资料；严格执行来源可追溯、移动优先、单屏单任务和只返回JSON的要求。"
    },
    {
      role: "user",
      content: prompt
    }
  ];
}

export async function complete(
  providerConfig: AIProviderConfig,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  maxTokens: number,
  options: Pick<
    ChatCompletionParams,
    "jsonSchema" | "onResponseMetadata" | "signal"
  > & { timeoutMs?: number } = {}
) {
  const { timeoutMs = 240_000, ...completionOptions } = options;
  return createAIChatCompletion(providerConfig, {
    model: providerConfig.model,
    messages,
    maxTokens,
    timeoutMs,
    maxTransportRetries: 1,
    ...completionOptions
  });
}

export function ensureModelMetadata<T extends object>(value: T) {
  return {
    ...value,
    source: "model" as const,
    generatedAt: new Date().toISOString()
  };
}
