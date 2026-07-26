import { getEnvProviderConfig } from "@/lib/ai-providers";
import { assertTrustedChatProviderConfig } from "@/lib/services/endpoint-guard";
import { ServiceError } from "@/lib/services/errors";
import { SkillSuiteValidationError } from "@/lib/skill-suite/validation";
import type {
  AIProviderConfig,
  DetailPlan,
  DetailScreen,
  ExecutionMode,
  ProductResearch,
  ScreenExecution,
  SupplementalBrief
} from "@/lib/types";

export type SkillSuiteRequest =
  | {
      stage: "research";
      providerConfig?: AIProviderConfig | null;
      assets: Array<{ id: string; dataUrl: string }>;
      notes?: string;
    }
  | {
      stage: "planning";
      providerConfig?: AIProviderConfig | null;
      research: ProductResearch;
      brief: SupplementalBrief;
    }
  | {
      stage: "execution";
      providerConfig?: AIProviderConfig | null;
      research: ProductResearch;
      plan: DetailPlan;
      screens: DetailScreen[];
      mode: ExecutionMode;
    }
  | {
      stage: "qa";
      providerConfig?: AIProviderConfig | null;
      research: ProductResearch;
      plan: DetailPlan;
      executions: Record<string, ScreenExecution>;
    };

export function assertProviderConfig(
  value: unknown
): asserts value is AIProviderConfig {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as AIProviderConfig).providerId !== "string" ||
    typeof (value as AIProviderConfig).apiKey !== "string" ||
    typeof (value as AIProviderConfig).model !== "string" ||
    typeof (value as AIProviderConfig).baseURL !== "string" ||
    !(value as AIProviderConfig).apiKey.trim() ||
    !(value as AIProviderConfig).model.trim()
  ) {
    throw new ServiceError("请先在“文案模型”中完成并通过 API 配置测试。", {
      statusCode: 401,
      code: "AI_CONFIG_REQUIRED"
    });
  }
}

export async function resolveProviderConfig(value: unknown) {
  if (value) {
    assertProviderConfig(value);
    // 客户端可控的 baseURL 必须通过公开 HTTPS 端点校验（防 SSRF），
    // 与生图链路的 assertPublicCustomEndpoint 保持同等防护。
    await assertTrustedChatProviderConfig(value);
    return value;
  }

  const envConfig = getEnvProviderConfig();
  if (!envConfig) {
    throw new ServiceError(
      "请先在“文案模型”中完成配置，或在服务端设置 ARK_API_KEY。",
      {
        statusCode: 401,
        code: "AI_CONFIG_REQUIRED"
      }
    );
  }
  return envConfig;
}

const SKILL_SUITE_STAGES = ["research", "planning", "execution", "qa"] as const;
const EXECUTION_MODES = ["A", "B", "D", "E"] as const;
const MAX_BRIEF_FIELD_LENGTH = 2_000;
const MAX_NOTES_LENGTH = 4_000;

export function assertRequestShape(
  body: unknown
): asserts body is SkillSuiteRequest {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !SKILL_SUITE_STAGES.includes(
      (body as { stage?: unknown }).stage as (typeof SKILL_SUITE_STAGES)[number]
    )
  ) {
    throw new ServiceError("请求缺少合法的 stage 字段。", {
      statusCode: 400,
      code: "SKILL_SUITE_REQUEST_INVALID"
    });
  }

  const candidate = body as Record<string, unknown>;

  if (
    candidate.stage === "research" &&
    candidate.notes !== undefined &&
    (typeof candidate.notes !== "string" ||
      candidate.notes.length > MAX_NOTES_LENGTH)
  ) {
    throw new ServiceError(`notes 必须是不超过${MAX_NOTES_LENGTH}字的字符串。`, {
      statusCode: 400,
      code: "SKILL_SUITE_REQUEST_INVALID"
    });
  }

  if (candidate.stage === "planning") {
    const brief = candidate.brief;
    if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
      throw new ServiceError("brief 必须是对象。", {
        statusCode: 400,
        code: "SKILL_SUITE_REQUEST_INVALID"
      });
    }
    for (const [key, fieldValue] of Object.entries(brief)) {
      if (
        typeof fieldValue !== "string" ||
        fieldValue.length > MAX_BRIEF_FIELD_LENGTH
      ) {
        throw new ServiceError(
          `brief.${key} 必须是不超过${MAX_BRIEF_FIELD_LENGTH}字的字符串。`,
          {
            statusCode: 400,
            code: "SKILL_SUITE_REQUEST_INVALID"
          }
        );
      }
    }
  }

  if (
    candidate.stage === "execution" &&
    !EXECUTION_MODES.includes(
      candidate.mode as (typeof EXECUTION_MODES)[number]
    )
  ) {
    throw new ServiceError("mode 必须是 A / B / D / E 之一。", {
      statusCode: 400,
      code: "SKILL_SUITE_REQUEST_INVALID"
    });
  }

  if (
    candidate.stage === "qa" &&
    (!candidate.executions ||
      typeof candidate.executions !== "object" ||
      Array.isArray(candidate.executions))
  ) {
    throw new ServiceError("executions 必须是以 screenId 为键的对象。", {
      statusCode: 400,
      code: "SKILL_SUITE_REQUEST_INVALID"
    });
  }
}

export function safeError(error: unknown) {
  if (error instanceof SkillSuiteValidationError) {
    return {
      status: 422,
      body: {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details,
        ...(error.meta ? { meta: error.meta } : {}),
        ...(error.partialData !== undefined
          ? { partialData: error.partialData }
          : {})
      }
    };
  }

  if (error instanceof ServiceError) {
    return {
      status: error.statusCode,
      body: {
        success: false,
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {})
      }
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: "四技能工作流执行失败，请检查配置后重试当前阶段。",
      code: "SKILL_SUITE_UNKNOWN"
    }
  };
}
