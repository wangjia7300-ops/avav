"use client";

import { create } from "zustand";
import { createEmptyProject } from "@/lib/skill-suite/defaults";
import type {
  DetailPageProject,
  DetailPlan,
  ExecutionMode,
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
  setAssets: (assets: ProjectAsset[]) => void;
  /** 只改素材分类标签（不参与模型输入），不级联清空下游结果。 */
  setAssetKind: (assetId: string, kind: ProjectAsset["kind"]) => void;
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
};

function now() {
  return new Date().toISOString();
}

export const useSkillSuiteStore = create<SkillSuiteStore>((set) => ({
  project: createEmptyProject(),
  stage: "research",
  selectedScreenId: "screen-01",
  executionMode: "E",
  workStatus: "idle",
  workLabel: "",
  error: null,
  runEpoch: 0,

  setStage: (stage) => set({ stage, error: null }),
  setSelectedScreen: (selectedScreenId) => set({ selectedScreenId }),
  setExecutionMode: (executionMode) => set({ executionMode }),

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
      workStatus: "idle",
      error: null,
      runEpoch: state.runEpoch + 1
    })),

  setAssetKind: (assetId, kind) =>
    set((state) => ({
      project: {
        ...state.project,
        assets: state.project.assets.map((asset) =>
          asset.id === assetId ? { ...asset, kind } : asset
        ),
        updatedAt: now()
      }
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
      stage: "planning",
      workStatus: "success",
      workLabel: "图研完成",
      error: null
    })),

  beginPlanning: () =>
    set((state) => ({
      project: {
        ...state.project,
        plan: null,
        executions: {},
        qa: null,
        updatedAt: now()
      },
      stage: "planning",
      selectedScreenId: "screen-01",
      workStatus: "running",
      workLabel: "正在生成15屏策划",
      error: null
    })),

  setPlan: (plan) =>
    set((state) => ({
      project: {
        ...state.project,
        plan,
        executions: {},
        qa: null,
        updatedAt: now()
      },
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
      workStatus: "idle",
      workLabel: "",
      error: null,
      runEpoch: state.runEpoch + 1
    }))
}));
