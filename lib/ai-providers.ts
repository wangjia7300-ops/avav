import OpenAI from "openai";
import { ENABLE_REAL_SEARCH } from "@/lib/config";
import { ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig, AIProviderId, ProviderCapabilities } from "@/lib/types";

// AI 请求超时（毫秒）。默认 120s；慢模型（如 gpt-5.5）可用环境变量 AI_REQUEST_TIMEOUT_MS 调高。
const AI_REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 120000;

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
  capabilities: ProviderCapabilities;
};

const VOLCENGINE_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
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
    visionNote: "支持图片理解",
    capabilities: {
      supportsVision: true,
      supportsStructuredOutput: true,
      supportsWebSearch: false,
      supportsLongContext: true
    }
  },
  {
    id: "volcengine",
    name: "火山方舟 Ark",
    baseURL: VOLCENGINE_ARK_BASE_URL,
    models: [],
    requiresAuth: true,
    description: "豆包/Seed 系列模型。请在模型字段粘贴火山方舟 ep-... 接入点 ID；当前版本不启用模型自带联网搜索。",
    visionSupport: "depends",
    visionNote: "取决于接入点是否开通视觉理解",
    capabilities: {
      supportsVision: true,
      supportsStructuredOutput: true,
      supportsWebSearch: false,
      supportsLongContext: true
    }
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    requiresAuth: true,
    description: "国产高性价比文本模型，支持 OpenAI 兼容接口；当前预设模型不支持产品图片识别。",
    visionSupport: "not_supported",
    visionNote: "当前预设不支持图片理解",
    capabilities: {
      supportsVision: false,
      supportsStructuredOutput: true,
      supportsWebSearch: false,
      supportsLongContext: true
    }
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    baseURL: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"],
    requiresAuth: true,
    description: "Claude 系列模型，支持图片理解，长文本和结构化输出能力强。",
    visionSupport: "supported",
    visionNote: "支持图片理解",
    capabilities: {
      supportsVision: true,
      supportsStructuredOutput: true,
      supportsWebSearch: false,
      supportsLongContext: true
    }
  },
  {
    id: "moonshot",
    name: "Moonshot (月之暗面)",
    baseURL: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    requiresAuth: true,
    description: "Kimi 文本模型，支持 OpenAI 兼容接口；当前预设模型不用于产品图片识别。",
    visionSupport: "not_supported",
    visionNote: "当前预设不支持图片理解",
    capabilities: {
      supportsVision: false,
      supportsStructuredOutput: true,
      supportsWebSearch: false,
      supportsLongContext: true
    }
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-plus", "glm-4v-plus"],
    requiresAuth: true,
    description: "GLM 系列模型，支持 OpenAI 兼容接口；请选择带 v 的视觉模型用于产品图片识别。",
    visionSupport: "depends",
    visionNote: "请选择视觉模型，例如 glm-4v-plus",
    capabilities: {
      supportsVision: false,
      supportsStructuredOutput: true,
      supportsWebSearch: false,
      supportsLongContext: true
    }
  },
  {
    id: "custom",
    name: "自定义供应商",
    baseURL: "",
    models: [],
    requiresAuth: true,
    description: "输入任意兼容 OpenAI Chat Completions API 的端点地址。",
    visionSupport: "depends",
    visionNote: "取决于自定义模型是否支持图片输入",
    capabilities: {
      supportsVision: true,
      supportsStructuredOutput: false,
      supportsWebSearch: false,
      supportsLongContext: false
    }
  }
];

function getProviderPreset(providerId: AIProviderId) {
  return PRESET_PROVIDERS.find((provider) => provider.id === providerId);
}

export function getProviderCapabilities(config?: AIProviderConfig | null): ProviderCapabilities {
  const withoutSearch = (capabilities: ProviderCapabilities): ProviderCapabilities => ({
    ...capabilities,
    supportsWebSearch: ENABLE_REAL_SEARCH ? capabilities.supportsWebSearch : false
  });

  if (!config) {
    return withoutSearch({
      supportsVision: true,
      supportsStructuredOutput: true,
      supportsWebSearch: false,
      supportsLongContext: true
    });
  }

  if (config.capabilities) {
    return withoutSearch(config.capabilities);
  }

  const preset = getProviderPreset(config.providerId);
  const model = config.model.toLowerCase();
  const base = preset?.capabilities ?? {
    supportsVision: true,
    supportsStructuredOutput: false,
    supportsWebSearch: false,
    supportsLongContext: false
  };

  if (config.providerId === "zhipu") {
    return withoutSearch({
      ...base,
      supportsVision: /\bglm-?4v|vision|vl\b/i.test(model)
    });
  }

  if (config.providerId === "custom") {
    return withoutSearch({
      ...base,
      supportsVision: !/(text|chat|reasoner|deepseek|moonshot)/i.test(model),
      supportsStructuredOutput: true,
      supportsWebSearch:
        ENABLE_REAL_SEARCH && (/search|联网|web/i.test(model) || /volces\.com/i.test(config.baseURL))
    });
  }

  return withoutSearch(base);
}

export function assertProviderCapability(
  config: AIProviderConfig | null | undefined,
  capability: keyof ProviderCapabilities,
  message: string
) {
  const capabilities = getProviderCapabilities(config);
  if (!capabilities[capability]) {
    throw new ServiceError(message, {
      statusCode: 400,
      code: "MODEL_CAPABILITY_UNSUPPORTED"
    });
  }
}

export function providerSupportsBuiltInSearch(config?: AIProviderConfig | null) {
  if (!ENABLE_REAL_SEARCH) {
    return false;
  }

  if (!config?.apiKey || !config.model) {
    return false;
  }

  const capabilities = getProviderCapabilities(config);
  return capabilities.supportsWebSearch && (config.providerId === "volcengine" || /volces\.com/i.test(config.baseURL));
}

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
  enableWebSearch?: boolean;
};

type ChatCompletionResult = {
  text: string;
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
    useResponsesAPI: config.providerId === "volcengine" || /\/responses\/?$/i.test(rawBaseURL)
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

function normalizeServiceError(error: unknown, providerName: string) {
  if (error instanceof ServiceError) {
    return error;
  }

  const status = (error as { status?: number; response?: { status?: number } }).status ??
    (error as { response?: { status?: number } }).response?.status;

  const baseMessage = getProviderErrorMessage(error);
  let hint = "";

  if (status === 401 && providerName === "volcengine") {
    hint =
      " 请确认已从火山方舟 Ark 控制台获取正确的 API Key（非 ep- 接入点 ID），ep- 接入点 ID 应填在「模型」字段。";
  } else if (status === 401 && providerName === "openai") {
    hint = " 请检查 API Key 是否正确，或以 sk- 开头。";
  } else if (status === 401) {
    hint = " 请检查 API Key 格式是否正确。";
  }

  return new ServiceError(`${providerName} API 调用失败：${baseMessage}${hint}`, {
    statusCode: status === 401 ? 401 : 502,
    code: "AI_PROVIDER_REQUEST_FAILED"
  });
}

function shouldTryNativeJsonSchema(config: AIProviderConfig) {
  return getProviderCapabilities(config).supportsStructuredOutput &&
    ["openai", "deepseek", "moonshot", "zhipu", "custom"].includes(config.providerId);
}

function supportsResponsesWebSearch(config: AIProviderConfig) {
  if (!ENABLE_REAL_SEARCH) {
    return false;
  }

  return config.providerId === "volcengine" || /volces\.com/i.test(config.baseURL);
}

function isJsonSchemaUnsupportedError(error: unknown) {
  const message = getProviderErrorMessage(error).toLowerCase();

  return (
    message.includes("response_format") ||
    message.includes("json_schema") ||
    message.includes("unsupported") ||
    message.includes("not support")
  );
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
    "JSON 必须尽量遵循下面的字段结构；无法确认的信息用空字符串、空数组或 risks/注意事项表达，不要写占位词，不要编造：",
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
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };

  if (payload.output_text) {
    return payload.output_text.trim();
  }

  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter((text): text is string => Boolean(text))
      .join("\n")
      .trim() ?? ""
  );
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

              return {
                type: "input_image",
                image_url: imageUrl
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

function isValidJsonLike(text: string) {
  try {
    const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const objectStart = clean.indexOf("{");
    const objectEnd = clean.lastIndexOf("}");
    const arrayStart = clean.indexOf("[");
    const arrayEnd = clean.lastIndexOf("]");
    const start = objectStart >= 0 ? objectStart : arrayStart;
    const end = objectStart >= 0 ? objectEnd : arrayEnd;
    if (start < 0 || end <= start) return false;
    JSON.parse(clean.slice(start, end + 1));
    return true;
  } catch {
    return false;
  }
}

async function openAICompatibleChat(
  config: AIProviderConfig,
  params: ChatCompletionParams
): Promise<ChatCompletionResult> {
  const resolved = resolveCompatibleConfig(config);
  const useNativeJsonSchema = shouldTryNativeJsonSchema(config);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: resolved.baseURL || undefined,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 0
  });

  async function request(useNativeSchema: boolean) {
    return client.chat.completions.create({
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
    });
  }

  let completion: Awaited<ReturnType<typeof request>>;
  try {
    completion = await request(useNativeJsonSchema);
  } catch (error) {
    if (!params.jsonSchema || !useNativeJsonSchema || !isJsonSchemaUnsupportedError(error)) {
      throw error;
    }

    completion = await request(false);
  }

  let text = completion.choices?.[0]?.message?.content?.trim() ?? "";

  // Retry once if JSON schema was requested but response isn't valid JSON
  if (params.jsonSchema && text && !isValidJsonLike(text)) {
    const retryCompletion = await client.chat.completions.create({
      model: resolved.model || params.model,
      messages: [
        ...params.messages,
        { role: "assistant", content: text },
        {
          role: "user",
          content:
            "Your response above is not valid JSON. Return ONLY the JSON object, no markdown fences, no explanation, no surrounding text. Just the raw JSON."
        }
      ],
      max_tokens: params.maxTokens ?? 2000
    });
    text = retryCompletion.choices?.[0]?.message?.content?.trim() ?? "";
  }

  if (!text) {
    const hasImage = params.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")
    );
    const hint = hasImage
      ? " 当前请求包含图片，请确认该模型/接入点支持视觉理解（多模态）。"
      : "";
    throw new ServiceError(`AI 返回内容为空，请重试。${hint}`, {
      statusCode: 502,
      code: "AI_EMPTY_RESPONSE"
    });
  }

  return { text };
}

async function responsesCompatibleChat(
  config: AIProviderConfig,
  params: ChatCompletionParams
): Promise<ChatCompletionResult> {
  const resolved = resolveCompatibleConfig(config);
  const tryNativeJsonSchema = config.providerId === "openai" || config.providerId === "volcengine";
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: resolved.baseURL
  });

  // Prepare messages once outside request() so retry can reuse
  const preparedNative = params.messages;
  const preparedFallback = withJsonSchemaInstruction(params.messages, params.jsonSchema);

  async function request(useNativeSchema: boolean) {
    const preparedMessages = useNativeSchema ? preparedNative : preparedFallback;
    const { instructions, inputMessages } = splitResponsesMessages(preparedMessages);

    return client.responses.create({
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
            tools: [{ type: "web_search" }]
          }
        : {}),
      max_output_tokens: params.maxTokens ?? 2000
    } as never);
  }

  let response: Awaited<ReturnType<typeof request>>;
  try {
    response = await request(tryNativeJsonSchema);
  } catch (error) {
    if (!params.jsonSchema || !tryNativeJsonSchema || !isJsonSchemaUnsupportedError(error)) {
      throw error;
    }
    response = await request(false);
  }

  let text = extractResponsesText(response);

  // Retry once if JSON schema was requested but response isn't valid JSON
  if (params.jsonSchema && text && !isValidJsonLike(text)) {
    const { instructions } = splitResponsesMessages(preparedNative);
    const { inputMessages } = splitResponsesMessages(preparedNative);
    const strictInstructions = instructions
      ? `${instructions}\n\nCRITICAL: Previous response was not JSON. Return ONLY the raw JSON object. No markdown.`
      : "Return ONLY valid JSON. No markdown, no explanation.";

    const retryResponse = await client.responses.create({
      model: resolved.model || params.model,
      instructions: strictInstructions,
      input: [
        ...convertChatMessagesToResponsesInput(inputMessages),
        { role: "assistant", content: text.slice(0, 800) },
        { role: "user", content: "That was not valid JSON. Return ONLY the raw JSON object now." }
      ] as never,
      max_output_tokens: params.maxTokens ?? 2000
    } as never);
    text = extractResponsesText(retryResponse);
  }

  if (!text) {
    const hasImage = params.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")
    );
    const hint = hasImage
      ? " 当前请求包含图片，请确认该模型/接入点支持视觉理解（多模态）。"
      : "";
    throw new ServiceError(`AI 返回内容为空，请重试。${hint}`, {
      statusCode: 502,
      code: "AI_EMPTY_RESPONSE"
    });
  }

  return { text };
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

function buildCompactJsonInstruction(jsonSchema: NonNullable<ChatCompletionParams["jsonSchema"]>) {
  if (jsonSchema.name === "design_plan" || jsonSchema.name === "ecommerce_design_plan") {
    return [
      "Return ONLY valid JSON, no markdown.",
      "The JSON must be an object with exactly these top-level fields:",
      "- mainImages: an array of 5 objects. Each object must include index, title, goal, scene, layout, imageBrief, textImageLayout, visualFocus, visualGuidelines, copywriting, visualElements.",
      "- detailPages: an array of 14 objects. Each object must include index, title, goal, layout, imageBrief, textImageLayout, visualFocus, visualGuidelines, copywriting, visualElements.",
      "copywriting must be an object with headline, subheadline, and body strings. visualElements must be an array of strings.",
      "visualGuidelines must include string fields: overallTone, imageTexture, lightingLogic, colorPaletteSystem, typographyRules, compositionRules, productAppearanceFeatures, unifiedVisualStyle."
    ].join("\n");
  }

  if (jsonSchema.name === "image_prompts") {
    return [
      "Return ONLY valid JSON, no markdown.",
      "The JSON must be an object with an items array.",
      "Each item must include imageType, index, title, prompts, negativePrompt.",
      "imageType must be main_image or detail_page.",
      "prompts must be an object containing exactly one string field: gpt."
    ].join("\n");
  }

  if (jsonSchema.name === "product_analysis") {
    return [
      "Return ONLY valid JSON, no markdown.",
      "The JSON must include: category, productNameGuess, appearance, visibleFeatures, materials, colors, styleKeywords, risks, brandNames, brandVisualStyle, specifications, sellingPoints, dataSellingPoints, targetAudience, parameters, productDetails, specialRequirements, visualStyleSystem.",
      "Array fields must be arrays of strings. brandNames must include chinese and english. visualStyleSystem must include overallTone, imageTexture, lightingLogic, colorSystem, typographyRules, compositionRules."
    ].join("\n");
  }

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
  const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  let response: Response;
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
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new ServiceError(`Anthropic API 调用失败 (${response.status})：${errorBody}`, {
      statusCode: response.status === 401 ? 401 : 502,
      code: "ANTHROPIC_REQUEST_FAILED"
    });
  }

  const data = await response.json();
  const text = extractAnthropicText(data, useAnthropicToolSchema ? params.jsonSchema?.name : undefined);

  if (!text) {
    throw new ServiceError("Anthropic 返回内容为空，请重试。", {
      statusCode: 502,
      code: "AI_EMPTY_RESPONSE"
    });
  }

  return { text };
}

// ── Main entry ────────────────────────────────────────────────────

export async function createChatCompletion(
  config: AIProviderConfig,
  params: ChatCompletionParams
): Promise<ChatCompletionResult> {
  try {
    if (config.providerId === "anthropic") {
      return await anthropicChat(config, params);
    }

    if (resolveCompatibleConfig(config).useResponsesAPI) {
      return await responsesCompatibleChat(config, params);
    }

    return await openAICompatibleChat(config, params);
  } catch (error) {
    throw normalizeServiceError(error, config.providerId);
  }
}

// ── Build provider config from env fallback ───────────────────────

export function getEnvProviderConfig(): AIProviderConfig | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  return {
    providerId: "openai",
    apiKey,
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4.1-mini"
  };
}
