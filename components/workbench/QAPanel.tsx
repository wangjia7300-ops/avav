"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  DownloadSimple,
  LockKey,
  MapPin,
  ShieldCheck,
  Warning,
  WarningCircle
} from "@phosphor-icons/react";
import type {
  DetailPlan,
  ProjectAsset,
  QAFinding,
  QAReport,
  ScreenExecution
} from "@/lib/types";

type QAView = "page" | "copy" | "prompt";

type QAPanelProps = {
  plan: DetailPlan | null;
  executions: Record<string, ScreenExecution>;
  qa: QAReport | null;
  selectedScreenId: string;
  assets: ProjectAsset[];
  running: boolean;
  onSelectScreen: (screenId: string) => void;
  onRun: () => void;
};

function exportReport(report: QAReport) {
  const findings = report.findings
    .map(
      (item) =>
        `## ${item.severity === "error" ? "❌" : item.severity === "warning" ? "⚠️" : "✅"} ${item.title}\n\n- 模块：${item.module}\n- 屏幕：${item.screenId ?? "全局"}\n- 证据：${item.evidence}\n- 修正：${item.fix}`
    )
    .join("\n\n");
  const blob = new Blob([`# 15屏详情页质检报告\n\n${report.summary}\n\n${findings}`], {
    type: "text/markdown;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "15屏详情页质检报告.md";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function QAPanel({
  plan,
  executions,
  qa,
  selectedScreenId,
  assets,
  running,
  onSelectScreen,
  onRun
}: QAPanelProps) {
  const [view, setView] = useState<QAView>("page");
  const [publishConfirmed, setPublishConfirmed] = useState(false);

  useEffect(() => {
    setPublishConfirmed(false);
  }, [qa]);
  const selected =
    plan?.screens.find((screen) => screen.id === selectedScreenId) ?? plan?.screens[0];
  const execution = selected ? executions[selected.id] : null;
  const previewAsset = assets[0]?.dataUrl;
  const groups = useMemo(
    () => ({
      error: qa?.findings.filter((item) => item.severity === "error") ?? [],
      warning: qa?.findings.filter((item) => item.severity === "warning") ?? [],
      pass: qa?.findings.filter((item) => item.severity === "pass") ?? []
    }),
    [qa]
  );

  if (!plan) {
    return (
      <section className="stage-empty">
        <span className="stage-empty-icon"><LockKey size={30} /></span>
        <p className="eyebrow">技能 04 · 独立质检</p>
        <h1>请先完成15屏策划</h1>
        <p>质检模块只读取结果，不会静默修改文案、证据或提示词。</p>
      </section>
    );
  }

  if (!qa || !selected) {
    return (
      <section className="stage-empty">
        <span className="stage-empty-icon"><ShieldCheck size={30} /></span>
        <p className="eyebrow">技能 04 · 独立质检</p>
        <h1>对15屏结果做只读审查</h1>
        <p>覆盖策划、前三屏、卖点、信任、移动端、AI标识、广告法、可访问性、暗色模式与迭代等14个模块。</p>
        <button type="button" className="primary-action" onClick={onRun} disabled={running}>
          {running ? "正在运行规则与模型质检…" : "运行完整质检"}
        </button>
      </section>
    );
  }

  return (
    <section className="qa-workspace">
      <div className="qa-document">
        <div className="qa-titlebar">
          <div>
            <p className="eyebrow">技能 04 · 独立质检</p>
            <h1>15屏详情页 · 质检报告</h1>
          </div>
          <div className="qa-view-tabs">
            <button type="button" className={view === "page" ? "is-active" : ""} onClick={() => setView("page")}>完整页面</button>
            <button type="button" className={view === "copy" ? "is-active" : ""} onClick={() => setView("copy")}>文案</button>
            <button type="button" className={view === "prompt" ? "is-active" : ""} onClick={() => setView("prompt")}>生图提示词</button>
          </div>
        </div>

        <div className="qa-canvas">
          <nav className="qa-screen-nav" aria-label="质检屏幕导航">
            <small>页面导航（15）</small>
            {plan.screens.map((screen) => (
              <button
                key={screen.id}
                type="button"
                className={screen.id === selected.id ? "is-active" : ""}
                onClick={() => onSelectScreen(screen.id)}
              >
                <span>{String(screen.index).padStart(2, "0")}</span>
                <i className={qa.findings.some((item) => item.screenId === screen.id && item.severity === "error") ? "has-error" : ""} />
              </button>
            ))}
          </nav>

          <div className="qa-preview-column">
            <div className="qa-preview-meta">
              <span>{String(selected.index).padStart(2, "0")} / 15 屏</span>
              <span>9:16</span>
            </div>
            <div className="qa-detail-preview">
              {previewAsset ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewAsset} alt="质检产品预览" />
              ) : null}
              <div className="qa-preview-copy">
                <small>{selected.role}</small>
                <h2>{execution?.copyFinal.headline ?? selected.copy.headline}</h2>
                <p className="preview-subheadline">
                  {execution?.copyFinal.subheadline ?? selected.copy.subheadline}
                </p>
                <p className="preview-body">
                  {execution?.copyFinal.body ?? selected.copy.body}
                </p>
              </div>
              <div className="qa-preview-points">
                {(execution?.copyFinal.keyPoints ?? selected.copy.keyPoints)
                  .slice(0, 3)
                  .map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>
          </div>

          <div className="qa-specification">
            {view === "page" ? (
              <>
                <SpecRow label="屏序" value={String(selected.index).padStart(2, "0")} />
                <SpecRow label="模块类型" value={selected.role} />
                <SpecRow label="画面比例" value="9:16" />
                <SpecRow label="转化任务" value={selected.conversionTask} />
                <SpecRow label="核心卖点" value={selected.primarySellingPoint} />
                <SpecRow label="证据引用" value={selected.evidenceIds.join("、") || "创意/场景屏"} />
                <SpecRow label="字体规范" value="H1 46px / H2 24px / 正文≥14px" />
                <SpecRow label="素材来源" value={assets.map((asset) => asset.name).join("、") || "未上传"} />
              </>
            ) : view === "copy" ? (
              <>
                <SpecRow label="标题" value={execution?.copyFinal.headline ?? selected.copy.headline} />
                <SpecRow label="副标题" value={execution?.copyFinal.subheadline ?? selected.copy.subheadline} />
                <SpecRow label="正文" value={execution?.copyFinal.body ?? selected.copy.body} />
                <SpecRow label="要点" value={(execution?.copyFinal.keyPoints ?? selected.copy.keyPoints).join("；")} />
              </>
            ) : (
              <>
                <SpecRow label="English Prompt" value={execution?.englishPrompt ?? "尚未生成"} />
                <SpecRow label="Negative Prompt" value={execution?.negativePrompt ?? "尚未生成"} />
                <SpecRow label="视觉指令" value={execution?.visualInstruction ?? "尚未生成"} />
                <SpecRow label="来源" value={execution?.source === "model" ? "真实模型" : "示例/未生成"} />
              </>
            )}
          </div>
        </div>
      </div>

      <aside className="qa-results">
        <div className="qa-results-heading">
          <div>
            <p className="eyebrow">质检结果（只读）</p>
            <h2>{qa.findings.length} 条审查记录</h2>
          </div>
          <button type="button" className="icon-button" onClick={onRun} aria-label="重新运行质检">
            <ShieldCheck size={18} />
          </button>
        </div>

        <p className="qa-summary">{qa.summary}</p>
        <p className="qa-policy-note">
          用户上传图片内的可识别内容均属于甲方基础资料，可直接进入文案并改善语义。敏感内容只做人工复核提示，不会因缺少外部报告被自动删除。
        </p>

        <FindingGroup
          severity="error"
          title={`发布前需处理 ${groups.error.length}`}
          findings={groups.error}
          onLocate={onSelectScreen}
        />
        <FindingGroup
          severity="warning"
          title={`优化建议 ${groups.warning.length}`}
          findings={groups.warning}
          onLocate={onSelectScreen}
        />
        <FindingGroup
          severity="pass"
          title={`已通过 ${groups.pass.length}`}
          findings={groups.pass}
          onLocate={onSelectScreen}
        />

        <div className="qa-actions">
          <button
            type="button"
            className="secondary-action"
            disabled={!groups.error[0]?.screenId}
            onClick={() => groups.error[0]?.screenId && onSelectScreen(groups.error[0].screenId)}
          >
            <MapPin size={17} />
            定位首个问题
          </button>
          <button type="button" className="secondary-action" onClick={() => exportReport(qa)}>
            <DownloadSimple size={17} />
            导出质检报告
          </button>
          <button
            type="button"
            className="publish-action"
            disabled={groups.error.length > 0}
            onClick={() => {
              exportReport(qa);
              setPublishConfirmed(true);
            }}
          >
            {publishConfirmed ? <CheckCircle size={17} weight="fill" /> : <LockKey size={17} />}
            {groups.error.length
              ? "处理高风险声明后发布"
              : publishConfirmed
                ? "已确认发布 · 报告已导出"
                : "确认可发布并导出报告"}
          </button>
        </div>
      </aside>
    </section>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="spec-row">
      <small>{label}</small>
      <p>{value}</p>
    </div>
  );
}

function FindingGroup({
  severity,
  title,
  findings,
  onLocate
}: {
  severity: "error" | "warning" | "pass";
  title: string;
  findings: QAFinding[];
  onLocate: (screenId: string) => void;
}) {
  const Icon =
    severity === "error" ? WarningCircle : severity === "warning" ? Warning : CheckCircle;
  const [expanded, setExpanded] = useState(false);
  const collapsedLimit = severity === "pass" ? 5 : 8;
  const visibleFindings = expanded ? findings : findings.slice(0, collapsedLimit);
  return (
    <section className={`finding-group ${severity}`}>
      <h3><Icon size={17} weight="fill" />{title}</h3>
      {findings.length ? (
        <>
          {visibleFindings.map((finding) => (
            <article key={finding.id}>
              <div>
                <strong>{finding.title}</strong>
                <p>{finding.evidence}</p>
                <p className="finding-fix">建议：{finding.fix}</p>
              </div>
              {finding.screenId ? (
                <button type="button" onClick={() => onLocate(finding.screenId as string)}>
                  {finding.screenId.replace("screen-", "")} 屏
                </button>
              ) : null}
            </article>
          ))}
          {findings.length > collapsedLimit ? (
            <button
              type="button"
              className="finding-more"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? "收起"
                : `展开全部 ${findings.length} 条（还有 ${findings.length - collapsedLimit} 条未显示）`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="finding-empty">暂无</p>
      )}
    </section>
  );
}
