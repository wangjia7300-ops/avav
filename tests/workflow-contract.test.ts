import { describe, expect, it } from "vitest";
import {
  WORKFLOW_STEPS,
  completedWorkflowStages
} from "@/lib/skill-suite/workflow";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";
import type { ExecutionRunStatus } from "@/lib/types";

describe("detail-page workflow contract", () => {
  it("只公开图研、策划、执行、质检四个顺序固定的生产阶段", () => {
    expect(WORKFLOW_STEPS.map((step) => step.id)).toEqual([
      "research",
      "planning",
      "execution",
      "qa"
    ]);
  });

  it("只有15屏当前执行结果齐全时才把执行阶段标记为完成", () => {
    const project = createSampleProject();
    const statuses: Record<string, ExecutionRunStatus> = Object.fromEntries(
      project.plan!.screens.map((screen) => [screen.id, "succeeded" as const])
    );

    expect(completedWorkflowStages(project, statuses)).toEqual([
      "research",
      "planning",
      "execution",
      "qa"
    ]);

    statuses["screen-08"] = "stale";
    expect(completedWorkflowStages(project, statuses)).toEqual([
      "research",
      "planning",
      "qa"
    ]);
  });
});
