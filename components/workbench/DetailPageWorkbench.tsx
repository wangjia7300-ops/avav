"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Info, Stop, WarningCircle, X } from "@phosphor-icons/react";
import { AppHeader } from "@/components/AppHeader";
import { AssetLibrary } from "@/components/workbench/AssetLibrary";
import { ExecutionPanel } from "@/components/workbench/ExecutionPanel";
import { PlanningPanel } from "@/components/workbench/PlanningPanel";
import { QAPanel } from "@/components/workbench/QAPanel";
import { ResearchPanel } from "@/components/workbench/ResearchPanel";
import { useImageProviderStore } from "@/lib/image-provider-store";
import { useProviderStore } from "@/lib/provider-store";
import {
  executionIdsToRun,
  isExecutionCurrent,
  selectCurrentExecutions,
  completedWorkflowStages
} from "@/lib/skill-suite/workflow";
import { useSkillSuiteStore } from "@/lib/skill-suite/store";
import {
  loadProject,
  clearProject,
  restoreAssets,
  projectHasRecoverableData,
  type PersistedProject
} from "@/lib/persistence";
import { useAutoSave } from "@/lib/hooks/useAutoSave";
import type {
  DetailPlan,
  GeneratedImageAsset,
  ProductResearch,
  ProjectAsset,
  QAReport,
  ScreenExecution,
} from "@/lib/types";
import { postJson, toWorkError } from "@/lib/workbench/api-client";
import type { ApiMeta } from "@/lib/workbench/api-client";
import {
  fingerprintResearchInput,
  runResearchPipeline,
  type ResearchPipelineCheckpoint
} from "@/lib/workbench/research-pipeline";
import {
  buildErrorRecoveryPresentation,
  summarizeExecutionRecovery
} from "@/lib/workbench/error-presentation";

function dataUrlFromBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("参考图转换失败。"));
    reader.readAsDataURL(blob);
  });
}

async function resolveAssetDataUrl(asset: ProjectAsset) {
  if (asset.dataUrl.startsWith("data:image/")) return asset.dataUrl;
  const response = await fetch(asset.dataUrl);
  if (!response.ok) throw new Error(`无法读取参考图：${asset.name}`);
  return dataUrlFromBlob(await response.blob());
}

function extractPlanningDraft(partialData: unknown): DetailPlan | null {
  if (!partialData || typeof partialData !== "object" || Array.isArray(partialData)) {
    return null;
  }
  const payload = partialData as { plan?: unknown; publishable?: unknown };
  const plan = payload.plan;
  if (
    payload.publishable !== false ||
    !plan ||
    typeof plan !== "object" ||
    Array.isArray(plan) ||
    !Array.isArray((plan as { screens?: unknown }).screens) ||
    (plan as { screens: unknown[] }).screens.length !== 15
  ) {
    return null;
  }
  return plan as DetailPlan;
}

export function DetailPageWorkbench() {
  const store = useSkillSuiteStore();
  const {
    project,
    stage,
    selectedScreenId,
    executionMode,
    executionStatuses,
    workStatus,
    workLabel,
    error
  } = store;
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(
    project.assets.map((asset) => asset.id)
  );
  const [generatedImages, setGeneratedImages] = useState<Record<string, GeneratedImageAsset>>({});
  const [lastResponseMeta, setLastResponseMeta] = useState<ApiMeta | null>(null);
  const imageRequestIdsRef = useRef<Record<string, string>>({});
  const activeExecutionBatchRef = useRef<string[]>([]);
  const researchCheckpointRef = useRef<ResearchPipelineCheckpoint | null>(
    null
  );
  const planningDraftRef = useRef<DetailPlan | null>(null);

  const running = workStatus === "running";
  const currentExecutions = useMemo(
    () => selectCurrentExecutions(project.executions, executionStatuses),
    [executionStatuses, project.executions]
  );
  const executionRecovery = useMemo(() => {
    const screenIds = project.plan?.screens.map((screen) => screen.id) ?? [];
    const runnableExecutionIds = project.plan
      ? executionIdsToRun(
          project.plan,
          project.executions,
          executionStatuses
        )
      : [];
    return summarizeExecutionRecovery({
      screenIds,
      currentExecutionIds: Object.keys(currentExecutions),
      runnableExecutionIds
    });
  }, [
    currentExecutions,
    executionStatuses,
    project.executions,
    project.plan
  ]);
  const errorPresentation = useMemo(
    () =>
      error
        ? buildErrorRecoveryPresentation({
            stage,
            error,
            hasResearch: Boolean(project.research),
            hasPlan: Boolean(project.plan),
            hasQA: Boolean(project.qa),
            completedExecutions: Object.keys(currentExecutions).length,
            totalExecutions: project.plan?.screens.length ?? 15,
            runnableExecutions: executionRecovery.runnable
          })
        : null,
    [
      currentExecutions,
      error,
      executionRecovery.runnable,
      project.plan,
      project.qa,
      project.research,
      stage
    ]
  );
  const hasPlanningDraft = Boolean(
    error ? extractPlanningDraft(error.partialData) : null
  );
  const completedStages = useMemo(
    () => completedWorkflowStages(project, executionStatuses),
    [executionStatuses, project]
  );

  function getProviderConfig() {
    // A verified browser configuration overrides the server default.
    // null tells the API route to use ARK_API_KEY / OPENAI_API_KEY from .env.local.
    return useProviderStore.getState().getActiveConfig();
  }

  function fail(reason: unknown) {
    setLastResponseMeta(null);
    store.setWork("error", "", toWorkError(reason));
  }

  function settleExecutionRecovery() {
    const snapshot = useSkillSuiteStore.getState();
    const plan = snapshot.project.plan;
    if (!plan) {
      fail(new Error("无法检查执行状态：15屏策划不存在。"));
      return;
    }
    const current = selectCurrentExecutions(
      snapshot.project.executions,
      snapshot.executionStatuses
    );
    const runnableIds = executionIdsToRun(
      plan,
      snapshot.project.executions,
      snapshot.executionStatuses
    );
    const summary = summarizeExecutionRecovery({
      screenIds: plan.screens.map((screen) => screen.id),
      currentExecutionIds: Object.keys(current),
      runnableExecutionIds: runnableIds
    });
    if (summary.complete) {
      store.setWork("success", "15屏 A / B / D / E 四类交付均已完成");
      return;
    }

    const currentIds = new Set(Object.keys(current));
    const runnableIdSet = new Set(runnableIds);
    const unresolvedIds = plan.screens
      .map((screen) => screen.id)
      .filter(
        (screenId) =>
          !currentIds.has(screenId) && !runnableIdSet.has(screenId)
      );
    store.setWork("error", "", {
      message: summary.runnable
        ? `本轮执行已结束，仍有 ${summary.runnable} 屏可续跑。`
        : `本轮执行已结束，仍有 ${summary.unresolved} 屏正在运行或已阻断。`,
      code: summary.runnable
        ? "EXECUTION_REMAINING"
        : "EXECUTION_STATUS_UNRESOLVED",
      retryable: summary.runnable > 0,
      details: [],
      phase: "execution",
      conflictScreenIds: [...runnableIds, ...unresolvedIds]
    });
  }

  // ── 竞态防护 ──────────────────────────────────────────────
  // 每次运行持有一个句柄：AbortController 用于取消在途请求；
  // epoch 用于识别“项目输入已变化”，过期响应的结果与错误一并丢弃。
  type RunHandle = {
    epoch: number;
    controller: AbortController;
    signal: AbortSignal;
  };

  const workAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      workAbortRef.current?.abort();
      workAbortRef.current = null;
    },
    []
  );

  // ── 持久化恢复 ──────────────────────────────────────────────
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored) return;
    let cancelled = false;
    loadProject().then((saved: PersistedProject | undefined) => {
      if (cancelled || !saved) return;
      if (!projectHasRecoverableData(saved)) return;
      const assets = restoreAssets(saved);
      store.restoreProject(
        {
          id: saved.id,
          name: saved.name,
          assets,
          brief: saved.brief,
          research: saved.research,
          plan: saved.plan,
          executions: saved.executions,
          qa: saved.qa,
          updatedAt: saved.savedAt
        },
        saved.stage
      );
      setSelectedAssetIds(assets.map((a) => a.id));
    }).catch(() => {
      // IndexedDB 不可用：静默跳过
    }).finally(() => {
      if (!cancelled) setRestored(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // ── 自动保存 ──────────────────────────────────────────────
  useAutoSave();

  function beginRun(label?: string): RunHandle {
    workAbortRef.current?.abort();
    const controller = new AbortController();
    workAbortRef.current = controller;
    setLastResponseMeta(null);
    if (label !== undefined) {
      store.setWork("running", label);
    }
    return {
      epoch: useSkillSuiteStore.getState().runEpoch,
      controller,
      signal: controller.signal
    };
  }

  function isStale(run: RunHandle) {
    return (
      useSkillSuiteStore.getState().runEpoch !== run.epoch ||
      workAbortRef.current !== run.controller
    );
  }

  function discardStaleRun(run: RunHandle) {
    // 仅当没有新的运行接管状态栏时才复位，避免覆盖新运行的 running 状态。
    if (workAbortRef.current === run.controller) {
      store.setWork("idle");
    }
  }

  function abortActiveRun() {
    workAbortRef.current?.abort();
    workAbortRef.current = null;
    activeExecutionBatchRef.current = [];
  }

  function cancelCurrentRun() {
    const controller = workAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    const activeIds = [...activeExecutionBatchRef.current];
    controller.abort();
    workAbortRef.current = null;
    activeExecutionBatchRef.current = [];
    if (activeIds.length) {
      store.setExecutionStatus(activeIds, "cancelled");
    }
    setLastResponseMeta(null);
    store.setWork(
      "success",
      activeIds.length
        ? `已中断当前批次（${activeIds.join("、")}）；已完成页面保留，可继续断点续跑`
        : "当前任务已中断；已有结果继续保留"
    );
  }

  async function runResearch() {
    let run: RunHandle | null = null;
    let totalBatches = 0;
    try {
      const providerConfig = getProviderConfig();
      const assets = project.assets.filter((asset) => selectedAssetIds.includes(asset.id));
      if (!assets.length) throw new Error("请至少选择一张产品图参与分析。");
      if (assets.some((asset) => !asset.dataUrl.startsWith("data:image/"))) {
        throw new Error("示例项目不能冒充真实模型输入，请先上传自己的产品图。");
      }
      totalBatches = Math.ceil(assets.length / 3);
      run = beginRun("正在准备分批图研");
      const inputFingerprint = await fingerprintResearchInput({
        assets,
        notes: project.brief.notes,
        providerConfig
      });
      if (isStale(run)) return discardStaleRun(run);

      const existingCheckpoint = researchCheckpointRef.current;
      const checkpoint =
        existingCheckpoint?.inputFingerprint === inputFingerprint
          ? existingCheckpoint
          : undefined;
      if (!checkpoint) researchCheckpointRef.current = null;
      const runId =
        checkpoint?.runId ??
        `research_${crypto.randomUUID().replace(/-/g, "")}`;
      const activeCheckpoint = checkpoint ?? {
        runId,
        inputFingerprint,
        completedBatchIndexes: []
      };
      // 在首批请求发出前就固定 runId。即使服务端已缓存成功、
      // 但客户端在收到响应时断线，下次也能命中同一批次而不重复计费。
      researchCheckpointRef.current = activeCheckpoint;

      const response = await runResearchPipeline(
        {
          runId,
          assets,
          notes: project.brief.notes,
          providerConfig,
          checkpoint: activeCheckpoint,
          signal: run.signal
        },
        {
          postExtract: (payload, signal) =>
            postJson("/api/skill-suite", payload, { signal }),
          postFinalize: (payload, signal) =>
            postJson<ProductResearch>("/api/skill-suite", payload, {
              signal
            }),
          onCheckpoint: (nextCheckpoint) => {
            researchCheckpointRef.current = nextCheckpoint;
          },
          onProgress: ({ phase, completedBatches, totalBatches: total }) => {
            if (!run || isStale(run)) return;
            store.setWork(
              "running",
              phase === "extract"
                ? `正在分批图研（已完成 ${completedBatches}/${total} 批）`
                : `图片事实已提取 ${completedBatches}/${total} 批，正在零图片汇总`
            );
          }
        }
      );
      if (isStale(run)) return discardStaleRun(run);
      setLastResponseMeta(response.meta ?? null);
      researchCheckpointRef.current = null;
      planningDraftRef.current = null;
      store.setResearch(response.data);
    } catch (reason) {
      if (run && isStale(run)) return discardStaleRun(run);
      const failure = toWorkError(reason);
      const checkpoint = researchCheckpointRef.current;
      const checkpointInvalid =
        failure.code === "RESEARCH_RUN_NOT_FOUND" ||
        failure.code === "RESEARCH_RUN_IDENTITY_MISMATCH" ||
        failure.code === "RESEARCH_RUN_MANIFEST_MISMATCH";
      if (checkpointInvalid) {
        researchCheckpointRef.current = null;
      }
      setLastResponseMeta(null);
      store.setWork("error", "", {
        ...failure,
        meta: {
          ...(failure.meta ?? {}),
          completedBatches: checkpointInvalid
            ? 0
            : (checkpoint?.completedBatchIndexes.length ?? 0),
          totalBatches
        }
      });
    }
  }

  async function runPlanning() {
    let run: RunHandle | null = null;
    try {
      if (!project.research) throw new Error("请先完成图片研究。");
      const providerConfig = getProviderConfig();
      const draftPlan = planningDraftRef.current;
      run = beginRun(
        draftPlan ? "正在继续修复剩余策划屏" : undefined
      );
      store.beginPlanning();
      if (draftPlan) {
        store.setWork("running", "正在继续修复剩余策划屏");
      }
      const response = await postJson<DetailPlan>(
        "/api/skill-suite",
        {
          stage: "planning",
          providerConfig,
          research: project.research,
          brief: project.brief,
          ...(draftPlan ? { draftPlan } : {})
        },
        { signal: run.signal }
      );
      if (isStale(run)) return discardStaleRun(run);
      setLastResponseMeta(response.meta);
      planningDraftRef.current = null;
      setGeneratedImages({});
      store.setPlan(response.data);
    } catch (reason) {
      if (run && isStale(run)) return discardStaleRun(run);
      const failure = toWorkError(reason);
      planningDraftRef.current = failure.retryable
        ? extractPlanningDraft(failure.partialData)
        : null;
      setLastResponseMeta(null);
      store.setWork("error", "", failure);
    }
  }

  async function generateExecutions(
    screenIds: string[],
    options: { onDone?: () => void } = {}
  ) {
    let run: RunHandle | null = null;
    let activeBatchIds: string[] = [];
    try {
      const snapshot = useSkillSuiteStore.getState();
      const research = snapshot.project.research;
      const plan = snapshot.project.plan;
      if (!research || !plan) {
        throw new Error("请先完成图研和15屏策划。");
      }
      const requestedIds = plan.screens
        .filter((screen) => screenIds.includes(screen.id))
        .map((screen) => screen.id);
      const runnableIds = new Set(
        executionIdsToRun(
          plan,
          snapshot.project.executions,
          snapshot.executionStatuses
        )
      );
      const idsToGenerate = requestedIds.filter((screenId) =>
        runnableIds.has(screenId)
      );
      if (!idsToGenerate.length) {
        if (options.onDone) {
          options.onDone();
        } else {
          settleExecutionRecovery();
        }
        return;
      }
      const providerConfig = getProviderConfig();
      run = beginRun("正在生成执行交付");
      for (let start = 0; start < idsToGenerate.length; start += 5) {
        const ids = idsToGenerate.slice(start, start + 5);
        activeBatchIds = ids;
        activeExecutionBatchRef.current = ids;
        const screens = plan.screens.filter((screen) => ids.includes(screen.id));
        // 只标记当前批次。若本批失败，后续尚未启动的屏仍保持可续跑，
        // 不会永久卡在 queued。
        store.setExecutionStatus(ids, "queued");
        store.setExecutionStatus(ids, "running");
        store.setWork(
          "running",
          idsToGenerate.length === 1
            ? "正在生成本屏交付"
            : `正在续跑 ${ids[0]}–${ids[ids.length - 1]}（${ids.length}屏）`
        );
        const response = await postJson<{ executions: ScreenExecution[] }>(
          "/api/skill-suite",
          {
            stage: "execution",
            providerConfig,
            research,
            plan,
            screens,
            mode: executionMode
          },
          { signal: run.signal }
        );
        if (isStale(run)) return discardStaleRun(run);
        setLastResponseMeta(response.meta);
        store.mergeExecutions(response.data.executions);
        ids.forEach((screenId) => {
          delete imageRequestIdsRef.current[screenId];
        });
        setGeneratedImages((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([screenId]) => !ids.includes(screenId))
          )
        );
        activeBatchIds = [];
        activeExecutionBatchRef.current = [];
      }
      options.onDone?.();
    } catch (reason) {
      if (run && isStale(run)) return discardStaleRun(run);
      if (run?.signal.aborted) return;
      if (activeBatchIds.length) {
        store.setExecutionStatus(activeBatchIds, "failed_retryable");
      }
      fail(reason);
    }
  }

  async function runSelectedExecution() {
    await generateExecutions([selectedScreenId]);
  }

  async function runAllExecutions() {
    const snapshot = useSkillSuiteStore.getState();
    if (!snapshot.project.plan) {
      fail(new Error("请先完成15屏策划。"));
      return;
    }
    const pendingIds = executionIdsToRun(
      snapshot.project.plan,
      snapshot.project.executions,
      snapshot.executionStatuses
    );
    const current = selectCurrentExecutions(
      snapshot.project.executions,
      snapshot.executionStatuses
    );
    if (!pendingIds.length) {
      if (
        snapshot.project.plan.screens.every((screen) =>
          Boolean(current[screen.id])
        )
      ) {
        store.setWork("success", "15屏 A / B / D / E 四类交付均已完成");
      } else {
        fail(
          new Error(
            "仍有页面处于运行中或阻断状态；请先处理这些状态，再继续断点续跑。"
          )
        );
      }
      return;
    }
    await generateExecutions(pendingIds, {
      onDone: settleExecutionRecovery
    });
  }

  async function runQA() {
    let run: RunHandle | null = null;
    try {
      if (!project.research || !project.plan) {
        throw new Error("请先完成图研和15屏策划。");
      }
      const providerConfig = getProviderConfig();
      run = beginRun("正在执行规则与模型质检");
      const response = await postJson<QAReport>(
        "/api/skill-suite",
        {
          stage: "qa",
          providerConfig,
          research: project.research,
          plan: project.plan,
          executions: selectCurrentExecutions(
            useSkillSuiteStore.getState().project.executions,
            useSkillSuiteStore.getState().executionStatuses
          )
        },
        { signal: run.signal }
      );
      if (isStale(run)) return discardStaleRun(run);
      setLastResponseMeta(response.meta);
      store.setQA(response.data);
    } catch (reason) {
      if (run && isStale(run)) return discardStaleRun(run);
      fail(reason);
    }
  }

  async function runImageGeneration() {
    let run: RunHandle | null = null;
    try {
      if (!project.research || !project.plan) throw new Error("本屏策划不完整。");
      const screen = project.plan.screens.find((item) => item.id === selectedScreenId);
      const execution = project.executions[selectedScreenId];
      if (!screen || !execution) throw new Error("请先生成本屏 A / B / D / E 执行交付。");
      if (
        !isExecutionCurrent(
          selectedScreenId,
          project.executions,
          executionStatuses
        )
      ) {
        throw new Error("本屏执行交付已失效或生成失败，请先续跑本屏。");
      }
      const imageProviderConfig = useImageProviderStore.getState().getActiveConfig();
      if (!imageProviderConfig) throw new Error("请先在右上角“生图模型”中完成独立配置。");
      const referenceAssets = project.assets.filter((asset) =>
        selectedAssetIds.includes(asset.id)
      );
      if (!referenceAssets.length) {
        throw new Error("生图前至少选择一张产品参考图。");
      }

      run = beginRun("正在携带产品参考图与定稿文案生成9:16完整画面");
      const referenceImages = await Promise.all(
        referenceAssets.map(resolveAssetDataUrl)
      );
      const requestId =
        imageRequestIdsRef.current[screen.id] ??
        `img_${Date.now()}_${crypto.randomUUID().replace(/-/g, "")}`;
      imageRequestIdsRef.current[screen.id] = requestId;
      const response = await postJson<GeneratedImageAsset>(
        "/api/skill-suite/image",
        {
          requestId,
          screen,
          execution,
          facts: project.research.facts,
          referenceImages,
          imageProviderConfig
        },
        { signal: run.signal }
      );
      if (isStale(run)) return discardStaleRun(run);
      setLastResponseMeta(response.meta);
      setGeneratedImages((current) => ({
        ...current,
        [screen.id]: response.data
      }));
      delete imageRequestIdsRef.current[screen.id];
      store.setWork("success", `${screen.id} 图文画面生成完成`);
    } catch (reason) {
      if (run && isStale(run)) return discardStaleRun(run);
      fail(reason);
    }
  }

  function handleAssetsChange(
    assets: ProjectAsset[],
    nextSelectedIds = assets.map((asset) => asset.id)
  ) {
    if (
      (project.research || project.plan) &&
      !window.confirm(
        "更改素材会清空已生成的图研、策划、执行与质检结果（保证结果与素材一致）。继续吗？"
      )
    ) {
      return false;
    }
    abortActiveRun();
    researchCheckpointRef.current = null;
    planningDraftRef.current = null;
    store.setAssets(assets);
    const availableIds = new Set(assets.map((asset) => asset.id));
    setSelectedAssetIds(
      nextSelectedIds.filter((assetId) => availableIds.has(assetId))
    );
    setGeneratedImages({});
    imageRequestIdsRef.current = {};
    setLastResponseMeta(null);
    return true;
  }

  function handleAssetSelectionChange(assetIds: string[]) {
    abortActiveRun();
    researchCheckpointRef.current = null;
    planningDraftRef.current = null;
    store.invalidateVisualInputs();
    setSelectedAssetIds(assetIds);
    setGeneratedImages({});
    imageRequestIdsRef.current = {};
    setLastResponseMeta(null);
  }

  function newProject() {
    if (
      (project.assets.length || project.research || project.plan) &&
      !window.confirm("新建项目会清空当前工作流结果，但不会影响 API 配置。继续吗？")
    ) {
      return;
    }
    abortActiveRun();
    researchCheckpointRef.current = null;
    planningDraftRef.current = null;
    store.resetProject();
    clearProject().catch(() => {});
    setSelectedAssetIds([]);
    setGeneratedImages({});
    imageRequestIdsRef.current = {};
    setLastResponseMeta(null);
  }

  function retryCurrentStage() {
    store.setWork("idle");
    if (stage === "research") {
      void runResearch();
      return;
    }
    if (stage === "planning") {
      void runPlanning();
      return;
    }
    if (stage === "execution") {
      void runAllExecutions();
      return;
    }
    void runQA();
  }

  return (
    <div id="workspace-app-shell" className="workbench-shell">
      <AppHeader
        stage={stage}
        completedStages={completedStages}
        onStageChange={store.setStage}
        onNewProject={newProject}
      />

      <div className="workbench-main">
        <AssetLibrary
          assets={project.assets}
          selectedIds={selectedAssetIds}
          onSelectionChange={handleAssetSelectionChange}
          onAssetsChange={handleAssetsChange}
        />

        <main className="workbench-content">
          {stage === "research" ? (
            <ResearchPanel
              research={project.research}
              assetCount={selectedAssetIds.length}
              running={running}
              onRun={() => void runResearch()}
              onContinue={() => store.setStage("planning")}
            />
          ) : null}
          {stage === "planning" ? (
            <PlanningPanel
              research={project.research}
              brief={project.brief}
              plan={project.plan}
              running={running}
              onBriefChange={(patch) => {
                planningDraftRef.current = null;
                store.updateBrief(patch);
              }}
              onRun={() => void runPlanning()}
              onSelectScreen={store.setSelectedScreen}
              onContinue={() => store.setStage("execution")}
            />
          ) : null}
          {stage === "execution" ? (
            <ExecutionPanel
              plan={project.plan}
              assets={project.assets}
              executions={project.executions}
              executionStatuses={executionStatuses}
              selectedScreenId={selectedScreenId}
              mode={executionMode}
              generatedImages={generatedImages}
              running={running}
              workLabel={workLabel}
              onSelectScreen={store.setSelectedScreen}
              onModeChange={store.setExecutionMode}
              onGenerateScreen={() => void runSelectedExecution()}
              onGenerateAll={() => void runAllExecutions()}
              onGenerateImage={() => void runImageGeneration()}
              onContinue={() => {
                store.setQA(null);
                store.setStage("qa");
              }}
            />
          ) : null}
          {stage === "qa" ? (
            <QAPanel
              plan={project.plan}
              executions={currentExecutions}
              qa={project.qa}
              selectedScreenId={selectedScreenId}
              assets={project.assets}
              running={running}
              onSelectScreen={store.setSelectedScreen}
              onRun={() => void runQA()}
            />
          ) : null}
        </main>
      </div>

      {running ? (
        <div className="workbench-toast running" role="status" aria-live="polite">
          <Info size={20} weight="fill" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>任务运行中</strong>
            <p>{workLabel || "正在处理当前任务"}</p>
          </div>
          <button
            type="button"
            className="workbench-cancel-button"
            onClick={cancelCurrentRun}
            aria-label="中断当前任务"
          >
            <Stop size={15} weight="fill" />
            中断
          </button>
        </div>
      ) : error ? (
        <div className="workbench-toast error" role="alert">
          <WarningCircle size={20} weight="fill" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>
              {errorPresentation?.title ?? "当前阶段未完成"}
            </strong>
            <p>{error.message}</p>
            {errorPresentation ? (
              <p className="workbench-recovery-note">
                {errorPresentation.recoveryNote}
              </p>
            ) : null}
            {errorPresentation?.costNote ? (
              <p className="workbench-cost-note">
                {errorPresentation.costNote}
              </p>
            ) : null}
            {error.partialData ? (
              <p>
                {hasPlanningDraft
                  ? "本次草稿未发布，已作为续修断点保留在当前页面。"
                  : "本次草稿未发布，仅保留诊断信息；重新尝试将从头生成完整结果。"}
              </p>
            ) : null}
            {errorPresentation?.technicalItems.length ? (
              <details className="workbench-technical-details">
                <summary>查看技术信息</summary>
                <p>
                  {errorPresentation.technicalItems.join(" · ")}
                </p>
              </details>
            ) : null}
            {errorPresentation?.validationDetails.length ? (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", fontSize: 10 }}>
                  查看完整校验明细（{errorPresentation.validationDetails.length}）
                </summary>
                <ol
                  style={{
                    margin: "6px 0 0",
                    maxHeight: 220,
                    overflow: "auto",
                    paddingLeft: 18,
                    color: "var(--ink)",
                    fontSize: 10,
                    lineHeight: 1.5
                  }}
                >
                  {errorPresentation.validationDetails.map((detail, index) => (
                    <li key={`${index}-${detail}`}>{detail}</li>
                  ))}
                </ol>
              </details>
            ) : null}
            {error.retryable ? (
              <button
                type="button"
                className="workbench-retry-button"
                onClick={retryCurrentStage}
              >
                {errorPresentation?.actionLabel ?? "重试当前阶段"}
              </button>
            ) : null}
          </div>
          <button type="button" aria-label="关闭错误" onClick={() => store.setWork("idle")}>
            <X size={16} />
          </button>
        </div>
      ) : workStatus === "success" && workLabel ? (
        <div className="workbench-toast success" role="status">
          <Info size={20} weight="fill" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p>{workLabel}</p>
            {lastResponseMeta ? (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: "pointer", fontSize: 10 }}>
                  查看本次模型运行信息
                </summary>
                <pre
                  style={{
                    margin: "6px 0 0",
                    maxHeight: 180,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    color: "var(--ink)",
                    fontSize: 9,
                    lineHeight: 1.45
                  }}
                >
                  {JSON.stringify(lastResponseMeta, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
          <button type="button" aria-label="关闭提示" onClick={() => store.setWork("idle")}>
            <X size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
