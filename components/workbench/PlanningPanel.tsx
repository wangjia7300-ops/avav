"use client";

import {
  ArrowRight,
  Check,
  FileText,
  LockKey,
  PencilSimple,
  Sparkle
} from "@phosphor-icons/react";
import type { DetailPlan, ProductResearch, SupplementalBrief } from "@/lib/types";

const briefFields: Array<{
  key: keyof SupplementalBrief;
  label: string;
  placeholder: string;
  wide?: boolean;
}> = [
  { key: "platform", label: "目标平台", placeholder: "天猫、京东、抖音、小红书…" },
  { key: "priceRange", label: "价格带", placeholder: "例如 199–299 元" },
  { key: "targetAudience", label: "核心人群", placeholder: "谁在什么场景下购买？", wide: true },
  { key: "competitorDifference", label: "竞品差异", placeholder: "比主要竞品多了什么或少了什么？", wide: true },
  { key: "promotionMoment", label: "促销时点", placeholder: "常规、618、双11、新品期…" },
  { key: "geoGoal", label: "GEO / AI搜索目标", placeholder: "希望AI购物助手回答什么？" },
  { key: "brandAssets", label: "品牌素材", placeholder: "Logo、品牌色、字体规范…" },
  { key: "productProofs", label: "证明资料", placeholder: "规格表、检测报告、包装清单…" },
  { key: "tone", label: "视觉语气", placeholder: "克制、甜酷、科技、生活方式…" },
  { key: "notes", label: "其他约束", placeholder: "禁用词、必须保留内容、渠道限制…", wide: true }
];

type PlanningPanelProps = {
  research: ProductResearch | null;
  brief: SupplementalBrief;
  plan: DetailPlan | null;
  running: boolean;
  onBriefChange: (patch: Partial<SupplementalBrief>) => void;
  onRun: () => void;
  onSelectScreen: (screenId: string) => void;
  onContinue: () => void;
};

export function PlanningPanel({
  research,
  brief,
  plan,
  running,
  onBriefChange,
  onRun,
  onSelectScreen,
  onContinue
}: PlanningPanelProps) {
  if (!research) {
    return (
      <section className="stage-empty">
        <span className="stage-empty-icon"><LockKey size={30} /></span>
        <p className="eyebrow">阶段 02 · 详情页策划</p>
        <h1>请先完成图片研究</h1>
        <p>策划必须基于可验证事实库，不能跳过图研直接编写商业声明。</p>
      </section>
    );
  }

  if (!plan) {
    return (
      <section className="document-panel planning-document">
        <div className="document-titlebar">
          <div>
            <p className="eyebrow">阶段 02 · 详情页策划</p>
            <h1>补齐模型看不到的业务信息</h1>
            <p>步骤1已完成产品分析；现在进行步骤2用户补充，之后才生成15屏策划。</p>
          </div>
          <div className="source-stamp">
            <Check size={16} weight="bold" />
            图研已完成
          </div>
        </div>

        <div className="planning-steps" aria-label="策划三步">
          <div className="is-complete"><span>1</span><b>产品分析</b><small>系统完成</small></div>
          <div className="is-active"><span>2</span><b>用户补充</b><small>当前步骤</small></div>
          <div><span>3</span><b>生成策划</b><small>15屏 9:16</small></div>
        </div>

        <div className="brief-grid">
          {briefFields.map((field) => (
            <label key={field.key} className={field.wide ? "is-wide" : ""}>
              <span>{field.label}</span>
              <textarea
                rows={field.wide ? 3 : 2}
                value={brief[field.key]}
                placeholder={field.placeholder}
                onChange={(event) => onBriefChange({ [field.key]: event.target.value })}
              />
            </label>
          ))}
        </div>

        <div className="planning-rule">
          <Sparkle size={20} />
          <div>
            <strong>系统硬约束</strong>
            <p>15屏固定、每屏一个转化任务、最多6个核心卖点；用户上传图片内容均按甲方基础资料使用，不凭空新增图片外结论。</p>
          </div>
        </div>

        <div className="document-actions">
          <span className="quiet-note">未填写的字段不会由模型擅自补齐。</span>
          <button
            type="button"
            className="primary-action"
            onClick={onRun}
            disabled={running}
          >
            {running ? "正在生成15屏策划…" : "生成15屏策划"}
            {!running ? <ArrowRight size={18} /> : null}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="document-panel">
      <div className="document-titlebar">
        <div>
          <p className="eyebrow">阶段 02 · 详情页策划</p>
          <h1>15屏策划结构</h1>
          <p>{plan.productPositioning}</p>
        </div>
        <button type="button" className="source-stamp interactive" onClick={onRun}>
          <PencilSimple size={16} />
          重新生成
        </button>
      </div>

      <div className="plan-meta-grid">
        <article>
          <small>核心卖点</small>
          <p>{plan.coreSellingPoints.join(" · ")}</p>
        </article>
        <article>
          <small>决策链</small>
          <p>{plan.decisionChain.join(" → ")}</p>
        </article>
        <article>
          <small>统一视觉方向</small>
          <p>{plan.globalVisualDirection}</p>
        </article>
      </div>

      <div className="screen-plan-table">
        <div className="screen-plan-head">
          <span>屏序</span>
          <span>页面角色 / 转化任务</span>
          <span>画面文案</span>
          <span>证据</span>
          <span>视觉差异</span>
        </div>
        {plan.screens.map((screen) => (
          <button
            key={screen.id}
            type="button"
            className="screen-plan-row"
            onClick={() => {
              onSelectScreen(screen.id);
              onContinue();
            }}
          >
            <span className="screen-number">{String(screen.index).padStart(2, "0")}</span>
            <span><b>{screen.role}</b><small>{screen.conversionTask}</small></span>
            <span>
              <b>{screen.copy.headline}</b>
              <small>{screen.copy.subheadline}</small>
              <small className="screen-copy-body">{screen.copy.body}</small>
            </span>
            <span>
              {screen.claimScope === "creative"
                ? "创意/场景屏"
                : `${screen.claimScope} · ${screen.evidenceIds.length} 条`}
            </span>
            <span>{screen.scene}<ArrowRight size={15} /></span>
          </button>
        ))}
      </div>

      <div className="document-actions">
        <span className="quiet-note"><FileText size={15} /> 已通过15屏数量与标题唯一性校验</span>
        <button type="button" className="primary-action" onClick={onContinue}>
          进入执行
          <ArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}
