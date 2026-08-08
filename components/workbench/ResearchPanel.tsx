"use client";

import {
  ArrowRight,
  CheckCircle,
  Eye,
  MagnifyingGlass,
  ShieldWarning,
  WarningCircle
} from "@phosphor-icons/react";
import { MAX_UPLOAD_IMAGE_COUNT } from "@/lib/config";
import type { EvidenceFact, ProductResearch } from "@/lib/types";

type ResearchPanelProps = {
  research: ProductResearch | null;
  assetCount: number;
  running: boolean;
  onRun: () => void;
  onContinue: () => void;
};

function getFactUsage(fact: EvidenceFact) {
  if (fact.commercialUse && fact.status !== "blocked") {
    return {
      tone: "allowed",
      label: fact.status === "verified" ? "可直接用于文案" : "甲方基础资料 · 可用于文案",
      guidance:
        fact.status === "verified"
          ? "可整理语序，但不得扩大原事实含义。"
          : "来自用户上传图片，可保留原意并做场景化、利益点和语义优化。"
    };
  }
  if (fact.status === "blocked") {
    return {
      tone: "blocked",
      label: "不可作为商业卖点",
      guidance: "不得换说法继续表达同一声明；请移除或改用其他已验证事实。"
    };
  }
  return {
    tone: "rewrite",
    label: "原句不可用 · 可改写/补证",
    guidance: "删除未证实的参数、材质、功效与因果承诺，改成可见外观或中性场景表达；也可补证后再用。"
  };
}

export function ResearchPanel({
  research,
  assetCount,
  running,
  onRun,
  onContinue
}: ResearchPanelProps) {
  if (!research) {
    return (
      <section className="stage-empty">
        <span className="stage-empty-icon"><MagnifyingGlass size={30} /></span>
        <p className="eyebrow">阶段 01 · 图片研究</p>
        <h1>先把甲方图片事实与模型推测分开</h1>
        <p>
          上传 1–{MAX_UPLOAD_IMAGE_COUNT} 张多角度产品图。系统将完成八维视觉审计，图片内可识别内容可用于文案，模型推测会被单独阻断。
        </p>
        <div className="stage-empty-list">
          <span><CheckCircle size={17} /> 构图、色彩、字体、视觉动线</span>
          <span><CheckCircle size={17} /> 材质工艺、情绪、算法适配</span>
          <span><ShieldWarning size={17} /> 品牌文字、装饰徽章与模型推测隔离</span>
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={!assetCount || running}
          onClick={onRun}
        >
          {running ? "正在调用真实模型…" : "开始八维图研"}
          {!running ? <ArrowRight size={18} /> : null}
        </button>
      </section>
    );
  }

  const usable = research.facts.filter(
    (fact) => fact.status !== "blocked" && fact.commercialUse
  );
  const restricted = research.facts.filter(
    (fact) => fact.status === "blocked" || !fact.commercialUse
  );

  return (
    <section className="document-panel">
      <div className="document-titlebar">
        <div>
          <p className="eyebrow">阶段 01 · 图片研究</p>
          <h1>{research.productName}</h1>
          <p>{research.summary}</p>
        </div>
        <div className="source-stamp">
          <Eye size={16} />
          {research.source === "sample" ? "示例数据" : "真实模型"}
        </div>
      </div>

      <div className="research-overview">
        <article>
          <small>品类</small>
          <strong>{research.category}</strong>
        </article>
        <article>
          <small>品牌识别</small>
          <strong>{research.brand || "未识别"}</strong>
        </article>
        <article>
          <small>可用文案事实</small>
          <strong>{usable.length} 条</strong>
        </article>
        <article>
          <small>受限声明</small>
          <strong>{restricted.length} 条</strong>
        </article>
      </div>

      <div className="research-section">
        <div className="section-heading">
          <div>
            <span>01</span>
            <h2>证据事实库</h2>
          </div>
          <p>用户上传图片内的可识别内容统一视为甲方基础资料，默认允许进入文案。</p>
        </div>
        <div className="fact-table">
          {research.facts.map((fact) => {
            const usage = getFactUsage(fact);
            return (
            <article key={fact.id} className="fact-row">
              <div className={`fact-status ${fact.status}`}>
                {fact.status === "verified" ? (
                  <CheckCircle size={17} weight="fill" />
                ) : (
                  <WarningCircle size={17} weight="fill" />
                )}
              </div>
              <div>
                <small>{fact.label} · {fact.claimScope}</small>
                <strong>{fact.value}</strong>
              </div>
              <p>{fact.evidence}</p>
              <div className="fact-usage-cell">
                <span className={`fact-usage ${usage.tone}`}>{usage.label}</span>
                <small>{usage.guidance}</small>
              </div>
            </article>
            );
          })}
        </div>
      </div>

      <div className="research-section">
        <div className="section-heading">
          <div>
            <span>02</span>
            <h2>八维视觉审计</h2>
          </div>
          <p>从原图诊断到详情页执行建议。</p>
        </div>
        <div className="audit-grid">
          {research.visualAudit.map((dimension, index) => (
            <article key={dimension.key} className="audit-card">
              <small>{String(index + 1).padStart(2, "0")}</small>
              <h3>{dimension.title}</h3>
              <p>{dimension.finding}</p>
              <div>{dimension.recommendation}</div>
            </article>
          ))}
        </div>
      </div>

      {research.risks.length ? (
        <div className="risk-strip">
          <ShieldWarning size={20} />
          <div>
            <strong>进入策划前需注意</strong>
            <p>{research.risks.join("；")}</p>
          </div>
        </div>
      ) : null}

      <div className="document-actions">
        <button type="button" className="secondary-action" onClick={onRun} disabled={running}>
          重新图研
        </button>
        <button type="button" className="primary-action" onClick={onContinue}>
          补充策划信息
          <ArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}
