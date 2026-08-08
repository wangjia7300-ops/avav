import {
  buildPlanningFoundationPrompt,
  buildPlanningFoundationRepairPrompt,
  buildPlanningRepairPrompt,
  buildPlanningRepairRetryPrompt,
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
  buildPlanningRepairPatchSchema,
  parsePlanningRepairPatchPayload,
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
const MAX_CONCURRENT_PLANNING_CALLS = 3;
const MAX_PLANNING_CALLS = 18;
const PLANNING_PROVIDER_MAX_ATTEMPTS = 2;
const PLANNING_REPAIR_MAX_TOKENS = 1_800;
const PLANNING_REPAIR_CALL_TIMEOUT_MS = 60_000;
const MIN_PLANNING_REPAIR_REMAINING_MS = 20_000;

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

function planningRepairTimeoutMs(deadlineAt: number) {
  const remaining = deadlineAt - Date.now();
  if (remaining < MIN_PLANNING_REPAIR_REMAINING_MS) {
    throw new SkillSuiteValidationError(
      "剩余时间不足以安全启动新的单屏修复调用。",
      "PLAN_TIME_BUDGET_EXCEEDED",
      [
        `至少需要：${MIN_PLANNING_REPAIR_REMAINING_MS}ms`,
        `当前剩余：${Math.max(0, remaining)}ms`
      ]
    );
  }
  return Math.min(PLANNING_REPAIR_CALL_TIMEOUT_MS, remaining);
}

function isRetryablePlanningProviderError(error: ServiceError) {
  return (
    error.details?.retryable ??
    (error.statusCode === 429 || error.statusCode >= 500)
  );
}

function wrapPlanningProviderError(input: {
  error: ServiceError;
  stage: string;
  batchId?: string;
  attempt: number;
  maxAttempts: number;
}) {
  return new ServiceError(input.error.message, {
    statusCode: input.error.statusCode,
    code: input.error.code,
    details: {
      ...input.error.details,
      stage: input.stage,
      ...(input.batchId ? { batchId: input.batchId } : {}),
      retryable: isRetryablePlanningProviderError(input.error),
      attempt: input.attempt,
      maxAttempts: input.maxAttempts
    }
  });
}

async function completePlanningProviderCall(input: {
  providerConfig: AIProviderConfig;
  prompt: string;
  maxTokens: number;
  stage: string;
  batchId?: string;
  deadlineAt: number;
  signal?: AbortSignal;
  consumeCallBudget: () => void;
}) {
  let lastError: unknown;
  let attemptsUsed = 0;

  for (
    let attempt = 1;
    attempt <= PLANNING_PROVIDER_MAX_ATTEMPTS;
    attempt += 1
  ) {
    if (input.signal?.aborted) break;
    attemptsUsed = attempt;
    try {
      input.consumeCallBudget();
      const text = await complete(
        input.providerConfig,
        textMessages(input.prompt),
        input.maxTokens,
        {
          timeoutMs: planningTimeoutMs(input.deadlineAt),
          signal: input.signal
        }
      );
      return {
        text,
        retryCount: attempt - 1
      };
    } catch (error) {
      if (input.signal?.aborted) throw error;
      lastError = error;
      if (
        !(error instanceof ServiceError) ||
        !isRetryablePlanningProviderError(error) ||
        attempt >= PLANNING_PROVIDER_MAX_ATTEMPTS
      ) {
        break;
      }
    }
  }

  if (lastError instanceof ServiceError) {
    throw wrapPlanningProviderError({
      error: lastError,
      stage: input.stage,
      batchId: input.batchId,
      attempt: Math.max(1, attemptsUsed),
      maxAttempts: isRetryablePlanningProviderError(lastError)
        ? PLANNING_PROVIDER_MAX_ATTEMPTS
        : 1
    });
  }

  throw (
    lastError ??
    new SkillSuiteValidationError(
      "策划阶段模型调用未返回结果。",
      "PLAN_TIME_BUDGET_EXCEEDED"
    )
  );
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

function chunkValues<T>(values: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function mergeRepairedScreens(
  plan: DetailPlan,
  repairedScreens: readonly DetailScreen[]
) {
  const repairedById = new Map(
    repairedScreens.map((screen) => [screen.id, screen])
  );
  return {
    ...plan,
    screens: plan.screens.map(
      (screen) => repairedById.get(screen.id) ?? screen
    )
  };
}

function planRepairStateFingerprint(
  issues: readonly PlanRepairIssue[],
  plan: DetailPlan,
  targetIds: readonly string[]
) {
  const targets = new Set(targetIds);
  const targetState = plan.screens
    .filter((screen) => targets.has(screen.id))
    .sort((left, right) => left.index - right.index)
    .map((screen) => ({
      id: screen.id,
      role: screen.role,
      conversionTask: screen.conversionTask,
      primarySellingPoint: screen.primarySellingPoint,
      proofMethod: screen.proofMethod,
      copy: screen.copy,
      scene: screen.scene,
      shot: screen.shot,
      composition: screen.composition,
      transition: screen.transition
    }));
  return `${planIssueFingerprint(issues)}::${JSON.stringify(targetState)}`;
}

function collectPlanQualityIssues(
  plan: DetailPlan,
  facts: readonly ProductResearch["facts"][number][]
) {
  try {
    assertPlan(plan, facts);
    return [] as PlanRepairIssue[];
  } catch (error) {
    if (
      error instanceof SkillSuiteValidationError &&
      error.code === "PLAN_QUALITY_INVALID" &&
      error.planIssues.length > 0
    ) {
      return error.planIssues;
    }
    if (
      error instanceof SkillSuiteValidationError &&
      error.code === "PLAN_QUALITY_INVALID"
    ) {
      throw new PlanRepairContractError(
        "单屏修复后仍未通过确定性结果校验，且校验器没有返回可定位问题。",
        "PLAN_REPAIR_INVALID",
        error.details
      );
    }
    throw error;
  }
}

function validateRepairCandidate(input: {
  basePlan: DetailPlan;
  candidateScreen: DetailScreen;
  targetId: string;
  originalIssues: readonly PlanRepairIssue[];
  facts: readonly ProductResearch["facts"][number][];
}) {
  const candidatePlan = mergeRepairedScreens(input.basePlan, [
    input.candidateScreen
  ]);
  const candidateIssues = collectPlanQualityIssues(candidatePlan, input.facts);
  const issueFamilyKey = (issue: PlanRepairIssue) =>
    [
      issue.ruleCode,
      issue.scope,
      issue.path ?? "",
      issue.matchedPhrase ?? "",
      issue.expectedClaimScope ?? ""
    ].join("|");
  const isResidualOriginalIssue = (candidate: PlanRepairIssue) =>
    input.originalIssues.some((original) => {
      if (issueFamilyKey(original) !== issueFamilyKey(candidate)) return false;
      const originalIds = new Set(original.screenIds);
      return candidate.screenIds.every((screenId) => originalIds.has(screenId));
    });
  const unresolvedTargetIssues = candidateIssues.filter((issue) =>
    issue.screenIds.includes(input.targetId)
  );
  const introducedIssues = candidateIssues.filter(
    (issue) => !isResidualOriginalIssue(issue)
  );

  if (unresolvedTargetIssues.length > 0 || introducedIssues.length > 0) {
    const details = Array.from(
      new Set(
        [...unresolvedTargetIssues, ...introducedIssues].map(
          (issue) => `${issue.ruleCode}：${issue.message}`
        )
      )
    );
    throw new PlanRepairContractError(
      `${input.targetId} 修复后仍有目标问题或引入了新问题。`,
      "PLAN_REPAIR_INVALID",
      details
    );
  }

  return candidatePlan;
}

type ScreenRepairOutcome =
  | { targetId: string; screen: DetailScreen; error?: never }
  | { targetId: string; screen?: never; error: unknown };

async function repairPlanningScreen(input: {
  providerConfig: AIProviderConfig;
  research: ProductResearch;
  brief: SupplementalBrief;
  rejectedPlan: DetailPlan;
  issues: readonly PlanRepairIssue[];
  targetId: string;
  deadlineAt: number;
  signal?: AbortSignal;
  validateCandidate?: (screen: DetailScreen) => void;
  consumeCallBudget: () => void;
}): Promise<ScreenRepairOutcome> {
  const targetIssues = input.issues.filter((issue) =>
    issue.screenIds.includes(input.targetId)
  );
  const authorizedFields = new Set(
    targetIssues.flatMap((issue) => issue.allowedRepairFields)
  );
  if (targetIssues.length === 0 || authorizedFields.size === 0) {
    return {
      targetId: input.targetId,
      error: new PlanRepairContractError(
        `${input.targetId} 没有可执行的字段修复授权。`,
        "PLAN_REPAIR_INVALID",
        ["无授权屏幕不得回退为全字段修改。"]
      )
    };
  }

  const targetIds = [input.targetId];
  const originalPrompt = buildPlanningRepairPrompt({
    research: input.research,
    brief: input.brief,
    rejectedPlan: input.rejectedPlan,
    issues: targetIssues,
    targetIds
  });
  let activePrompt = originalPrompt;
  let lastError: unknown;

  for (let formatAttempt = 0; formatAttempt < 2; formatAttempt += 1) {
    try {
      const timeoutMs = planningRepairTimeoutMs(input.deadlineAt);
      input.consumeCallBudget();
      const repairedText = await complete(
        input.providerConfig,
        textMessages(activePrompt),
        PLANNING_REPAIR_MAX_TOKENS,
        {
          jsonSchema: {
            name: `planning_repair_${input.targetId.replaceAll("-", "_")}_patch`,
            schema: buildPlanningRepairPatchSchema(
              input.targetId,
              [...authorizedFields]
            ),
            strict: true
          },
          timeoutMs,
          signal: input.signal
        }
      );
      const repairPayload = extractJsonObject<unknown>(repairedText);
      const screen = parsePlanningRepairPatchPayload({
        payload: repairPayload,
        targetId: input.targetId,
        originalScreens: input.rejectedPlan.screens,
        issues: targetIssues
      });
      input.validateCandidate?.(screen);
      return { targetId: input.targetId, screen };
    } catch (error) {
      lastError = error;
      // 供应商超时、截断、限流或网络错误不是格式问题，禁止在
      // 策划层静默重放付费请求，也禁止包装成 PLAN_REPAIR_INVALID。
      if (error instanceof ServiceError) break;
      const isFormattingFailure =
        error instanceof PlanRepairContractError ||
        (error instanceof SkillSuiteValidationError &&
          error.code === "MODEL_JSON_INVALID");
      if (!isFormattingFailure || formatAttempt === 1) break;

      activePrompt = buildPlanningRepairRetryPrompt({
        originalPrompt,
        errorCode:
          error instanceof PlanRepairContractError ||
          error instanceof SkillSuiteValidationError
            ? error.code
            : "PLAN_REPAIR_INVALID",
        errorMessage:
          error instanceof Error ? error.message : "修复结果格式无效。",
        errorDetails:
          error instanceof PlanRepairContractError ||
          error instanceof SkillSuiteValidationError
            ? error.details
            : [],
        targetIds
      });
    }
  }

  return {
    targetId: input.targetId,
    error:
      lastError ??
      new PlanRepairContractError(
        `${input.targetId} 没有返回可验证的修复结果。`,
        "PLAN_REPAIR_INVALID"
      )
  };
}

async function generatePlanningBatch(input: {
  providerConfig: AIProviderConfig;
  research: ProductResearch;
  brief: SupplementalBrief;
  foundation: DetailPlanFoundation;
  indexes: readonly number[];
  deadlineAt: number;
  signal?: AbortSignal;
  consumeCallBudget: () => void;
}) {
  const prompt = buildPlanningScreenBatchPrompt({
    research: input.research,
    brief: input.brief,
    foundation: input.foundation,
    indexes: input.indexes
  });
  const first = input.indexes[0];
  const last = input.indexes[input.indexes.length - 1];
  const batchId = `screens-${first}-${last}`;
  let lastError: unknown;
  let providerRetryCount = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (input.signal?.aborted) break;
    try {
      const { text, retryCount } = await completePlanningProviderCall({
        providerConfig: input.providerConfig,
        prompt,
        maxTokens: 7_000,
        stage: "planning-batch",
        batchId,
        deadlineAt: input.deadlineAt,
        signal: input.signal,
        consumeCallBudget: input.consumeCallBudget
      });
      providerRetryCount += retryCount;
      return {
        screens: parsePlanningBatch(text, input.indexes),
        retryCount: attempt + providerRetryCount
      };
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (error instanceof ServiceError) {
        throw new ServiceError(
          `第${first}–${last}屏策划批次未完成，请重试当前阶段。`,
          {
            statusCode: error.statusCode,
            code: error.code,
            details: {
              ...error.details,
              stage: "planning-batch",
              batchId,
              retryable:
                error.details?.retryable ??
                (error.statusCode === 429 || error.statusCode >= 500)
            }
          }
        );
      }
      lastError = error;
    }
  }
  throw lastError;
}

export async function runPlanningStage(
  body: Extract<SkillSuiteRequest, { stage: "planning" }>,
  providerConfig: AIProviderConfig,
  signal?: AbortSignal
) {
  const planningStartedAt = Date.now();
  const planningDeadlineAt =
    planningStartedAt + PLANNING_TIME_BUDGET_MS;
  let planningCallCount = 0;
  let repairCallCount = 0;
  const consumePlanningCallBudget = () => {
    const remainingMs = planningDeadlineAt - Date.now();
    if (remainingMs < MIN_PLANNING_REPAIR_REMAINING_MS) {
      throw new SkillSuiteValidationError(
        "剩余时间不足以安全启动新的策划模型调用。",
        "PLAN_TIME_BUDGET_EXCEEDED",
        [
          `至少需要：${MIN_PLANNING_REPAIR_REMAINING_MS}ms`,
          `当前剩余：${Math.max(0, remainingMs)}ms`
        ]
      );
    }
    if (planningCallCount >= MAX_PLANNING_CALLS) {
      throw new SkillSuiteValidationError(
        "单次策划的模型调用已达到安全上限。",
        "PLAN_REPAIR_CALL_LIMIT_EXCEEDED",
        [`总调用上限：${MAX_PLANNING_CALLS}`]
      );
    }
    planningCallCount += 1;
  };
  assertResearch(body.research);
  let foundationRepairCount = 0;
  let batchRetryCount = 0;
  let parsed: DetailPlan;

  if (body.draftPlan) {
    parsed = {
      ...body.draftPlan,
      screens: applyScreenContracts(
        body.draftPlan.screens,
        body.research.facts
      ),
      source: "model",
      generatedAt: new Date().toISOString()
    };
  } else {
    const foundationPrompt = buildPlanningFoundationPrompt(
      body.research,
      body.brief
    );
    const foundationCall = await completePlanningProviderCall({
      providerConfig,
      prompt: foundationPrompt,
      maxTokens: 7_000,
      stage: "planning-foundation",
      deadlineAt: planningDeadlineAt,
      signal,
      consumeCallBudget: consumePlanningCallBudget
    });
    batchRetryCount += foundationCall.retryCount;
    let foundation =
      extractJsonObject<DetailPlanFoundation>(foundationCall.text);
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
        const foundationRepairCall = await completePlanningProviderCall({
          providerConfig,
          prompt: repairPrompt,
          maxTokens: 5_000,
          stage: "planning-foundation-repair",
          deadlineAt: planningDeadlineAt,
          signal,
          consumeCallBudget: consumePlanningCallBudget
        });
        batchRetryCount += foundationRepairCall.retryCount;
        foundation =
          extractJsonObject<DetailPlanFoundation>(foundationRepairCall.text);
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
    const abortFromRequest = () => batchAbort.abort();
    if (signal?.aborted) {
      batchAbort.abort();
    } else {
      signal?.addEventListener("abort", abortFromRequest, { once: true });
    }
    const batchResults = await (async () => {
      try {
        const results: Awaited<ReturnType<typeof generatePlanningBatch>>[] = [];
        for (const wave of chunkValues(
          indexBatches,
          MAX_CONCURRENT_PLANNING_CALLS
        )) {
          const waveResults = await Promise.all(
            wave.map((indexes) =>
              generatePlanningBatch({
                providerConfig,
                research: body.research,
                brief: body.brief,
                foundation,
                indexes,
                deadlineAt: planningDeadlineAt,
                signal: batchAbort.signal,
                consumeCallBudget: consumePlanningCallBudget
              }).catch((error) => {
                batchAbort.abort();
                throw error;
              })
            )
          );
          results.push(...waveResults);
        }
        return results;
      } finally {
        signal?.removeEventListener("abort", abortFromRequest);
      }
    })();
    batchRetryCount = batchResults.reduce(
      (sum, batch) => sum + batch.retryCount,
      0
    );
    parsed = {
      ...foundation,
      screens: applyScreenContracts(
        batchResults.flatMap((batch) => batch.screens),
        body.research.facts
      ),
      source: "model",
      generatedAt: new Date().toISOString()
    };
  }
  let repairCount = 0;
  let previousRepairStateFingerprint = "";

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
    repairCallCount,
    planningCallCount,
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
      const fingerprint = planRepairStateFingerprint(
        repairIssues,
        parsed,
        targetIds
      );
      const meta = planningMeta("planning-repair", targetIds, false);
      const partialData = { plan: parsed, publishable: false };

      if (
        fingerprint &&
        previousRepairStateFingerprint &&
        fingerprint === previousRepairStateFingerprint
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

      previousRepairStateFingerprint = fingerprint;
      repairCount += 1;
      const acceptedTargetIds = new Set<string>();
      let failedOutcome: ScreenRepairOutcome | undefined;

      // 单屏独立生成与验收，一轮最多并发3屏。某屏超时或越界
      // 不会再把同轮其他已通过的屏幕整批丢弃。
      for (const wave of chunkValues(
        targetIds,
        MAX_CONCURRENT_PLANNING_CALLS
      )) {
        const workingPlan = parsed;
        const outcomes = await Promise.all(
          wave.map((targetId) =>
            repairPlanningScreen({
              providerConfig,
              research: body.research,
              brief: body.brief,
              rejectedPlan: workingPlan,
              issues: repairIssues,
              targetId,
              deadlineAt: planningDeadlineAt,
              signal,
              consumeCallBudget: () => {
                consumePlanningCallBudget();
                repairCallCount += 1;
              },
              validateCandidate: (screen) => {
                validateRepairCandidate({
                  basePlan: workingPlan,
                  candidateScreen: screen,
                  targetId,
                  originalIssues: repairIssues,
                  facts: body.research.facts
                });
              }
            })
          )
        );
        const validatedOutcomes: ScreenRepairOutcome[] = [];
        for (const outcome of outcomes) {
          if (!outcome.screen) {
            validatedOutcomes.push(outcome);
            continue;
          }
          try {
            parsed = validateRepairCandidate({
              basePlan: parsed,
              candidateScreen: outcome.screen,
              targetId: outcome.targetId,
              originalIssues: repairIssues,
              facts: body.research.facts
            });
            acceptedTargetIds.add(outcome.targetId);
            validatedOutcomes.push(outcome);
          } catch (candidateError) {
            validatedOutcomes.push({
              targetId: outcome.targetId,
              error: candidateError
            });
          }
        }

        const failedOutcomes = validatedOutcomes.filter((outcome) =>
          Boolean(outcome.error)
        );
        failedOutcome =
          failedOutcomes.find(
            (outcome) => outcome.error instanceof ServiceError
          ) ?? failedOutcomes[0];
        // 当前波次有失败时不再启动后续付费请求；但已通过的
        // 屏幕已合并到未发布草稿，作为精确断点返回。
        if (failedOutcome) break;
      }

      if (failedOutcome?.error) {
        const unacceptedTargetIds = targetIds.filter(
          (targetId) => !acceptedTargetIds.has(targetId)
        );
        let freshIssues: PlanRepairIssue[] | undefined;
        try {
          freshIssues = collectPlanQualityIssues(parsed, body.research.facts);
        } catch {
          // A secondary diagnostics failure must not hide the original
          // provider/contract cause reported below.
        }
        // A failed model call remains a failed repair even if a secondary
        // diagnostic pass cannot reproduce the issue. Never publish across a
        // provider/contract failure; fall back to the original issue set.
        const issueSource =
          freshIssues && freshIssues.length > 0 ? freshIssues : repairIssues;
        const remainingIssueMap = new Map<string, PlanRepairIssue>();
        issueSource.forEach((issue) => {
          const remainingScreenIds = issue.screenIds.filter((screenId) =>
            unacceptedTargetIds.includes(screenId)
          );
          if (remainingScreenIds.length === 0) return;
          const remainingIssue = { ...issue, screenIds: remainingScreenIds };
          remainingIssueMap.set(
            planIssueFingerprint([remainingIssue]),
            remainingIssue
          );
        });
        const remainingIssues = [...remainingIssueMap.values()];
        const remainingTargetIds = selectPlanRepairTargetIds(
          remainingIssues,
          parsed.screens
        );
        const cause = failedOutcome.error;
        const isProviderFailure = cause instanceof ServiceError;
        const repairCode = isProviderFailure
          ? cause.code
          : cause instanceof PlanRepairContractError ||
              cause instanceof SkillSuiteValidationError
            ? cause.code
            : "PLAN_REPAIR_INVALID";
        const repairDetails = [
          ...(cause instanceof Error ? [cause.message] : []),
          ...(cause instanceof PlanRepairContractError ||
          cause instanceof SkillSuiteValidationError
            ? cause.details
            : []),
          `已保留通过确定性结果校验的修复屏：${
            [...acceptedTargetIds].join("、") || "无"
          }。`,
          `仍待修复：${remainingTargetIds.join("、")}。`
        ];
        const providerMeta =
          cause instanceof ServiceError ? cause.details ?? {} : {};
        const isRepairCallLimit =
          cause instanceof SkillSuiteValidationError &&
          cause.code === "PLAN_REPAIR_CALL_LIMIT_EXCEEDED";
        const phase = isProviderFailure
          ? "planning-repair-provider"
          : isRepairCallLimit
            ? "planning-repair-limit"
          : cause instanceof SkillSuiteValidationError &&
              cause.code === "PLAN_TIME_BUDGET_EXCEEDED"
            ? "planning-repair-budget"
            : "planning-repair-contract";
        throw new SkillSuiteValidationError(
          isProviderFailure
            ? "策划修复调用未完成，已保留通过校验的局部修复，当前草稿未发布。"
            : isRepairCallLimit
              ? "策划修复达到安全调用上限，已保留通过校验的局部修复，当前草稿未发布。"
            : "策划修复越界修改任务契约或返回格式无效，当前草稿未发布。",
          repairCode,
          repairDetails,
          remainingIssues,
          {
            ...planningMeta(phase, remainingTargetIds, false),
            ...providerMeta,
            phase,
            conflictScreenIds: remainingTargetIds,
            acceptedRepairScreenIds: [...acceptedTargetIds],
            retryable:
              cause instanceof ServiceError
                ? cause.details?.retryable ??
                  (cause.statusCode === 429 || cause.statusCode >= 500)
                : false
          },
          { plan: parsed, publishable: false },
          cause instanceof ServiceError
            ? cause.statusCode
            : cause instanceof SkillSuiteValidationError
              ? cause.statusCode
              : 422
        );
      }
    }
  }
  const plan = ensureModelMetadata(parsed);

  return {
    data: plan,
    meta: planningMeta("complete", [], true)
  };
}
