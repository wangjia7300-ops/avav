import { GoogleGenAI, type Interactions } from "@google/genai";
import type {
  ChatCompletionParams,
  ChatCompletionResponseMetadata
} from "@/lib/ai-providers";
import { ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig } from "@/lib/types";

type GeminiInteractionResult = {
  text: string;
  metadata: ChatCompletionResponseMetadata;
};

type MessageContent = ChatCompletionParams["messages"][number]["content"];

function contentText(content: MessageContent) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function parseBase64Image(value: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(
    value
  );
  if (!match) return null;

  return {
    mimeType: match[1],
    data: match[2].replace(/\s+/g, "")
  };
}

function toGeminiContent(content: MessageContent): Interactions.Content[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  return content.flatMap((part): Interactions.Content[] => {
    if (part.type === "text") {
      return part.text.trim() ? [{ type: "text", text: part.text }] : [];
    }

    if (part.type !== "image_url") return [];

    const imageUrl =
      typeof part.image_url === "string"
        ? part.image_url
        : part.image_url.url;
    const embeddedImage = parseBase64Image(imageUrl);
    if (embeddedImage) {
      return [
        {
          type: "image",
          data: embeddedImage.data,
          mime_type: embeddedImage.mimeType
        }
      ];
    }

    if (/^https:\/\//i.test(imageUrl)) {
      return [{ type: "image", uri: imageUrl }];
    }

    throw new ServiceError(
      "Gemini 图片格式不支持，请上传本地图片或可访问的 HTTPS 图片。",
      {
        statusCode: 400,
        code: "GEMINI_IMAGE_INPUT_INVALID"
      }
    );
  });
}

function buildInteractionInput(
  messages: ChatCompletionParams["messages"]
): Interactions.CreateModelInteractionParamsNonStreaming["input"] {
  const conversationalMessages = messages.filter(
    (message) => message.role !== "system" && message.role !== "developer"
  );

  if (
    conversationalMessages.length === 1 &&
    conversationalMessages[0].role === "user"
  ) {
    const content = toGeminiContent(conversationalMessages[0].content);
    if (content.length > 0) return content;
  }

  const turns = conversationalMessages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const content = toGeminiContent(message.content);
    if (content.length === 0) return [];
    return [
      {
        role: message.role === "assistant" ? "model" : "user",
        content
      }
    ];
  });

  if (turns.length === 0) {
    throw new ServiceError("Gemini 请求没有可用的文本或图片输入。", {
      statusCode: 400,
      code: "GEMINI_INPUT_EMPTY"
    });
  }

  return turns;
}

function notifyMetadata(
  params: ChatCompletionParams,
  metadata: ChatCompletionResponseMetadata
) {
  try {
    params.onResponseMetadata?.(metadata);
  } catch {
    // 诊断回调不得影响已成功的供应商请求。
  }
}

function assertCompleted(status: string) {
  if (status === "completed") return;

  if (status === "incomplete") {
    throw new ServiceError("Gemini 输出未完成，响应已被截断。", {
      statusCode: 502,
      code: "AI_RESPONSE_TRUNCATED",
      details: { normalizedValue: status }
    });
  }

  if (status === "budget_exceeded") {
    throw new ServiceError("Gemini 本次响应超出模型计算预算。", {
      statusCode: 502,
      code: "AI_RESPONSE_BUDGET_EXCEEDED",
      details: { normalizedValue: status }
    });
  }

  throw new ServiceError("Gemini 未能完成本次响应。", {
    statusCode: 502,
    code: "AI_RESPONSE_INCOMPLETE",
    details: { normalizedValue: status || "unknown" }
  });
}

function combineParentSignalWithDeadline(
  parentSignal: AbortSignal,
  timeoutMs: number
) {
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(
      parentSignal.reason ??
        new DOMException("The operation was aborted.", "AbortError")
    );
  };

  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeoutId = controller.signal.aborted
    ? undefined
    : setTimeout(() => {
        controller.abort(
          Object.assign(new Error("Gemini request timed out."), {
            name: "APIConnectionTimeoutError",
            code: "ETIMEDOUT"
          })
        );
      }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      parentSignal.removeEventListener("abort", abortFromParent);
    }
  };
}

/**
 * Google 官方原生 Interactions API 适配器。它不依赖 OpenAI
 * 兼容层，因此可以保留 Gemini 的多图输入、原生 JSON
 * Schema 与完整交互状态。
 */
export async function geminiInteractionsChat(
  config: AIProviderConfig,
  params: ChatCompletionParams
): Promise<GeminiInteractionResult> {
  const client = new GoogleGenAI({ apiKey: config.apiKey });
  const timeoutMs = params.timeoutMs ?? 180_000;
  const systemInstruction = params.messages
    .filter(
      (message) => message.role === "system" || message.role === "developer"
    )
    .map((message) => contentText(message.content))
    .filter(Boolean)
    .join("\n\n");

  const request: Interactions.CreateModelInteractionParamsNonStreaming = {
    model: config.model || params.model || "gemini-3.6-flash",
    stream: false,
    // Interactions 默认会存储交互。客户产品图不得进入
    // 长期保留链路，所以所有前台任务强制关闭存储。
    store: false,
    ...(systemInstruction
      ? { system_instruction: systemInstruction }
      : {}),
    input: buildInteractionInput(params.messages),
    ...(params.jsonSchema
      ? {
          response_format: {
            type: "text" as const,
            mime_type: "application/json" as const,
            schema: params.jsonSchema.schema
          }
        }
      : {}),
    generation_config: {
      max_output_tokens: params.maxTokens ?? 2_000
    }
  };

  const combinedSignal = params.signal
    ? combineParentSignalWithDeadline(params.signal, timeoutMs)
    : null;
  let response: Awaited<
    ReturnType<typeof client.interactions.create>
  >;
  try {
    response = await client.interactions.create(request, {
      timeout: timeoutMs,
      maxRetries: 0,
      ...(combinedSignal
        ? { fetchOptions: { signal: combinedSignal.signal } }
        : {})
    });
  } finally {
    combinedSignal?.cleanup();
  }
  if (
    response &&
    typeof response === "object" &&
    Symbol.asyncIterator in response
  ) {
    throw new ServiceError("Gemini 返回了非预期的流式响应。", {
      statusCode: 502,
      code: "AI_RESPONSE_INCOMPLETE"
    });
  }
  const interaction = response as {
    status?: string;
    output_text?: string;
  };
  const status = interaction.status ?? "unknown";
  const metadata: ChatCompletionResponseMetadata = {
    api: "gemini_interactions",
    status,
    ...(status === "completed" ? {} : { incompleteReason: status }),
    structuredOutputMode: params.jsonSchema
      ? "native_json_schema"
      : "none"
  };
  notifyMetadata(params, metadata);
  assertCompleted(status);

  const text = interaction.output_text?.trim() ?? "";
  if (!text) {
    throw new ServiceError("Gemini 返回内容为空，请重试。", {
      statusCode: 502,
      code: "AI_EMPTY_RESPONSE"
    });
  }

  return { text, metadata };
}
