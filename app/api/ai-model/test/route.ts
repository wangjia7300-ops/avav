import type OpenAI from "openai";
import { PRESET_PROVIDERS } from "@/lib/ai-providers";
import { getEnvProviderConfig } from "@/lib/ai-providers";
import { assertTrustedChatProviderConfig } from "@/lib/services/endpoint-guard";
import { createAIChatCompletion } from "@/lib/services/openai-client";
import { ServiceError } from "@/lib/services/errors";
import { jsonNoStore } from "@/lib/skill-suite/server/http";
import type { AIProviderConfig } from "@/lib/types";

export const maxDuration = 180;

const capabilities = [
  {
    id: "image_research",
    name: "八维图片研究",
    description: "识别可见事实、OCR候选与视觉问题，不把推测当卖点。"
  },
  {
    id: "detail_planning",
    name: "15屏详情策划",
    description: "按决策链生成15屏9:16方案，并严格引用可验证证据。"
  },
  {
    id: "execution_qa",
    name: "四类执行与质检",
    description: "交付文案、生图指令、GEO与视觉制作参考，并执行独立只读质检。"
  }
];

const tinyVisionTestImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAByUlEQVR42u2Zr08DMRTHbw0sQSwEUTTBoBGgCLIGewq1f2F+Qewf4F+YQs1iLlMLCgQaQ9BUECCBZBjESy6X9trturv+yL5PLe3l9v28vvfavut9/SyzlI1liRsAAAAAANS/dzxn43mqAKV0DwysO/V+GJADAAAAAAAAAAAAYJsBem5diWNxZ5p6Oz9URo4e300PvxbXvgEGe7ute/H79297Q2jHIXIOTq4szzzvPykjp59nluc/Xu43iSXWrnoHoxdaksp3CCn+trs/0jJaiu5afeMccF6HdWwx6SsjlzfLYACNbHoxtCDZMQID3HJe/hY5V2aLmVyJwWJQL3Kuq1fG9QCLJYRKieRvfVzkXJlyPEq0uw+Q+0kl6VOChFyu4OmBFH4FipmsjW8aLCb92ugKnANV9zeKND0TWJzur66DJQFwIwOAyLmpwJe1KMYkHkmpF/6V2RJpGRU5L+oOC8o+EN1GphdT005scX8sGxlpNTnbHmkhAUZS0iKQRNNp1H43CLwClM1VDNOZIuoLzfBhWnutSeZGtr5c7MRJA1DzjBppLZq/zlwXDBuqd2yvO7cBu+iwM/9/mYX9PoAqBAAAAAAAAIjJ/gExrMO8dzUj4QAAAABJRU5ErkJggg==";

function resolveConfig(config: AIProviderConfig) {
  if (!config.apiKey.trim() || !config.model.trim()) {
    throw new ServiceError("请先填写 API Key 和模型名称。", {
      statusCode: 400,
      code: "MODEL_TEST_CONFIG_MISSING"
    });
  }
  const preset = PRESET_PROVIDERS.find((provider) => provider.id === config.providerId);
  if (config.providerId !== "custom" && !preset) {
    throw new ServiceError("不支持当前 AI 供应商。", {
      statusCode: 400,
      code: "MODEL_PROVIDER_UNSUPPORTED"
    });
  }
  if (config.providerId === "custom" && !/^https:\/\//i.test(config.baseURL.trim())) {
    throw new ServiceError("自定义 Endpoint 必须以 https:// 开头。", {
      statusCode: 400,
      code: "MODEL_ENDPOINT_INVALID"
    });
  }
  return {
    ...config,
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    // custom 预设的 baseURL 是空字符串，必须使用用户填写的 Endpoint；
    // 否则 SDK 会回落到 api.openai.com，把密钥发给非预期供应商。
    baseURL:
      config.providerId === "custom"
        ? config.baseURL.trim()
        : preset?.baseURL || config.baseURL.trim()
  };
}

function parseTestResult(text: string) {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  let parsed: unknown;

  try {
    parsed = JSON.parse(start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped);
  } catch {
    throw new ServiceError("模型已连接，但未通过四技能 JSON 协议测试。", {
      statusCode: 422,
      code: "MODEL_RESPONSE_JSON_INVALID"
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ServiceError("模型已连接，但未通过四技能 JSON 协议测试。", {
      statusCode: 422,
      code: "MODEL_RESPONSE_JSON_INVALID"
    });
  }

  const payload = parsed as Record<string, unknown>;

  if (
    typeof payload.category !== "string" ||
    typeof payload.dominantColor !== "string" ||
    typeof payload.visibleFact !== "string" ||
    !/蓝|青|靛|blue|navy|azure|cyan|indigo|cobalt|teal/i.test(payload.dominantColor)
  ) {
    throw new ServiceError("模型未通过图片理解与事实提取测试。", {
      statusCode: 422,
      code: "MODEL_VISION_UNSUPPORTED"
    });
  }
}

function safeFailure(error: unknown) {
  const service = error instanceof ServiceError ? error : null;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const status = service?.statusCode ?? 502;
  const code = service?.code ?? "MODEL_TEST_FAILED";

  if (status === 401 || message.includes("401") || message.includes("unauthorized")) {
    return {
      status: 401,
      field: "apiKey" as const,
      error: "API Key 无效或已失效。",
      code: "MODEL_AUTH_FAILED",
      retryable: false
    };
  }
  if (status === 404 || message.includes("404") || message.includes("not found")) {
    return {
      status: 404,
      field: "model" as const,
      error: "未找到模型或接入点，请检查模型名称或 ep-... ID。",
      code: "MODEL_NOT_FOUND",
      retryable: false
    };
  }
  if (status === 429 || message.includes("429") || message.includes("rate limit")) {
    return {
      status: 429,
      error: "模型服务限流或额度不足，请稍后重试。",
      code: "MODEL_RATE_LIMITED",
      retryable: true
    };
  }

  return {
    status,
    field:
      code === "MODEL_ENDPOINT_INVALID"
        ? ("baseURL" as const)
        : code.includes("VISION") || code.includes("RESPONSE")
          ? ("model" as const)
          : undefined,
    error:
      service?.message ??
      "模型连接测试失败，请检查 API Key、模型、Endpoint 和图片理解能力。",
    code,
    retryable: status >= 500
  };
}

export async function GET() {
  const envConfig = getEnvProviderConfig();
  return jsonNoStore({
    success: true,
    data: {
      mode: "real",
      ready: Boolean(envConfig),
      hasServerConfig: Boolean(envConfig),
      providerId: envConfig?.providerId ?? null,
      model: envConfig?.model ?? null,
      capabilities,
      message: envConfig
        ? `${envConfig.displayName ?? envConfig.providerId}/${envConfig.model} 已载入，建议执行一次生产协议测试。`
        : "请在右上角配置文案模型，或在服务端设置 ARK_API_KEY。"
    }
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      providerConfig?: AIProviderConfig;
    };
    const envConfig = getEnvProviderConfig();
    const config = body.providerConfig
      ? resolveConfig(body.providerConfig)
      : envConfig;
    if (!config) {
      throw new ServiceError("缺少模型配置。", {
        statusCode: 400,
        code: "MODEL_TEST_CONFIG_MISSING"
      });
    }
    if (body.providerConfig) {
      // 客户端提交的配置必须指向公开 HTTPS 端点（防 SSRF）。
      await assertTrustedChatProviderConfig(config);
    }
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      {
        type: "text",
        text: [
          "观察测试图，只返回JSON。",
          "结构必须为：",
          '{"category":"测试品类","dominantColor":"主色","visibleFact":"一个可见事实","planningRole":"首屏定位","executionMode":"E","qaRule":"证据优先"}'
        ].join("\n")
      },
      {
        type: "image_url",
        image_url: { url: tinyVisionTestImage, detail: "low" }
      }
    ];
    const text = await createAIChatCompletion(config, {
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你正在执行四技能工作流能力测试。不要推测，只返回完整JSON。"
        },
        { role: "user", content }
      ],
      maxTokens: 600,
      timeoutMs: 120_000,
      maxTransportRetries: 1
    });
    parseTestResult(text);

    return jsonNoStore({
      success: true,
      data: {
        mode: "real",
        ready: true,
        providerId: config.providerId,
        model: config.model,
        capabilities,
        message: `${config.providerId}/${config.model} 已通过图片理解与四技能 JSON 协议测试。`
      }
    });
  } catch (error) {
    const failure = safeFailure(error);
    return jsonNoStore(
      {
        success: false,
        error: failure.error,
        code: failure.code,
        field: failure.field,
        retryable: failure.retryable
      },
      failure.status
    );
  }
}
