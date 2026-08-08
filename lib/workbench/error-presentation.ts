import type { WorkErrorInfo } from "@/lib/skill-suite/store";
import type { WorkflowStage } from "@/lib/types";

export type ErrorRecoveryPresentation = {
  title: string;
  recoveryNote: string;
  actionLabel: string;
  costNote?: string;
  technicalItems: string[];
  validationDetails: string[];
};

type ErrorRecoveryContext = {
  stage: WorkflowStage;
  error: WorkErrorInfo;
  hasResearch: boolean;
  hasPlan: boolean;
  hasQA: boolean;
  completedExecutions: number;
  totalExecutions: number;
  /** 依据当前逐屏状态计算出的实际可续跑数量。 */
  runnableExecutions?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasUnpublishedPlanningDraft(error: WorkErrorInfo) {
  if (!isRecord(error.partialData)) return false;
  const plan = error.partialData.plan;
  return (
    isRecord(plan) &&
    Array.isArray(plan.screens) &&
    plan.screens.length === 15 &&
    error.partialData.publishable === false
  );
}

export type ExecutionRecoverySummary = {
  total: number;
  completed: number;
  runnable: number;
  unresolved: number;
  complete: boolean;
};

export function summarizeExecutionRecovery(input: {
  screenIds: readonly string[];
  currentExecutionIds: readonly string[];
  runnableExecutionIds: readonly string[];
}): ExecutionRecoverySummary {
  const screenIds = Array.from(new Set(input.screenIds));
  const planned = new Set(screenIds);
  const current = new Set(
    input.currentExecutionIds.filter((screenId) => planned.has(screenId))
  );
  const runnable = new Set(
    input.runnableExecutionIds.filter(
      (screenId) => planned.has(screenId) && !current.has(screenId)
    )
  );
  const total = screenIds.length;
  const completed = current.size;
  const runnableCount = runnable.size;
  const unresolved = Math.max(0, total - completed - runnableCount);

  return {
    total,
    completed,
    runnable: runnableCount,
    unresolved,
    complete: total > 0 && completed === total
  };
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function boundedInteger(value: unknown, min: number, max: number) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}

function technicalItems(error: WorkErrorInfo) {
  const items = [
    error.code ?? "",
    error.status ? `HTTP ${error.status}` : "",
    error.phase ? `阶段：${error.phase}` : "",
    error.conflictScreenIds.length
      ? `冲突屏：${error.conflictScreenIds.join("、")}`
      : ""
  ];
  const origin = error.meta?.failureOrigin;
  const upstreamStatus =
    origin === "upstream_http"
      ? boundedInteger(error.meta?.upstreamStatus, 400, 599)
      : undefined;
  if (origin === "sdk_timeout") {
    items.push("SDK 等待预算耗尽");
  } else if (origin === "connection_timeout") {
    items.push("模型供应商连接在等待预算到期前中断");
  } else if (origin === "upstream_http") {
    items.push(
      upstreamStatus
        ? `模型供应商上游返回 HTTP ${upstreamStatus}`
        : "模型供应商上游返回异常"
    );
  } else if (origin === "stream_event") {
    items.push("模型供应商在响应流中返回错误事件");
  } else if (origin === "network") {
    items.push("模型网络连接中断");
  } else if (origin === "stage_budget") {
    items.push("当前阶段总等待预算耗尽");
  } else if (origin === "unknown") {
    items.push("模型供应商异常来源未分类");
  }

  const elapsedMs = finiteNumber(error.meta?.elapsedMs);
  if (elapsedMs !== undefined) {
    items.push(`耗时 ${Math.max(0, Math.round(elapsedMs / 1_000))} 秒`);
  }
  const attempt = boundedInteger(error.meta?.attempt, 1, 3);
  const maxAttempts = boundedInteger(error.meta?.maxAttempts, 1, 3);
  if (
    attempt !== undefined &&
    maxAttempts !== undefined &&
    attempt <= maxAttempts
  ) {
    items.push(`尝试 ${attempt}/${maxAttempts}`);
  }

  return items.filter(Boolean);
}

function userValidationDetails(error: WorkErrorInfo) {
  const machineControlDetail =
    /^\s*(?:retryable|attempt|maxAttempts|failureOrigin|elapsedMs|upstreamStatus|hasUpstreamRequestId)\s*[：:=]/i;
  return error.details.filter(
    (detail) => !machineControlDetail.test(detail)
  );
}

export function buildErrorRecoveryPresentation(
  context: ErrorRecoveryContext
): ErrorRecoveryPresentation {
  const common = {
    costNote: context.error.retryable
      ? "再次尝试会重新调用模型，可能产生新的调用费用。"
      : undefined,
    technicalItems: technicalItems(context.error),
    validationDetails: userValidationDetails(context.error)
  };

  if (context.stage === "research") {
    const totalBatches = boundedInteger(
      context.error.meta?.totalBatches,
      1,
      3
    );
    const completedBatches = totalBatches
      ? boundedInteger(
          context.error.meta?.completedBatches,
          1,
          totalBatches
        )
      : undefined;
    if (totalBatches && completedBatches) {
      const remainingBatches = totalBatches - completedBatches;
      const recoveryPrefix = context.hasResearch
        ? "上一版图研及后续结果仍在当前页面。"
        : "已上传的产品图和补充说明仍在当前页面。";
      return {
        title: context.hasResearch ? "新图研暂未完成" : "图研暂未完成",
        recoveryNote: remainingBatches
          ? `${recoveryPrefix}图研断点已保留：已完成 ${completedBatches}/${totalBatches} 批，重试时只续跑剩余 ${remainingBatches} 批和最终汇总，不会重做已完成批次。`
          : `${recoveryPrefix}图研断点已保留：已完成 ${completedBatches}/${totalBatches} 批，重试时只重试最终汇总。`,
        actionLabel: remainingBatches
          ? "从断点续跑图研"
          : "继续图研汇总",
        ...common,
        costNote: remainingBatches
          ? "已完成批次不会重复调用或重复计费；未完成批次和最终汇总仍可能产生新的调用费用。"
          : "已完成批次不会重复调用或重复计费；本次只会重新调用最终汇总。"
      };
    }
    return {
      title: context.hasResearch ? "新图研暂未完成" : "图研暂未完成",
      recoveryNote: context.hasResearch
        ? "上一版图研及后续结果仍在当前页面。新图研成功后，将替换图研并重置现有策划、执行与质检结果。"
        : "本次图研结果未写入。已上传的产品图和补充说明仍在当前页面。",
      actionLabel: context.hasResearch ? "重新图研" : "重试图研",
      ...common
    };
  }

  if (context.stage === "planning") {
    if (hasUnpublishedPlanningDraft(context.error)) {
      const remaining = context.error.conflictScreenIds.length;
      const accepted = Array.isArray(
        context.error.meta?.acceptedRepairScreenIds
      )
        ? context.error.meta.acceptedRepairScreenIds.filter(
            (item): item is string => typeof item === "string"
          ).length
        : 0;
      return {
        title: "15屏策划续修暂未完成",
        recoveryNote: `已验证的局部修复草稿已保留；${accepted ? `已通过 ${accepted} 屏，` : ""}继续修复剩余 ${remaining || "待定位"} 屏，不会把草稿当正式策划发布。`,
        actionLabel: "继续修复剩余屏",
        ...common,
        costNote: context.error.retryable
          ? "已通过校验的修复屏不会重复调用；剩余冲突屏仍可能产生新的调用费用。"
          : common.costNote
      };
    }
    return {
      title: context.hasPlan ? "新策划暂未完成" : "15屏策划暂未完成",
      recoveryNote: context.hasPlan
        ? "上一版策划、执行和质检结果仍在当前页面。新策划成功后，现有执行与质检结果将重置。"
        : "图研和已填写的策划信息仍在当前页面。本次草稿未发布；重试只会重新调用未完成的策划生成，成功前不会覆盖正式结果。",
      actionLabel: context.hasPlan ? "重新生成15屏策划" : "重试策划生成",
      ...common
    };
  }

  if (context.stage === "execution") {
    const total = Math.max(1, context.totalExecutions);
    const completed = Math.min(
      total,
      Math.max(0, context.completedExecutions)
    );
    const pending = Math.min(
      total - completed,
      Math.max(
        0,
        context.runnableExecutions ?? total - completed
      )
    );
    const unresolved = Math.max(0, total - completed - pending);
    const unresolvedNote = unresolved
      ? `另有 ${unresolved} 屏正在运行或已阻断，不会自动重跑。`
      : "";
    return {
      title: "执行生成在部分页面中断",
      recoveryNote: `当前版本已完成 ${completed}/${total} 屏；${pending ? `可续跑 ${pending} 屏，不会重做已成功页面。` : "当前没有可续跑页面。"}${unresolvedNote}`,
      actionLabel: pending ? `续跑可恢复 ${pending} 屏` : "检查执行状态",
      ...common
    };
  }

  return {
    title: context.hasQA ? "新质检暂未完成" : "质检暂未完成",
    recoveryNote: context.hasQA
      ? "上一版质检报告仍在当前页面；再次运行只读取现有结果，不会修改策划或执行内容。"
      : "本次未生成质检报告。图研、策划和执行内容均未被修改。",
    actionLabel: context.hasQA ? "重新运行规范质检" : "重试规范质检",
    ...common
  };
}
