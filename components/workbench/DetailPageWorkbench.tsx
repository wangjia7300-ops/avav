"use client";

import { useMemo, useRef, useState } from "react";
import { Info, WarningCircle, X } from "@phosphor-icons/react";
import { AppHeader } from "@/components/AppHeader";
import { AssetLibrary } from "@/components/workbench/AssetLibrary";
import { ExecutionPanel } from "@/components/workbench/ExecutionPanel";
import { PlanningPanel } from "@/components/workbench/PlanningPanel";
import { QAPanel } from "@/components/workbench/QAPanel";
import { ResearchPanel } from "@/components/workbench/ResearchPanel";
import { useImageProviderStore } from "@/lib/image-provider-store";
import { useProviderStore } from "@/lib/provider-store";
import { useSkillSuiteStore } from "@/lib/skill-suite/store";
import type {
  DetailPlan,
  GeneratedImageAsset,
  ProductResearch,
  ProjectAsset,
  QAReport,
  ScreenExecution,
  WorkflowStage
} from "@/lib/types";
import { postJson, toWorkError } from "@/lib/workbench/api-client";
import type { ApiMeta } from "@/lib/workbench/api-client";

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

export function DetailPageWorkbench() {
  const store = useSkillSuiteStore();
  const {
    project,
    stage,
    selectedScreenId,
    executionMode,
    workStatus,
    workLabel,
    error
  } = store;
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(
    project.assets.map((asset) => asset.id)
  );
  const [generatedImages, setGeneratedImages] = useState<Record<string, GeneratedImageAsset>>({});
  const [lastResponseMeta, setLastResponseMeta] = useState<ApiMeta | null>(null);

  const running = workStatus === "running";
  const completedStages = useMemo(() => {
    const completed: WorkflowStage[] = [];
    if (project.research) completed.push("research");
    if (project.plan) completed.push("planning");
    if (project.plan && Object.keys(project.executions).length === 15) completed.push("execution");
    if (project.qa) completed.push("qa");
    return completed;
  }, [project.executions, project.plan, project.qa, project.research]);

  function getProviderConfig() {
    // A verified browser configuration overrides the server default.
    // null tells the API route to use ARK_API_KEY / OPENAI_API_KEY from .env.local.
    return useProviderStore.getState().getActiveConfig();
  }

  function fail(reason: unknown) {
    setLastResponseMeta(null);
    store.setWork("error", "", toWorkError(reason));
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
    return useSkillSuiteStore.getState().runEpoch !== run.epoch;
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
  }

  async function runResearch() {
    let run: RunHandle | null = null;
    try {
      const providerConfig = getProviderConfig();
      const assets = project.assets.filter((asset) => selectedAssetIds.includes(asset.id));
      if (!assets.length) throw new Error("请至少选择一张产品图参与分析。");
      if (assets.some((asset) => !asset.dataUrl.startsWith("data:image/"))) {
        throw new Error("示例项目不能冒充真实模型输入，请先上传自己的产品图。");
      }
      run = beginRun("正在执行真实 Ark 八维图研");
      const response = await postJson<ProductResearch>(
        "/api/skill-suite",
        {
          stage: "research",
          providerConfig,
          assets: assets.map((asset) => ({ id: asset.id, dataUrl: asset.dataUrl })),
          notes: project.brief.notes
        },
        { signal: run.signal }
      );
      if (isStale(run)) return discardStaleRun(run);
      setLastResponseMeta(response.meta);
      store.setResearch(response.data);
    } catch (reason) {
      if (run && isStale(run)) return discardStaleRun(run);
      fail(reason);
    }
  }

  async function runPlanning() {
    let run: RunHandle | null = null;
    try {
      if (!project.research) throw new Error("请先完成图片研究。");
      const providerConfig = getProviderConfig();
      setGeneratedImages({});
      run = beginRun();
      store.beginPlanning();
      const response = await postJson<DetailPlan>(
        "/api/skill-suite",
        {
          stage: "planning",
          providerConfig,
          research: project.research,
          brief: project.brief
        },
        { signal: run.signal }
      );
      if (isStale(run)) return discardStaleRun(run);
      setLastResponseMeta(response.meta);
      store.setPlan(response.data);
    } catch (reason) {
      if (run && isStale(run)) return discardStaleRun(run);
      fail(reason);
    }
  }

  async function generateExecutions(screenIds: string[], onDone?: () => void) {
    let run: RunHandle | null = null;
    try {
      if (!project.research || !project.plan) {
        throw new Error("请先完成图研和15屏策划。");
      }
      const providerConfig = getProviderConfig();
      run = beginRun("正在生成执行交付");
      for (let start = 0; start < screenIds.length; start += 5) {
        const ids = screenIds.slice(start, start + 5);
        const screens = project.plan.screens.filter((screen) => ids.includes(screen.id));
        store.setWork(
          "running",
          screenIds.length === 1
            ? "正在生成本屏交付"
            : `正在生成第${start + 1}–${Math.min(start + 5, screenIds.length)}屏`
        );
        const response = await postJson<{ executions: ScreenExecution[] }>(
          "/api/skill-suite",
          {
            stage: "execution",
            providerConfig,
            research: project.research,
            plan: project.plan,
            screens,
            mode: executionMode
          },
          { signal: run.signal }
        );
        if (isStale(run)) return discardStaleRun(run);
        setLastResponseMeta(response.meta);
        store.mergeExecutions(response.data.executions);
      }
      onDone?.();
    } catch (reason) {
      if (run && isStale(run)) return discardStaleRun(run);
      fail(reason);
    }
  }

  async function runSelectedExecution() {
    await generateExecutions([selectedScreenId]);
  }

  async function runAllExecutions() {
    if (!project.plan) {
      fail(new Error("请先完成15屏策划。"));
      return;
    }
    await generateExecutions(
      project.plan.screens.map((screen) => screen.id),
      () => store.setWork("success", "15屏 A / B / D / E 四类交付已完成")
    );
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
          executions: project.executions
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
      const imageProviderConfig = useImageProviderStore.getState().getActiveConfig();
      if (!imageProviderConfig) throw new Error("请先在右上角“生图模型”中完成独立配置。");
      if (!project.assets.length) throw new Error("生图前必须上传产品参考图。");

      run = beginRun("正在携带产品参考图与定稿文案生成9:16完整画面");
      const referenceImages = await Promise.all(project.assets.map(resolveAssetDataUrl));
      const response = await postJson<GeneratedImageAsset>(
        "/api/skill-suite/image",
        {
          requestId: `img_${Date.now()}_${crypto.randomUUID().replace(/-/g, "")}`,
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
      store.setWork("success", `${screen.id} 图文画面生成完成`);
    } catch (reason) {
      if (run && isStale(run)) return discardStaleRun(run);
      fail(reason);
    }
  }

  function handleAssetsChange(assets: ProjectAsset[]) {
    if (
      (project.research || project.plan) &&
      !window.confirm(
        "更换或新增素材会清空已生成的图研、策划、执行与质检结果（保证结果与素材一致）。继续吗？"
      )
    ) {
      return;
    }
    abortActiveRun();
    store.setAssets(assets);
    setSelectedAssetIds(assets.map((asset) => asset.id));
    setGeneratedImages({});
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
    store.resetProject();
    setSelectedAssetIds([]);
    setGeneratedImages({});
    setLastResponseMeta(null);
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
          onSelectionChange={setSelectedAssetIds}
          onAssetsChange={handleAssetsChange}
          onAssetKindChange={store.setAssetKind}
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
              onBriefChange={store.updateBrief}
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
              executions={project.executions}
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

      {error ? (
        <div className="workbench-toast error" role="alert">
          <WarningCircle size={20} weight="fill" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>
              当前阶段未完成
              {error.code ? ` · ${error.code}` : ""}
            </strong>
            <p>{error.message}</p>
            {error.status || error.phase || error.conflictScreenIds.length ? (
              <p>
                {[
                  error.status ? `HTTP ${error.status}` : "",
                  error.phase ? `阶段：${error.phase}` : "",
                  error.conflictScreenIds.length
                    ? `冲突屏：${error.conflictScreenIds.join("、")}`
                    : ""
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {error.partialData ? (
              <p>本次部分草稿仅用于继续修复，未写入正式策划结果。</p>
            ) : null}
            {error.details.length ? (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", fontSize: 10 }}>
                  查看完整校验明细（{error.details.length}）
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
                  {error.details.map((detail, index) => (
                    <li key={`${index}-${detail}`}>{detail}</li>
                  ))}
                </ol>
              </details>
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
