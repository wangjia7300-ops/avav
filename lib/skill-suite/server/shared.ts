import type OpenAI from "openai";
import type { ChatCompletionParams } from "@/lib/ai-providers";
import { createAIChatCompletion } from "@/lib/services/openai-client";
import { logCost } from "@/lib/cost-tracker";
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
  > & {
    timeoutMs?: number;
    /** 成本追踪：阶段标识 */
    costStage?: string;
    /** 成本追踪：操作描述 */
    costOperation?: string;
    /** 成本追踪：输入图片数量 */
    costImageCount?: number;
  } = {}
) {
  const { timeoutMs = 240_000, costStage, costOperation, costImageCount, ...completionOptions } = options;
  const result = await createAIChatCompletion(providerConfig, {
    model: providerConfig.model,
    messages,
    maxTokens,
    timeoutMs,
    maxTransportRetries: 1,
    ...completionOptions
  });

  // 记录成本
  if (costStage) {
    logCost({
      stage: costStage,
      operation: costOperation ?? costStage,
      model: providerConfig.model,
      providerId: providerConfig.providerId,
      inputText: JSON.stringify(messages),
      outputText: result,
      imageCount: costImageCount
    });
  }

  return result;
}

export function ensureModelMetadata<T extends object>(value: T) {
  return {
    ...value,
    source: "model" as const,
    generatedAt: new Date().toISOString()
  };
}
