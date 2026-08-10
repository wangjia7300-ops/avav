import OpenAI from "openai";
import {
  ServiceError,
  type SafeApiErrorDetails
} from "@/lib/services/errors";
import type { AIProviderConfig, AIProviderId } from "@/lib/types";

const DEFAULT_AI_REQUEST_TIMEOUT_MS = 180_000;
const MIN_AI_REQUEST_TIMEOUT_MS = 10_000;
const MAX_AI_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_AI_TRANSPORT_RETRIES = 2;
const MAX_AI_TRANSPORT_RETRIES = 2;
const AI_RETRY_BASE_DELAY_MS = 500;
const MIN_RETRY_BUDGET_RATIO = 0.75;
const SDK_TIMEOUT_BUDGET_RATIO = 0.9;

// ── Preset definitions ────────────────────────────────────────────

export type ProviderPreset = {
  id: AIProviderId;
  name: string;
  baseURL: string;
  models: string[];
  requiresAuth: boolean;
  description: string;
  visionSupport: "supported" | "depends" | "not_supported";
  visionNote: string;
};

const VOLCENGINE_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const GEMINI_GENERATE_CONTENT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
const ARK_ENDPOINT_ID_PATTERN = /^ep-[a-z0-9-]+$/i;

export const PRESET_PROVIDERS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini"],
    requiresAuth: true,
    description: "GPT 系列模型，支持视觉识别和结构化输出。",
    visionSupport: "supported",
    visionNote: "支持图片理解"
  },
  {
    id: "volcengine",
    name: "火山方舟 Ark",
    baseURL: VOLCENGINE_ARK_BASE_URL,
    models: [],
    requiresAuth: true,
    description: "豆包/Seed 系列模型。模型字段支持官方模型名称或火山方舟 ep-... 推理接入点 ID。",
    visionSupport: "depends",
    visionNote: "取决于接入点是否开通视觉理解"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseURL: GEMINI_GENERATE_CONTENT_BASE_URL,
    models: [
      "gemini-flash-latest",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite"
    ],
    requiresAuth: true,
    description:
      "Gemini 原生 generateContent API，支持多图理解与 JSON Schema 结构化输出。",
    visionSupport: "supported",
    visionNote: "支持1–9张产品图片理解"
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    baseURL: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"],
    requiresAuth: true,
    description: "Claude 系列模型，支持图片理解，长文本和结构化输出能力强。",
    visionSupport: "supported",
    visionNote: "支持图片理解"
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-plus", "glm-4v-plus"],
    requiresAuth: true,
    description: "GLM 系列模型，支持 OpenAI 兼容接口；请选择带 v 的视觉模型用于产品图片识别。",
    visionSupport: "depends",
    visionNote: "请选择视觉模型，例如 glm-4v-plus"
  },
  {
    id: "custom",
    name: "自定义供应商",
    baseURL: "",
    models: [],
    requiresAuth: true,
    description: "输入任意兼容 OpenAI Chat Completions API 的端点地址。",
    visionSupport: "depends",
    visionNote: "取决于自定义模型是否支持图片输入"
  }
];

// ── Unified chat completion params ────────────────────────────────

export type ChatCompletionParams = {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxTransportRetries?: number;
  enableWebSearch?: boolean;
  onResponseMetadata?: (metadata: ChatCompletionResponseMetadata) => void;
};

export type ChatCompletionResponseMetadata = {
  api:
    | "chat_completions"
    | "responses"
    | "anthropic"
    | "gemini_generate_content";
  status?: string;
  finishReason?: string;
  incompleteReason?: string;
  structuredOutputMode: "none" | "native_json_schema" | "instruction_fallback";
  nativeJsonSchemaUnsupported?: boolean;
};

type ChatCompletionResult = {
  text: string;
  metadata?: ChatCompletionResponseMetadata;
};

function isArkEndpointId(value: string) {
  return ARK_ENDPOINT_ID_PATTERN.test(value.trim());
}

function normalizeProviderBaseURL(baseURL: string) {
  return baseURL
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/responses$/i, "");
}

function isHttpURL(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function resolveCompatibleConfig(config: AIProviderConfig) {
  const rawBaseURL = config.baseURL.trim();
  const rawModel = config.model.trim();

  if (isArkEndpointId(rawBaseURL)) {
    return {
      baseURL: VOLCENGINE_ARK_BASE_URL,
      model: rawBaseURL,
      useResponsesAPI: true,
      note: "检测到火山方舟接入点 ID 已填在 Endpoint 字段，已自动作为模型 ID 调用。"
    };
  }

  if (rawBaseURL && !isHttpURL(rawBaseURL)) {
    throw new ServiceError(
      "API Endpoint 必须是 https:// 开头的网址。火山方舟的 ep-... 是接入点 ID，请填到「模型」字段，或直接选择「火山方舟 Ark」供应商。",
      {
        statusCode: 400,
        code: "API_ENDPOINT_INVALID"
      }
    );
  }

  return {
    baseURL: normalizeProviderBaseURL(
      rawBaseURL || (config.providerId === "volcengine" ? VOLCENGINE_ARK_BASE_URL : "")
    ),
    model: rawModel,
    // 火山方舟 v3 的官方 OpenAI SDK 示例使用 Responses API。
    // 模型名称与 ep-... 推理接入点都统一走同一适配器，避免图片消息协议混用。
    useResponsesAPI:
      config.providerId === "volcengine" || /\/responses\/?$/i.test(rawBaseURL)
  };
}

function getProviderErrorMessage(error: unknown) {
  const maybeError = error as {
    status?: number;
    message?: string;
    error?: unknown;
    response?: { status?: number; data?: unknown };
  };

  const status = maybeError.status ?? maybeError.response?.status;
  const rawMessage =
    maybeError.message ??
    (typeof maybeError.error === "string" ? maybeError.error : undefined) ??
    (maybeError.response?.data ? JSON.stringify(maybeError.response.data) : undefined);

  if (!rawMessage) {
    return status ? `HTTP ${status}` : "未知错误";
  }

  return status ? `HTTP ${status}，${rawMessage}` : rawMessage;
}

function getProviderStatus(error: unknown) {
  return (error as { status?: number; statusCode?: number; response?: { status?: number } }).status ??
    (error as { statusCode?: number }).statusCode ??
    (error as { response?: { status?: number } }).response?.status;
}

function resolveRequestTimeoutMs(params: ChatCompletionParams) {
  const configuredTimeout = Number(
    params.timeoutMs ?? process.env.AI_REQUEST_TIMEOUT_MS ?? DEFAULT_AI_REQUEST_TIMEOUT_MS
  );

  if (!Number.isFinite(configuredTimeout)) {
    return DEFAULT_AI_REQUEST_TIMEOUT_MS;
  }

  return Math.min(
    MAX_AI_REQUEST_TIMEOUT_MS,
    Math.max(MIN_AI_REQUEST_TIMEOUT_MS, Math.round(configuredTimeout))
  );
}

function adapterBudgetTimeoutError() {
  return Object.assign(
    new Error("The shared adapter request budget was exhausted."),
    {
      name: "APIConnectionTimeoutError",
      code: "ETIMEDOUT"
    }
  );
}

function remainingAdapterTimeoutMs(deadlineAt: number) {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs < MIN_AI_REQUEST_TIMEOUT_MS) {
    throw adapterBudgetTimeoutError();
  }
  return Math.min(MAX_AI_REQUEST_TIMEOUT_MS, remainingMs);
}

function isProviderTimeout(error: unknown) {
  const candidate = error as { name?: string; code?: string; message?: string };
  const status = getProviderStatus(error);
  const name = candidate.name?.toLowerCase() ?? "";
  const code = candidate.code?.toLowerCase() ?? "";
  const message = candidate.message?.toLowerCase() ?? "";

  return (
    status === 408 ||
    status === 504 ||
    name.includes("timeout") ||
    name === "aborterror" ||
    code.includes("timeout") ||
    code === "etimedout" ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("aborted")
  );
}

function isProviderNetworkError(error: unknown) {
  if (error instanceof ServiceError) return false;

  const candidate = error as { name?: string; code?: string; message?: string };
  const name = candidate.name?.toLowerCase() ?? "";
  const code = candidate.code?.toLowerCase() ?? "";
  const message = candidate.message?.toLowerCase() ?? "";

  return (
    name.includes("connection") ||
    [
      "econnreset",
      "econnrefused",
      "eai_again",
      "enotfound",
      "enetunreach",
      "epipe"
    ].includes(code) ||
    message.includes("fetch failed") ||
    message.includes("network error") ||
    message.includes("socket hang up") ||
    message.includes("connection reset")
  );
}

function hasUpstreamRequestId(error: unknown) {
  const candidate = error as {
    request_id?: unknown;
    requestId?: unknown;
    requestID?: unknown;
  };
  return [
    candidate.request_id,
    candidate.requestId,
    candidate.requestID
  ].some((value) => typeof value === "string" && value.length > 0);
}

function providerFailureDiagnostic(input: {
  error: unknown;
  startedAt: number;
  timeoutBudgetMs: number;
  attempt: number;
  maxAttempts: number;
}): SafeApiErrorDetails {
  const status = getProviderStatus(input.error);
  const elapsedMs = Math.max(0, Date.now() - input.startedAt);
  const upstreamStatus =
    Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599
      ? Number(status)
      : undefined;

  return {
    failureOrigin:
      upstreamStatus !== undefined
        ? "upstream_http"
        : isProviderTimeout(input.error)
          ? elapsedMs >= input.timeoutBudgetMs * SDK_TIMEOUT_BUDGET_RATIO
            ? "sdk_timeout"
            : "connection_timeout"
          : isProviderNetworkError(input.error)
            ? "network"
            : "unknown",
    elapsedMs,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
    ...(hasUpstreamRequestId(input.error)
      ? { hasUpstreamRequestId: true }
      : {})
  };
}

function resolveTransportRetries(params: ChatCompletionParams) {
  const configuredRetries = Number(
    params.maxTransportRetries ??
      process.env.AI_MAX_TRANSPORT_RETRIES ??
      DEFAULT_AI_TRANSPORT_RETRIES
  );

  if (!Number.isFinite(configuredRetries)) {
    return DEFAULT_AI_TRANSPORT_RETRIES;
  }

  return Math.min(
    MAX_AI_TRANSPORT_RETRIES,
    Math.max(0, Math.floor(configuredRetries))
  );
}

function isRetryableTransportError(error: unknown) {
  if (isProviderTimeout(error)) return true;

  const status = getProviderStatus(error);
  if (status === 429 || (typeof status === "number" && status >= 500)) {
    return !(error instanceof ServiceError) ||
      error.code === "ANTHROPIC_REQUEST_FAILED";
  }

  if (error instanceof ServiceError) return false;
  return isProviderNetworkError(error);
}

function waitForTransportRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function getSafeProviderFailure(
  error: unknown,
  providerName: string,
  diagnostic?: SafeApiErrorDetails
) {
  const status = getProviderStatus(error);
  const rawMessage = getProviderErrorMessage(error).toLowerCase();

  if (
    rawMessage.includes("accountoverdue") ||
    rawMessage.includes("overdue balance") ||
    rawMessage.includes("账户欠费") ||
    rawMessage.includes("余额逾期")
  ) {
    return new ServiceError(
      `${providerName} 账户存在逾期余额，请先在供应商控制台完成结算后重试。`,
      {
        statusCode: 402,
        code: "AI_PROVIDER_ACCOUNT_OVERDUE"
      }
    );
  }

  if (isProviderTimeout(error)) {
    return new ServiceError(
      `${providerName} 暂时响应较慢，请稍后重试。`,
      {
        statusCode: 504,
        code: "AI_PROVIDER_TIMEOUT",
        details: {
          ...diagnostic,
          retryable: true
        }
      }
    );
  }

  if (status === 401) {
    return new ServiceError(`${providerName} API 鉴权失败，请检查 API Key。`, {
      statusCode: 401,
      code: "AI_PROVIDER_AUTH_FAILED"
    });
  }

  if (status === 403) {
    return new ServiceError(`${providerName} API 拒绝访问，请检查模型或接入点权限。`, {
      statusCode: 403,
      code: "AI_PROVIDER_PERMISSION_DENIED"
    });
  }

  if (status === 404) {
    return new ServiceError(`${providerName} 未找到当前模型或接入点。`, {
      statusCode: 404,
      code: "AI_PROVIDER_NOT_FOUND"
    });
  }

  if (status === 429) {
    return new ServiceError(`${providerName} 当前限流或额度不足，请稍后重试。`, {
      statusCode: 429,
      code: "AI_PROVIDER_RATE_LIMITED",
      details: {
        ...diagnostic,
        retryable: true
      }
    });
  }

  if (
    (rawMessage.includes("image") || rawMessage.includes("vision") || rawMessage.includes("图片")) &&
    (rawMessage.includes("unsupported") || rawMessage.includes("not support") || rawMessage.includes("不支持"))
  ) {
    return new ServiceError(`${providerName} 当前模型或接入点不支持图片理解。`, {
      statusCode: 422,
      code: "AI_PROVIDER_VISION_UNSUPPORTED"
    });
  }

  if (status === 400 || status === 422) {
    return new ServiceError(`${providerName} 拒绝了当前请求参数，请检查模型能力与接口兼容性。`, {
      statusCode: 422,
      code: "AI_PROVIDER_BAD_REQUEST"
    });
  }

  return new ServiceError(`${providerName} API 调用失败，请稍后重试。`, {
    statusCode: 502,
    code: "AI_PROVIDER_REQUEST_FAILED",
    details: {
      ...diagnostic,
      // 只有已确认的网络传输异常允许自动提示重试。未知 SDK/
      // 程序异常保留诊断但不诱导用户再次产生调用费用。供应商明确
      // 返回 5xx 时允许用户手动重试，但传输层仍不会替用户重放 Ark。
      retryable:
        diagnostic?.failureOrigin === "network" ||
        (diagnostic?.failureOrigin === "upstream_http" &&
          typeof diagnostic.upstreamStatus === "number" &&
          diagnostic.upstreamStatus >= 500)
    }
  });
}

function normalizeServiceError(
  error: unknown,
  providerName: string,
  diagnostic?: SafeApiErrorDetails
) {
  if (error instanceof ServiceError) {
    if (error.code === "ANTHROPIC_REQUEST_FAILED") {
      return getSafeProviderFailure(error, providerName, diagnostic);
    }

    return error;
  }

  return getSafeProviderFailure(error, providerName, diagnostic);
}

function shouldTryNativeJsonSchema(config: AIProviderConfig) {
  return ["openai", "zhipu", "custom"].includes(config.providerId);
}

function supportsResponsesWebSearch(config: AIProviderConfig) {
  return config.providerId === "volcengine" || /volces\.com/i.test(config.baseURL);
}

function isJsonSchemaUnsupportedError(error: unknown) {
  const message = getProviderErrorMessage(error).toLowerCase();
  const mentionsStructuredOutput =
    message.includes("response_format") ||
    message.includes("json_schema") ||
    message.includes("json schema") ||
    message.includes("text.format") ||
    message.includes("structured output");

  return (
    mentionsStructuredOutput &&
    (message.includes("unsupported") ||
      message.includes("not support") ||
      message.includes("不支持") ||
      message.includes("unknown") ||
      message.includes("unrecognized") ||
      message.includes("invalid"))
  );
}

function notifyResponseMetadata(
  params: ChatCompletionParams,
  metadata: ChatCompletionResponseMetadata
) {
  try {
    params.onResponseMetadata?.(metadata);
  } catch {
    // Metadata is diagnostic-only and must never make a successful provider request fail.
  }
}

function withJsonSchemaInstruction(
  messages: ChatCompletionParams["messages"],
  jsonSchema: ChatCompletionParams["jsonSchema"]
) {
  if (!jsonSchema) {
    return messages;
  }

  const schemaInstruction = [
    "你必须只返回合法 JSON，不要 Markdown，不要解释文字，不要代码块。",
    "JSON 必须尽量遵循下面的字段结构；无法确认的信息用空字符串、空数组或 [待确认]，不要编造：",
    JSON.stringify(jsonSchema.schema)
  ].join("\n");

  return [
    {
      role: "system" as const,
      content: schemaInstruction
    },
    ...messages
  ];
}

function extractResponsesText(response: unknown) {
  const payload = response as {
    output_text?: string;
    output?: Array<{
      type?: string;
      status?: string;
      content?: Array<{ text?: string; type?: string; refusal?: string }>;
    }>;
  };

  if (payload.output_text) {
    return payload.output_text.trim();
  }

  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter(
        (content) =>
          !content.type || content.type === "output_text" || content.type === "text"
      )
      .map((content) => content.text)
      .filter((text): text is string => Boolean(text))
      .join("\n")
      .trim() ?? ""
  );
}

function getResponsesState(response: unknown) {
  const payload = response as {
    status?: string;
    error?: unknown;
    incomplete_details?: { reason?: string } | null;
    output?: Array<{ type?: string; status?: string }>;
  };
  const incompleteMessage = payload.output?.find(
    (item) => item.type === "message" && item.status === "incomplete"
  );

  return {
    status: payload.status,
    incompleteReason: payload.incomplete_details?.reason,
    hasIncompleteMessage: Boolean(incompleteMessage),
    hasResponseError: Boolean(payload.error)
  };
}

function assertResponsesCompleted(response: unknown) {
  const state = getResponsesState(response);

  if (
    state.status === "incomplete" ||
    state.hasIncompleteMessage ||
    state.incompleteReason
  ) {
    if (
      state.incompleteReason === "length" ||
      state.incompleteReason === "max_output_tokens" ||
      (state.incompleteReason?.includes("max") && state.incompleteReason.includes("token"))
    ) {
      throw new ServiceError("AI 输出达到长度上限，响应已被截断。", {
        statusCode: 502,
        code: "AI_RESPONSE_TRUNCATED",
        details: {
          normalizedValue: state.incompleteReason ?? "message_incomplete"
        }
      });
    }

    throw new ServiceError("AI 未能完成本次响应，请重试。", {
      statusCode: 502,
      code: "AI_RESPONSE_INCOMPLETE",
      details: {
        normalizedValue:
          state.incompleteReason ??
          state.status ??
          (state.hasIncompleteMessage ? "message_incomplete" : "unknown")
      }
    });
  }

  if (
    state.hasResponseError ||
    state.status === "failed" ||
    state.status === "cancelled" ||
    state.status === "in_progress" ||
    state.status === "queued"
  ) {
    throw new ServiceError("AI 响应未正常完成，请重试。", {
      statusCode: 502,
      code: "AI_RESPONSE_INCOMPLETE",
      details: {
        normalizedValue: state.status ?? "response_error"
      }
    });
  }

  return state;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.asyncIterator in value &&
      typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
  );
}

function responseStreamEventError(event: {
  code?: unknown;
  message?: unknown;
}) {
  const code = typeof event.code === "string" ? event.code : "stream_error";
  const message =
    typeof event.message === "string" && event.message.trim()
      ? event.message
      : "Responses stream failed.";
  const normalizedCode = code.toLowerCase();
  const status = normalizedCode.includes("rate_limit")
    ? 429
    : normalizedCode.includes("invalid") ||
        normalizedCode.includes("unsupported")
      ? 400
      : normalizedCode.includes("server")
        ? 502
        : undefined;

  return Object.assign(new Error(message), {
    name: "APIError",
    code,
    responseStreamEvent: true,
    ...(status ? { status } : {})
  });
}

function isResponseStreamEventFailure(error: unknown) {
  return (error as { responseStreamEvent?: unknown })
    .responseStreamEvent === true;
}

/**
 * Ark 的长视觉请求改用 Responses SSE。只有收到 completed 终态才会采纳
 * 文本；流中断、failed 或 incomplete 都继续走既有完整性校验，绝不把
 * 已收到的半截 JSON 当成成功结果。
 */
async function materializeResponsesStream(value: unknown) {
  if (!isAsyncIterable(value)) {
    // 兼容不支持 SSE 的 Responses 实现，以及测试用的兼容端点。
    return value;
  }

  let terminalResponse: unknown;
  let streamedText = "";
  let completed = false;
  let receivedEvent = false;
  const startedAt = Date.now();

  try {
    for await (const rawEvent of value) {
      receivedEvent = true;
      const event = rawEvent as {
        type?: string;
        delta?: string;
        text?: string;
        response?: unknown;
        code?: unknown;
        message?: unknown;
      };

      if (event.type === "response.output_text.delta" && event.delta) {
        streamedText += event.delta;
        continue;
      }
      if (
        event.type === "response.output_text.done" &&
        !streamedText &&
        event.text
      ) {
        streamedText = event.text;
        continue;
      }
      if (event.type === "error") {
        throw responseStreamEventError(event);
      }
      if (
        event.type === "response.completed" ||
        event.type === "response.failed" ||
        event.type === "response.incomplete"
      ) {
        terminalResponse = event.response;
        completed = event.type === "response.completed";
        // 终态事件已经给出了本次响应的最终状态。继续等待 SSE 连接 EOF
        // 只会让“成功后关闭连接”的正常抖动被误判成失败。
        break;
      }
    }
  } catch (error) {
    if (
      receivedEvent &&
      isResponseStreamEventFailure(error) &&
      !isJsonSchemaUnsupportedError(error)
    ) {
      const status = getProviderStatus(error);
      const responseStatus =
        Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599
          ? Number(status)
          : undefined;
      throw new ServiceError("模型供应商流式响应未能完成，本次未写入不完整结果。", {
        statusCode: responseStatus ?? 502,
        code: "AI_PROVIDER_STREAM_FAILED",
        details: {
          // Responses 的 error 是 HTTP 200 连接中的 SSE 事件，不等于
          // 供应商真的返回了一个 HTTP 502，避免在诊断里伪造上游状态码。
          failureOrigin: "stream_event",
          retryable:
            responseStatus === 429 ||
            (responseStatus !== undefined && responseStatus >= 500)
        }
      });
    }
    // 一旦服务端已开始发送本次响应，自动重放整个视觉请求可能造成
    // 重复计费。保留显式重试入口，但不在传输层偷偷再发一次。
    if (
      receivedEvent &&
      (isProviderTimeout(error) || isProviderNetworkError(error))
    ) {
      throw new ServiceError("模型供应商流式连接在完成前中断，本次未写入不完整结果。", {
        statusCode: 502,
        code: "AI_PROVIDER_STREAM_INTERRUPTED",
        details: {
          failureOrigin: "connection_timeout",
          elapsedMs: Math.max(0, Date.now() - startedAt),
          retryable: true
        }
      });
    }
    throw error;
  }

  if (!terminalResponse) {
    throw new ServiceError("AI 流式响应在完成前中断，请重试。", {
      statusCode: 502,
      code: "AI_RESPONSE_INCOMPLETE",
      details: { normalizedValue: "stream_ended_without_terminal_event" }
    });
  }

  if (!completed) {
    return terminalResponse;
  }

  const finalText = extractResponsesText(terminalResponse);
  if (finalText || !streamedText) {
    return terminalResponse;
  }

  return {
    ...(terminalResponse as Record<string, unknown>),
    output_text: streamedText
  };
}

function convertChatMessagesToResponsesInput(messages: ChatCompletionParams["messages"]) {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return {
        role: message.role,
        content: message.content
      };
    }

    if (Array.isArray(message.content)) {
      return {
        role: message.role,
        content: message.content
          .map((part) => {
            if (part.type === "text") {
              return {
                type: "input_text",
                text: part.text
              };
            }

            if (part.type === "image_url") {
              const imageUrl =
                typeof part.image_url === "string" ? part.image_url : part.image_url.url;
              const detail =
                typeof part.image_url === "string"
                  ? "auto"
                  : part.image_url.detail ?? "auto";

              return {
                type: "input_image",
                image_url: imageUrl,
                detail
              };
            }

            return null;
          })
          .filter(Boolean)
      };
    }

    return {
      role: message.role,
      content: ""
    };
  });
}

function messageContentToText(content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"]) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    return null;
  }

  return {
    mediaType: match[1],
    data: match[2]
  };
}

function imageUrlFromPart(part: Extract<OpenAI.Chat.Completions.ChatCompletionContentPart, { type: "image_url" }>) {
  return typeof part.image_url === "string" ? part.image_url : part.image_url.url;
}

function splitResponsesMessages(messages: ChatCompletionParams["messages"]) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => messageContentToText(message.content))
    .filter(Boolean)
    .join("\n\n");
  const inputMessages = messages.filter((message) => message.role !== "system");

  return {
    instructions,
    inputMessages
  };
}

// ── OpenAI-compatible adapter ─────────────────────────────────────

async function openAICompatibleChat(
  config: AIProviderConfig,
  params: ChatCompletionParams
): Promise<ChatCompletionResult> {
  const resolved = resolveCompatibleConfig(config);
  const useNativeJsonSchema = shouldTryNativeJsonSchema(config);
  let nativeJsonSchemaUnsupported = false;
  // 原生 JSON Schema 和 instruction fallback 属于同一次逻辑请求，
  // 必须共享一个截止时间，不能各自再获得一份完整 timeout。
  const adapterDeadlineAt = Date.now() + resolveRequestTimeoutMs(params);

  async function request(useNativeSchema: boolean) {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: resolved.baseURL || undefined,
      timeout: remainingAdapterTimeoutMs(adapterDeadlineAt),
      maxRetries: 0
    });
    return client.chat.completions.create(
      {
        model: resolved.model || params.model,
        messages: useNativeSchema
          ? params.messages
          : withJsonSchemaInstruction(params.messages, params.jsonSchema),
        ...(params.jsonSchema && useNativeSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: params.jsonSchema.name,
                  strict: params.jsonSchema.strict ?? true,
                  schema: params.jsonSchema.schema
                }
              }
            }
          : {}),
        max_tokens: params.maxTokens ?? 2000
      },
      params.signal ? { signal: params.signal } : undefined
    );
  }

  let completion: Awaited<ReturnType<typeof request>>;
  try {
    completion = await request(useNativeJsonSchema);
  } catch (error) {
    if (!params.jsonSchema || !useNativeJsonSchema || !isJsonSchemaUnsupportedError(error)) {
      throw error;
    }

    nativeJsonSchemaUnsupported = true;
    notifyResponseMetadata(params, {
      api: "chat_completions",
      status: "retrying_without_native_json_schema",
      structuredOutputMode: "instruction_fallback",
      nativeJsonSchemaUnsupported: true
    });
    completion = await request(false);
  }

  const finishReason: string | undefined = completion.choices[0]?.finish_reason ?? undefined;
  const metadata: ChatCompletionResponseMetadata = {
    api: "chat_completions",
    status: finishReason === "stop" ? "completed" : finishReason,
    finishReason,
    structuredOutputMode: params.jsonSchema
      ? nativeJsonSchemaUnsupported
        ? "instruction_fallback"
        : "native_json_schema"
      : "none",
    ...(nativeJsonSchemaUnsupported ? { nativeJsonSchemaUnsupported: true } : {})
  };
  notifyResponseMetadata(params, metadata);

  if (["length", "max_tokens", "max_output_tokens"].includes(finishReason ?? "")) {
    throw new ServiceError("AI 输出达到长度上限，响应已被截断。", {
      statusCode: 502,
      code: "AI_RESPONSE_TRUNCATED"
    });
  }

  if (finishReason === "content_filter") {
    throw new ServiceError("AI 响应未能完整生成。", {
      statusCode: 502,
      code: "AI_RESPONSE_INCOMPLETE"
    });
  }

  const text = completion.choices[0]?.message?.content?.trim() ?? "";

  if (!text) {
    throw new ServiceError("AI 返回内容为空，请重试。", {
      statusCode: 502,
      code: "AI_EMPTY_RESPONSE"
    });
  }

  return { text, metadata };
}

async function responsesCompatibleChat(
  config: AIProviderConfig,
  params: ChatCompletionParams
): Promise<ChatCompletionResult> {
  const resolved = resolveCompatibleConfig(config);
  const tryNativeJsonSchema = config.providerId === "openai" || config.providerId === "volcengine";
  let nativeJsonSchemaUnsupported = false;
  // Responses 原生结构化输出与指令降级共享同一个截止时间。
  // 若第一轮已经消耗大部分时间，不再启动一个注定无法完成的降级请求。
  const adapterDeadlineAt = Date.now() + resolveRequestTimeoutMs(params);

  async function request(useNativeSchema: boolean) {
    const requestTimeoutMs = remainingAdapterTimeoutMs(adapterDeadlineAt);
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: resolved.baseURL,
      timeout: requestTimeoutMs,
      maxRetries: 0
    });
    const preparedMessages = useNativeSchema
      ? params.messages
      : withJsonSchemaInstruction(params.messages, params.jsonSchema);
    const { instructions, inputMessages } = splitResponsesMessages(preparedMessages);
    const useStreaming = config.providerId === "volcengine";
    const requestController = new AbortController();
    let deadlineExpired = false;
    const forwardCallerAbort = () => {
      requestController.abort(params.signal?.reason);
    };
    params.signal?.addEventListener("abort", forwardCallerAbort, {
      once: true
    });
    if (params.signal?.aborted) {
      forwardCallerAbort();
    }
    const deadlineTimer = setTimeout(() => {
      deadlineExpired = true;
      requestController.abort();
    }, requestTimeoutMs);

    try {
      const responseOrStream = await client.responses.create(
        {
          model: resolved.model || params.model,
          ...(instructions ? { instructions } : {}),
          input: convertChatMessagesToResponsesInput(inputMessages) as never,
          ...(params.jsonSchema && useNativeSchema
            ? {
                text: {
                  format: {
                    type: "json_schema",
                    name: params.jsonSchema.name,
                    strict: params.jsonSchema.strict ?? true,
                    schema: params.jsonSchema.schema
                  }
                }
              }
            : {}),
          ...(params.enableWebSearch && supportsResponsesWebSearch(config)
            ? {
                tools: [
                  {
                    type: "web_search"
                  }
                ]
              }
            : {}),
          max_output_tokens: params.maxTokens ?? 2000,
          ...(useStreaming ? { stream: true } : {})
        } as never,
        { signal: requestController.signal }
      );
      const response = useStreaming
        ? await materializeResponsesStream(responseOrStream)
        : responseOrStream;

      // SDK 的请求 timeout 只覆盖到响应头。若流读取因 deadline abort
      // 安静结束，仍必须按总预算超时报错，不能把半截输出当成功。
      if (deadlineExpired) {
        throw adapterBudgetTimeoutError();
      }
      return response;
    } catch (error) {
      if (deadlineExpired && !params.signal?.aborted) {
        throw adapterBudgetTimeoutError();
      }
      throw error;
    } finally {
      clearTimeout(deadlineTimer);
      params.signal?.removeEventListener("abort", forwardCallerAbort);
    }
  }

  let response: Awaited<ReturnType<typeof request>>;
  try {
    response = await request(tryNativeJsonSchema);
  } catch (error) {
    if (!params.jsonSchema || !tryNativeJsonSchema || !isJsonSchemaUnsupportedError(error)) {
      throw error;
    }

    nativeJsonSchemaUnsupported = true;
    notifyResponseMetadata(params, {
      api: "responses",
      status: "retrying_without_native_json_schema",
      structuredOutputMode: "instruction_fallback",
      nativeJsonSchemaUnsupported: true
    });
    response = await request(false);
  }

  const state = getResponsesState(response);
  const metadata: ChatCompletionResponseMetadata = {
    api: "responses",
    status: state.status,
    incompleteReason: state.incompleteReason,
    structuredOutputMode: params.jsonSchema
      ? nativeJsonSchemaUnsupported
        ? "instruction_fallback"
        : "native_json_schema"
      : "none",
    ...(nativeJsonSchemaUnsupported ? { nativeJsonSchemaUnsupported: true } : {})
  };
  notifyResponseMetadata(params, metadata);
  assertResponsesCompleted(response);

  const text = extractResponsesText(response);

  if (!text) {
    throw new ServiceError("AI 返回内容为空，请重试。", {
      statusCode: 502,
      code: "AI_EMPTY_RESPONSE"
    });
  }

  return { text, metadata };
}

// ── Anthropic adapter (raw fetch, no SDK dependency) ──────────────

function convertOpenAIContentToAnthropic(content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"]) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (part.type === "text") {
        return {
          type: "text",
          text: part.text
        };
      }

      if (part.type === "image_url") {
        const imageUrl = imageUrlFromPart(part);
        const dataUrl = parseDataUrl(imageUrl);

        if (dataUrl) {
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: dataUrl.mediaType,
              data: dataUrl.data
            }
          };
        }

        if (/^https?:\/\//i.test(imageUrl)) {
          return {
            type: "image",
            source: {
              type: "url",
              url: imageUrl
            }
          };
        }

        throw new ServiceError("Anthropic 图片格式不支持，请上传 base64 图片或可访问的图片 URL。", {
          statusCode: 400,
          code: "ANTHROPIC_IMAGE_INPUT_INVALID"
        });
      }

      return null;
    })
    .filter(Boolean);
}

function extractAnthropicText(data: unknown, toolName?: string) {
  const payload = data as {
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  };

  const toolUse = payload.content?.find(
    (item) => item.type === "tool_use" && (!toolName || item.name === toolName)
  );
  if (toolUse?.input) {
    return JSON.stringify(toolUse.input);
  }

  return (
    payload.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim() ?? ""
  );
}

function buildCompactJsonInstruction(_jsonSchema: NonNullable<ChatCompletionParams["jsonSchema"]>) {
  return [
    "Return ONLY valid JSON, no markdown.",
    "The JSON must follow the requested structure and include all required fields."
  ].join("\n");
}

function shouldUseAnthropicToolSchema(jsonSchema?: ChatCompletionParams["jsonSchema"]) {
  if (!jsonSchema) {
    return false;
  }

  return JSON.stringify(jsonSchema.schema).length <= 9000;
}

async function anthropicChat(
  config: AIProviderConfig,
  params: ChatCompletionParams
): Promise<ChatCompletionResult> {
  const model = config.model || params.model || "claude-sonnet-4-6";
  const maxTokens = params.maxTokens ?? 2000;

  const systemMessages: string[] = [];
  const anthropicMessages: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  for (const msg of params.messages) {
    if (msg.role === "system") {
      systemMessages.push(messageContentToText(msg.content));
    } else if (msg.role === "user" || msg.role === "assistant") {
      anthropicMessages.push({
        role: msg.role,
        content: convertOpenAIContentToAnthropic(msg.content)
      });
    }
  }

  const requestBody: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: anthropicMessages
  };

  if (systemMessages.length > 0) {
    requestBody.system = systemMessages.join("\n");
  }

  const useAnthropicToolSchema = shouldUseAnthropicToolSchema(params.jsonSchema);

  if (params.jsonSchema && useAnthropicToolSchema) {
    requestBody.tools = [
      {
        name: params.jsonSchema.name,
        description: "Return the final answer as a structured JSON object.",
        input_schema: params.jsonSchema.schema
      }
    ];
    requestBody.tool_choice = {
      type: "tool",
      name: params.jsonSchema.name
    };
    requestBody.system = [
      requestBody.system,
      "Use the provided tool to return the final structured result. Do not answer in free text."
    ]
      .filter(Boolean)
      .join("\n\n");
  } else if (params.jsonSchema) {
    requestBody.system = [
      requestBody.system,
      buildCompactJsonInstruction(params.jsonSchema)
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  const timeoutId = setTimeout(
    () => controller.abort(),
    resolveRequestTimeoutMs(params)
  );
  let response: Response;

  if (params.signal?.aborted) {
    controller.abort();
  } else {
    params.signal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    response = await fetch(`${config.baseURL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
    params.signal?.removeEventListener("abort", abortFromParent);
  }

  if (!response.ok) {
    throw new ServiceError("Anthropic API 调用失败。", {
      statusCode: response.status >= 400 && response.status < 500 ? response.status : 502,
      code: "ANTHROPIC_REQUEST_FAILED"
    });
  }

  const data = (await response.json()) as { stop_reason?: string | null };
  const finishReason = data.stop_reason ?? undefined;
  const metadata: ChatCompletionResponseMetadata = {
    api: "anthropic",
    status: finishReason === "max_tokens" || finishReason === "refusal" ? "incomplete" : "completed",
    finishReason,
    structuredOutputMode: params.jsonSchema
      ? useAnthropicToolSchema
        ? "native_json_schema"
        : "instruction_fallback"
      : "none"
  };
  notifyResponseMetadata(params, metadata);

  if (finishReason === "max_tokens") {
    throw new ServiceError("AI 输出达到长度上限，响应已被截断。", {
      statusCode: 502,
      code: "AI_RESPONSE_TRUNCATED"
    });
  }

  if (finishReason === "refusal") {
    throw new ServiceError("AI 未能完成本次响应。", {
      statusCode: 502,
      code: "AI_RESPONSE_INCOMPLETE"
    });
  }

  const text = extractAnthropicText(data, useAnthropicToolSchema ? params.jsonSchema?.name : undefined);

  if (!text) {
    throw new ServiceError("Anthropic 返回内容为空，请重试。", {
      statusCode: 502,
      code: "AI_EMPTY_RESPONSE"
    });
  }

  return { text, metadata };
}

// ── Main entry ────────────────────────────────────────────────────

export async function createChatCompletion(
  config: AIProviderConfig,
  params: ChatCompletionParams
): Promise<ChatCompletionResult> {
  const configuredMaxRetries = resolveTransportRetries(params);
  // Ark 长视觉请求可能已经到达计费侧，但当前接口没有可用的幂等键。
  // 因此即使首个 SSE 事件尚未到达，也不在传输层隐式重放付费请求；
  // 失败后由用户通过明确的“重试当前阶段”再次发起。
  const maxRetries =
    config.providerId === "volcengine" || config.providerId === "gemini"
      ? 0
      : configuredMaxRetries;
  // timeoutMs 是整次传输（含重试）的总预算，而不是每次尝试都可重复
  // 消耗的时长。其他供应商发生瞬时错误时可以在剩余预算内重试，
  // 同时不会把多次完整等待叠加到路由上限之外。
  const startedAt = Date.now();
  const totalBudgetMs = resolveRequestTimeoutMs(params);
  const deadlineAt = startedAt + totalBudgetMs;
  let lastError: unknown;
  let attemptsUsed = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (params.signal?.aborted) {
      throw new ServiceError("AI 请求已取消。", {
        statusCode: 499,
        code: "AI_REQUEST_ABORTED"
      });
    }

    const remainingMs = deadlineAt - Date.now();
    if (remainingMs < MIN_AI_REQUEST_TIMEOUT_MS) {
      break;
    }
    const attemptParams = {
      ...params,
      // 首轮始终拥有完整剩余预算。若供应商快速返回瞬时错误，
      // 后续尝试才使用扣除已消耗时间后的余额；绝不为预留一次
      // 可能不会发生的重试而提前截断重型多图请求。
      timeoutMs: Math.min(MAX_AI_REQUEST_TIMEOUT_MS, remainingMs)
    };

    try {
      attemptsUsed = attempt + 1;
      if (config.providerId === "anthropic") {
        return await anthropicChat(config, attemptParams);
      }

      if (config.providerId === "gemini") {
        const { geminiGenerateContentChat } = await import(
          "@/lib/gemini-provider"
        );
        return await geminiGenerateContentChat(config, attemptParams);
      }

      if (resolveCompatibleConfig(config).useResponsesAPI) {
        return await responsesCompatibleChat(config, attemptParams);
      }

      return await openAICompatibleChat(config, attemptParams);
    } catch (error) {
      lastError = error;
      if (
        params.signal?.aborted ||
        attempt >= maxRetries ||
        !isRetryableTransportError(error)
      ) {
        break;
      }

      const delayMs = AI_RETRY_BASE_DELAY_MS * 2 ** attempt;
      const retryBudgetAfterDelay = deadlineAt - Date.now() - delayMs;
      const meaningfulRetryBudget = Math.max(
        MIN_AI_REQUEST_TIMEOUT_MS,
        Math.round(totalBudgetMs * MIN_RETRY_BUDGET_RATIO)
      );
      if (retryBudgetAfterDelay < meaningfulRetryBudget) {
        break;
      }
      try {
        await waitForTransportRetry(delayMs, params.signal);
      } catch (error) {
        if (params.signal?.aborted) {
          break;
        }
        throw error;
      }
    }
  }

  if (params.signal?.aborted) {
    throw new ServiceError("AI 请求已取消。", {
      statusCode: 499,
      code: "AI_REQUEST_ABORTED"
    });
  }

  throw normalizeServiceError(
    lastError,
    config.displayName ??
      PRESET_PROVIDERS.find((preset) => preset.id === config.providerId)?.name ??
      config.providerId,
    providerFailureDiagnostic({
      error: lastError,
      startedAt,
      timeoutBudgetMs: totalBudgetMs,
      attempt: attemptsUsed,
      // 只展示实际启动过的尝试次数，避免真实 SDK 耗尽首轮预算后
      // 仍向用户显示“1/2”这种并未发生第二次调用的误导信息。
      maxAttempts: Math.max(1, attemptsUsed)
    })
  );
}

// ── Build provider config from env fallback ───────────────────────

export function getEnvProviderConfig(): AIProviderConfig | null {
  const arkApiKey = process.env.ARK_API_KEY?.trim();
  const arkConfig: AIProviderConfig | null = arkApiKey
    ? {
      providerId: "volcengine",
      apiKey: arkApiKey,
      baseURL:
        process.env.ARK_BASE_URL?.trim() || VOLCENGINE_ARK_BASE_URL,
      model:
        process.env.ARK_MODEL?.trim() || "doubao-seed-1-8-251228",
      displayName: "火山方舟 Ark（服务端）"
      }
    : null;

  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiConfig: AIProviderConfig | null = geminiApiKey
    ? {
      providerId: "gemini",
      apiKey: geminiApiKey,
      baseURL: GEMINI_GENERATE_CONTENT_BASE_URL,
      model: process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest",
      displayName: "Google Gemini（服务端）"
      }
    : null;

  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
  const openaiConfig: AIProviderConfig | null = openaiApiKey
    ? {
        providerId: "openai",
        apiKey: openaiApiKey,
        baseURL: "https://api.openai.com/v1",
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
        displayName: "OpenAI（服务端）"
      }
    : null;

  const preferredProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  const preferredProviderId =
    preferredProvider === "ark" ? "volcengine" : preferredProvider;
  const configuredProviders = [arkConfig, geminiConfig, openaiConfig].filter(
    (config): config is AIProviderConfig => Boolean(config)
  );
  const preferredConfig = configuredProviders.find(
    (config) => config.providerId === preferredProviderId
  );

  return preferredConfig ?? arkConfig ?? geminiConfig ?? openaiConfig;
}
