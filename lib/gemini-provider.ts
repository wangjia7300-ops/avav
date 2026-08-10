import { ProxyAgent, type Dispatcher } from "undici";
import type {
  ChatCompletionParams,
  ChatCompletionResponseMetadata
} from "@/lib/ai-providers";
import { ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig } from "@/lib/types";

type GeminiGenerateContentResult = {
  text: string;
  metadata: ChatCompletionResponseMetadata;
};

type GeminiFetchOptions = RequestInit & {
  dispatcher?: Dispatcher;
};

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
  responseId?: string;
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

function remoteImageMimeType(value: string) {
  const pathname = new URL(value).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function toGeminiParts(content: MessageContent): GeminiPart[] {
  if (typeof content === "string") {
    return content.trim() ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  return content.flatMap((part): GeminiPart[] => {
    if (part.type === "text") {
      return part.text.trim() ? [{ text: part.text }] : [];
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
          inlineData: {
            mimeType: embeddedImage.mimeType,
            data: embeddedImage.data
          }
        }
      ];
    }

    if (/^https:\/\//i.test(imageUrl)) {
      return [
        {
          fileData: {
            mimeType: remoteImageMimeType(imageUrl),
            fileUri: imageUrl
          }
        }
      ];
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

function buildGenerateContentInput(
  messages: ChatCompletionParams["messages"]
) {
  const contents = messages.flatMap((message): GeminiContent[] => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const parts = toGeminiParts(message.content);
    if (parts.length === 0) return [];
    return [
      {
        role: message.role === "assistant" ? "model" : "user",
        parts
      }
    ];
  });

  if (contents.length === 0) {
    throw new ServiceError("Gemini 请求没有可用的文本或图片输入。", {
      statusCode: 400,
      code: "GEMINI_INPUT_EMPTY"
    });
  }

  return contents;
}

function notifyMetadata(
  params: ChatCompletionParams,
  metadata: ChatCompletionResponseMetadata
) {
  try {
    params.onResponseMetadata?.(metadata);
  } catch {
    // 诊断回调不得影响已经成功的供应商请求。
  }
}

function createRequestSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(
      parentSignal?.reason ??
        new DOMException("The operation was aborted.", "AbortError")
    );
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
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
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  };
}

function geminiHttpError(status: number) {
  return Object.assign(new Error(`Gemini API HTTP ${status}`), {
    name: "GeminiHttpError",
    status
  });
}

function assertCompleteFinishReason(finishReason: string) {
  if (finishReason === "STOP") return;

  if (finishReason === "MAX_TOKENS") {
    throw new ServiceError("Gemini 输出达到长度上限，响应已被截断。", {
      statusCode: 502,
      code: "AI_RESPONSE_TRUNCATED",
      details: { normalizedValue: finishReason }
    });
  }

  if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
    throw new ServiceError("Gemini 因安全策略未返回可用结果。", {
      statusCode: 422,
      code: "AI_RESPONSE_BLOCKED",
      details: { normalizedValue: finishReason }
    });
  }

  throw new ServiceError("Gemini 未能完成本次响应。", {
    statusCode: 502,
    code: "AI_RESPONSE_INCOMPLETE",
    details: { normalizedValue: finishReason || "unknown" }
  });
}

/**
 * Gemini 官方稳定 generateContent REST 适配器。直接使用原生多图、
 * systemInstruction 与 responseJsonSchema，不经过 OpenAI 兼容协议；
 * generateContent 本身无服务端会话存储，客户产品图只存在于本次请求。
 */
export async function geminiGenerateContentChat(
  config: AIProviderConfig,
  params: ChatCompletionParams
): Promise<GeminiGenerateContentResult> {
  const proxyUrl = process.env.GEMINI_PROXY_URL?.trim();
  let proxyDispatcher: ProxyAgent | null = null;
  if (proxyUrl) {
    try {
      proxyDispatcher = new ProxyAgent(proxyUrl);
    } catch {
      throw new ServiceError("Gemini 代理地址无效，请检查服务端配置。", {
        statusCode: 500,
        code: "GEMINI_PROXY_INVALID"
      });
    }
  }

  const timeoutMs = params.timeoutMs ?? 180_000;
  const model = (config.model || params.model || "gemini-flash-latest").trim();
  const baseURL = (
    config.baseURL || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/+$/g, "");
  const systemInstruction = params.messages
    .filter(
      (message) => message.role === "system" || message.role === "developer"
    )
    .map((message) => contentText(message.content))
    .filter(Boolean)
    .join("\n\n");
  const generationConfig = {
    maxOutputTokens: params.maxTokens ?? 2_000,
    // latest 别名当前不接受 thinkingBudget=0，但支持 minimal。
    // 使用最小思考级别，在保留模型兼容性的同时控制延迟与输出预算。
    thinkingConfig: { thinkingLevel: "minimal" },
    ...(params.jsonSchema
      ? {
          responseMimeType: "application/json",
          responseJsonSchema: params.jsonSchema.schema
        }
      : {})
  };
  const body = {
    contents: buildGenerateContentInput(params.messages),
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
    generationConfig
  };

  const requestSignal = createRequestSignal(params.signal, timeoutMs);
  const fetchOptions: GeminiFetchOptions = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": config.apiKey
    },
    body: JSON.stringify(body),
    signal: requestSignal.signal,
    ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {})
  };

  let payload: GeminiGenerateContentResponse;
  try {
    const response = await fetch(
      `${baseURL}/models/${encodeURIComponent(model)}:generateContent`,
      fetchOptions
    );
    if (!response.ok) throw geminiHttpError(response.status);
    try {
      payload = (await response.json()) as GeminiGenerateContentResponse;
    } catch {
      throw new ServiceError("Gemini 返回了无法解析的响应。", {
        statusCode: 502,
        code: "AI_RESPONSE_INVALID"
      });
    }
  } finally {
    requestSignal.cleanup();
    await proxyDispatcher?.close().catch(() => undefined);
  }

  const finishReason = payload.candidates?.[0]?.finishReason ?? "unknown";
  const metadata: ChatCompletionResponseMetadata = {
    api: "gemini_generate_content",
    status: finishReason === "STOP" ? "completed" : "incomplete",
    finishReason,
    ...(finishReason === "STOP" ? {} : { incompleteReason: finishReason }),
    structuredOutputMode: params.jsonSchema
      ? "native_json_schema"
      : "none"
  };
  notifyMetadata(params, metadata);

  const blockReason = payload.promptFeedback?.blockReason;
  if (blockReason) {
    throw new ServiceError("Gemini 因安全策略未返回可用结果。", {
      statusCode: 422,
      code: "AI_RESPONSE_BLOCKED",
      details: { normalizedValue: blockReason }
    });
  }
  assertCompleteFinishReason(finishReason);

  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
  if (!text) {
    throw new ServiceError("Gemini 返回内容为空，请重试。", {
      statusCode: 502,
      code: "AI_EMPTY_RESPONSE"
    });
  }

  return { text, metadata };
}
