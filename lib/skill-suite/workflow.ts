import type {
  DetailPageProject,
  DetailPlan,
  ExecutionRunStatus,
  ScreenExecution,
  WorkflowStage
} from "@/lib/types";

export const WORKFLOW_STEPS: ReadonlyArray<{
  id: WorkflowStage;
  label: string;
}> = [
  { id: "research", label: "图研" },
  { id: "planning", label: "策划" },
  { id: "execution", label: "执行" },
  { id: "qa", label: "质检" }
];

const NON_CURRENT_EXECUTION_STATUSES = new Set<ExecutionRunStatus>([
  "not_started",
  "queued",
  "running",
  "failed_retryable",
  "blocked",
  "stale",
  "cancelled"
]);

export function isExecutionCurrent(
  screenId: string,
  executions: Record<string, ScreenExecution>,
  statuses: Record<string, ExecutionRunStatus>
) {
  const execution = executions[screenId];
  if (!execution || execution.screenId !== screenId) return false;
  const status = statuses[screenId];
  return !status || !NON_CURRENT_EXECUTION_STATUSES.has(status);
}

export function selectCurrentExecutions(
  executions: Record<string, ScreenExecution>,
  statuses: Record<string, ExecutionRunStatus>
) {
  return Object.fromEntries(
    Object.entries(executions).filter(([screenId]) =>
      isExecutionCurrent(screenId, executions, statuses)
    )
  );
}

export function executionIdsToRun(
  plan: Pick<DetailPlan, "screens">,
  executions: Record<string, ScreenExecution>,
  statuses: Record<string, ExecutionRunStatus>
) {
  return plan.screens
    .filter((screen) => {
      const status = statuses[screen.id];
      if (status === "blocked" || status === "queued" || status === "running") {
        return false;
      }
      const execution = executions[screen.id];
      if (!execution || execution.screenId !== screen.id) return true;
      return (
        status === "failed_retryable" ||
        status === "stale" ||
        status === "cancelled" ||
        status === "not_started"
      );
    })
    .map((screen) => screen.id);
}

export function completedWorkflowStages(
  project: DetailPageProject,
  executionStatuses: Record<string, ExecutionRunStatus>
) {
  const completed: WorkflowStage[] = [];
  if (project.research) completed.push("research");
  if (project.plan) completed.push("planning");
  if (
    project.plan?.screens.length === 15 &&
    project.plan.screens.every((screen) =>
      isExecutionCurrent(screen.id, project.executions, executionStatuses)
    )
  ) {
    completed.push("execution");
  }
  if (project.qa?.status === "prompt_complete") completed.push("qa");
  return completed;
}
