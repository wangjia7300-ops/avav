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

type UploadedResearchAsset = { id: string; dataUrl: string };

export type ResearchExtractRequest = {
  stage: "research";
  operation: "extract";
  providerConfig?: AIProviderConfig | null;
  runId: string;
  inputFingerprint: string;
  batchIndex: number;
  totalBatches: number;
  allAssetIds: string[];
  assets: UploadedResearchAsset[];
  notes?: string;
};

export type ResearchFinalizeRequest = {
  stage: "research";
  operation: "finalize";
  providerConfig?: AIProviderConfig | null;
  runId: string;
  inputFingerprint: string;
  assetIds: string[];
  notes?: string;
};

export type SkillSuiteRequest =
  | ResearchExtractRequest
  | ResearchFinalizeRequest
  | {
      stage: "planning";
      providerConfig?: AIProviderConfig | null;
      research: ProductResearch;
      brief: SupplementalBrief;
      draftPlan?: DetailPlan;
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

function assertProviderConfig(
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
      "请先在“文案模型”中完成配置，或在服务端设置 ARK_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY。",
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
const RESEARCH_BATCH_SIZE = 3;
const MAX_RESEARCH_ASSETS = 9;
const RUN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{12,160}$/;
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function assertResearchToken(value: unknown, field: string) {
  if (typeof value !== "string" || !RUN_TOKEN_PATTERN.test(value)) {
    throw new ServiceError(`${field} 不合法。`, {
      statusCode: 400,
      code: "SKILL_SUITE_REQUEST_INVALID"
    });
  }
}

function assertAssetIds(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_RESEARCH_ASSETS ||
    value.some(
      (item) => typeof item !== "string" || !ASSET_ID_PATTERN.test(item)
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new ServiceError(
      `${field} 必须是1–${MAX_RESEARCH_ASSETS}个不重复的合法素材ID。`,
      {
        statusCode: 400,
        code: "SKILL_SUITE_REQUEST_INVALID"
      }
    );
  }
  return value as string[];
}

function assertResearchNotes(value: unknown) {
  if (
    value !== undefined &&
    (typeof value !== "string" || value.length > MAX_NOTES_LENGTH)
  ) {
    throw new ServiceError(`notes 必须是不超过${MAX_NOTES_LENGTH}字的字符串。`, {
      statusCode: 400,
      code: "SKILL_SUITE_REQUEST_INVALID"
    });
  }
}

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

  if (candidate.stage === "research") {
    assertResearchNotes(candidate.notes);
    const operation = candidate.operation;
    if (
      operation !== "extract" &&
      operation !== "finalize"
    ) {
      throw new ServiceError("图研请求必须指定 extract 或 finalize 操作。", {
        statusCode: 400,
        code: "SKILL_RESEARCH_OPERATION_INVALID"
      });
    }

    if (operation === "extract") {
      assertResearchToken(candidate.runId, "runId");
      assertResearchToken(candidate.inputFingerprint, "inputFingerprint");
      const allAssetIds = assertAssetIds(
        candidate.allAssetIds,
        "allAssetIds"
      );
      const expectedTotalBatches = Math.ceil(
        allAssetIds.length / RESEARCH_BATCH_SIZE
      );
      if (
        !Number.isInteger(candidate.totalBatches) ||
        candidate.totalBatches !== expectedTotalBatches ||
        !Number.isInteger(candidate.batchIndex) ||
        Number(candidate.batchIndex) < 0 ||
        Number(candidate.batchIndex) >= expectedTotalBatches ||
        !Array.isArray(candidate.assets) ||
        candidate.assets.length < 1 ||
        candidate.assets.length > RESEARCH_BATCH_SIZE
      ) {
        throw new ServiceError("图研批次编号、总数或图片数不合法。", {
          statusCode: 400,
          code: "SKILL_SUITE_REQUEST_INVALID"
        });
      }
      const expectedIds = allAssetIds.slice(
        Number(candidate.batchIndex) * RESEARCH_BATCH_SIZE,
        (Number(candidate.batchIndex) + 1) * RESEARCH_BATCH_SIZE
      );
      const receivedIds = candidate.assets.map((asset) =>
        asset && typeof asset === "object"
          ? (asset as { id?: unknown }).id
          : undefined
      );
      if (
        receivedIds.length !== expectedIds.length ||
        receivedIds.some((id, index) => id !== expectedIds[index])
      ) {
        throw new ServiceError("当前图研批次与全部素材顺序不一致。", {
          statusCode: 409,
          code: "RESEARCH_RUN_BATCH_MANIFEST_MISMATCH"
        });
      }
    }

    if (operation === "finalize") {
      assertResearchToken(candidate.runId, "runId");
      assertResearchToken(candidate.inputFingerprint, "inputFingerprint");
      assertAssetIds(candidate.assetIds, "assetIds");
      if (candidate.assets !== undefined) {
        throw new ServiceError("图研汇总请求不得再携带产品图。", {
          statusCode: 400,
          code: "SKILL_SUITE_REQUEST_INVALID"
        });
      }
    }
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
    if (candidate.draftPlan !== undefined) {
      const draftPlan = candidate.draftPlan;
      if (
        !draftPlan ||
        typeof draftPlan !== "object" ||
        Array.isArray(draftPlan) ||
        !Array.isArray((draftPlan as { screens?: unknown }).screens) ||
        (draftPlan as { screens: unknown[] }).screens.length !== 15
      ) {
        throw new ServiceError("draftPlan 必须是未发布的15屏策划草稿。", {
          statusCode: 400,
          code: "SKILL_SUITE_REQUEST_INVALID"
        });
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
      status: error.statusCode,
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
