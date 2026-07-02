import { shouldUseMockData } from "@/lib/config";
import {
  buildGeneratedPrompts,
  getPromptDeliverableTitle,
  isInternalPlanningTitle,
  sanitizePromptText
} from "@/lib/prompt-templates";
import { createAIChatCompletion } from "@/lib/services/openai-client";
import { ServiceError } from "@/lib/services/errors";
import { sanitizeGeneratedPromptCompliance } from "@/lib/services/compliance";
import { buildProductVisualAnchor, formatCompactProductVisualAnchor } from "@/lib/services/product-visual-anchor";
import { dedupePromptSegments } from "@/lib/services/prompt-compaction";
import { generatedPromptsSchema } from "@/lib/services/schemas/product-analysis-schema";
import type {
  AIProviderConfig,
  DetailPagePlan,
  GenerationMeta,
  GeneratedPrompt,
  MainImagePlan,
  MarketResearch,
  OutputScope,
  PromptCoverageIssue,
  PromptCoverageMeta,
  PromptGenerationResult,
  ProductManualInfo,
  ProductAnalysis
} from "@/lib/types";
import type { ChatCompletionParams } from "@/lib/ai-providers";

type GeneratePromptsInput = {
  productAnalysis: ProductAnalysis;
  designPlan?: {
    mainImages: MainImagePlan[];
    detailPages: DetailPagePlan[];
  };
  mainImages?: MainImagePlan[];
  detailPages?: DetailPagePlan[];
  marketResearch?: MarketResearch;
  manualProductInfo?: ProductManualInfo;
  providerConfig?: AIProviderConfig | null;
  planningContext?: string;
  outputScope?: OutputScope;
};

function normalizeOutputScope(scope?: OutputScope): OutputScope {
  return scope ?? "all";
}

function includesMainImages(scope: OutputScope) {
  return scope !== "detail_only";
}

function includesDetailPages(scope: OutputScope) {
  return scope !== "main_only";
}

function promptScopeLabel(scope: OutputScope) {
  if (scope === "main_only") return "仅主图提示词";
  if (scope === "detail_only") return "仅详情页提示词";
  return "主图与详情页提示词";
}

function filterPromptsByScope(prompts: GeneratedPrompt[], scope: OutputScope) {
  if (scope === "main_only") return prompts.filter((prompt) => prompt.imageType === "main_image");
  if (scope === "detail_only") return prompts.filter((prompt) => prompt.imageType === "detail_page");
  return prompts;
}

type PromptTarget = {
  imageType: "main_image" | "detail_page";
  index: number;
  title: string;
};

type PromptBatch = {
  label: string;
  mainImages: MainImagePlan[];
  detailPages: DetailPagePlan[];
  targets: PromptTarget[];
};

function promptTargetKey(target: Pick<PromptTarget, "imageType" | "index">) {
  return `${target.imageType}:${target.index}`;
}

function promptTargetLabel(target: Pick<PromptTarget, "imageType" | "index"> & { title?: string }) {
  const prefix = target.imageType === "main_image" ? "主图" : "详情页";
  return `${prefix}${target.index}${target.title ? `《${target.title}》` : ""}`;
}

function planTitle(plan: MainImagePlan | DetailPagePlan, fallback: string) {
  return getPromptDeliverableTitle(plan, fallback);
}

function buildPromptTargets(
  mainImages: MainImagePlan[],
  detailPages: DetailPagePlan[],
  scope: OutputScope
): PromptTarget[] {
  const mainTargets = includesMainImages(scope)
    ? mainImages.map((plan) => ({
        imageType: "main_image" as const,
        index: plan.index,
        title: planTitle(plan, `主图${plan.index}`)
      }))
    : [];
  const detailTargets = includesDetailPages(scope)
    ? detailPages.map((plan) => ({
        imageType: "detail_page" as const,
        index: plan.index,
        title: planTitle(plan, `详情页${plan.index}`)
      }))
    : [];

  return [...mainTargets, ...detailTargets];
}

function issueFromTarget(target: PromptTarget): PromptCoverageIssue {
  return {
    imageType: target.imageType,
    index: target.index,
    title: target.title
  };
}

function issueFromPrompt(prompt: GeneratedPrompt): PromptCoverageIssue {
  return {
    imageType: prompt.imageType,
    index: prompt.index,
    title: prompt.title
  };
}

function validatePromptCoverage(prompts: GeneratedPrompt[], targets: PromptTarget[]): PromptCoverageMeta {
  const targetMap = new Map(targets.map((target) => [promptTargetKey(target), target]));
  const seen = new Map<string, GeneratedPrompt[]>();

  prompts.forEach((prompt) => {
    const key = promptTargetKey(prompt);
    const list = seen.get(key) ?? [];
    list.push(prompt);
    seen.set(key, list);
  });

  const missing = targets
    .filter((target) => !seen.has(promptTargetKey(target)))
    .map(issueFromTarget);
  const duplicates = Array.from(seen.entries()).flatMap(([key, items]) => {
    if (items.length <= 1 || !targetMap.has(key)) return [];
    return items.slice(1).map(issueFromPrompt);
  });
  const unexpected = prompts
    .filter((prompt) => !targetMap.has(promptTargetKey(prompt)))
    .map(issueFromPrompt);

  return {
    expectedCount: targets.length,
    receivedCount: prompts.length,
    missing,
    duplicates,
    unexpected
  };
}

function summarizeCoverageIssue(items: PromptCoverageIssue[], limit = 8) {
  if (!items.length) return "";
  const labels = items.slice(0, limit).map(promptTargetLabel);
  const rest = items.length > limit ? ` 等 ${items.length} 项` : "";
  return `${labels.join("、")}${rest}`;
}

function assertPromptCoverage(prompts: GeneratedPrompt[], targets: PromptTarget[], context = "提示词") {
  const coverage = validatePromptCoverage(prompts, targets);
  if (!coverage.missing.length && !coverage.duplicates.length && !coverage.unexpected.length) {
    return coverage;
  }

  const parts = [
    `${context}生成不完整：应生成 ${coverage.expectedCount} 条，实际收到 ${coverage.receivedCount} 条。`
  ];
  const missing = summarizeCoverageIssue(coverage.missing);
  const duplicates = summarizeCoverageIssue(coverage.duplicates);
  const unexpected = summarizeCoverageIssue(coverage.unexpected);

  if (missing) parts.push(`缺少：${missing}。`);
  if (duplicates) parts.push(`重复：${duplicates}。`);
  if (unexpected) parts.push(`多余：${unexpected}。`);

  throw new ServiceError(parts.join(""), {
    statusCode: 502,
    code: "PROMPT_COVERAGE_INCOMPLETE"
  });
}

function orderPromptsByTargets(prompts: GeneratedPrompt[], targets: PromptTarget[]) {
  const promptMap = new Map(prompts.map((prompt) => [promptTargetKey(prompt), prompt]));
  return targets.map((target) => promptMap.get(promptTargetKey(target))).filter(Boolean) as GeneratedPrompt[];
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildPromptBatches(
  mainImages: MainImagePlan[],
  detailPages: DetailPagePlan[],
  scope: OutputScope
): PromptBatch[] {
  const batches: PromptBatch[] = [];

  if (includesMainImages(scope) && mainImages.length) {
    batches.push({
      label: "主图提示词",
      mainImages,
      detailPages: [],
      targets: buildPromptTargets(mainImages, [], "main_only")
    });
  }

  if (includesDetailPages(scope) && detailPages.length) {
    chunkArray(detailPages, 4).forEach((chunk, batchIndex) => {
      batches.push({
        label: `详情页提示词第 ${batchIndex + 1} 批`,
        mainImages: [],
        detailPages: chunk,
        targets: buildPromptTargets([], chunk, "detail_only")
      });
    });
  }

  return batches;
}

function formatTargetList(targets: PromptTarget[]) {
  return targets.map((target) => `- ${promptTargetLabel(target)}`).join("\n");
}

function createPromptGenerationMeta(
  input: GeneratePromptsInput,
  payload: Partial<GenerationMeta>
): GenerationMeta {
  return {
    step: "prompts",
    sourceType: payload.sourceType ?? "real_ai",
    usedAI: payload.usedAI ?? Boolean(input.providerConfig?.apiKey && input.providerConfig?.model),
    usedMock: payload.usedMock ?? false,
    usedFallback: payload.usedFallback ?? false,
    usedSearch: payload.usedSearch,
    evidenceLevel: payload.evidenceLevel ?? "B",
    providerName: payload.providerName ?? input.providerConfig?.displayName ?? input.providerConfig?.providerId,
    model: payload.model ?? input.providerConfig?.model ?? process.env.OPENAI_PROMPT_MODEL ?? "gpt-4.1-mini",
    fallbackReason: payload.fallbackReason,
    note: payload.note,
    generatedAt: payload.generatedAt ?? new Date().toISOString()
  };
}

function attachPromptGenerationMeta(prompts: GeneratedPrompt[], meta: GenerationMeta) {
  return prompts.map((prompt) => ({ ...prompt, generationMeta: meta }));
}

const promptsJsonSchema = {
  name: "image_prompts",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["imageType", "index", "title", "backgroundPrompt", "textLayer", "negativePrompt"],
          properties: {
            imageType: { type: "string", enum: ["main_image", "detail_page"] },
            index: { type: "number" },
            title: { type: "string" },
            backgroundPrompt: { type: "string" },
            textLayer: {
              type: "object",
              additionalProperties: false,
              required: ["headline", "subheadline", "body", "labels", "cta", "layoutHint"],
              properties: {
                headline: { type: "string" },
                subheadline: { type: "string" },
                body: { type: "string" },
                labels: { type: "array", items: { type: "string" } },
                cta: { type: "string" },
                layoutHint: { type: "string" }
              }
            },
            negativePrompt: { type: "string" }
          }
        }
      }
    }
  }
} as const;

function parsePromptsJson(text: string): GeneratedPrompt[] {
  const cleanText = extractJsonLikeText(
    text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
      .trim()
  );

  try {
    const parsed = JSON.parse(cleanText) as { items?: unknown; data?: unknown };
    const items = Array.isArray(parsed) ? parsed : parsed.items ?? parsed.data;
    return generatedPromptsSchema.parse(items);
  } catch {
    throw new ServiceError("AI 返回格式异常，请重试", {
      statusCode: 502,
      code: "AI_RESPONSE_SCHEMA_INVALID"
    });
  }
}

function getPromptTitleFromPlan(
  prompt: GeneratedPrompt,
  mainImages?: MainImagePlan[],
  detailPages?: DetailPagePlan[]
) {
  const plans = prompt.imageType === "main_image" ? mainImages : detailPages;
  const matchingPlan = plans?.find((plan) => plan.index === prompt.index);
  const promptTitle = sanitizePromptText(prompt.title);
  const fallback = `${prompt.imageType === "main_image" ? "主图" : "详情页"}${prompt.index}`;

  if (matchingPlan) {
    return getPromptDeliverableTitle(matchingPlan, fallback);
  }

  if (promptTitle && !isInternalPlanningTitle(promptTitle)) {
    return promptTitle;
  }

  return fallback;
}

function sanitizeGeneratedPromptBody(text: string) {
  return dedupePromptSegments(sanitizePromptText(text)
    .replace(
      /(?:产品品类|产品名称|产品名称猜测|可见功能|材质判断|颜色|核心卖点|用户反馈优点|用户反馈问题|目标受众|整体调性|画面质感|布光逻辑|色彩体系|字体规范|构图规范|产品外观特征)\s*[:：]\s*([^。；;]*)([。；;]?)/g,
      "$1$2"
    )
    .replace(/(?:模块主题|转化目标|本屏负责|本屏任务|画面目标)\s*[:：]\s*[^。；;]*[。；;]?/g, "")
    .replace(/画面主标题/g, "中文标题")
    .replace(/[；;]\s*[；;]+/g, "；")
    .replace(/[。]\s*[。]+/g, "。")
    .trim(), { maxChars: 900 });
}

function sanitizeGeneratedPrompts(
  prompts: GeneratedPrompt[],
  mainImages?: MainImagePlan[],
  detailPages?: DetailPagePlan[],
  productAnalysis?: ProductAnalysis
): GeneratedPrompt[] {
  const anchorText = productAnalysis
    ? formatCompactProductVisualAnchor(productAnalysis.visualAnchor ?? buildProductVisualAnchor(productAnalysis))
    : "";

  return prompts.map((prompt) =>
    sanitizeGeneratedPromptCompliance({
      ...prompt,
      title: getPromptTitleFromPlan(prompt, mainImages, detailPages),
      backgroundPrompt: sanitizeGeneratedPromptBody(
        anchorText && !prompt.backgroundPrompt.includes("产品外观锚点")
          ? `${anchorText}。${prompt.backgroundPrompt}`
          : prompt.backgroundPrompt
      ),
      textLayer: {
        headline: sanitizePromptText(prompt.textLayer?.headline ?? ""),
        subheadline: sanitizePromptText(prompt.textLayer?.subheadline ?? ""),
        body: sanitizePromptText(prompt.textLayer?.body ?? ""),
        labels: (prompt.textLayer?.labels ?? []).map(sanitizePromptText).filter(Boolean),
        cta: sanitizePromptText(prompt.textLayer?.cta ?? ""),
        layoutHint: sanitizePromptText(prompt.textLayer?.layoutHint ?? "")
      },
      negativePrompt: sanitizePromptText(prompt.negativePrompt)
    })
  );
}

function extractJsonLikeText(text: string) {
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1);
  }

  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return text.slice(arrayStart, arrayEnd + 1);
  }

  return text;
}

function splitManualItems(value?: string) {
  return (value ?? "")
    .split(/[、，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueItems(items: string[], limit: number) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function buildFallbackPrompts(
  productAnalysis: ProductAnalysis,
  marketResearch: MarketResearch | undefined,
  mainImages: MainImagePlan[],
  detailPages: DetailPagePlan[],
  manualProductInfo?: ProductManualInfo
) {
  const manualSellingPoints = splitManualItems(manualProductInfo?.sellingPoints);
  const manualAudience = splitManualItems(manualProductInfo?.targetAudience);
  const manualNotes = splitManualItems(manualProductInfo?.notes);
  const enrichedProductAnalysisWithoutAnchor: ProductAnalysis = {
    ...productAnalysis,
    category: manualProductInfo?.category || productAnalysis.category,
    productNameGuess: manualProductInfo?.productName || productAnalysis.productNameGuess,
    brandNames: {
      chinese: manualProductInfo?.brand || productAnalysis.brandNames?.chinese,
      english: productAnalysis.brandNames?.english
    },
    sellingPoints: uniqueItems([...manualSellingPoints, ...(productAnalysis.sellingPoints ?? [])], 8),
    visibleFeatures: uniqueItems([...productAnalysis.visibleFeatures, ...manualSellingPoints], 8),
    targetAudience: uniqueItems([...manualAudience, ...(productAnalysis.targetAudience ?? [])], 8),
    productDetails: uniqueItems([...(productAnalysis.productDetails ?? [])], 8)
  };
  const enrichedProductAnalysis: ProductAnalysis = {
    ...enrichedProductAnalysisWithoutAnchor,
    visualAnchor: buildProductVisualAnchor(enrichedProductAnalysisWithoutAnchor)
  };
  const enrichedMarketResearch = marketResearch
    ? {
        ...marketResearch,
        hotSellingPoints: uniqueItems([...manualSellingPoints, ...marketResearch.hotSellingPoints], 6),
        userPainPoints: uniqueItems([
          ...manualAudience.map((audience) => `${audience}关注真实使用收益`),
          ...marketResearch.userPainPoints
        ], 6),
        visualStyles: uniqueItems([
          ...manualNotes.map((note) => `${note}视觉方向`),
          ...marketResearch.visualStyles
        ], 6)
      }
    : undefined;

  return sanitizeGeneratedPrompts(
    buildGeneratedPrompts(
      enrichedProductAnalysis,
      enrichedMarketResearch ?? {
        hotSellingPoints: enrichedProductAnalysis.visibleFeatures,
        userPainPoints: enrichedProductAnalysis.risks,
        userFeedbackPros: enrichedProductAnalysis.sellingPoints,
        userFeedbackCons: enrichedProductAnalysis.risks,
        competitorTitleStyles: [],
        visualStyles: enrichedProductAnalysis.styleKeywords
      },
      mainImages,
      detailPages
    ),
    mainImages,
    detailPages,
    enrichedProductAnalysis
  );
}

function compactProductAnalysisForPrompt(productAnalysis: ProductAnalysis) {
  return {
    category: productAnalysis.category,
    productNameGuess: productAnalysis.productNameGuess,
    appearance: productAnalysis.appearance?.slice(0, 8),
    visibleFeatures: productAnalysis.visibleFeatures?.slice(0, 8),
    materials: productAnalysis.materials?.slice(0, 6),
    colors: productAnalysis.colors?.slice(0, 6),
    sellingPoints: productAnalysis.sellingPoints?.slice(0, 8),
    targetAudience: productAnalysis.targetAudience?.slice(0, 6),
    risks: productAnalysis.risks?.slice(0, 6),
    visualStyleSystem: productAnalysis.visualStyleSystem,
    visualAnchor: productAnalysis.visualAnchor ?? buildProductVisualAnchor(productAnalysis)
  };
}

function compactMarketResearchForPrompt(marketResearch?: MarketResearch) {
  if (!marketResearch) return {};

  return {
    hotSellingPoints: marketResearch.hotSellingPoints?.slice(0, 8),
    userPainPoints: marketResearch.userPainPoints?.slice(0, 8),
    userFeedbackPros: marketResearch.userFeedbackPros?.slice(0, 6),
    userFeedbackCons: marketResearch.userFeedbackCons?.slice(0, 6),
    targetUserProfiles: marketResearch.targetUserProfiles?.slice(0, 6),
    visualStyles: marketResearch.visualStyles?.slice(0, 6),
    designStyleJudgement: marketResearch.designStyleJudgement?.slice(0, 6),
    sourceNote: marketResearch.sourceNote
  };
}

function compactPlanForPrompt(plan: MainImagePlan | DetailPagePlan) {
  const isDetailPlan = "screenRole" in plan || "funnelStage" in plan || "conversionPurpose" in plan;
  const mainPlan = plan as MainImagePlan;
  const detailPlan = plan as DetailPagePlan;

  return {
    index: plan.index,
    title: plan.title,
    goal: plan.goal,
    scene: "scene" in plan ? mainPlan.scene : undefined,
    layout: plan.layout,
    imageBrief: plan.imageBrief,
    textImageLayout: plan.textImageLayout,
    visualFocus: plan.visualFocus,
    visualGuidelines: plan.visualGuidelines,
    copywriting: plan.copywriting,
    visualElements: plan.visualElements,
    role: isDetailPlan ? detailPlan.screenRole : mainPlan.role,
    primaryClickReason: isDetailPlan ? undefined : mainPlan.primaryClickReason,
    expressionMethod: isDetailPlan ? undefined : mainPlan.expressionMethod,
    visualStrategy: plan.visualStrategy,
    proofOrBoundary: plan.proofOrBoundary,
    conversionPurpose: isDetailPlan ? detailPlan.conversionPurpose : undefined,
    funnelStage: isDetailPlan ? detailPlan.funnelStage : undefined,
    userQuestionAnswered: isDetailPlan ? detailPlan.userQuestionAnswered : undefined,
    assignedSellingPoint: plan.assignedSellingPoint
      ? {
          name: plan.assignedSellingPoint.name,
          feature: plan.assignedSellingPoint.feature,
          advantage: plan.assignedSellingPoint.advantage,
          benefit: plan.assignedSellingPoint.benefit,
          scene: plan.assignedSellingPoint.scene,
          painPoint: plan.assignedSellingPoint.painPoint,
          emotionalTrigger: plan.assignedSellingPoint.emotionalTrigger,
          proof: plan.assignedSellingPoint.proof,
          claimBoundary: plan.assignedSellingPoint.claimBoundary,
          evidenceLevel: plan.assignedSellingPoint.evidenceLevel
        }
      : undefined
  };
}

function promptBatchScope(batch: PromptBatch): OutputScope {
  if (batch.mainImages.length && !batch.detailPages.length) return "main_only";
  if (batch.detailPages.length && !batch.mainImages.length) return "detail_only";
  return "all";
}

function batchMaxTokens(batch: PromptBatch) {
  return Math.min(8000, Math.max(3600, batch.targets.length * 1500));
}

function buildPromptBatchParams(
  input: GeneratePromptsInput,
  batch: PromptBatch,
  batchIndex: number,
  totalBatches: number
): ChatCompletionParams {
  const batchScope = promptBatchScope(batch);
  const productAnchor = formatCompactProductVisualAnchor(
    input.productAnalysis.visualAnchor ?? buildProductVisualAnchor(input.productAnalysis)
  );

  return {
    model: process.env.OPENAI_PROMPT_MODEL ?? "gpt-4.1-mini",
    messages: [
      {
        role: "user",
        content: [
          "你是顶级商业运营、广告策划、商业视觉设计总监和 AI 图像提示词专家。任务：把当前批次的电商策划脚本转成可直接执行的中文生图提示词。",
          `当前批次：${batch.label}（第 ${batchIndex + 1}/${totalBatches} 批）。`,
          `本批必须且只能输出 ${batch.targets.length} 条 items。不得少于、不得多于目标清单。`,
          "目标清单：",
          formatTargetList(batch.targets),
          "",
          "【输出结构】",
          "JSON 顶层必须是对象，且只包含 items 数组。",
          "每个 items 元素必须包含 imageType、index、title、backgroundPrompt、textLayer、negativePrompt。",
          "textLayer 必须包含 headline、subheadline、body、labels、cta、layoutHint。没有 CTA 时 cta 返回空字符串。",
          "",
          "【生成边界】",
          "backgroundPrompt 是完整电商成图提示词，需要包含产品、场景、光线、材质、构图、上屏中文文案、信息卡片、图标/标签和排版关系。",
          "textLayer 是结构化文字层，必须和 backgroundPrompt 中的上屏文案一致。",
          "每条只讲一个核心信息。不要把产品分析、字段说明、系统规则整包写进去。",
          "标题必须顶部左对齐；主标题、副标题、正文说明统一左对齐；文字与产品保持安全距离，不遮挡产品。",
          "主图使用 1:1 方图；详情页使用 2:3 竖屏。",
          "主图提示词控制在 300-450 字，详情页提示词控制在 400-600 字。",
          "产品外观必须锁定，不得改品类、颜色、关键部件、比例和材质。",
          "不得生成证书、公章、检测报告、排名榜单、虚假销量、虚假授权、额外品牌 Logo 或不可验证数据。",
          "不得出现伪文字、乱码、错别字、水印。不得输出「模块主题」「转化目标」「本屏任务」「后期文字层」等内部词。",
          "不同目标的画面、卖点和文案角度必须不同，不能批量复用同一句标题/正文。",
          "",
          "【统一产品外观锚点】",
          productAnchor,
          "",
          `产品分析摘要：${JSON.stringify(compactProductAnalysisForPrompt(input.productAnalysis))}`,
          `市场/用户资料摘要：${JSON.stringify(compactMarketResearchForPrompt(input.marketResearch))}`,
          `用户补充信息：${JSON.stringify(input.manualProductInfo ?? {})}`,
          `多轮策划会话摘要：${input.planningContext ?? "暂无前置会话结论。"}`,
          `本批主图方案：${batch.mainImages.length ? JSON.stringify(batch.mainImages.map(compactPlanForPrompt)) : "无"}`,
          `本批详情页方案：${batch.detailPages.length ? JSON.stringify(batch.detailPages.map(compactPlanForPrompt)) : "无"}`,
          `本批输出范围：${promptScopeLabel(batchScope)}。`
        ].join("\n")
      }
    ],
    jsonSchema: promptsJsonSchema,
    maxTokens: batchMaxTokens(batch)
  };
}

export async function generateImagePrompts(input: GeneratePromptsInput): Promise<PromptGenerationResult> {
  const outputScope = normalizeOutputScope(input.outputScope);
  const rawMainImages = input.designPlan?.mainImages ?? input.mainImages ?? [];
  const rawDetailPages = input.designPlan?.detailPages ?? input.detailPages ?? [];
  const mainImages = includesMainImages(outputScope) ? rawMainImages : [];
  const detailPages = includesDetailPages(outputScope) ? rawDetailPages : [];

  if (
    !input.productAnalysis ||
    (includesMainImages(outputScope) && !mainImages.length) ||
    (includesDetailPages(outputScope) && !detailPages.length)
  ) {
    throw new ServiceError("生成提示词缺少产品分析或当前输出范围对应的视觉方案数据。", {
      statusCode: 400,
      code: "PROMPT_INPUT_MISSING"
    });
  }

  const hasProviderConfig = Boolean(input.providerConfig?.apiKey && input.providerConfig?.model);
  const allTargets = buildPromptTargets(mainImages, detailPages, outputScope);

  if (shouldUseMockData() && !hasProviderConfig) {
    const mockMeta = createPromptGenerationMeta(input, {
      sourceType: "mock",
      usedAI: false,
      usedMock: true,
      usedFallback: true,
      evidenceLevel: "C",
      fallbackReason: "未配置页面 AI 模型，使用演示提示词。",
      note: "演示模式提示词仅用于测试流程，不代表真实 AI 提示词生成结果。"
    });
    const fallbackPrompts = buildFallbackPrompts(
      input.productAnalysis,
      input.marketResearch,
      mainImages,
      detailPages,
      input.manualProductInfo
    );
    const promptCoverage = assertPromptCoverage(fallbackPrompts, allTargets, "演示提示词");
    return {
      prompts: attachPromptGenerationMeta(orderPromptsByTargets(fallbackPrompts, allTargets), mockMeta),
      generationMeta: mockMeta,
      promptCoverage
    };
  }

  try {
    const batches = buildPromptBatches(mainImages, detailPages, outputScope);
    const collectedPrompts: GeneratedPrompt[] = [];

    for (const [batchIndex, batch] of batches.entries()) {
      const text = await createAIChatCompletion(
        input.providerConfig ?? null,
        buildPromptBatchParams(input, batch, batchIndex, batches.length)
      );
      const batchPrompts = filterPromptsByScope(
        sanitizeGeneratedPrompts(
          parsePromptsJson(text),
          batch.mainImages,
          batch.detailPages,
          input.productAnalysis
        ),
        promptBatchScope(batch)
      );
      assertPromptCoverage(batchPrompts, batch.targets, batch.label);
      collectedPrompts.push(...orderPromptsByTargets(batchPrompts, batch.targets));
    }

    const promptCoverage = {
      ...assertPromptCoverage(collectedPrompts, allTargets, "全部提示词"),
      batchCount: batches.length
    };
    const aiMeta = createPromptGenerationMeta(input, {
      sourceType: "real_ai",
      usedAI: true,
      usedMock: false,
      usedFallback: false,
      evidenceLevel: "B",
      note: `提示词由当前配置的 AI 模型分 ${batches.length} 批生成；已校验覆盖 ${promptCoverage.expectedCount}/${promptCoverage.expectedCount} 条。`
    });
    return {
      prompts: attachPromptGenerationMeta(orderPromptsByTargets(collectedPrompts, allTargets), aiMeta),
      generationMeta: aiMeta,
      promptCoverage
    };
  } catch (error) {
    console.warn("AI prompt generation failed. Template fallback is disabled.", error);
    if (error instanceof ServiceError) {
      throw error;
    }
    throw new ServiceError(
      `AI 提示词生成失败，已停止使用模板兜底。请检查 API Key、模型权限、结构化输出能力或稍后重试。${error instanceof Error ? `原因：${error.message}` : ""}`,
      {
        statusCode: 502,
        code: "PROMPT_AI_FAILED"
      }
    );
  }
}
