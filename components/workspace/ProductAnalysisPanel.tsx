"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProductAnalysis } from "@/lib/types";

type ProductAnalysisPanelProps = {
  analysis: ProductAnalysis | null;
};

function isFallbackAnalysis(analysis: ProductAnalysis) {
  const values = [
    analysis.category,
    analysis.productNameGuess,
    ...analysis.appearance,
    ...analysis.visibleFeatures,
    ...analysis.materials,
    ...analysis.colors
  ];

  return values.some((value) =>
    /待识别产品|保持上传参考图|参考产品图片|结合产品图可见结构/.test(value)
  );
}

function TagList({
  items,
  variant = "default"
}: {
  items: string[];
  variant?: "default" | "violet" | "success" | "secondary" | "outline";
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item} variant={variant}>
          {item}
        </Badge>
      ))}
    </div>
  );
}

function OptionalTagBlock({
  title,
  items,
  variant = "secondary"
}: {
  title: string;
  items?: string[];
  variant?: "default" | "violet" | "success" | "secondary" | "outline";
}) {
  if (!items?.length) {
    return null;
  }

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-950">{title}</p>
      <TagList items={items} variant={variant} />
    </div>
  );
}

export function ProductAnalysisPanel({ analysis }: ProductAnalysisPanelProps) {
  if (!analysis) {
    return (
      <EmptyState
        title="等待产品识别"
        description="上传图片并开始分析后，这里会展示品类、外观特征、可见功能和风格关键词。"
      />
    );
  }

  if (isFallbackAnalysis(analysis)) {
    return (
      <EmptyState
        title="产品识别未成功"
        description="当前结果是旧的兜底内容，不是 API 模型真实识别结果。请刷新后重新分析；如果仍失败，请检查当前模型接入点是否支持图片理解。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>识别结果</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-primary/5 p-4">
            <p className="text-xs font-medium text-muted-foreground">产品品类</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xl font-semibold text-slate-950">{analysis.category}</p>
              <Badge variant="success">结构化 JSON</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">产品名称猜测：{analysis.productNameGuess}</p>
            {analysis.brandNames?.chinese || analysis.brandNames?.english ? (
              <p className="mt-1 text-sm text-muted-foreground">
                品牌识别：
                {[analysis.brandNames.chinese, analysis.brandNames.english].filter(Boolean).join(" / ")}
              </p>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-950">外观信息</p>
            <TagList items={analysis.appearance} />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-950">可见功能</p>
            <TagList items={analysis.visibleFeatures} variant="violet" />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-950">材质判断</p>
            <TagList items={analysis.materials} variant="secondary" />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-950">颜色</p>
            <TagList items={analysis.colors} variant="outline" />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-950">风格关键词</p>
            <TagList items={analysis.styleKeywords} variant="success" />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-950">识别风险</p>
            <TagList items={analysis.risks} variant="secondary" />
          </div>

          <OptionalTagBlock title="品牌标志风格" items={analysis.brandVisualStyle} variant="outline" />
          <OptionalTagBlock title="规格/包装文字" items={analysis.specifications} variant="secondary" />
          <OptionalTagBlock title="卖点提取" items={analysis.sellingPoints} variant="default" />
          <OptionalTagBlock title="数据卖点" items={analysis.dataSellingPoints} variant="violet" />
          <OptionalTagBlock title="目标受众推断" items={analysis.targetAudience} variant="success" />
          <OptionalTagBlock title="产品参数/说明" items={analysis.parameters} variant="secondary" />
          <OptionalTagBlock title="产品细节识别" items={analysis.productDetails} variant="outline" />

          {analysis.visualAnchor ? (
            <div className="rounded-md border bg-blue-50/50 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-950">产品外观锚点</p>
              <div className="space-y-2 text-xs leading-5 text-slate-700">
                <p>主体轮廓：{analysis.visualAnchor.categoryShape}</p>
                <p>
                  颜色：{analysis.visualAnchor.mainColor}
                  {analysis.visualAnchor.secondaryColor ? ` / ${analysis.visualAnchor.secondaryColor}` : ""}
                </p>
                {analysis.visualAnchor.materialLook ? <p>材质：{analysis.visualAnchor.materialLook}</p> : null}
                {analysis.visualAnchor.keyParts.length ? (
                  <p>关键部件：{analysis.visualAnchor.keyParts.join("、")}</p>
                ) : null}
                {analysis.visualAnchor.mustAvoid.length ? (
                  <p>避免：{analysis.visualAnchor.mustAvoid.join("；")}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {analysis.specialRequirements ? (
            <div className="rounded-md bg-muted/60 p-3">
              <p className="text-xs font-medium text-muted-foreground">特殊需求判断</p>
              <p className="mt-2 text-sm leading-6 text-slate-800">
                模特：{analysis.specialRequirements.needModel || "未判断"}；场景：
                {analysis.specialRequirements.needScene || "未判断"}；数据可视化：
                {analysis.specialRequirements.needDataVisualization || "未判断"}
              </p>
              {analysis.specialRequirements.others?.length ? (
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  其他：{analysis.specialRequirements.others.join("、")}
                </p>
              ) : null}
            </div>
          ) : null}

          {analysis.visualStyleSystem ? (
            <div className="rounded-md border bg-white p-3">
              <p className="mb-3 text-sm font-semibold text-slate-950">视觉风格体系</p>
              <div className="space-y-3">
                <OptionalTagBlock title="整体调性" items={analysis.visualStyleSystem.overallTone} variant="default" />
                <OptionalTagBlock title="画面质感" items={analysis.visualStyleSystem.imageTexture} variant="secondary" />
                <OptionalTagBlock title="布光逻辑" items={analysis.visualStyleSystem.lightingLogic} variant="outline" />
                <OptionalTagBlock title="色彩体系" items={analysis.visualStyleSystem.colorSystem} variant="violet" />
                <OptionalTagBlock title="字体规范" items={analysis.visualStyleSystem.typographyRules} variant="success" />
                <OptionalTagBlock title="构图规范" items={analysis.visualStyleSystem.compositionRules} variant="secondary" />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
