"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { filterForbiddenItems, formatEvidenceTag } from "@/lib/evidence";
import type { MarketEvidenceField, MarketResearch } from "@/lib/types";

type MarketInsightPanelProps = {
  research: MarketResearch | null;
};

function InsightBlock({
  title,
  items,
  field,
  research,
  variant
}: {
  title: string;
  items: string[];
  field: MarketEvidenceField;
  research: MarketResearch;
  variant: "default" | "violet" | "success" | "secondary" | "outline";
}) {
  const visibleItems = filterForbiddenItems(items, research.evidence, field);

  if (!visibleItems.length) {
    return null;
  }

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-950">{title}</p>
      <div className="flex flex-wrap gap-2">
        {visibleItems.map((item, visibleIndex) => {
          const originalIndex = items.findIndex((candidate) => candidate === item);
          const info = research.evidence?.[field]?.[originalIndex >= 0 ? originalIndex : visibleIndex];

          return (
            <Badge key={`${field}-${item}`} variant={variant} title={formatEvidenceTag(info)}>
              {item}
              <span className="ml-1 opacity-70">
                {info ? `· ${info.evidenceLevel}/${info.source}` : "· 未标注"}
              </span>
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

export function MarketInsightPanel({ research }: MarketInsightPanelProps) {
  if (!research) {
    return (
      <EmptyState
        title="等待市场验证"
        description="产品识图完成后，这里会基于产品信息、用户补充资料和 AI 策划框架提炼卖点体系、用户画像、参数细节、评价问题和详情页风格线索。"
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>市场与卖点洞察</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {research.sourceNote ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            {research.sourceNote}
          </p>
        ) : null}
        <InsightBlock title="热门卖点" items={research.hotSellingPoints} field="hotSellingPoints" research={research} variant="default" />
        <InsightBlock title="用户反馈痛点问题" items={research.userPainPoints} field="userPainPoints" research={research} variant="violet" />
        {research.userFeedbackPros?.length ? (
          <InsightBlock title="用户反馈优点" items={research.userFeedbackPros} field="userFeedbackPros" research={research} variant="success" />
        ) : null}
        {research.userFeedbackCons?.length ? (
          <InsightBlock title="用户反馈问题" items={research.userFeedbackCons} field="userFeedbackCons" research={research} variant="violet" />
        ) : null}
        {research.copywritingSellingPoints?.length ? (
          <InsightBlock title="文案卖点" items={research.copywritingSellingPoints} field="copywritingSellingPoints" research={research} variant="default" />
        ) : null}
        {research.certificationSellingPoints?.length ? (
          <InsightBlock title="认证卖点" items={research.certificationSellingPoints} field="certificationSellingPoints" research={research} variant="outline" />
        ) : null}
        {research.featureSellingPoints?.length ? (
          <InsightBlock title="特征卖点" items={research.featureSellingPoints} field="featureSellingPoints" research={research} variant="success" />
        ) : null}
        {research.dataSellingPointInsights?.length ? (
          <InsightBlock title="数据卖点" items={research.dataSellingPointInsights} field="dataSellingPointInsights" research={research} variant="violet" />
        ) : null}
        {research.userQuestions?.length ? (
          <InsightBlock title="用户疑问 TOP5" items={research.userQuestions} field="userQuestions" research={research} variant="secondary" />
        ) : null}
        {research.targetUserProfiles?.length ? (
          <InsightBlock title="目标用户画像" items={research.targetUserProfiles} field="targetUserProfiles" research={research} variant="default" />
        ) : null}
        {research.functionProblemMapping?.length ? (
          <InsightBlock title="功能-场景-情绪映射" items={research.functionProblemMapping} field="functionProblemMapping" research={research} variant="success" />
        ) : null}
        {research.aiShoppingInsights?.length ? (
          <InsightBlock title="AI购物推荐逻辑" items={research.aiShoppingInsights} field="aiShoppingInsights" research={research} variant="outline" />
        ) : null}
        {research.targetAudienceInsights?.length ? (
          <InsightBlock title="目标受众推断" items={research.targetAudienceInsights} field="targetAudienceInsights" research={research} variant="default" />
        ) : null}
        {research.productParameterInsights?.length ? (
          <InsightBlock title="产品参数提取" items={research.productParameterInsights} field="productParameterInsights" research={research} variant="secondary" />
        ) : null}
        {research.productDetailInsights?.length ? (
          <InsightBlock title="产品细节识别" items={research.productDetailInsights} field="productDetailInsights" research={research} variant="success" />
        ) : null}
        {research.designStyleJudgement?.length ? (
          <InsightBlock title="设计风格判断" items={research.designStyleJudgement} field="designStyleJudgement" research={research} variant="secondary" />
        ) : null}
        <InsightBlock title="竞品标题风格" items={research.competitorTitleStyles} field="competitorTitleStyles" research={research} variant="success" />
        <InsightBlock title="视觉风格方向" items={research.visualStyles} field="visualStyles" research={research} variant="secondary" />
        {research.competitorVisualBenchmarks?.length ? (
          <InsightBlock title="竞品视觉标杆" items={research.competitorVisualBenchmarks} field="competitorVisualBenchmarks" research={research} variant="outline" />
        ) : null}
        {research.designStrategyNotes?.length ? (
          <InsightBlock title="设计策略笔记" items={research.designStrategyNotes} field="designStrategyNotes" research={research} variant="default" />
        ) : null}
        {research.competitorAnalysis ? (
          <div className="rounded-md border bg-slate-50/70 p-3">
            <p className="text-sm font-semibold text-slate-950">竞品拆解摘要</p>
            <div className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
              <p>样本数量：{research.competitorAnalysis.competitorCount}</p>
              {research.competitorAnalysis.mainImagePatterns.length ? (
                <p>主图规律：{research.competitorAnalysis.mainImagePatterns.join("、")}</p>
              ) : null}
              {research.competitorAnalysis.differentiationOpportunities.length ? (
                <p>差异化机会：{research.competitorAnalysis.differentiationOpportunities.join("；")}</p>
              ) : null}
              <p>{research.competitorAnalysis.evidenceNote}</p>
            </div>
          </div>
        ) : null}
        {research.reviewInsight ? (
          <div className="rounded-md border bg-slate-50/70 p-3">
            <p className="text-sm font-semibold text-slate-950">用户评论洞察</p>
            <div className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
              <p>评论样本数量：{research.reviewInsight.reviewCount}</p>
              {research.reviewInsight.topPurchaseReasons.length ? (
                <p>购买理由：{research.reviewInsight.topPurchaseReasons.join("、")}</p>
              ) : null}
              {research.reviewInsight.topPainPoints.length ? (
                <p>用户痛点：{research.reviewInsight.topPainPoints.join("、")}</p>
              ) : null}
              {research.reviewInsight.userConcerns.length ? (
                <p>用户顾虑：{research.reviewInsight.userConcerns.join("、")}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
