import { beforeEach, describe, expect, it } from "vitest";
import {
  executionIdsToRun,
  isExecutionCurrent,
  selectCurrentExecutions
} from "@/lib/skill-suite/workflow";
import { useSkillSuiteStore } from "@/lib/skill-suite/store";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

describe("execution session resume", () => {
  beforeEach(() => {
    useSkillSuiteStore.getState().resetProject();
  });

  it("前5屏成功后第6屏失败，续跑列表从screen-06开始且成功屏不丢失", () => {
    const sample = createSampleProject();
    useSkillSuiteStore.getState().setResearch(sample.research!);
    useSkillSuiteStore.getState().setPlan(sample.plan!);
    useSkillSuiteStore
      .getState()
      .mergeExecutions(Object.values(sample.executions).slice(0, 5));
    useSkillSuiteStore
      .getState()
      .setExecutionStatus(["screen-06"], "failed_retryable");

    const state = useSkillSuiteStore.getState();
    const pending = executionIdsToRun(
      sample.plan!,
      state.project.executions,
      state.executionStatuses
    );

    expect(pending).toEqual(
      Array.from(
        { length: 10 },
        (_, index) => `screen-${String(index + 6).padStart(2, "0")}`
      )
    );
    expect(Object.keys(state.project.executions)).toEqual([
      "screen-01",
      "screen-02",
      "screen-03",
      "screen-04",
      "screen-05"
    ]);
    expect(state.executionStatuses["screen-01"]).toBe("succeeded");
    expect(state.executionStatuses["screen-06"]).toBe("failed_retryable");
  });

  it("重试成功只合并目标屏，已成功屏对象保持不变", () => {
    const sample = createSampleProject();
    const firstFive = Object.values(sample.executions).slice(0, 5);
    useSkillSuiteStore.getState().setResearch(sample.research!);
    useSkillSuiteStore.getState().setPlan(sample.plan!);
    useSkillSuiteStore.getState().mergeExecutions(firstFive);
    const screenOneBefore =
      useSkillSuiteStore.getState().project.executions["screen-01"];
    useSkillSuiteStore
      .getState()
      .setExecutionStatus(["screen-06"], "failed_retryable");

    useSkillSuiteStore
      .getState()
      .mergeExecutions([sample.executions["screen-06"]]);

    const state = useSkillSuiteStore.getState();
    expect(state.project.executions["screen-01"]).toBe(screenOneBefore);
    expect(state.project.executions["screen-06"]).toEqual(
      sample.executions["screen-06"]
    );
    expect(state.executionStatuses["screen-06"]).toBe("succeeded");
  });

  it("已失效屏保留旧结果但不会进入当前执行集，并会被续跑选中", () => {
    const sample = createSampleProject();
    useSkillSuiteStore.getState().setResearch(sample.research!);
    useSkillSuiteStore.getState().setPlan(sample.plan!);
    useSkillSuiteStore
      .getState()
      .mergeExecutions(Object.values(sample.executions));

    useSkillSuiteStore.getState().markExecutionsStale(["screen-03"]);

    const state = useSkillSuiteStore.getState();
    expect(state.project.executions["screen-03"]).toBeTruthy();
    expect(
      isExecutionCurrent(
        "screen-03",
        state.project.executions,
        state.executionStatuses
      )
    ).toBe(false);
    expect(
      selectCurrentExecutions(
        state.project.executions,
        state.executionStatuses
      )["screen-03"]
    ).toBeUndefined();
    expect(
      executionIdsToRun(
        sample.plan!,
        state.project.executions,
        state.executionStatuses
      )
    ).toEqual(["screen-03"]);
    expect(state.project.qa).toBeNull();
  });

  it("自动续跑选择缺失、失败、失效、取消或未开始屏，不重复调用成功、运行中和阻断屏", () => {
    const sample = createSampleProject();
    const statuses = {
      "screen-01": "succeeded",
      "screen-02": "blocked",
      "screen-03": "running",
      "screen-04": "queued",
      "screen-05": "cancelled",
      "screen-06": "failed_retryable",
      "screen-07": "stale"
    } as const;

    expect(
      executionIdsToRun(sample.plan!, sample.executions, {
        ...statuses,
        "screen-08": "not_started"
      })
    ).toEqual(["screen-05", "screen-06", "screen-07", "screen-08"]);
  });
});
