import type {
  DetailPagePlan,
  GenerationMeta,
  GenerationMetaMap,
  GeneratedPrompt,
  GlobalAnalysisStatus,
  MainImagePlan,
  MarketResearch,
  OutputScope,
  PlanVisualGuidelines,
  PlanningSession,
  ProductManualInfo,
  ProductAnalysis,
  SellingPointAsset,
  WorkflowStepStates
} from "@/lib/types";
import { filterForbiddenItems, formatEvidenceTag } from "@/lib/evidence";
import { sanitizeComplianceText } from "@/lib/services/compliance";
import {
  sanitizeBackgroundPrompt,
  sanitizeCopywritingOutput,
  sanitizeMarkdownExport,
  sanitizeTextLayer,
  validateUserBenefit
} from "@/lib/services/copywriting-guardrails";
import { formatPromptForDelivery } from "@/lib/prompt-delivery-format";
import { buildCompetitorAnalysis } from "@/lib/services/competitor-analysis";
import { formatCompactProductVisualAnchor } from "@/lib/services/product-visual-anchor";
import { buildReviewInsight } from "@/lib/services/review-insight";
import { buildUserDecisionPath } from "@/lib/services/user-decision-path";
import type { EvidenceMap, MarketEvidenceField, ProductEvidenceField } from "@/lib/types";

type ExportInput = {
  imageName?: string | null;
  manualProductInfo?: ProductManualInfo;
  productAnalysis: ProductAnalysis | null;
  marketResearch: MarketResearch | null;
  mainImages: MainImagePlan[];
  detailPages: DetailPagePlan[];
  prompts: GeneratedPrompt[];
  outputScope?: OutputScope;
  globalStatus?: GlobalAnalysisStatus;
  stepStates?: WorkflowStepStates;
  isMockMode?: boolean;
  generationMeta?: GenerationMetaMap;
  planningSession?: PlanningSession;
};

function list(items: string[]) {
  return items.map((item) => `- ${sanitizeComplianceText(item)}`).join("\n");
}

function evidenceList<TField extends string>(
  items: string[] | undefined,
  evidence: EvidenceMap<TField> | undefined,
  field: TField
) {
  const visibleItems = filterForbiddenItems(items, evidence, field);

  if (!visibleItems.length) {
    return "- 暂无可用信息";
  }

  return visibleItems
    .map((item, visibleIndex) => {
      const originalIndex = (items ?? []).findIndex((candidate) => candidate === item);
      const info = evidence?.[field]?.[originalIndex >= 0 ? originalIndex : visibleIndex];
      return `- ${sanitizeComplianceText(item)}（${formatEvidenceTag(info)}）`;
    })
    .join("\n");
}

function compactText(text: string | undefined, max = 120) {
  const clean = sanitizeComplianceText(text)
    .replace(/\s+/g, " ")
    .replace(/^(整体调性|画面质感|布光逻辑|色彩配色体系|字体规范|构图规范|统一视觉风格)\s*[:：]\s*/, "")
    .trim();

  return Array.from(clean).slice(0, max).join("");
}

function renderVisualGuidelines(guidelines?: PlanVisualGuidelines) {
  if (!guidelines) {
    return "";
  }

  return [
    "- 视觉规范：",
    `  - 风格：${compactText(guidelines.overallTone, 80)}`,
    `  - 光影/质感：${compactText(`${guidelines.imageTexture}；${guidelines.lightingLogic}`, 110)}`,
    `  - 色彩：${compactText(guidelines.colorPaletteSystem, 80)}`,
    `  - 排版：标题顶部左对齐，思源黑体/HarmonyOS Sans，留白充足，文案不遮挡产品`,
    `  - 外观锁定：${compactText(guidelines.productAppearanceFeatures, 90)}`
  ].join("\n");
}

function renderVisualStyleSystem(productAnalysis: ProductAnalysis | null) {
  const style = productAnalysis?.visualStyleSystem;

  if (!style) {
    return "暂无视觉风格体系。";
  }

  return [
    "### 整体调性",
    list(style.overallTone),
    "",
    "### 画面质感",
    list(style.imageTexture),
    "",
    "### 布光逻辑",
    list(style.lightingLogic),
    "",
    "### 色彩体系",
    list(style.colorSystem),
    "",
    "### 字体规范",
    list(style.typographyRules),
    "",
    "### 构图规范",
    list(style.compositionRules)
  ].join("\n");
}

function renderMainPlan(plan: MainImagePlan) {
  const copywriting = sanitizeCopywritingOutput(plan.copywriting, {
    assignedSellingPoint: plan.assignedSellingPoint,
    fallbackPoint: plan.assignedSellingPoint?.name,
    evidenceLevel: plan.assignedSellingPoint?.evidenceLevel
  });
  const displayTitle = sanitizeComplianceText(copywriting.headline || plan.title);
  return [
    `### 主图 ${plan.index}. ${displayTitle}`,
    plan.role ? `- 角色：${sanitizeComplianceText(plan.role)}` : "",
    plan.primaryClickReason ? `- 主点击理由：${sanitizeComplianceText(plan.primaryClickReason)}` : "",
    plan.expressionMethod ? `- 表达方式：${sanitizeComplianceText(plan.expressionMethod)}` : "",
    plan.productSizeRatio ? `- 产品占比：${plan.productSizeRatio}` : "",
    plan.compositionRule ? `- 构图规则：${sanitizeComplianceText(plan.compositionRule)}` : "",
    plan.proofOrBoundary ? `- 证据边界：${sanitizeComplianceText(plan.proofOrBoundary)}` : "",
    plan.clickTriggerExplanation ? `- 点击触发解释：${sanitizeComplianceText(plan.clickTriggerExplanation)}` : "",
    plan.assignedSellingPoint
      ? `- 本图卖点：${sanitizeComplianceText(plan.assignedSellingPoint.name)}（${plan.assignedSellingPoint.priority}/${plan.assignedSellingPoint.evidenceLevel}/${plan.assignedSellingPoint.source}）`
      : "",
    `- 目标：${sanitizeComplianceText(plan.goal)}`,
    `- 场景：${sanitizeComplianceText(plan.scene)}`,
    `- 版式：${sanitizeComplianceText(plan.layout)}`,
    plan.imageBrief ? `- 配图说明：${sanitizeComplianceText(plan.imageBrief)}` : "",
    plan.textImageLayout ? `- 图文排版关系：${sanitizeComplianceText(plan.textImageLayout)}` : "",
    plan.visualFocus ? `- 视觉重心：${sanitizeComplianceText(plan.visualFocus)}` : "",
    renderVisualGuidelines(plan.visualGuidelines),
    `- 主标题：${sanitizeComplianceText(copywriting.headline)}`,
    copywriting.subheadline ? `- 副标题：${sanitizeComplianceText(copywriting.subheadline)}` : "",
    copywriting.body ? `- 正文：${sanitizeComplianceText(copywriting.body)}` : "",
    `- 视觉元素：${plan.visualElements.map(sanitizeComplianceText).join("、")}`
  ]
    .filter(Boolean)
    .join("\n");
}

function renderDetailPlan(plan: DetailPagePlan) {
  const copywriting = sanitizeCopywritingOutput(plan.copywriting, {
    assignedSellingPoint: plan.assignedSellingPoint,
    fallbackPoint: plan.assignedSellingPoint?.name,
    evidenceLevel: plan.assignedSellingPoint?.evidenceLevel
  });
  const displayTitle = sanitizeComplianceText(copywriting.headline || plan.title);
  return [
    `### 详情页 ${plan.index}. ${displayTitle}`,
    plan.screenRole ? `- 漏斗角色：${sanitizeComplianceText(plan.screenRole)}（${plan.funnelStage ?? "need"}）` : "",
    plan.userQuestionAnswered ? `- 回答用户问题：${sanitizeComplianceText(plan.userQuestionAnswered)}` : "",
    plan.conversionPurpose ? `- 转化目的：${sanitizeComplianceText(plan.conversionPurpose)}` : "",
    plan.proofOrBoundary ? `- 证据边界：${sanitizeComplianceText(plan.proofOrBoundary)}` : "",
    plan.assignedSellingPoint
      ? `- 本屏卖点：${sanitizeComplianceText(plan.assignedSellingPoint.name)}（${plan.assignedSellingPoint.priority}/${plan.assignedSellingPoint.evidenceLevel}/${plan.assignedSellingPoint.source}）`
      : "",
    plan.structureMode ? `- 详情页版本：${plan.structureMode === "full" ? "完整版" : plan.structureMode === "lightweight" ? "轻量版" : "裁剪版"}` : "",
    plan.structureNote ? `- 裁剪说明：${sanitizeComplianceText(plan.structureNote)}` : "",
    `- 目标：${sanitizeComplianceText(plan.goal)}`,
    `- 版式：${sanitizeComplianceText(plan.layout)}`,
    plan.imageBrief ? `- 配图说明：${sanitizeComplianceText(plan.imageBrief)}` : "",
    plan.textImageLayout ? `- 图文排版关系：${sanitizeComplianceText(plan.textImageLayout)}` : "",
    plan.visualFocus ? `- 视觉重心：${sanitizeComplianceText(plan.visualFocus)}` : "",
    renderVisualGuidelines(plan.visualGuidelines),
    `- 标题：${sanitizeComplianceText(copywriting.headline)}`,
    copywriting.subheadline ? `- 副标题：${sanitizeComplianceText(copywriting.subheadline)}` : "",
    copywriting.body ? `- 正文：${sanitizeComplianceText(copywriting.body)}` : "",
    `- 视觉元素：${plan.visualElements.map(sanitizeComplianceText).join("、")}`
  ]
    .filter(Boolean)
    .join("\n");
}

function renderPrompt(prompt: GeneratedPrompt) {
  const textLayer = sanitizeTextLayer(prompt.textLayer);
  const backgroundPrompt = sanitizeBackgroundPrompt(prompt.backgroundPrompt, textLayer);
  const displayTitle = sanitizeComplianceText(textLayer.headline || prompt.title);

  return [
    `### ${prompt.imageType === "main_image" ? "主图" : "详情页"} ${prompt.index}. ${displayTitle}`,
    formatPromptForDelivery({
      ...prompt,
      backgroundPrompt,
      textLayer
    })
  ].filter(Boolean).join("\n");
}

function isSellingPointAsset(asset: SellingPointAsset | undefined): asset is SellingPointAsset {
  return Boolean(asset);
}

function renderSellingPointAssets(mainImages: MainImagePlan[], detailPages: DetailPagePlan[]) {
  const assets = [...mainImages, ...detailPages]
    .map((plan) => plan.assignedSellingPoint)
    .filter(isSellingPointAsset);
  const unique = new Map<string, SellingPointAsset>();

  for (const asset of assets) {
    if (!unique.has(asset.name)) unique.set(asset.name, asset);
  }

  if (!unique.size) {
    return "暂无卖点资产池摘要。";
  }

  return Array.from(unique.values())
    .map((asset) =>
      [
        `- ${sanitizeComplianceText(asset.name)}｜${asset.priority}｜证据 ${asset.evidenceLevel}｜来源 ${asset.source}`,
        `  - Feature：${sanitizeComplianceText(asset.feature || asset.name)}`,
        asset.advantage ? `  - Advantage：${sanitizeComplianceText(asset.advantage)}` : "",
        `  - Benefit：${validateUserBenefit(asset.userBenefit).passed ? sanitizeComplianceText(asset.userBenefit ?? "") : "需补充更具体使用场景"}`,
        asset.scene ? `  - Scene：${sanitizeComplianceText(asset.scene)}` : "",
        asset.emotionalTrigger ? `  - Emotion：${sanitizeComplianceText(asset.emotionalTrigger)}` : "",
        asset.claimBoundary ? `  - Boundary：${sanitizeComplianceText(asset.claimBoundary)}` : ""
      ].filter(Boolean).join("\n")
    )
    .join("\n");
}

function renderUserDecisionPath(input: ExportInput) {
  if (!input.productAnalysis || !input.marketResearch) {
    return "暂无用户决策路径。";
  }

  const competitorAnalysis = input.marketResearch.competitorAnalysis ?? buildCompetitorAnalysis(input.manualProductInfo, input.marketResearch);
  const reviewInsight = input.marketResearch.reviewInsight ?? buildReviewInsight(input.manualProductInfo, input.marketResearch);
  const path = buildUserDecisionPath({
    product: input.productAnalysis,
    market: input.marketResearch,
    manualProductInfo: input.manualProductInfo,
    competitorAnalysis,
    reviewInsight
  });

  return [
    `- 品类判断：${sanitizeComplianceText(path.productCategory)}`,
    `- 产品类型：${sanitizeComplianceText(path.productType)}`,
    path.userSegments.length ? `- 目标人群：${path.userSegments.map(sanitizeComplianceText).join("、")}` : "",
    "",
    "### 决策链路",
    list(path.decisionPath),
    "",
    "### 用户核心问题",
    list(path.coreQuestions),
    "",
    "### 购买触发",
    path.purchaseTriggers.length ? list(path.purchaseTriggers) : "- 样本有限，需补充竞品或评论资料",
    "",
    "### 犹豫点",
    path.hesitationPoints.length ? list(path.hesitationPoints) : "- 样本有限，需补充用户反馈资料",
    "",
    `> 证据边界：${sanitizeComplianceText(path.evidenceBoundary)}`
  ].filter(Boolean).join("\n");
}

function renderMainClickReason(mainImages: MainImagePlan[]) {
  const first = mainImages[0];
  const reason = first?.mainClickReason;

  if (!first) {
    return "暂无唯一主点击理由。";
  }

  return [
    `- 唯一主点击理由：${sanitizeComplianceText(reason?.primaryClickReason ?? first.primaryClickReason ?? first.copywriting.headline)}`,
    `- 表达方式：${sanitizeComplianceText(reason?.expressionMethod ?? first.expressionMethod ?? "scene")}`,
    `- 绑定卖点资产：${sanitizeComplianceText(reason?.selectedSellingPointAssetId ?? first.assignedSellingPoint?.name ?? "未分配")}`,
    `- 用户痛点：${sanitizeComplianceText(reason?.userPainPoint ?? first.assignedSellingPoint?.painPoint ?? "样本有限，需补充")}`,
    `- 预期利益：${sanitizeComplianceText(reason?.expectedUserBenefit ?? first.assignedSellingPoint?.userBenefit ?? first.copywriting.subheadline ?? "待补充")}`,
    `- 证据边界：${sanitizeComplianceText(reason?.proofOrBoundary ?? first.proofOrBoundary ?? "按已提供信息保守表达")}`,
    `- 点击解释：${sanitizeComplianceText(reason?.whyThisWillTriggerClick ?? first.clickTriggerExplanation ?? "首图只讲一个点击理由")}`
  ].join("\n");
}

function renderTopReviewAndCompetitor(input: ExportInput) {
  if (!input.marketResearch) {
    return "暂无竞品和评论分析。";
  }

  const competitorAnalysis = input.marketResearch.competitorAnalysis ?? buildCompetitorAnalysis(input.manualProductInfo, input.marketResearch);
  const reviewInsight = input.marketResearch.reviewInsight ?? buildReviewInsight(input.manualProductInfo, input.marketResearch);

  return [
    "### 竞品拆解摘要",
    `- 样本数量：${competitorAnalysis.competitorCount}`,
    competitorAnalysis.mainImagePatterns.length ? `- 主图视觉规律：${competitorAnalysis.mainImagePatterns.map(sanitizeComplianceText).join("、")}` : "- 主图视觉规律：样本有限，需补充竞品截图或文案",
    competitorAnalysis.titleKeywordLibrary.length ? `- 标题关键词：${competitorAnalysis.titleKeywordLibrary.map(sanitizeComplianceText).join("、")}` : "",
    competitorAnalysis.differentiationOpportunities.length ? `- 差异化机会：${competitorAnalysis.differentiationOpportunities.map(sanitizeComplianceText).join("；")}` : "",
    `- 证据说明：${sanitizeComplianceText(competitorAnalysis.evidenceNote)}`,
    "",
    "### 用户评论分析摘要",
    `- 评论样本数量：${reviewInsight.reviewCount}`,
    reviewInsight.topPurchaseReasons.length ? `- TOP5购买理由：${reviewInsight.topPurchaseReasons.map(sanitizeComplianceText).join("、")}` : "- TOP5购买理由：样本有限，需补充评论文本",
    reviewInsight.topPainPoints.length ? `- TOP10用户痛点：${reviewInsight.topPainPoints.map(sanitizeComplianceText).join("、")}` : "- TOP10用户痛点：样本有限，需补充差评/问答文本",
    reviewInsight.userConcerns.length ? `- 用户顾虑：${reviewInsight.userConcerns.map(sanitizeComplianceText).join("、")}` : "",
    reviewInsight.usageScenarios.length ? `- 真实使用场景：${reviewInsight.usageScenarios.map(sanitizeComplianceText).join("、")}` : ""
  ].filter(Boolean).join("\n");
}

function renderDetailFunnel(detailPages: DetailPagePlan[]) {
  if (!detailPages.length) {
    return "暂无详情页销售漏斗。";
  }

  return detailPages
    .map((plan) =>
      [
        `- 第 ${plan.index} 屏｜${sanitizeComplianceText(plan.screenRole ?? plan.title)}｜${plan.funnelStage ?? "need"}`,
        `  - 回答问题：${sanitizeComplianceText(plan.userQuestionAnswered ?? "本屏要解决一个明确购买问题")}`,
        `  - 转化目的：${sanitizeComplianceText(plan.conversionPurpose ?? plan.goal)}`,
        `  - 证据边界：${sanitizeComplianceText(plan.proofOrBoundary ?? "按已有信息保守表达")}`
      ].join("\n")
    )
    .join("\n");
}

function renderConversionSuggestions(mainImages: MainImagePlan[], detailPages: DetailPagePlan[]) {
  return [
    "- 主图首图保持一个主点击理由，不把详情页长文案压进货架首图。",
    "- 详情页前3屏优先完成代入、痛点和解决方案，不提前堆参数表。",
    "- 每屏只讲一个购买理由，已用过的卖点换场景或证据表达，避免重复消耗。",
    "- 没有真实评论、证书、销量、检测报告时，只做顾虑回应或素材占位，不伪造成品证据。",
    mainImages.some((plan) => plan.expressionMethod === "number")
      ? "- 数字型主图必须保留来源和测试边界，避免把参数写成绝对体验。"
      : "",
    detailPages.some((plan) => plan.funnelStage === "risk_reversal")
      ? "- 风险降低屏建议补充真实售后规则、退换政策或用户提供的保障材料。"
      : ""
  ].filter(Boolean).join("\n");
}

function renderExportStatus(input: ExportInput) {
  const entries = input.stepStates ? Object.entries(input.stepStates) : [];
  const completed = entries.filter(([, state]) => state.status === "success").map(([key]) => key);
  const missing = entries.filter(([, state]) => state.status !== "success").map(([key]) => key);
  const metaEntries = (["product", "research", "style", "design", "prompts"] as const)
    .map((step) => input.generationMeta?.[step])
    .filter(Boolean) as GenerationMeta[];
  const containsMock = metaEntries.some((meta) => meta.usedMock || meta.sourceType === "mock");
  const containsFallback = metaEntries.some((meta) => meta.usedFallback || meta.sourceType === "template_fallback");
  const containsInference = metaEntries.some((meta) => meta.sourceType === "ai_inference" || meta.evidenceLevel === "C");
  const sourceLines = metaEntries.length
    ? metaEntries.map((meta) => {
        const sourceLabel =
          meta.sourceType === "real_ai"
            ? "真实 AI"
            : meta.sourceType === "web_search"
              ? "真实搜索"
              : meta.sourceType === "user_input"
                ? "用户输入"
                : meta.sourceType === "ai_inference"
                  ? "AI 推断"
                  : meta.sourceType === "mock"
                    ? "模拟数据"
                    : meta.sourceType === "template_fallback"
                      ? "模板兜底"
                      : "未生成";

        return `- ${meta.step}：${sourceLabel}｜AI：${meta.usedAI ? "是" : "否"}｜Mock：${meta.usedMock ? "是" : "否"}｜模板兜底：${meta.usedFallback ? "是" : "否"}${meta.note ? `｜${meta.note}` : ""}`;
      })
    : ["- 暂无步骤级来源记录"];

  return sanitizeMarkdownExport([
    `- 全局状态：${input.globalStatus ?? "unknown"}`,
    `- 已完成模块：${completed.length ? completed.join("、") : "未标注"}`,
    `- 缺失模块：${missing.length ? missing.join("、") : "无"}`,
    `- 数据来源声明：以步骤级来源为准，不再使用全局 Mock 开关判断整份方案。`,
    `- 是否包含 Mock / 模拟数据：${containsMock ? "是" : "否"}`,
    `- 是否包含模板兜底：${containsFallback ? "是" : "否"}`,
    `- 是否包含 AI 推断 / C 级信息：${containsInference ? "是" : "否"}`,
    "",
    "### 步骤级来源",
    sourceLines.join("\n")
  ].join("\n"));
}

function renderPlanningSession(session?: PlanningSession) {
  if (!session?.turns.length) {
    return "暂无多轮策划会话记录。";
  }

  return session.turns
    .map((turn, index) => {
      const source = turn.generationMeta
        ? `${turn.generationMeta.sourceType}｜证据：${turn.generationMeta.evidenceLevel ?? "未标注"}`
        : "来源待记录";

      return [
        `### 第 ${index + 1} 轮：${sanitizeComplianceText(turn.title)}`,
        `- 步骤：${turn.step}`,
        `- 状态：${turn.status}`,
        `- 来源：${source}`,
        `- 输入摘要：${sanitizeComplianceText(turn.inputSummary)}`,
        turn.outputSummary ? `- 输出结论：${sanitizeComplianceText(turn.outputSummary)}` : "",
        turn.errorMessage ? `- 错误信息：${sanitizeComplianceText(turn.errorMessage)}` : ""
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

export function buildProjectMarkdown(input: ExportInput) {
  const { imageName, manualProductInfo, productAnalysis, marketResearch, mainImages, detailPages, prompts } = input;
  const now = new Date().toLocaleString("zh-CN", {
    hour12: false
  });

  return sanitizeMarkdownExport([
    "# AI电商视觉策划方案",
    "",
    input.generationMeta && Object.values(input.generationMeta).some((meta) => meta.usedMock)
      ? "> 本方案包含模拟数据步骤，仅供测试与演示。请以“导出状态 / 步骤级来源”为准。"
      : "",
    "",
    `- 生成时间：${now}`,
    `- 产品图片：${imageName ?? "未命名图片"}`,
    `- 输出范围：${input.outputScope === "main_only" ? "仅主图策划与主图提示词" : input.outputScope === "detail_only" ? "仅详情页策划与详情页提示词" : "完整策划（主图 + 详情页 + 全部提示词）"}`,
    "",
    "## 导出状态",
    renderExportStatus(input),
    "",
    "## 多轮策划会话记录",
    renderPlanningSession(input.planningSession),
    "",
    "## 0. 用户补充信息",
    manualProductInfo && Object.values(manualProductInfo).some(Boolean)
      ? [
          manualProductInfo.productName ? `- 产品名称/型号：${manualProductInfo.productName}` : "",
          manualProductInfo.category ? `- 产品品类：${manualProductInfo.category}` : "",
          manualProductInfo.brand ? `- 品牌：${manualProductInfo.brand}` : "",
          manualProductInfo.productDriveType ? `- 商品驱动类型：${manualProductInfo.productDriveType === "emotional_aesthetic" ? "感性美学型" : "理性功能型"}` : "",
          manualProductInfo.targetPlatform ? `- 目标平台：${manualProductInfo.targetPlatform}` : "",
          manualProductInfo.priceRange ? `- 价格/销量线索：${manualProductInfo.priceRange}` : "",
          manualProductInfo.targetAudience ? `- 目标人群：${manualProductInfo.targetAudience}` : "",
          manualProductInfo.sellingPoints ? `- 已知卖点：${manualProductInfo.sellingPoints}` : "",
          manualProductInfo.competitorText ? `- 竞品/平台资料：${manualProductInfo.competitorText.slice(0, 500)}` : "",
          manualProductInfo.reviewText ? `- 用户评论/反馈资料：${manualProductInfo.reviewText.slice(0, 500)}` : "",
          manualProductInfo.notes ? `- 其他补充：${manualProductInfo.notes}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      : "暂无用户补充信息。",
    "",
	    "## 1. 产品识别",
	    productAnalysis
	      ? [
	          `- 产品品类：${sanitizeComplianceText(productAnalysis.category)}`,
	          `- 产品名称猜测：${sanitizeComplianceText(productAnalysis.productNameGuess)}`,
	          productAnalysis.visualAnchor
	            ? `- 产品外观锚点：${sanitizeComplianceText(formatCompactProductVisualAnchor(productAnalysis.visualAnchor))}`
	            : "",
	          "",
          "### 外观信息",
          evidenceList(productAnalysis.appearance, productAnalysis.evidence, "appearance" satisfies ProductEvidenceField),
          "",
          "### 可见功能",
          evidenceList(productAnalysis.visibleFeatures, productAnalysis.evidence, "visibleFeatures" satisfies ProductEvidenceField),
          "",
          "### 材质判断",
          evidenceList(productAnalysis.materials, productAnalysis.evidence, "materials" satisfies ProductEvidenceField),
          "",
          "### 颜色",
          evidenceList(productAnalysis.colors, productAnalysis.evidence, "colors" satisfies ProductEvidenceField),
          "",
          "### 风格关键词",
          evidenceList(productAnalysis.styleKeywords, productAnalysis.evidence, "styleKeywords" satisfies ProductEvidenceField),
          "",
          "### 识别风险",
          evidenceList(productAnalysis.risks, productAnalysis.evidence, "risks" satisfies ProductEvidenceField)
        ].join("\n")
      : "暂无产品识别结果。",
    "",
    "## 2. 视觉风格体系",
    renderVisualStyleSystem(productAnalysis),
    "",
    "## 3. 卖点受众分析",
    marketResearch
      ? [
          "### 热门卖点",
          evidenceList(marketResearch.hotSellingPoints, marketResearch.evidence, "hotSellingPoints" satisfies MarketEvidenceField),
          "",
          "### 用户反馈痛点问题",
          evidenceList(marketResearch.userPainPoints, marketResearch.evidence, "userPainPoints" satisfies MarketEvidenceField),
          "",
          marketResearch.userFeedbackPros?.length
            ? ["### 用户反馈优点", evidenceList(marketResearch.userFeedbackPros, marketResearch.evidence, "userFeedbackPros" satisfies MarketEvidenceField), ""].join("\n")
            : "",
          marketResearch.userFeedbackCons?.length
            ? ["### 用户反馈问题", evidenceList(marketResearch.userFeedbackCons, marketResearch.evidence, "userFeedbackCons" satisfies MarketEvidenceField), ""].join("\n")
            : "",
          marketResearch.targetAudienceInsights?.length
            ? ["### 目标受众推断", evidenceList(marketResearch.targetAudienceInsights, marketResearch.evidence, "targetAudienceInsights" satisfies MarketEvidenceField), ""].join("\n")
            : "",
          marketResearch.productParameterInsights?.length
            ? ["### 产品参数提取", evidenceList(marketResearch.productParameterInsights, marketResearch.evidence, "productParameterInsights" satisfies MarketEvidenceField), ""].join("\n")
            : "",
          marketResearch.productDetailInsights?.length
            ? ["### 产品细节识别", evidenceList(marketResearch.productDetailInsights, marketResearch.evidence, "productDetailInsights" satisfies MarketEvidenceField), ""].join("\n")
            : "",
          marketResearch.designStyleJudgement?.length
            ? ["### 设计风格判断", evidenceList(marketResearch.designStyleJudgement, marketResearch.evidence, "designStyleJudgement" satisfies MarketEvidenceField), ""].join("\n")
            : "",
          "### 竞品标题风格",
          evidenceList(marketResearch.competitorTitleStyles, marketResearch.evidence, "competitorTitleStyles" satisfies MarketEvidenceField),
          "",
          "### 视觉风格",
          evidenceList(marketResearch.visualStyles, marketResearch.evidence, "visualStyles" satisfies MarketEvidenceField),
          "",
          marketResearch.competitorVisualBenchmarks?.length
            ? ["### 竞品视觉标杆", evidenceList(marketResearch.competitorVisualBenchmarks, marketResearch.evidence, "competitorVisualBenchmarks" satisfies MarketEvidenceField), ""].join("\n")
            : "",
          marketResearch.designStrategyNotes?.length
            ? ["### 设计策略笔记", evidenceList(marketResearch.designStrategyNotes, marketResearch.evidence, "designStrategyNotes" satisfies MarketEvidenceField), ""].join("\n")
            : "",
          marketResearch.sourceNote ? `> ${marketResearch.sourceNote}` : ""
        ].join("\n")
      : "暂无卖点受众分析结果。",
    "",
    "## 4. 用户决策路径",
    renderUserDecisionPath(input),
    "",
    "## 5. 竞品拆解与评论洞察",
    renderTopReviewAndCompetitor(input),
    "",
    "## 6. 卖点资产池摘要",
    renderSellingPointAssets(mainImages, detailPages),
    "",
    "## 7. 唯一主点击理由",
    renderMainClickReason(mainImages),
    "",
    "## 8. 主图点击策略",
    mainImages.length ? mainImages.map(renderMainPlan).join("\n\n") : "暂无主图方案。",
    "",
    "## 9. 详情页销售漏斗",
    renderDetailFunnel(detailPages),
    "",
    "## 10. 详情页策划方案",
    detailPages.length ? detailPages.map(renderDetailPlan).join("\n\n") : "暂无详情页方案。",
    "",
    "## 11. AI绘画提示词",
    prompts.length ? prompts.map(renderPrompt).join("\n\n") : "暂无提示词。",
    "",
    "## 12. 转化率优化建议",
    renderConversionSuggestions(mainImages, detailPages),
    "",
    "## 13. 证据来源与表达边界",
    [
      "- S/A/B 级信息可作为主图或详情页核心表达，C 级信息只作为方向和顾虑参考。",
      "- 用户粘贴的竞品文案、评论资料属于 user_input，需要商家自行确认来源真实性。",
      "- 无真实搜索或用户材料时，不得把 AI 推断写成销量、排名、检测报告、认证或真实评论。",
      "- AI 生图提示词采用完整成图提示词 + 结构化文字层：中文标题、正文、标签与排版会进入最终提示词，同时保留 textLayer 便于人工微调。"
    ].join("\n")
  ].filter((item) => item !== "").join("\n"));
}
