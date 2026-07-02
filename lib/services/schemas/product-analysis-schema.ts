import type {
  DetailPagePlan,
  GeneratedPrompt,
  MainImagePlan,
  MarketResearch,
  PlanVisualGuidelines,
  PromptTextLayer,
  ProductAnalysis
} from "@/lib/types";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertProductAnalysis(value: unknown): ProductAnalysis {
  if (!isObject(value)) {
    throw new Error("Invalid product analysis");
  }

  if (
    typeof value.category !== "string" ||
    typeof value.productNameGuess !== "string" ||
    !isStringArray(value.appearance) ||
    !isStringArray(value.visibleFeatures) ||
    !isStringArray(value.materials) ||
    !isStringArray(value.colors) ||
    !isStringArray(value.styleKeywords) ||
    !isStringArray(value.risks)
  ) {
    throw new Error("Invalid product analysis");
  }

  return value as ProductAnalysis;
}

function assertCopywriting(value: unknown) {
  if (!isObject(value) || typeof value.headline !== "string") {
    throw new Error("Invalid copywriting");
  }

  return value as { headline: string; subheadline?: string; body?: string };
}

function assertVisualGuidelines(value: unknown): PlanVisualGuidelines | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const requiredKeys: Array<keyof PlanVisualGuidelines> = [
    "overallTone",
    "imageTexture",
    "lightingLogic",
    "colorPaletteSystem",
    "typographyRules",
    "compositionRules",
    "productAppearanceFeatures",
    "unifiedVisualStyle"
  ];

  if (!requiredKeys.every((key) => typeof value[key] === "string")) {
    return undefined;
  }

  return value as PlanVisualGuidelines;
}

function assertMainImagePlan(value: unknown): MainImagePlan {
  if (!isObject(value)) {
    throw new Error("Invalid main image plan");
  }

  if (
    typeof value.index !== "number" ||
    typeof value.title !== "string" ||
    typeof value.goal !== "string" ||
    typeof value.scene !== "string" ||
    typeof value.layout !== "string" ||
    !isStringArray(value.visualElements)
  ) {
    throw new Error("Invalid main image plan");
  }

  return {
    index: value.index,
    title: value.title,
    goal: value.goal,
    scene: value.scene,
    layout: value.layout,
    imageBrief: typeof value.imageBrief === "string" ? value.imageBrief : undefined,
    textImageLayout: typeof value.textImageLayout === "string" ? value.textImageLayout : undefined,
    visualFocus: typeof value.visualFocus === "string" ? value.visualFocus : undefined,
    visualGuidelines: assertVisualGuidelines(value.visualGuidelines),
    copywriting: assertCopywriting(value.copywriting),
    visualElements: value.visualElements
  };
}

function assertDetailPagePlan(value: unknown): DetailPagePlan {
  if (!isObject(value)) {
    throw new Error("Invalid detail page plan");
  }

  if (
    typeof value.index !== "number" ||
    typeof value.title !== "string" ||
    typeof value.goal !== "string" ||
    typeof value.layout !== "string" ||
    !isStringArray(value.visualElements)
  ) {
    throw new Error("Invalid detail page plan");
  }

  return {
    index: value.index,
    title: value.title,
    goal: value.goal,
    layout: value.layout,
    imageBrief: typeof value.imageBrief === "string" ? value.imageBrief : undefined,
    textImageLayout: typeof value.textImageLayout === "string" ? value.textImageLayout : undefined,
    visualFocus: typeof value.visualFocus === "string" ? value.visualFocus : undefined,
    visualGuidelines: assertVisualGuidelines(value.visualGuidelines),
    copywriting: assertCopywriting(value.copywriting),
    visualElements: value.visualElements,
    structureMode:
      value.structureMode === "full" || value.structureMode === "cropped" || value.structureMode === "lightweight"
        ? value.structureMode
        : undefined,
    structureNote: typeof value.structureNote === "string" ? value.structureNote : undefined
  };
}

function assertTextLayer(value: unknown): PromptTextLayer {
  if (!isObject(value)) {
    return {};
  }

  return {
    headline: typeof value.headline === "string" ? value.headline : undefined,
    subheadline: typeof value.subheadline === "string" ? value.subheadline : undefined,
    body: typeof value.body === "string" ? value.body : undefined,
    labels: isStringArray(value.labels) ? value.labels : undefined,
    cta: typeof value.cta === "string" ? value.cta : undefined,
    layoutHint: typeof value.layoutHint === "string" ? value.layoutHint : undefined
  };
}

function assertGeneratedPrompt(value: unknown): GeneratedPrompt {
  if (!isObject(value)) {
    throw new Error("Invalid generated prompt");
  }

  if (
    (value.imageType !== "main_image" && value.imageType !== "detail_page") ||
    typeof value.index !== "number" ||
    typeof value.title !== "string" ||
    typeof value.negativePrompt !== "string"
  ) {
    throw new Error("Invalid generated prompt");
  }

  const legacyPrompt = isObject(value.prompts) && typeof value.prompts.gpt === "string"
    ? value.prompts.gpt
    : undefined;

  if (typeof value.backgroundPrompt !== "string" && !legacyPrompt) {
    throw new Error("Invalid generated prompt");
  }

  return {
    imageType: value.imageType,
    index: value.index,
    title: value.title,
    backgroundPrompt: typeof value.backgroundPrompt === "string" ? value.backgroundPrompt : legacyPrompt ?? "",
    textLayer: assertTextLayer(value.textLayer),
    negativePrompt: value.negativePrompt
  };
}

export const productAnalysisSchema = {
  parse: assertProductAnalysis
};

export const designPlanSchema = {
  parse(value: unknown) {
    if (!isObject(value) || !Array.isArray(value.mainImages) || !Array.isArray(value.detailPages)) {
      throw new Error("Invalid design plan");
    }

    return {
      mainImages: value.mainImages.map(assertMainImagePlan),
      detailPages: value.detailPages.map(assertDetailPagePlan)
    };
  }
};

// 分批模式：仅解析 mainImages 数组
export const mainImagesSchema = {
  parse(value: unknown): MainImagePlan[] {
    if (!isObject(value) || !Array.isArray(value.mainImages)) {
      throw new Error("Invalid main images");
    }
    return value.mainImages.map(assertMainImagePlan);
  }
};

// 分批模式：仅解析 detailPages 数组
export const detailPagesSchema = {
  parse(value: unknown): DetailPagePlan[] {
    if (!isObject(value) || !Array.isArray(value.detailPages)) {
      throw new Error("Invalid detail pages");
    }
    return value.detailPages.map(assertDetailPagePlan);
  }
};

function assertMarketResearch(value: unknown): MarketResearch {
  if (!isObject(value)) {
    throw new Error("Invalid market research");
  }

  if (
    !isStringArray(value.hotSellingPoints) ||
    !isStringArray(value.userPainPoints) ||
    !isStringArray(value.competitorTitleStyles) ||
    !isStringArray(value.visualStyles)
  ) {
    throw new Error("Invalid market research");
  }

  return {
    hotSellingPoints: value.hotSellingPoints,
    userPainPoints: value.userPainPoints,
    userFeedbackPros: isStringArray(value.userFeedbackPros) ? value.userFeedbackPros : undefined,
    userFeedbackCons: isStringArray(value.userFeedbackCons) ? value.userFeedbackCons : undefined,
    copywritingSellingPoints: isStringArray(value.copywritingSellingPoints)
      ? value.copywritingSellingPoints
      : undefined,
    certificationSellingPoints: isStringArray(value.certificationSellingPoints)
      ? value.certificationSellingPoints
      : undefined,
    featureSellingPoints: isStringArray(value.featureSellingPoints) ? value.featureSellingPoints : undefined,
    dataSellingPointInsights: isStringArray(value.dataSellingPointInsights)
      ? value.dataSellingPointInsights
      : undefined,
    userQuestions: isStringArray(value.userQuestions) ? value.userQuestions : undefined,
    aiShoppingInsights: isStringArray(value.aiShoppingInsights) ? value.aiShoppingInsights : undefined,
    targetUserProfiles: isStringArray(value.targetUserProfiles) ? value.targetUserProfiles : undefined,
    functionProblemMapping: isStringArray(value.functionProblemMapping)
      ? value.functionProblemMapping
      : undefined,
    targetAudienceInsights: isStringArray(value.targetAudienceInsights) ? value.targetAudienceInsights : undefined,
    productParameterInsights: isStringArray(value.productParameterInsights)
      ? value.productParameterInsights
      : undefined,
    productDetailInsights: isStringArray(value.productDetailInsights) ? value.productDetailInsights : undefined,
    designStyleJudgement: isStringArray(value.designStyleJudgement) ? value.designStyleJudgement : undefined,
    competitorTitleStyles: value.competitorTitleStyles,
    visualStyles: value.visualStyles,
    competitorVisualBenchmarks: isStringArray(value.competitorVisualBenchmarks)
      ? value.competitorVisualBenchmarks
      : undefined,
    designStrategyNotes: isStringArray(value.designStrategyNotes) ? value.designStrategyNotes : undefined,
    sourceNote: typeof value.sourceNote === "string" ? value.sourceNote : undefined
  };
}

export const marketResearchSchema = {
  parse: assertMarketResearch
};

export const generatedPromptsSchema = {
  parse(value: unknown) {
    if (!Array.isArray(value)) {
      throw new Error("Invalid generated prompts");
    }

    return value.map(assertGeneratedPrompt);
  }
};
