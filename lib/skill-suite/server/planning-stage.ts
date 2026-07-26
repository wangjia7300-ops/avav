import {
  buildPlanningFoundationPrompt,
  buildPlanningFoundationRepairPrompt,
  buildPlanningRepairPrompt,
  buildPlanningScreenBatchPrompt
} from "@/lib/skill-suite/prompts";
import {
  assertPlan,
  assertPlanningFoundation,
  assertResearch,
  extractJsonObject,
  SkillSuiteValidationError
} from "@/lib/skill-suite/validation";
import { ServiceError } from "@/lib/services/errors";
import type {
  AIProviderConfig,
  DetailPlan,
  DetailPlanFoundation,
  DetailScreen,
  ProductResearch,
  SupplementalBrief
} from "@/lib/types";
import {
  parsePlanningRepairPayload,
  planIssueFingerprint,
  PlanRepairContractError,
  selectPlanRepairTargetIds,
  type PlanRepairIssue
} from "@/lib/skill-suite/plan-repair";
import { applyScreenContracts } from "@/lib/skill-suite/screen-contracts";
import { complete, ensureModelMetadata, textMessages } from "./shared";
import type { SkillSuiteRequest } from "./request";

const MAX_PLANNING_REPAIR_ATTEMPTS = 4;
const PLANNING_TIME_BUDGET_MS = 270_000;

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

export async function runPlanningStage(
  body: Extract<SkillSuiteRequest, { stage: "planning" }>,
  providerConfig: AIProviderConfig
) {
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

  return {
    data: plan,
    meta: planningMeta("complete", [], true)
  };
}
