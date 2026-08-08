"use client";

import { create } from "zustand";
import { createEmptyProject } from "@/lib/skill-suite/defaults";
import type {
  DetailPageProject,
  DetailPlan,
  ExecutionMode,
  ExecutionRunStatus,
  ProductResearch,
  ProjectAsset,
  QAReport,
  ScreenExecution,
  SupplementalBrief,
  WorkflowStage
} from "@/lib/types";

type WorkStatus = "idle" | "running" | "success" | "error";

export type WorkErrorInfo = {
  message: string;
  status?: number;
  code?: string;
  retryable?: boolean;
  details: string[];
  meta?: Record<string, unknown>;
  phase?: string;
  conflictScreenIds: string[];
  partialData?: unknown;
};

type SkillSuiteStore = {
  project: DetailPageProject;
  stage: WorkflowStage;
  selectedScreenId: string;
  executionMode: ExecutionMode;
  /** 当前浏览会话内的逐屏执行状态；业务结果仍保存在 project.executions。 */
  executionStatuses: Record<string, ExecutionRunStatus>;
  workStatus: WorkStatus;
  workLabel: string;
  error: WorkErrorInfo | null;
  /**
   * 输入代际号：换素材、改简报、新建项目时递增。
   * 在途请求完成时若代际号已变化，其结果必须被丢弃，
   * 防止旧产品的生成结果写入新项目（竞态防护）。
   */
  runEpoch: number;
  setStage: (stage: WorkflowStage) => void;
  setSelectedScreen: (screenId: string) => void;
  setExecutionMode: (mode: ExecutionMode) => void;
  setExecutionStatus: (
    screenIds: readonly string[],
    status: ExecutionRunStatus
  ) => void;
  markExecutionsStale: (screenIds?: readonly string[]) => void;
  invalidateVisualInputs: () => void;
  setAssets: (assets: ProjectAsset[]) => void;
  /** 修改素材分类；保留文案链路，但使依赖身份参考图的质检/成图失效。 */
  updateBrief: (patch: Partial<SupplementalBrief>) => void;
  setResearch: (research: ProductResearch) => void;
  beginPlanning: () => void;
  setPlan: (plan: DetailPlan) => void;
  mergeExecutions: (executions: ScreenExecution[]) => void;
  setQA: (qa: QAReport | null) => void;
  setWork: (
    status: WorkStatus,
    label?: string,
    error?: WorkErrorInfo | null
  ) => void;
  resetProject: () => void;
  /** 从持久化数据恢复项目（替换当前空项目） */
  restoreProject: (project: DetailPageProject, stage: WorkflowStage) => void;
};

function now() {
  return new Date().toISOString();
}

export const useSkillSuiteStore = create<SkillSuiteStore>((set) => ({
  project: createEmptyProject(),
  stage: "research",
  selectedScreenId: "screen-01",
  executionMode: "E",
  executionStatuses: {},
  workStatus: "idle",
  workLabel: "",
  error: null,
  runEpoch: 0,

  setStage: (stage) => set({ stage, error: null }),
  setSelectedScreen: (selectedScreenId) => set({ selectedScreenId }),
  setExecutionMode: (executionMode) => set({ executionMode }),
  setExecutionStatus: (screenIds, status) =>
    set((state) => ({
      executionStatuses: {
        ...state.executionStatuses,
        ...Object.fromEntries(screenIds.map((screenId) => [screenId, status]))
      },
      ...(status === "stale" ? {
        project: {
          ...state.project,
          qa: null,
          updatedAt: now()
        }
      } : {})
    })),
  markExecutionsStale: (screenIds) =>
    set((state) => {
      const targets =
        screenIds ??
        Object.keys(state.project.executions);
      return {
        executionStatuses: {
          ...state.executionStatuses,
          ...Object.fromEntries(
            targets
              .filter((screenId) => Boolean(state.project.executions[screenId]))
              .map((screenId) => [screenId, "stale" as const])
          )
        },
        project: {
          ...state.project,
          qa: null,
          updatedAt: now()
        }
      };
    }),
  invalidateVisualInputs: () =>
    set((state) => ({
      project: {
        ...state.project,
        qa: null,
        updatedAt: now()
      },
      runEpoch: state.runEpoch + 1
    })),

  setAssets: (assets) =>
    set((state) => ({
      project: {
        ...state.project,
        name: assets.length ? assets[0].name.replace(/\.[^.]+$/, "") : "未命名详情页项目",
        assets,
        research: null,
        plan: null,
        executions: {},
        qa: null,
        updatedAt: now()
      },
      stage: "research",
      selectedScreenId: "screen-01",
      executionStatuses: {},
      workStatus: "idle",
      error: null,
      runEpoch: state.runEpoch + 1
    })),

  updateBrief: (patch) =>
    set((state) => ({
      project: {
        ...state.project,
        brief: { ...state.project.brief, ...patch },
        plan: null,
        executions: {},
        qa: null,
        updatedAt: now()
      },
      executionStatuses: {},
      runEpoch: state.runEpoch + 1
    })),

  setResearch: (research) =>
    set((state) => ({
      project: {
        ...state.project,
        research,
        plan: null,
        executions: {},
        qa: null,
        updatedAt: now()
      },
      executionStatuses: {},
      stage: "planning",
      workStatus: "success",
      workLabel: "图研完成",
      error: null
    })),

  beginPlanning: () =>
    set({
      stage: "planning",
      selectedScreenId: "screen-01",
      workStatus: "running",
      workLabel: "正在生成15屏策划",
      error: null
    }),

  setPlan: (plan) =>
    set((state) => ({
      project: {
        ...state.project,
        plan,
        executions: {},
        qa: null,
        updatedAt: now()
      },
      executionStatuses: {},
      stage: "execution",
      selectedScreenId: "screen-01",
      workStatus: "success",
      workLabel: "15屏策划完成",
      error: null
    })),

  mergeExecutions: (executions) =>
    set((state) => ({
      project: {
        ...state.project,
        executions: {
          ...state.project.executions,
          ...Object.fromEntries(executions.map((item) => [item.screenId, item]))
        },
        qa: null,
        updatedAt: now()
      },
      executionStatuses: {
        ...state.executionStatuses,
        ...Object.fromEntries(
          executions.map((item) => [item.screenId, "succeeded" as const])
        )
      },
      workStatus: "success",
      workLabel: `已生成 ${executions.length} 屏交付`,
      error: null
    })),

  setQA: (qa) =>
    set((state) => ({
      project: {
        ...state.project,
        qa,
        updatedAt: now()
      },
      stage: qa ? "qa" : state.stage,
      workStatus: qa ? "success" : state.workStatus,
      workLabel: qa ? "质检完成" : state.workLabel,
      error: null
    })),

  setWork: (workStatus, workLabel = "", error = null) =>
    set({ workStatus, workLabel, error }),

  resetProject: () =>
    set((state) => ({
      project: createEmptyProject(),
      stage: "research",
      selectedScreenId: "screen-01",
      executionMode: "E",
      executionStatuses: {},
      workStatus: "idle",
      workLabel: "",
      error: null,
      runEpoch: state.runEpoch + 1
    })),

  restoreProject: (project, stage) =>
    set((state) => ({
      project,
      stage,
      selectedScreenId: "screen-01",
      executionMode: "E",
      executionStatuses: {},
      workStatus: "idle",
      workLabel: "已恢复上次项目",
      error: null,
      runEpoch: state.runEpoch + 1
    }))
}));
