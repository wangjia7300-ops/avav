import type OpenAI from "openai";
import { NextResponse } from "next/server";
import { MAX_UPLOAD_IMAGE_COUNT } from "@/lib/config";
import {
  buildExecutionPrompt,
  buildExecutionRepairPrompt,
  buildPlanningFoundationPrompt,
  buildPlanningFoundationRepairPrompt,
  buildPlanningRepairPrompt,
  buildPlanningScreenBatchPrompt,
  buildQAPrompt,
  buildResearchRepairPrompt,
  buildResearchPrompt,
  compileScreenImagePrompt
} from "@/lib/skill-suite/prompts";
import { authorizeUploadedImageFacts } from "@/lib/skill-suite/evidence-policy";
import {
  assertExecutions,
  assertPlan,
  assertPlanningFoundation,
  assertQAReport,
  assertResearch,
  extractJsonObject,
  parseExecutionDrafts,
  runDeterministicQA,
  SkillSuiteValidationError
} from "@/lib/skill-suite/validation";
import {
  createAIChatCompletion
} from "@/lib/services/openai-client";
import type { ChatCompletionParams } from "@/lib/ai-providers";
import { getEnvProviderConfig } from "@/lib/ai-providers";
import { assertTrustedChatProviderConfig } from "@/lib/services/endpoint-guard";
import { ServiceError } from "@/lib/services/errors";
import type {
  AIProviderConfig,
  DetailPlan,
  DetailPlanFoundation,
  DetailScreen,
  ExecutionMode,
  ProductResearch,
  QAReport,
  QAFinding,
  ScreenExecution,
  SupplementalBrief
} from "@/lib/types";
import {
  collectResearchStructureIssues,
  normalizeResearchDraft
} from "@/lib/skill-suite/research-normalization";
import { RESEARCH_JSON_SCHEMA } from "@/lib/skill-suite/research-schema";
import {
  parsePlanningRepairPayload,
  planIssueFingerprint,
  PlanRepairContractError,
  selectPlanRepairTargetIds,
  type PlanRepairIssue
} from "@/lib/skill-suite/plan-repair";
import { applyScreenContracts } from "@/lib/skill-suite/screen-contracts";

export const maxDuration = 300;
const MAX_PLANNING_REPAIR_ATTEMPTS = 4;
const PLANNING_TIME_BUDGET_MS = 270_000;

type SkillSuiteRequest =
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

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0"
    }
  });
}

function assertProviderConfig(value: unknown): asserts value is AIProviderConfig {
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

async function resolveProviderConfig(value: unknown) {
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

function assertRequestShape(body: unknown): asserts body is SkillSuiteRequest {
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

function safeError(error: unknown) {
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

function textMessages(prompt: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
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

async function complete(
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

function planningTimeoutMs(deadlineAt: number) {
  const remaining = deadlineAt - Date.now();
  if (remaining < 5_000) {
    throw new SkillSuiteValidationError(
      "策划阶段已用完本次时间预算，请保留当前诊断后重试。",
      "PLAN_TIME_BUDGET_EXCEEDED",
      [`时间预算：${PLANNING_TIME_BUDGET_MS}ms`]
    );
  }
  return Math.min(240_000, remaining);
}

function ensureModelMetadata<T extends object>(value: T) {
  return {
    ...value,
    source: "model" as const,
    generatedAt: new Date().toISOString()
  };
}

function parsePlanningBatch(
  text: string,
  expectedIndexes: readonly number[]
) {
  const payload = extractJsonObject<{ screens: DetailScreen[] }>(text);
  const screens = Array.isArray(payload.screens) ? payload.screens : [];
  const expectedIds = expectedIndexes.map(
    (index) => `screen-${String(index).padStart(2, "0")}`
  );
  const actualIds = screens.map((screen) => screen?.id);
  if (
    screens.length !== expectedIndexes.length ||
    expectedIds.some((id) => !actualIds.includes(id)) ||
    new Set(actualIds).size !== actualIds.length
  ) {
    throw new SkillSuiteValidationError(
      "策划分批结果缺屏、串屏或 screenId 重复。",
      "PLAN_BATCH_INVALID",
      [
        `期望：${expectedIds.join("、")}`,
        `实际：${actualIds.join("、") || "空"}`
      ]
    );
  }
  return screens.sort((left, right) => left.index - right.index);
}

async function generatePlanningBatch(input: {
  providerConfig: AIProviderConfig;
  research: ProductResearch;
  brief: SupplementalBrief;
  foundation: DetailPlanFoundation;
  indexes: readonly number[];
  deadlineAt: number;
  signal?: AbortSignal;
}) {
  const prompt = buildPlanningScreenBatchPrompt({
    research: input.research,
    brief: input.brief,
    foundation: input.foundation,
    indexes: input.indexes
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (input.signal?.aborted) break;
    try {
      const text = await complete(
        input.providerConfig,
        textMessages(prompt),
        7_000,
        { timeoutMs: planningTimeoutMs(input.deadlineAt), signal: input.signal }
      );
      return {
        screens: parsePlanningBatch(text, input.indexes),
        retryCount: attempt
      };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof ServiceError) {
    const first = input.indexes[0];
    const last = input.indexes[input.indexes.length - 1];
    throw new ServiceError(
      `第${first}–${last}屏策划批次未完成，请重试当前阶段。`,
      {
        statusCode: lastError.statusCode,
        code: lastError.code,
        details: {
          ...lastError.details,
          stage: "planning-batch",
          batchId: `screens-${first}-${last}`,
          retryable: true
        }
      }
    );
  }
  throw lastError;
}

function mergeFindings(
  deterministic: QAFinding[],
  semantic: QAFinding[],
  facts: ProductResearch["facts"]
) {
  const seen = new Set(deterministic.map((item) => `${item.screenId ?? ""}:${item.title}`));
  const availableScopes = new Set(
    facts
      .filter((fact) => fact.commercialUse && fact.status !== "blocked")
      .map((fact) => fact.claimScope)
  );
  return [
    ...deterministic,
    ...semantic.filter((item) => {
      const key = `${item.screenId ?? ""}:${item.title}`;
      if (seen.has(key)) return false;
      // “通过”必须来自可复现的规则检查。语义模型只负责补充问题，
      // 不能在没有真实像素稿或业务资料时自报字号、暗色模式、A/B 等通过项。
      if (item.severity === "pass") return false;
      if (
        item.module === "促销" &&
        !availableScopes.has("promotion")
      ) {
        return false;
      }
      if (
        item.module === "信任证据" &&
        /缺乏|缺少|没有/.test(`${item.title}${item.evidence}`) &&
        !facts.some((fact) =>
          /评价|好评|口碑|用户反馈/.test(`${fact.label}${fact.value}`)
        )
      ) {
        return false;
      }
      if (
        !availableScopes.has("performance") &&
        /保暖|保温|锁温|防滑|耐磨|舒适|柔软|透气|抗菌|耐用/.test(
          `${item.title}${item.evidence}${item.fix}`
        )
      ) {
        return false;
      }
      seen.add(key);
      return true;
    })
  ];
}

export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json().catch(() => {
      throw new ServiceError("请求体必须是合法 JSON。", {
        statusCode: 400,
        code: "SKILL_SUITE_REQUEST_INVALID"
      });
    });
    assertRequestShape(rawBody);
    const body = rawBody;
    const providerConfig = await resolveProviderConfig(body.providerConfig);

    if (body.stage === "research") {
      if (
        !Array.isArray(body.assets) ||
        body.assets.length < 1 ||
        body.assets.length > MAX_UPLOAD_IMAGE_COUNT
      ) {
        throw new ServiceError(`请上传1–${MAX_UPLOAD_IMAGE_COUNT}张产品图。`, {
          statusCode: 400,
          code: "ASSET_COUNT_INVALID"
        });
      }

      const invalidAsset = body.assets.find(
        (asset) =>
          typeof asset?.id !== "string" ||
          typeof asset?.dataUrl !== "string" ||
          !/^data:image\/(?:png|jpeg|webp);base64,/i.test(asset.dataUrl)
      );
      if (invalidAsset) {
        throw new ServiceError("产品图必须是 JPG、PNG 或 WEBP 的本地 data URL。", {
          statusCode: 400,
          code: "ASSET_FORMAT_INVALID"
        });
      }

      const assetIds = body.assets.map((asset) => asset.id);
      const notes = body.notes?.trim() ?? "";
      const imageParts = body.assets.map(
        (asset) =>
          ({
            type: "image_url",
            image_url: { url: asset.dataUrl, detail: "high" }
          }) as OpenAI.Chat.Completions.ChatCompletionContentPartImage
      );
      // 语义类问题（JSON 已完整、仅字段语义冲突）在修复轮次改为纯文本任务，
      // 避免模型重新看图后再次生成自然复合句，抵消“只修结构”的要求。
      const SEMANTIC_ISSUE_CODES = new Set([
        "COMPOSITE_ENUM",
        "CROSS_FIELD_CONFLICT",
        "INVALID_ENUM",
        "DUPLICATE_VALUE",
        "OUT_OF_RANGE"
      ]);
      let currentPrompt = buildResearchPrompt(assetIds, notes);
      let parsed: unknown;
      let repairCount = 0;
      let responseMetadata: unknown;
      let includeImages = true;
      let lastIssueFingerprint: string | null = null;

      while (repairCount <= 2) {
        const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
          { type: "text", text: currentPrompt },
          ...(includeImages ? imageParts : [])
        ];
        const text = await complete(
          providerConfig,
          [
            {
              role: "system",
              content:
                "你是电商产品图片研究员。只依据图片和用户补充提取内容；用户上传图片内的可识别文字、参数、材质、功能和卖点全部视为甲方一方基础资料，可用于文案。风险只做备注，不因缺少外部报告删除内容。"
            },
            { role: "user", content }
          ],
          7000,
          {
            jsonSchema: {
              name: "product_research",
              schema: RESEARCH_JSON_SCHEMA,
              strict: true
            },
            onResponseMetadata: (metadata) => {
              responseMetadata = metadata;
            }
          }
        );

        let rejectedResult: unknown = text;
        let jsonParsed = false;
        let structuredIssues: Array<{ path: string; code: string }> = [];
        let issues: string[] = [];
        try {
          const extracted = extractJsonObject<unknown>(text);
          const normalized = normalizeResearchDraft(extracted);
          parsed =
            normalized &&
            typeof normalized === "object" &&
            !Array.isArray(normalized)
              ? {
                  ...normalized,
                  source: "model",
                  generatedAt: new Date().toISOString()
                }
              : normalized;
          rejectedResult = parsed;
          jsonParsed = true;
          const collected = collectResearchStructureIssues(parsed, {
            allowedAssetIds: assetIds
          });
          structuredIssues = collected.map((issue) => ({
            path: issue.path,
            code: issue.code
          }));
          issues = collected.map(
            (issue, index) =>
              `${index + 1}. [${issue.code}] ${issue.path}：${issue.message}`
          );
        } catch (error) {
          if (
            error instanceof SkillSuiteValidationError &&
            error.code === "MODEL_JSON_INVALID"
          ) {
            structuredIssues = [{ path: "$", code: "MODEL_JSON_INVALID" }];
            issues = ["1. [MODEL_JSON_INVALID] $：返回内容不是完整 JSON 对象。"];
          } else {
            throw error;
          }
        }

        if (issues.length === 0) break;

        // 连续两轮修复停留在同一组问题上，说明修复不收敛，
        // 立即失败并展示字段级命中详情，避免继续重复计费。
        const issueFingerprint = structuredIssues
          .map((issue) => `${issue.path}|${issue.code}`)
          .sort()
          .join(";");
        if (repairCount > 0 && issueFingerprint === lastIssueFingerprint) {
          throw new SkillSuiteValidationError(
            "真实模型图研修复连续两轮停留在同一组结构问题上，已提前终止，未写入兜底数据。",
            "RESEARCH_REPAIR_NOT_CONVERGING",
            issues
          );
        }
        lastIssueFingerprint = issueFingerprint;

        if (repairCount === 2) {
          throw new SkillSuiteValidationError(
            "真实模型图研结果经两次定点修复后仍不符合生产结构，未写入兜底数据。",
            "RESEARCH_SCHEMA_INVALID",
            issues
          );
        }

        const textOnlyRepair =
          jsonParsed &&
          structuredIssues.every((issue) => SEMANTIC_ISSUE_CODES.has(issue.code));

        repairCount += 1;
        includeImages = !textOnlyRepair;
        currentPrompt = buildResearchRepairPrompt({
          rejectedResult,
          issues,
          assetIds,
          notes,
          textOnly: textOnlyRepair
        });
      }

      assertResearch(parsed);
      const authorized = authorizeUploadedImageFacts(
        parsed,
        assetIds
      );
      assertResearch(authorized);
      const research = ensureModelMetadata(authorized);

      return jsonNoStore({
        success: true,
        data: research,
        meta: {
          repairCount,
          fallbackUsed: false,
          responseMetadata
        }
      });
    }

    if (body.stage === "planning") {
      const planningStartedAt = Date.now();
      const planningDeadlineAt =
        planningStartedAt + PLANNING_TIME_BUDGET_MS;
      assertResearch(body.research);
      const foundationPrompt = buildPlanningFoundationPrompt(
        body.research,
        body.brief
      );
      const foundationText = await complete(
        providerConfig,
        textMessages(foundationPrompt),
        7_000,
        { timeoutMs: planningTimeoutMs(planningDeadlineAt) }
      );
      let foundation =
        extractJsonObject<DetailPlanFoundation>(foundationText);
      let foundationRepairCount = 0;
      while (foundationRepairCount <= 2) {
        try {
          assertPlanningFoundation(foundation, body.research.facts);
          break;
        } catch (error) {
          if (
            !(error instanceof SkillSuiteValidationError) ||
            error.code !== "PLAN_FOUNDATION_INVALID" ||
            foundationRepairCount === 2
          ) {
            throw error;
          }
          foundationRepairCount += 1;
          const repairPrompt = buildPlanningFoundationRepairPrompt({
            research: body.research,
            brief: body.brief,
            rejectedFoundation: foundation,
            issues: error.details
          });
          const repairedText = await complete(
            providerConfig,
            textMessages(repairPrompt),
            5_000,
            { timeoutMs: planningTimeoutMs(planningDeadlineAt) }
          );
          foundation =
            extractJsonObject<DetailPlanFoundation>(repairedText);
        }
      }

      const indexBatches = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
        [10, 11, 12],
        [13, 14, 15]
      ] as const;
      // 任一批次彻底失败时取消其余在途批次，避免白耗模型配额。
      const batchAbort = new AbortController();
      const batchResults = await Promise.all(
        indexBatches.map((indexes) =>
          generatePlanningBatch({
            providerConfig,
            research: body.research,
            brief: body.brief,
            foundation,
            indexes,
            deadlineAt: planningDeadlineAt,
            signal: batchAbort.signal
          }).catch((error) => {
            batchAbort.abort();
            throw error;
          })
        )
      );
      const batchRetryCount = batchResults.reduce(
        (sum, batch) => sum + batch.retryCount,
        0
      );
      let parsed: DetailPlan = {
        ...foundation,
        screens: applyScreenContracts(
          batchResults.flatMap((batch) => batch.screens),
          body.research.facts
        ),
        source: "model",
        generatedAt: new Date().toISOString()
      };
      let repairCount = 0;
      let previousIssueFingerprint = "";

      const planningMeta = (
        phase: string,
        conflictScreenIds: readonly string[] = [],
        publishable = false
      ) => ({
        generationMode: "foundation-plus-5x3",
        phase,
        elapsedMs: Date.now() - planningStartedAt,
        timeBudgetMs: PLANNING_TIME_BUDGET_MS,
        foundationRepairCount,
        batchRetryCount,
        repairCount,
        completedScreenIds: parsed.screens.map((screen) => screen.id),
        conflictScreenIds: [...conflictScreenIds],
        fallbackUsed: false,
        publishable
      });

      while (true) {
        try {
          assertPlan(parsed, body.research.facts);
          break;
        } catch (error) {
          if (
            !(error instanceof SkillSuiteValidationError) ||
            error.code !== "PLAN_QUALITY_INVALID"
          ) {
            throw error;
          }

          const repairIssues: PlanRepairIssue[] =
            error.planIssues.length > 0
              ? error.planIssues
              : [
                  {
                    ruleCode: "PLAN_QUALITY_UNSTRUCTURED",
                    message: error.details.join("；"),
                    screenIds: parsed.screens.map((screen) => screen.id),
                    scope: "foundation",
                    allowedRepairFields: [
                      "role",
                      "conversionTask",
                      "primarySellingPoint",
                      "proofMethod",
                      "copy.headline",
                      "copy.subheadline",
                      "copy.body",
                      "copy.keyPoints",
                      "scene",
                      "shot",
                      "composition",
                      "transition"
                    ]
                  }
                ];
          const targetIds = selectPlanRepairTargetIds(
            repairIssues,
            parsed.screens
          );
          const fingerprint = planIssueFingerprint(repairIssues);
          const meta = planningMeta("planning-repair", targetIds, false);
          const partialData = { plan: parsed, publishable: false };

          if (
            fingerprint &&
            previousIssueFingerprint &&
            fingerprint === previousIssueFingerprint
          ) {
            throw new SkillSuiteValidationError(
              "策划修复连续返回同一组问题，已停止无效循环；当前结果未发布。",
              "PLAN_REPAIR_NOT_CONVERGING",
              error.details,
              repairIssues,
              meta,
              partialData
            );
          }

          if (repairCount >= MAX_PLANNING_REPAIR_ATTEMPTS) {
            throw new SkillSuiteValidationError(
              "策划修复达到上限后仍未通过，当前结果未发布。",
              "PLAN_REPAIR_EXHAUSTED",
              error.details,
              repairIssues,
              meta,
              partialData
            );
          }

          try {
            planningTimeoutMs(planningDeadlineAt);
          } catch {
            throw new SkillSuiteValidationError(
              "策划阶段已用完时间预算，当前结果未发布。",
              "PLAN_TIME_BUDGET_EXCEEDED",
              error.details,
              repairIssues,
              meta,
              partialData
            );
          }

          previousIssueFingerprint = fingerprint;
          repairCount += 1;
          const repairPrompt = buildPlanningRepairPrompt({
            research: body.research,
            brief: body.brief,
            rejectedPlan: parsed,
            issues: repairIssues,
            targetIds
          });
          let repairedScreens: DetailScreen[] | undefined;
          let lastRepairError: unknown;
          for (let formatAttempt = 0; formatAttempt < 2; formatAttempt += 1) {
            try {
              const repairedText = await complete(
                providerConfig,
                textMessages(repairPrompt),
                7_000,
                { timeoutMs: planningTimeoutMs(planningDeadlineAt) }
              );
              const repairPayload = extractJsonObject<unknown>(repairedText);
              repairedScreens = parsePlanningRepairPayload({
                payload: repairPayload,
                targetIds,
                originalScreens: parsed.screens,
                issues: repairIssues
              });
              break;
            } catch (repairError) {
              lastRepairError = repairError;
              const isFormattingFailure =
                repairError instanceof PlanRepairContractError ||
                (repairError instanceof SkillSuiteValidationError &&
                  repairError.code === "MODEL_JSON_INVALID");
              if (!isFormattingFailure || formatAttempt === 1) break;
            }
          }

          if (!repairedScreens) {
            const repairCode =
              lastRepairError instanceof PlanRepairContractError
                ? lastRepairError.code
                : lastRepairError instanceof SkillSuiteValidationError
                  ? lastRepairError.code
                  : "PLAN_REPAIR_INVALID";
            const repairDetails =
              lastRepairError instanceof PlanRepairContractError ||
              lastRepairError instanceof SkillSuiteValidationError
                ? lastRepairError.details
                : ["模型两次没有返回符合目标子集契约的修复结果。"];
            throw new SkillSuiteValidationError(
              "策划修复越界修改任务契约或返回格式无效，当前结果未发布。",
              repairCode,
              repairDetails,
              repairIssues,
              planningMeta("planning-repair-contract", targetIds, false),
              partialData
            );
          }

          const repairedById = new Map(
            repairedScreens.map((screen) => [screen.id, screen])
          );
          parsed = {
            ...parsed,
            screens: parsed.screens.map(
              (screen) => repairedById.get(screen.id) ?? screen
            )
          };
        }
      }
      const plan = ensureModelMetadata(parsed);

      return jsonNoStore({
        success: true,
        data: plan,
        meta: planningMeta("complete", [], true)
      });
    }

    if (body.stage === "execution") {
      assertResearch(body.research);
      assertPlan(body.plan, body.research.facts);
      if (!Array.isArray(body.screens) || body.screens.length < 1 || body.screens.length > 5) {
        throw new ServiceError("执行阶段每批只能生成1–5屏。", {
          statusCode: 400,
          code: "EXECUTION_BATCH_INVALID"
        });
      }

      const planById = new Map(body.plan.screens.map((screen) => [screen.id, screen]));
      const requested = body.screens.map((screen) => planById.get(screen.id)).filter(Boolean);
      if (requested.length !== body.screens.length) {
        throw new ServiceError("执行批次包含不属于当前策划的屏幕。", {
          statusCode: 400,
          code: "EXECUTION_SCREEN_INVALID"
        });
      }

      const prompt = buildExecutionPrompt(
        requested as DetailScreen[],
        body.research,
        body.plan,
        body.mode
      );
      const text = await complete(providerConfig, textMessages(prompt), 9000);
      let parsed = extractJsonObject<unknown>(text);
      let drafts;
      let repairCount = 0;
      while (repairCount <= 2) {
        try {
          drafts = parseExecutionDrafts(
            parsed,
            requested as DetailScreen[]
          );
          break;
        } catch (error) {
          if (
            !(error instanceof SkillSuiteValidationError) ||
            !error.code.startsWith("EXECUTION_") ||
            repairCount === 2
          ) {
            throw error;
          }
          repairCount += 1;
          const repairPrompt = buildExecutionRepairPrompt({
            screens: requested as DetailScreen[],
            research: body.research,
            plan: body.plan,
            mode: body.mode,
            rejectedResult: parsed,
            issues: error.details
          });
          const repairedText = await complete(
            providerConfig,
            textMessages(repairPrompt),
            9_000
          );
          parsed = extractJsonObject<unknown>(repairedText);
        }
      }
      if (!drafts) {
        throw new SkillSuiteValidationError(
          "执行交付修正后仍不可用。",
          "EXECUTION_REPAIR_INVALID"
        );
      }
      const executions = drafts.map((item) =>
        ensureModelMetadata({
          ...item,
          englishPrompt: compileScreenImagePrompt({
            screen: planById.get(item.screenId) as DetailScreen,
            execution: item,
            facts: body.research.facts
          })
        })
      );
      assertExecutions(
        { executions },
        requested as DetailScreen[],
        body.research.facts
      );

      return jsonNoStore({
        success: true,
        data: { executions },
        meta: { repairCount, fallbackUsed: false }
      });
    }

    if (body.stage === "qa") {
      assertResearch(body.research);
      assertPlan(body.plan, body.research.facts);
      const deterministicFindings = runDeterministicQA(
        body.plan,
        body.executions,
        body.research.facts
      );
      const prompt = buildQAPrompt({
        research: body.research,
        plan: body.plan,
        executions: body.executions,
        deterministicFindings
      });
      const text = await complete(providerConfig, textMessages(prompt), 6500);
      const parsed = extractJsonObject<QAReport>(text);
      assertQAReport(parsed);
      const deterministicErrors = deterministicFindings.filter(
        (item) => item.severity === "error"
      );
      const report: QAReport = {
        ...parsed,
        findings: mergeFindings(
          deterministicFindings,
          parsed.findings,
          body.research.facts
        ),
        summary: deterministicErrors.length
          ? `规则质检发现${deterministicErrors.length}项必须修复；修复前不可视为通过。${parsed.summary}`
          : parsed.summary,
        source: "rules+model",
        generatedAt: new Date().toISOString()
      };

      return jsonNoStore({ success: true, data: report });
    }

    throw new ServiceError("不支持的四技能工作流阶段。", {
      statusCode: 400,
      code: "SKILL_STAGE_INVALID"
    });
  } catch (error) {
    const failure = safeError(error);
    return jsonNoStore(failure.body, failure.status);
  }
}
