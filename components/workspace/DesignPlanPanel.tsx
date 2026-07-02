"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { sanitizeCopywritingOutput } from "@/lib/services/copywriting-guardrails";
import type { DetailPagePlan, GenerationMeta, MainImagePlan, PlanVisualGuidelines } from "@/lib/types";

type DesignPlanPanelProps =
  | {
      type: "main";
      plans: MainImagePlan[];
    }
  | {
      type: "detail";
      plans: DetailPagePlan[];
    };

function visualGuidelineEntries(guidelines?: PlanVisualGuidelines) {
  if (!guidelines) {
    return [];
  }

  return [
    ["整体调性", guidelines.overallTone],
    ["画面质感", guidelines.imageTexture],
    ["布光逻辑", guidelines.lightingLogic],
    ["色彩配色体系", guidelines.colorPaletteSystem],
    ["字体规范", guidelines.typographyRules],
    ["构图规范", guidelines.compositionRules],
    ["产品外观特征", guidelines.productAppearanceFeatures],
    ["统一视觉风格", guidelines.unifiedVisualStyle]
  ].filter(([, value]) => Boolean(value));
}

function generationBadge(meta?: GenerationMeta) {
  if (!meta) return null;
  if (meta.usedMock || meta.sourceType === "mock") return <Badge variant="secondary">模拟数据</Badge>;
  if (meta.usedFallback || meta.sourceType === "template_fallback") return <Badge variant="outline">模板兜底</Badge>;
  if (meta.usedAI || meta.sourceType === "real_ai") return <Badge variant="success">真实 AI</Badge>;
  if (meta.sourceType === "ai_inference") return <Badge variant="outline">AI 推断</Badge>;
  return null;
}

export function DesignPlanPanel(props: DesignPlanPanelProps) {
  const isMain = props.type === "main";
  const firstDetailPlan = !isMain ? props.plans[0] : undefined;

  if (!props.plans.length) {
    return (
      <EmptyState
        title={isMain ? "等待主图方案" : "等待详情页方案"}
        description="完成视觉策划步骤后，这里会展示每张图的目标、场景、版式、文案和视觉元素。"
      />
    );
  }

  return (
    <div className="space-y-4">
      {!isMain && firstDetailPlan?.structureMode ? (
        <div className="rounded-md border bg-blue-50/60 p-3 text-sm leading-6 text-blue-900">
          详情页结构：
          {firstDetailPlan.structureMode === "full"
            ? "完整结构"
            : firstDetailPlan.structureMode === "lightweight"
              ? "轻量结构"
              : "裁剪结构"}
          {firstDetailPlan.structureNote ? `。${firstDetailPlan.structureNote}` : ""}
        </div>
      ) : null}
      {props.plans.map((plan) => {
        const safeCopywriting = sanitizeCopywritingOutput(plan.copywriting, {
          assignedSellingPoint: plan.assignedSellingPoint,
          fallbackPoint: plan.assignedSellingPoint?.name,
          evidenceLevel: plan.assignedSellingPoint?.evidenceLevel
        });

        return (
        <Card key={plan.index}>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>
                  {isMain ? "主图" : "详情页"} {plan.index}. {plan.title}
                </CardTitle>
                <p className="mt-2 text-sm text-muted-foreground">目标：{plan.goal}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Badge variant={isMain ? "default" : "violet"}>{isMain ? "1:1" : "纵向屏"}</Badge>
                {generationBadge(plan.generationMeta)}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {"scene" in plan ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">场景</p>
                <p className="mt-1 text-sm leading-6 text-slate-800">{plan.scene}</p>
              </div>
            ) : null}
            <div>
              <p className="text-xs font-medium text-muted-foreground">版式</p>
              <p className="mt-1 text-sm leading-6 text-slate-800">{plan.layout}</p>
            </div>
            {plan.imageBrief ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">配图说明</p>
                <p className="mt-1 text-sm leading-6 text-slate-800">{plan.imageBrief}</p>
              </div>
            ) : null}
            {plan.textImageLayout ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">图文排版关系</p>
                <p className="mt-1 text-sm leading-6 text-slate-800">{plan.textImageLayout}</p>
              </div>
            ) : null}
            {plan.visualFocus ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">视觉重心</p>
                <p className="mt-1 text-sm leading-6 text-slate-800">{plan.visualFocus}</p>
              </div>
            ) : null}
            {isMain && ("role" in plan) && plan.role ? (
              <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3">
                <p className="text-xs font-medium text-blue-700">主图点击策略</p>
                <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-700 sm:grid-cols-2">
                  <p>角色：{plan.role}</p>
                  <p>表达方式：{plan.expressionMethod ?? "scene"}</p>
                  <p>主点击理由：{plan.primaryClickReason ?? "待补充"}</p>
                  <p>产品占比：{plan.productSizeRatio ?? "60-80%"}</p>
                  <p className="sm:col-span-2">构图规则：{plan.compositionRule ?? "只讲一个核心点击理由"}</p>
                  <p className="sm:col-span-2">证据边界：{plan.proofOrBoundary ?? "按已提供信息保守表达"}</p>
                  <p className="sm:col-span-2">点击解释：{plan.clickTriggerExplanation ?? "降低识别成本并触发点击"}</p>
                </div>
              </div>
            ) : null}
            {!isMain && ("screenRole" in plan) && plan.screenRole ? (
              <div className="rounded-md border border-emerald-100 bg-emerald-50/60 p-3">
                <p className="text-xs font-medium text-emerald-700">详情页销售漏斗</p>
                <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-700">
                  <p>阶段：{plan.screenRole} / {plan.funnelStage ?? "need"}</p>
                  <p>回答用户问题：{plan.userQuestionAnswered ?? "本屏解决一个购买问题"}</p>
                  <p>转化目的：{plan.conversionPurpose ?? "推动继续浏览和决策"}</p>
                  <p>证据边界：{plan.proofOrBoundary ?? "按已提供信息保守表达"}</p>
                </div>
              </div>
            ) : null}
            {visualGuidelineEntries(plan.visualGuidelines).length ? (
              <div className="rounded-md border bg-slate-50/70 p-3">
                <p className="text-xs font-medium text-muted-foreground">视觉规范</p>
                <div className="mt-3 space-y-2">
                  {visualGuidelineEntries(plan.visualGuidelines).map(([label, value]) => (
                    <div key={label} className="grid gap-1 sm:grid-cols-[96px_1fr]">
                      <p className="text-xs font-semibold text-slate-600">{label}</p>
                      <p className="text-xs leading-5 text-slate-700">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="rounded-md bg-muted/60 p-3">
              <p className="text-xs font-medium text-muted-foreground">文案</p>
              <p className="mt-2 text-sm font-semibold text-slate-950">
                {safeCopywriting.headline}
              </p>
              {safeCopywriting.subheadline ? (
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {safeCopywriting.subheadline}
                </p>
              ) : null}
              {safeCopywriting.body ? (
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                  {safeCopywriting.body}
                </p>
              ) : null}
            </div>
            {plan.assignedSellingPoint ? (
              <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3">
                <p className="text-xs font-medium text-blue-700">本屏卖点资产</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="default">{plan.assignedSellingPoint.name}</Badge>
                  <Badge variant="outline">{plan.assignedSellingPoint.priority}</Badge>
                  <Badge variant="outline">证据 {plan.assignedSellingPoint.evidenceLevel}</Badge>
                  <Badge variant="secondary">{plan.assignedSellingPoint.source}</Badge>
                </div>
                {plan.assignedSellingPoint.userBenefit ? (
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    用户利益：{plan.assignedSellingPoint.userBenefit}
                  </p>
                ) : null}
                {plan.assignedSellingPoint.scene || plan.assignedSellingPoint.emotionalTrigger ? (
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    FAB：{plan.assignedSellingPoint.scene ?? "场景待补充"} / {plan.assignedSellingPoint.emotionalTrigger ?? "情绪待补充"}
                  </p>
                ) : null}
                {plan.assignedSellingPoint.claimBoundary ? (
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    边界：{plan.assignedSellingPoint.claimBoundary}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {plan.visualElements.map((item) => (
                <Badge key={item} variant="secondary">
                  {item}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
}
