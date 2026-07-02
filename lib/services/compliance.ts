import type {
  DetailPagePlan,
  GeneratedPrompt,
  MainImagePlan,
  MarketResearch,
  PlanCopywriting,
  ProductAnalysis,
  PromptTextLayer
} from "@/lib/types";
import {
  sanitizeBackgroundPrompt as sanitizeGuardedBackgroundPrompt,
  sanitizeTextLayer as sanitizeGuardedTextLayer
} from "@/lib/services/copywriting-guardrails";
import { compactNegativePrompt, dedupePromptSegments } from "@/lib/services/prompt-compaction";

const complianceReplacements: Array<[RegExp, string]> = [
  [/替代空调/g, "辅助降温"],
  [/空调替代/g, "辅助降温"],
  [/国家级/g, "专业"],
  [/世界级/g, "高标准"],
  [/行业第一|全网第一|排名第一|第一/g, "表现靠前"],
  [/NO\.?1/gi, "优选"],
  [/顶级/g, "高品质"],
  [/绝对/g, "更"],
  [/100%/g, "充分"],
  [/保证/g, "帮助"],
  [/治疗/g, "护理"],
  [/治愈/g, "改善体验"],
  [/药用/g, "日常护理"],
  [/防病/g, "健康管理"],
  [/根治/g, "持续改善"],
  [/终身不坏/g, "耐用省心"],
  [/永久有效/g, "长期可用"],
  [/无效退款/g, "售后规则以店铺说明为准"],
  [/官方认证/g, "资质信息"],
  [/销量\s*\d+[^\s，。；;]*/g, "用户关注度"],
  [/排名榜单/g, "对比参考"]
];

const genericExtremeMatcher = /最(?!后|终)/g;
const trustEvidenceMatcher =
  /认证|证书|质检|检测|报告|专利|售后|保修|质保|退换|保障|许可证|3C|CCC|CE|FDA|有机|无添加|进口|用户评价|晒图|证言|品牌背书|工厂|产线/i;
const reliableParameterMatcher =
  /\d+\s*(?:w|W|cm|mm|mAh|v|V|kg|g|ml|ML|l|L|升|分钟|小时|分贝|db|dB|%|℃|度|档|叶|片)/;
const fakeTrustVisualMatcher =
  /证书|公章|检测报告|质检报告|奖章|专利文件|排名榜单|销量榜|权威认证/g;
const promptTextInstructionMatcher =
  /(?:证书文字|公章文字|检测报告文字)[^。；;]*[。；;]?/gi;

export const backgroundNegativePrompt =
  "产品变形，比例异常，结构改变，材质失真，文字乱码，错别字，文字模糊，水印，logo错位，背景杂乱，光影不统一，产品遮挡文字，证书，公章，检测报告，虚假数据";

export function sanitizeComplianceText(text: string | undefined) {
  const source = text ?? "";
  return complianceReplacements
    .reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), source)
    .replace(genericExtremeMatcher, "更")
    .replace(/\[待确认\]|\[需确认\]|待确认|需人工复核|需要人工复核/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；、,.])/g, "$1")
    .trim();
}

export function sanitizeComplianceList(items: string[] | undefined) {
  return Array.from(new Set((items ?? []).map(sanitizeComplianceText).filter(Boolean)));
}

export function sanitizeCopywriting(copy: PlanCopywriting): PlanCopywriting {
  return {
    headline: sanitizeComplianceText(copy.headline),
    subheadline: copy.subheadline ? sanitizeComplianceText(copy.subheadline) : undefined,
    body: copy.body
      ? copy.body
          .split("\n")
          .map(sanitizeComplianceText)
          .filter(Boolean)
          .join("\n")
      : undefined
  };
}

export function sanitizePlanCompliance<TPlan extends MainImagePlan | DetailPagePlan>(plan: TPlan): TPlan {
  return {
    ...plan,
    title: sanitizeComplianceText(plan.title),
    goal: sanitizeComplianceText(plan.goal),
    layout: sanitizeComplianceText(plan.layout),
    imageBrief: plan.imageBrief ? sanitizeComplianceText(plan.imageBrief) : undefined,
    textImageLayout: plan.textImageLayout ? sanitizeComplianceText(plan.textImageLayout) : undefined,
    visualFocus: plan.visualFocus ? sanitizeComplianceText(plan.visualFocus) : undefined,
    copywriting: sanitizeCopywriting(plan.copywriting),
    visualElements: sanitizeComplianceList(plan.visualElements),
    visualGuidelines: plan.visualGuidelines
      ? {
          overallTone: sanitizeComplianceText(plan.visualGuidelines.overallTone),
          imageTexture: sanitizeComplianceText(plan.visualGuidelines.imageTexture),
          lightingLogic: sanitizeComplianceText(plan.visualGuidelines.lightingLogic),
          colorPaletteSystem: sanitizeComplianceText(plan.visualGuidelines.colorPaletteSystem),
          typographyRules: sanitizeComplianceText(plan.visualGuidelines.typographyRules),
          compositionRules: sanitizeComplianceText(plan.visualGuidelines.compositionRules),
          productAppearanceFeatures: sanitizeComplianceText(plan.visualGuidelines.productAppearanceFeatures),
          unifiedVisualStyle: sanitizeComplianceText(plan.visualGuidelines.unifiedVisualStyle)
        }
      : undefined
  };
}

export function hasRealTrustEvidence(
  product: ProductAnalysis,
  market: MarketResearch,
  manualNotes?: string
) {
  return [
    ...(product.specifications ?? []),
    ...(product.parameters ?? []),
    ...(product.dataSellingPoints ?? []),
    ...(market.certificationSellingPoints ?? []),
    ...(market.userFeedbackPros ?? []),
    ...(market.designStrategyNotes ?? []),
    manualNotes ?? ""
  ].some((item) => trustEvidenceMatcher.test(item));
}

export function hasReliableParameters(product: ProductAnalysis, market: MarketResearch) {
  return [
    ...(product.specifications ?? []),
    ...(product.parameters ?? []),
    ...(product.dataSellingPoints ?? []),
    ...(market.dataSellingPointInsights ?? []),
    ...(market.productParameterInsights ?? [])
  ].some((item) => reliableParameterMatcher.test(item) && !/待确认|需确认|以商家资料|补充/.test(item));
}

export function sanitizeBackgroundPrompt(text: string, textLayer?: PromptTextLayer) {
  let cleaned = sanitizeGuardedBackgroundPrompt(sanitizeComplianceText(text), textLayer)
    .replace(promptTextInstructionMatcher, "")
    .replace(fakeTrustVisualMatcher, "资质信息卡片区域，不生成证书、公章或检测报告")
    .replace(/后期文字层|后期文字区域|后期排版区域/g, "文字排版区域")
    .replace(/Logo|品牌字样|品牌\s*Logo\s*位|Logo位/gi, "品牌安全留白区，不额外生成Logo或品牌字样")
    .replace(/无文字(?:信息卡片底板|线性图标容器|图形标签容器)/g, "信息卡片、线性图标和图形标签容器")
    .replace(/数字卖点|数据文字/g, "图形化重点信息");

  return dedupePromptSegments(cleaned, { maxChars: 900 });
}

export function sanitizeTextLayer(layer: PromptTextLayer): PromptTextLayer {
  const guarded = sanitizeGuardedTextLayer(layer);

  return {
    headline: guarded.headline ? sanitizeComplianceText(guarded.headline) : undefined,
    subheadline: guarded.subheadline ? sanitizeComplianceText(guarded.subheadline) : undefined,
    body: guarded.body
      ? guarded.body
          .split("\n")
          .map(sanitizeComplianceText)
          .filter(Boolean)
          .join("\n")
      : undefined,
    labels: sanitizeComplianceList(guarded.labels),
    cta: guarded.cta ? sanitizeComplianceText(guarded.cta) : undefined,
    layoutHint: guarded.layoutHint ? sanitizeComplianceText(guarded.layoutHint) : undefined
  };
}

export function sanitizeGeneratedPromptCompliance(prompt: GeneratedPrompt): GeneratedPrompt {
  const textLayer = sanitizeTextLayer(prompt.textLayer);
  return {
    ...prompt,
    title: sanitizeComplianceText(prompt.title),
    backgroundPrompt: sanitizeBackgroundPrompt(prompt.backgroundPrompt, textLayer),
    textLayer,
    negativePrompt: compactNegativePrompt(sanitizeComplianceText(`${prompt.negativePrompt}，${backgroundNegativePrompt}`))
  };
}
