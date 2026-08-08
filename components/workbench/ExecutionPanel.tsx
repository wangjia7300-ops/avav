"use client";

import {
  ArrowDown,
  Copy,
  DownloadSimple,
  FileCode,
  ImageSquare,
  MagicWand,
  Sparkle
} from "@phosphor-icons/react";
import type {
  DetailPlan,
  ExecutionMode,
  ExecutionRunStatus,
  GeneratedImageAsset,
  ProjectAsset,
  ScreenExecution
} from "@/lib/types";
import {
  executionIdsToRun,
  isExecutionCurrent,
  selectCurrentExecutions
} from "@/lib/skill-suite/workflow";

const modes: Array<{ id: ExecutionMode; label: string }> = [
  { id: "A", label: "文案定稿" },
  { id: "B", label: "生图指令" },
  { id: "D", label: "GEO优化" },
  { id: "E", label: "视觉制作参考" }
];

type ExecutionPanelProps = {
  plan: DetailPlan | null;
  assets: ProjectAsset[];
  executions: Record<string, ScreenExecution>;
  executionStatuses: Record<string, ExecutionRunStatus>;
  selectedScreenId: string;
  mode: ExecutionMode;
  generatedImages: Record<string, GeneratedImageAsset>;
  running: boolean;
  workLabel: string;
  onSelectScreen: (screenId: string) => void;
  onModeChange: (mode: ExecutionMode) => void;
  onGenerateScreen: () => void;
  onGenerateAll: () => void;
  onGenerateImage: () => void;
  onContinue: () => void;
};

function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

function executionStatusMarker(
  status: ExecutionRunStatus | undefined,
  current: boolean
) {
  if (current) {
    return { className: "is-succeeded", label: "当前版本已生成" };
  }
  if (!status || status === "not_started") return null;
  const labels: Partial<Record<ExecutionRunStatus, string>> = {
    queued: "等待生成",
    running: "正在生成",
    failed_retryable: "生成失败，可重试",
    blocked: "存在阻断问题",
    stale: "结果已失效",
    cancelled: "生成已取消"
  };
  return {
    className: `is-${status.replace(/_/g, "-")}`,
    label: labels[status] ?? status
  };
}

function exportMarkdown(plan: DetailPlan, executions: Record<string, ScreenExecution>) {
  const body = plan.screens
    .map((screen) => {
      const execution = executions[screen.id];
      return [
        `## ${String(screen.index).padStart(2, "0")}｜${screen.copy.headline}`,
        "",
        `- 页面任务：${screen.conversionTask}`,
        `- 核心卖点：${screen.primarySellingPoint}`,
        `- 证据引用：${screen.evidenceIds.join("、") || "创意/场景屏"}`,
        "",
        "### 画面文案",
        execution
          ? [
              execution.copyFinal.headline,
              execution.copyFinal.subheadline,
              execution.copyFinal.body,
              ...execution.copyFinal.keyPoints.map((item) => `- ${item}`)
            ].join("\n")
          : "尚未生成",
        "",
        "### 即梦生图指令（实际发送）",
        execution?.englishPrompt ?? "尚未生成",
        "",
        "### 即梦约束条件",
        execution?.negativePrompt ?? "尚未生成",
        "",
        `> ${execution?.aiLabel ?? "尚未生成"}`
      ].join("\n");
    })
    .join("\n\n---\n\n");
  const blob = new Blob([`# 15屏详情页交付文档\n\n${body}`], {
    type: "text/markdown;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "15屏详情页文案与提示词.md";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ExecutionPanel({
  plan,
  assets,
  executions,
  executionStatuses,
  selectedScreenId,
  mode,
  generatedImages,
  running,
  workLabel,
  onSelectScreen,
  onModeChange,
  onGenerateScreen,
  onGenerateAll,
  onGenerateImage,
  onContinue
}: ExecutionPanelProps) {
  if (!plan) {
    return (
      <section className="stage-empty">
        <span className="stage-empty-icon"><MagicWand size={30} /></span>
        <p className="eyebrow">阶段 03 · 详情页执行</p>
        <h1>请先生成15屏策划</h1>
        <p>执行模块只翻译已经确认的每屏任务，不重新发明卖点或重复整份规范。</p>
      </section>
    );
  }

  const selectedScreen =
    plan.screens.find((screen) => screen.id === selectedScreenId) ?? plan.screens[0];
  const storedExecution = executions[selectedScreen.id];
  const executionIsCurrent = isExecutionCurrent(
    selectedScreen.id,
    executions,
    executionStatuses
  );
  const execution = executionIsCurrent ? storedExecution : undefined;
  const generatedImage = executionIsCurrent
    ? generatedImages[selectedScreen.id]
    : undefined;
  const pendingIds = executionIdsToRun(plan, executions, executionStatuses);
  const currentExecutions = selectCurrentExecutions(
    executions,
    executionStatuses
  );
  const completed = plan.screens.filter((screen) =>
    Boolean(currentExecutions[screen.id])
  ).length;
  const blocked = plan.screens.filter(
    (screen) => executionStatuses[screen.id] === "blocked"
  ).length;
  const firstBlockedId = plan.screens.find(
    (screen) => executionStatuses[screen.id] === "blocked"
  )?.id;
  const batchActionLabel = running
    ? workLabel || "生成中…"
    : completed === 15
      ? "15屏均已完成"
      : pendingIds.length
        ? blocked
          ? `本次页面内续跑 ${pendingIds.length} 屏（另有 ${blocked} 屏阻断）`
          : `本次页面内续跑剩余 ${pendingIds.length} 屏`
        : blocked
          ? `定位首个阻断屏（共 ${blocked} 屏）`
          : "等待运行中页面完成";
  const selectedRunStatus = executionStatuses[selectedScreen.id];
  const heroAsset = assets[0]?.dataUrl;

  return (
    <section className="execution-workspace">
      <div className="execution-toolbar">
        <div>
          <p className="eyebrow">阶段 03 · 详情页执行</p>
          <h1>屏幕 {String(selectedScreen.index).padStart(2, "0")} / 15</h1>
        </div>
        <div className="execution-progress">
          <span>{completed}/15 已生成</span>
          <div><i style={{ width: `${(completed / 15) * 100}%` }} /></div>
        </div>
        <button
          type="button"
          className="secondary-action compact"
          onClick={() => exportMarkdown(plan, currentExecutions)}
          disabled={!completed}
        >
          <DownloadSimple size={17} />
          导出文档
        </button>
        <button
          type="button"
          className="primary-action compact"
          onClick={
            pendingIds.length
              ? onGenerateAll
              : firstBlockedId
                ? () => onSelectScreen(firstBlockedId)
                : onGenerateAll
          }
          disabled={running || (pendingIds.length === 0 && !firstBlockedId)}
        >
          <Sparkle size={17} />
          {batchActionLabel}
        </button>
      </div>

      <div className="execution-body">
        <nav className="screen-minimap" aria-label="15屏导航">
          {plan.screens.map((screen) => {
            const current = isExecutionCurrent(
              screen.id,
              executions,
              executionStatuses
            );
            const marker = executionStatusMarker(
              executionStatuses[screen.id],
              current
            );
            return (
              <button
                key={screen.id}
                type="button"
                className={screen.id === selectedScreen.id ? "is-active" : ""}
                onClick={() => onSelectScreen(screen.id)}
              >
                <span>{String(screen.index).padStart(2, "0")}</span>
                <small>{screen.role}</small>
                {marker ? (
                  <i className={marker.className} aria-label={marker.label} />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="preview-column">
          <div className="preview-toolbar">
            <span>9:16 竖版</span>
            <span>
              {generatedImage?.width && generatedImage?.height
                ? `${generatedImage.width} × ${generatedImage.height}`
                : "目标 1440 × 2560"}
            </span>
          </div>
          <div
            className={`detail-preview${generatedImage ? " is-generated" : ""}`}
          >
            {generatedImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={generatedImage.imageUrl} alt={`${selectedScreen.copy.headline} 生成图`} />
            ) : heroAsset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroAsset} alt="产品参考预览" />
            ) : (
              <div className="preview-placeholder"><ImageSquare size={32} /></div>
            )}
            {!generatedImage ? (
              <>
                <div className="preview-copy">
                  <small>{selectedScreen.role}</small>
                  <h2>{execution?.copyFinal.headline ?? selectedScreen.copy.headline}</h2>
                  <p className="preview-subheadline">
                    {execution?.copyFinal.subheadline ?? selectedScreen.copy.subheadline}
                  </p>
                  <p className="preview-body">
                    {execution?.copyFinal.body ?? selectedScreen.copy.body}
                  </p>
                </div>
                <div className="preview-evidence">
                  {(execution?.copyFinal.keyPoints ?? selectedScreen.copy.keyPoints)
                    .slice(0, 3)
                    .map((item) => <span key={item}>{item}</span>)}
                </div>
              </>
            ) : null}
          </div>
          <button
            type="button"
            className="image-action"
            disabled={!execution || running}
            onClick={onGenerateImage}
          >
            <ImageSquare size={18} />
            {generatedImage ? "重新生图" : "携带参考图生成完整画面"}
          </button>
          <p className="preview-note">
            {generatedImage
              ? "当前预览为供应商返回并经服务端校验后的原始成图，未再叠加页面文案；请与右侧定稿逐字复核。"
              : "生图会携带本屏定稿文案；出图后仍需复核中文错字、漏字和重复文字。"}
          </p>
        </div>

        <div className="deliverable-column">
          <div className="mode-tabs" role="tablist" aria-label="交付类型">
            {modes.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={mode === item.id}
                className={mode === item.id ? "is-active" : ""}
                onClick={() => onModeChange(item.id)}
              >
                <b>{item.id}</b>
                {item.label}
              </button>
            ))}
          </div>

          {!execution ? (
            <div className="execution-empty">
              <FileCode size={28} />
              <h2>
                {selectedRunStatus === "failed_retryable"
                  ? "本屏上次生成失败，可安全重试"
                  : selectedRunStatus === "stale"
                    ? "本屏交付已失效，需要重新生成"
                    : selectedRunStatus === "blocked"
                      ? "本屏存在阻断问题"
                      : selectedRunStatus === "cancelled"
                        ? "本屏上次生成已取消，可重新生成"
                    : "本屏尚未生成执行交付"}
              </h2>
              <p>
                已成功的其他屏会原样保留；本次只处理当前缺失、失败或已失效屏。
              </p>
              <button
                type="button"
                className="primary-action"
                onClick={onGenerateScreen}
                disabled={running || selectedRunStatus === "blocked"}
              >
                {running
                  ? "正在生成本屏…"
                  : selectedRunStatus === "blocked"
                    ? "先处理阻断原因"
                    : "生成或重试本屏"}
              </button>
            </div>
          ) : (
            <div className="deliverable-content">
              {mode === "A" ? (
                <>
                  <DeliverableBlock title="标题" value={execution.copyFinal.headline} />
                  <DeliverableBlock title="副标题" value={execution.copyFinal.subheadline} />
                  <DeliverableBlock title="正文" value={execution.copyFinal.body} />
                  <DeliverableBlock
                    title="要点"
                    value={execution.copyFinal.keyPoints.map((item) => `• ${item}`).join("\n")}
                  />
                </>
              ) : null}
              {mode === "B" ? (
                <>
                  <DeliverableBlock title="本屏即梦视觉草稿" value={execution.visualInstruction} />
                  <DeliverableBlock title="即梦生图指令（实际发送）" value={execution.englishPrompt} />
                  <DeliverableBlock title="即梦约束条件" value={execution.negativePrompt} tone="warning" />
                </>
              ) : null}
              {mode === "D" ? (
                <>
                  <DeliverableBlock title="AI购物问题" value={execution.geo.query} />
                  <DeliverableBlock title="证据答案" value={execution.geo.answer} />
                  <DeliverableBlock title="实体词" value={execution.geo.entities.join(" · ")} />
                </>
              ) : null}
              {mode === "E" ? (
                <>
                  <div className="production-reference-grid">
                    <DeliverableBlock title="信息层级" value={execution.productionReference.information} />
                    <DeliverableBlock title="线框结构" value={execution.productionReference.wireframe} />
                    <DeliverableBlock title="字体规范" value={execution.productionReference.typography} />
                    <DeliverableBlock title="场景与镜头" value={execution.productionReference.sceneDirection} />
                    <DeliverableBlock title="暗色模式" value={execution.productionReference.darkMode} />
                    <DeliverableBlock title="执行备注" value={execution.productionReference.designNotes} />
                  </div>
                  <div className="palette-row">
                    {execution.productionReference.palette.map((color) => (
                      <span key={color}><i style={{ backgroundColor: color }} />{color}</span>
                    ))}
                  </div>
                </>
              ) : null}
              <div className="execution-source">
                <span>{execution.source === "sample" ? "示例交付" : "真实模型"}</span>
                <span>{execution.aiLabel}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="execution-footer">
        <div className="screen-filmstrip">
          {plan.screens.map((screen) => (
            <button
              key={screen.id}
              type="button"
              className={screen.id === selectedScreen.id ? "is-active" : ""}
              onClick={() => onSelectScreen(screen.id)}
            >
              <span>{String(screen.index).padStart(2, "0")}</span>
              <small>{screen.copy.headline}</small>
            </button>
          ))}
        </div>
        <button type="button" className="qa-next-action" onClick={onContinue}>
          运行独立质检
          <ArrowDown size={16} />
        </button>
      </div>
    </section>
  );
}

function DeliverableBlock({
  title,
  value,
  tone
}: {
  title: string;
  value: string;
  tone?: "warning";
}) {
  return (
    <article className={`deliverable-block${tone ? ` ${tone}` : ""}`}>
      <div>
        <h3>{title}</h3>
        <button type="button" aria-label={`复制${title}`} onClick={() => void copyText(value)}>
          <Copy size={15} />
          复制
        </button>
      </div>
      <p>{value}</p>
    </article>
  );
}
