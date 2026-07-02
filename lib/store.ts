"use client";

import { create } from "zustand";
import type {
  AnalysisStatus,
  DetailPagePlan,
  DesignPlanGenerationResult,
  GenerationMeta,
  GeneratedPrompt,
  MainImagePlan,
  MarketResearch,
  OutputScope,
  PromptGenerationResult,
  ProductManualInfo,
  ProductAnalysis,
  ProjectState,
  ResultTab,
  VisualStyleSystem,
  UploadedProductImage,
  WorkflowStepId,
  WorkflowStepState,
  WorkflowStepStates
} from "@/lib/types";
import { useProviderStore } from "@/lib/provider-store";
import { useSearchProviderStore } from "@/lib/search-provider-store";
import { getProviderCapabilities } from "@/lib/ai-providers";
import { buildEvidenceItems, mergeEvidenceMaps } from "@/lib/evidence";
import {
  completePlanningTurn,
  createPlanningSession,
  failPlanningTurn,
  startPlanningTurn,
  summarizeDesignPlan,
  summarizeMarketResearch,
  summarizePlanningSessionForAI,
  summarizeProductAnalysis,
  summarizePrompts
} from "@/lib/services/planning-session";

type ProjectActions = {
  setUploadedImages: (images: UploadedProductImage[]) => void;
  removeUploadedImage: (index: number) => void;
  setManualProductInfo: (payload: ProductManualInfo) => void;
  setOutputScope: (scope: OutputScope) => void;
  setActiveTab: (tab: ResultTab) => void;
  setError: (message: string | null) => void;
  retryStep: (step: Exclude<WorkflowStepId, "upload" | "export">) => Promise<void>;
  markExportSuccess: () => void;
  markExportFailed: (message: string) => void;
  resetProject: () => void;
  runAnalysis: () => Promise<void>;
};

function createInitialStepState(): WorkflowStepState {
  return {
    status: "idle",
    retryCount: 0
  };
}

function createInitialStepStates(): WorkflowStepStates {
  return {
    product: createInitialStepState(),
    research: createInitialStepState(),
    style: createInitialStepState(),
    design: createInitialStepState(),
    prompts: createInitialStepState(),
    export: createInitialStepState()
  };
}

const initialState: ProjectState = {
  uploadedImages: [],
  imagePreviewUrl: null,
  imageName: null,
  imageSize: null,
  manualProductInfo: {},
  outputScope: "all",
  status: "idle",
  globalStatus: "idle",
  stepStates: createInitialStepStates(),
  currentStepIndex: 0,
  activeTab: "product",
  productAnalysis: null,
  marketResearch: null,
  mainImages: [],
  detailPages: [],
  prompts: [],
  generationMeta: {},
  planningSession: createPlanningSession(),
  error: null
};

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  let payload: ApiResponse<T>;

  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new Error("接口返回格式异常，请重试。");
  }

  if (!response.ok || !payload.success) {
    throw new Error("error" in payload ? payload.error : `请求失败：${response.status}`);
  }

  return payload.data;
}

async function pause(ms = 220) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function createGenerationMeta(
  step: GenerationMeta["step"],
  payload: Partial<GenerationMeta>
): GenerationMeta {
  return {
    step,
    sourceType: payload.sourceType ?? "ai_inference",
    usedAI: payload.usedAI ?? false,
    usedMock: payload.usedMock ?? false,
    usedFallback: payload.usedFallback ?? false,
    usedSearch: payload.usedSearch,
    evidenceLevel: payload.evidenceLevel,
    providerName: payload.providerName,
    model: payload.model,
    fallbackReason: payload.fallbackReason,
    note: payload.note,
    generatedAt: payload.generatedAt ?? nowIso()
  };
}

function providerMeta(providerConfig: ReturnType<typeof useProviderStore.getState>["config"]) {
  return {
    providerName: providerConfig?.displayName ?? providerConfig?.providerId,
    model: providerConfig?.model
  };
}

function inferMarketGenerationMeta(marketResearch: MarketResearch, providerConfig: ReturnType<typeof useProviderStore.getState>["config"]) {
  const allEvidence = Object.values(marketResearch.evidence ?? {}).flat();
  const hasWebSearch = allEvidence.some((item) => item?.source === "web_search");
  const hasUserInput = allEvidence.some((item) => item?.source === "user_input");
  const hasMock = allEvidence.some((item) => item?.source === "mock");
  const evidenceLevel = hasWebSearch ? "A" : hasUserInput ? "A" : hasMock ? "C" : "C";

  return createGenerationMeta("research", {
    sourceType: hasWebSearch ? "web_search" : hasUserInput ? "user_input" : hasMock ? "mock" : "ai_inference",
    usedAI: Boolean(providerConfig?.apiKey && providerConfig?.model),
    usedMock: hasMock,
    usedFallback: false,
    usedSearch: hasWebSearch,
    evidenceLevel,
    note: marketResearch.sourceNote ?? (hasWebSearch ? "已使用真实搜索结果。" : "未使用真实联网搜索结果，市场内容仅作为方向参考。"),
    ...providerMeta(providerConfig)
  });
}

function markStepPending(
  stepStates: WorkflowStepStates,
  step: keyof WorkflowStepStates,
  incrementRetry = false
): WorkflowStepStates {
  return {
    ...stepStates,
    [step]: {
      ...stepStates[step],
      status: "pending",
      errorMessage: undefined,
      retryCount: stepStates[step].retryCount + (incrementRetry ? 1 : 0),
      startedAt: nowIso()
    }
  };
}

function markStepSuccess(stepStates: WorkflowStepStates, step: keyof WorkflowStepStates): WorkflowStepStates {
  return {
    ...stepStates,
    [step]: {
      ...stepStates[step],
      status: "success",
      errorMessage: undefined,
      completedAt: nowIso()
    }
  };
}

function markStepFailed(
  stepStates: WorkflowStepStates,
  step: keyof WorkflowStepStates,
  errorMessage: string
): WorkflowStepStates {
  return {
    ...stepStates,
    [step]: {
      ...stepStates[step],
      status: "failed",
      errorMessage,
      completedAt: nowIso()
    }
  };
}

function hasAnySuccessfulStep(stepStates: WorkflowStepStates) {
  return Object.values(stepStates).some((step) => step.status === "success");
}

function getApiImages(images: UploadedProductImage[]) {
  return images.map((image) => ({
    ...image,
    apiUrl: image.analysisUrl ?? image.previewUrl,
    apiSize: image.compressedSize ?? image.imageSize
  }));
}

function splitManualItems(value?: string) {
  return (value ?? "")
    .split(/[、，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueItems(items: string[], limit = Number.POSITIVE_INFINITY) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function wantsMainImages(scope: OutputScope) {
  return scope !== "detail_only";
}

function wantsDetailPages(scope: OutputScope) {
  return scope !== "main_only";
}

function validatePromptResultCoverage(
  result: PromptGenerationResult,
  scope: OutputScope,
  mainImages: MainImagePlan[],
  detailPages: DetailPagePlan[]
) {
  const expectedMain = wantsMainImages(scope) ? mainImages.length : 0;
  const expectedDetail = wantsDetailPages(scope) ? detailPages.length : 0;
  const receivedMain = result.prompts.filter((prompt) => prompt.imageType === "main_image").length;
  const receivedDetail = result.prompts.filter((prompt) => prompt.imageType === "detail_page").length;
  const expectedTotal = expectedMain + expectedDetail;
  const receivedTotal = result.prompts.length;

  if (expectedMain === receivedMain && expectedDetail === receivedDetail && expectedTotal === receivedTotal) {
    return;
  }

  const missing = result.promptCoverage?.missing?.length
    ? `缺少：${result.promptCoverage.missing
        .slice(0, 8)
        .map((item) => `${item.imageType === "main_image" ? "主图" : "详情页"}${item.index}`)
        .join("、")}。`
    : "";

  throw new Error(
    `提示词生成不完整：应生成主图 ${expectedMain} 条、详情页 ${expectedDetail} 条；实际收到主图 ${receivedMain} 条、详情页 ${receivedDetail} 条。${missing}`
  );
}

function resultTabForScope(scope: OutputScope): ResultTab {
  return scope === "detail_only" ? "detailPages" : "mainImages";
}

function mergeManualInfoIntoProductArchive(
  analysis: ProductAnalysis,
  visualStyleSystem: VisualStyleSystem,
  manualProductInfo: ProductManualInfo
): ProductAnalysis {
  const manualSellingPoints = splitManualItems(manualProductInfo.sellingPoints);
  const manualAudience = splitManualItems(manualProductInfo.targetAudience);
  const manualNotes = splitManualItems(manualProductInfo.notes);
  const hasManualInfo = Object.values(manualProductInfo).some(Boolean);

  const merged: ProductAnalysis = {
    ...analysis,
    category: manualProductInfo.category || analysis.category,
    productNameGuess: manualProductInfo.productName || analysis.productNameGuess,
    brandNames: {
      chinese: manualProductInfo.brand || analysis.brandNames?.chinese,
      english: analysis.brandNames?.english
    },
    sellingPoints: uniqueItems([...manualSellingPoints, ...(analysis.sellingPoints ?? [])], 10),
    visibleFeatures: uniqueItems([...analysis.visibleFeatures, ...manualSellingPoints], 10),
    targetAudience: uniqueItems([...manualAudience, ...(analysis.targetAudience ?? [])], 10),
    productDetails: uniqueItems([...(analysis.productDetails ?? []), ...manualNotes], 10),
    risks: hasManualInfo
      ? uniqueItems([
          ...analysis.risks,
          "已合并用户手动填写信息；上架前仍以商品实物、官方参数和平台合规要求为准"
        ], 10)
      : analysis.risks,
    visualStyleSystem
  };

  return {
    ...merged,
    evidence: mergeEvidenceMaps(analysis.evidence, {
      category: manualProductInfo.category
        ? buildEvidenceItems([manualProductInfo.category], "user_input", "A", {
            sourceNote: "用户手动填写产品品类"
          })
        : [],
      productNameGuess: manualProductInfo.productName
        ? buildEvidenceItems([manualProductInfo.productName], "user_input", "A", {
            sourceNote: "用户手动填写产品名称/型号"
          })
        : [],
      brandNames: manualProductInfo.brand
        ? buildEvidenceItems([manualProductInfo.brand], "user_input", "A", {
            sourceNote: "用户手动填写品牌"
          })
        : [],
      sellingPoints: buildEvidenceItems(manualSellingPoints, "user_input", "B", {
        sourceNote: "用户手动填写已知卖点"
      }),
      visibleFeatures: buildEvidenceItems(manualSellingPoints, "user_input", "B", {
        sourceNote: "用户手动填写卖点，作为策划上下文"
      }),
      targetAudience: buildEvidenceItems(manualAudience, "user_input", "B", {
        sourceNote: "用户手动填写目标人群"
      }),
      productDetails: buildEvidenceItems(manualNotes, "user_input", "B", {
        sourceNote: "用户手动填写其他补充"
      }),
      visualStyleSystem: buildEvidenceItems(
        [
          ...visualStyleSystem.overallTone,
          ...visualStyleSystem.imageTexture,
          ...visualStyleSystem.lightingLogic,
          ...visualStyleSystem.colorSystem,
          ...visualStyleSystem.typographyRules,
          ...visualStyleSystem.compositionRules
        ],
        "llm_inference",
        "B",
        {
          sourceNote: "基于产品识图、市场验证和用户补充生成的视觉风格体系"
        }
      )
    })
  };
}

export const useProjectStore = create<ProjectState & ProjectActions>((set, get) => ({
  ...initialState,
  setUploadedImages: (images) => {
    const firstImage = images[0] ?? null;

    set({
      uploadedImages: images,
      imagePreviewUrl: firstImage?.previewUrl ?? null,
      imageName: firstImage?.imageName ?? null,
      imageSize: firstImage?.imageSize ?? null,
      status: images.length ? "ready" : "idle",
      globalStatus: images.length ? "idle" : "idle",
      stepStates: createInitialStepStates(),
      error: null,
      currentStepIndex: images.length ? Math.max(get().currentStepIndex, 0) : 0,
      productAnalysis: null,
      marketResearch: null,
      mainImages: [],
      detailPages: [],
      prompts: [],
      generationMeta: {},
      planningSession: createPlanningSession(firstImage?.imageName ?? "AI电商视觉策划多轮会话")
    });
  },
  removeUploadedImage: (index) => {
    const nextImages = get().uploadedImages.filter((_, itemIndex) => itemIndex !== index);
    const firstImage = nextImages[0] ?? null;

    set({
      uploadedImages: nextImages,
      imagePreviewUrl: firstImage?.previewUrl ?? null,
      imageName: firstImage?.imageName ?? null,
      imageSize: firstImage?.imageSize ?? null,
      status: nextImages.length ? "ready" : "idle",
      globalStatus: nextImages.length ? "idle" : "idle",
      stepStates: createInitialStepStates(),
      error: null,
      currentStepIndex: nextImages.length ? get().currentStepIndex : 0,
      productAnalysis: null,
      marketResearch: null,
      mainImages: [],
      detailPages: [],
      prompts: [],
      generationMeta: {},
      planningSession: createPlanningSession(firstImage?.imageName ?? "AI电商视觉策划多轮会话")
    });
  },
  setManualProductInfo: (payload) =>
    set({
      manualProductInfo: payload,
      error: null
    }),
  setOutputScope: (scope) =>
    set({
      outputScope: scope,
      mainImages: [],
      detailPages: [],
      prompts: [],
      activeTab: "product",
      generationMeta: {
        ...get().generationMeta,
        design: undefined,
        prompts: undefined
      },
      error: null
    }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setError: (message) =>
    set({
      error: message,
      status: message ? "error" : get().status,
      globalStatus: message ? "error" : get().globalStatus
    }),
  markExportSuccess: () =>
    set({
      stepStates: markStepSuccess(get().stepStates, "export")
    }),
  markExportFailed: (message) =>
    set({
      stepStates: markStepFailed(get().stepStates, "export", message),
      globalStatus: "partial_completed",
      error: message
    }),
  resetProject: () =>
    set({
      ...initialState,
      stepStates: createInitialStepStates(),
      generationMeta: {},
      planningSession: createPlanningSession()
    }),
  retryStep: async (step) => {
    const providerConfig = useProviderStore.getState().getActiveConfig();
    const searchConfig = useSearchProviderStore.getState().getActiveConfig();
    const state = get();
    const manualProductInfo = state.manualProductInfo;
    const outputScope = state.outputScope;
    let activeTurnId: string | null = null;
    const beginTurn = (title: string, inputSummary: string) => {
      const started = startPlanningTurn(get().planningSession, {
        step,
        title,
        inputSummary
      });
      set({ planningSession: started.session });
      activeTurnId = started.turnId;
      return started.turnId;
    };
    const completeTurn = (turnId: string, outputSummary: string, generationMeta?: GenerationMeta) => {
      set({
        planningSession: completePlanningTurn(get().planningSession, turnId, outputSummary, generationMeta)
      });
      activeTurnId = null;
    };

    try {
      set({
        status: "running",
        globalStatus: "processing",
        error: null,
        stepStates: markStepPending(get().stepStates, step, true)
      });

      if (step === "product") {
        const turnId = beginTurn(
          "产品识图重试",
          `图片${state.uploadedImages.length || (state.imagePreviewUrl ? 1 : 0)}张；用户补充=${JSON.stringify(manualProductInfo ?? {})}`
        );
        const images = state.uploadedImages.length
          ? state.uploadedImages
          : state.imagePreviewUrl && state.imageName && state.imageSize
            ? [{ previewUrl: state.imagePreviewUrl, imageName: state.imageName, imageSize: state.imageSize }]
            : [];

        if (!images.length) throw new Error("请先上传至少一张产品图片。");
        if (!getProviderCapabilities(providerConfig).supportsVision) {
          throw new Error("当前模型不支持图片识别，请换用支持视觉理解的模型。");
        }

        const apiImages = getApiImages(images);
        const productAnalysis = await postJson<ProductAnalysis>("/api/analyze-product", {
          imageBase64: apiImages[0]?.apiUrl,
          imageBase64s: apiImages.map((image) => image.apiUrl),
          imageName: apiImages[0]?.imageName,
          imageNames: apiImages.map((image) => image.imageName),
          imageSize: apiImages[0]?.apiSize,
          imageSizes: apiImages.map((image) => image.apiSize),
          manualProductInfo,
          providerConfig
        });
        const productMeta = createGenerationMeta("product", {
          sourceType: providerConfig ? "real_ai" : "mock",
          usedAI: Boolean(providerConfig),
          usedMock: !providerConfig,
          usedFallback: !providerConfig,
          evidenceLevel: providerConfig ? "A" : "C",
          note: providerConfig ? "产品识图使用当前配置的视觉模型。" : "未配置页面 AI，产品识图使用演示数据。",
          ...providerMeta(providerConfig)
        });

        set({
          productAnalysis,
          activeTab: "product",
          currentStepIndex: 1,
          generationMeta: {
            ...get().generationMeta,
            product: productMeta
          },
          stepStates: markStepSuccess(get().stepStates, "product")
        });
        completeTurn(turnId, summarizeProductAnalysis(productAnalysis), productMeta);
      }

      if (step === "research") {
        const turnId = beginTurn(
          "市场验证重试",
          `产品=${get().productAnalysis?.productNameGuess ?? get().productAnalysis?.category ?? "未识别"}；用户补充=${JSON.stringify(manualProductInfo ?? {})}`
        );
        const productAnalysis = get().productAnalysis;
        if (!productAnalysis) throw new Error("请先完成产品识图，再重试市场验证。");

        const marketResearch = await postJson<MarketResearch>("/api/research-product", {
          productAnalysis,
          manualProductInfo,
          providerConfig,
          searchConfig
        });
        const researchMeta = inferMarketGenerationMeta(marketResearch, providerConfig);
        set({
          marketResearch,
          activeTab: "market",
          currentStepIndex: 2,
          generationMeta: {
            ...get().generationMeta,
            research: researchMeta
          },
          stepStates: markStepSuccess(get().stepStates, "research")
        });
        completeTurn(turnId, summarizeMarketResearch(marketResearch), researchMeta);
      }

      if (step === "style") {
        const { productAnalysis, marketResearch } = get();
        const turnId = beginTurn(
          "视觉风格体系重试",
          `产品=${productAnalysis?.productNameGuess ?? "未识别"}；市场摘要=${marketResearch ? summarizeMarketResearch(marketResearch) : "尚未完成市场验证"}`
        );
        if (!productAnalysis || !marketResearch) throw new Error("请先完成产品识图和市场验证，再重试视觉风格。");

        const visualStyleSystem = await postJson<VisualStyleSystem>("/api/generate-visual-style", {
          productAnalysis,
          marketResearch,
          manualProductInfo,
          providerConfig,
          searchConfig
        });
        const productAnalysisWithVisualStyle = mergeManualInfoIntoProductArchive(
          productAnalysis,
          visualStyleSystem,
          manualProductInfo
        );
        const styleMeta = createGenerationMeta("style", {
          sourceType: providerConfig ? "real_ai" : "mock",
          usedAI: Boolean(providerConfig),
          usedMock: !providerConfig,
          usedFallback: !providerConfig,
          evidenceLevel: providerConfig ? "B" : "C",
          note: providerConfig ? "视觉风格体系由 AI 结合产品档案和市场输入生成。" : "视觉风格体系使用演示模式生成。",
          ...providerMeta(providerConfig)
        });
        set({
          productAnalysis: productAnalysisWithVisualStyle,
          activeTab: "product",
          currentStepIndex: 3,
          generationMeta: {
            ...get().generationMeta,
            style: styleMeta
          },
          stepStates: markStepSuccess(get().stepStates, "style")
        });
        completeTurn(
          turnId,
          `视觉风格：${visualStyleSystem.overallTone.slice(0, 3).join("、")}；构图：${visualStyleSystem.compositionRules.slice(0, 2).join("、")}`,
          styleMeta
        );
      }

      if (step === "design") {
        const turnId = beginTurn(
          "主图与详情页策划重试",
          summarizePlanningSessionForAI(get().planningSession)
        );
        const { productAnalysis, marketResearch } = get();
        if (!productAnalysis || !marketResearch) throw new Error("请先完成产品识图和市场验证，再重试策划方案。");

        const design = await postJson<DesignPlanGenerationResult>("/api/generate-design-plan", {
          productAnalysis,
          marketResearch,
          manualProductInfo,
          providerConfig,
          outputScope,
          planningContext: summarizePlanningSessionForAI(get().planningSession)
        });
        const designMeta = design.generationMeta ?? createGenerationMeta("design", {
          sourceType: "real_ai",
          usedAI: true,
          usedMock: false,
          usedFallback: false,
          evidenceLevel: "B",
          note: "策划方案由 AI 生成。",
          ...providerMeta(providerConfig)
        });
        set({
          mainImages: design.mainImages,
          detailPages: design.detailPages,
          activeTab: resultTabForScope(outputScope),
          currentStepIndex: 4,
          generationMeta: {
            ...get().generationMeta,
            design: designMeta
          },
          stepStates: markStepSuccess(get().stepStates, "design")
        });
        completeTurn(turnId, summarizeDesignPlan(design), designMeta);
      }

      if (step === "prompts") {
        const turnId = beginTurn(
          "AI 生图提示词重试",
          summarizePlanningSessionForAI(get().planningSession)
        );
        const { productAnalysis, marketResearch, mainImages, detailPages } = get();
        if (
          !productAnalysis ||
          (wantsMainImages(outputScope) && !mainImages.length) ||
          (wantsDetailPages(outputScope) && !detailPages.length)
        ) {
          throw new Error("请先生成当前输出范围对应的策划方案，再重试提示词。");
        }

        const promptResult = await postJson<PromptGenerationResult>("/api/generate-prompts", {
          productAnalysis,
          designPlan: { mainImages, detailPages },
          marketResearch,
          manualProductInfo,
          providerConfig,
          outputScope,
          planningContext: summarizePlanningSessionForAI(get().planningSession)
        });
        validatePromptResultCoverage(promptResult, outputScope, mainImages, detailPages);
        const promptMeta = promptResult.generationMeta ?? createGenerationMeta("prompts", {
          sourceType: "real_ai",
          usedAI: true,
          usedMock: false,
          usedFallback: false,
          evidenceLevel: "B",
          note: "提示词由 AI 生成。",
          ...providerMeta(providerConfig)
        });
        set({
          prompts: promptResult.prompts,
          activeTab: "prompts",
          currentStepIndex: 5,
          generationMeta: {
            ...get().generationMeta,
            prompts: promptMeta
          },
          stepStates: markStepSuccess(get().stepStates, "prompts")
        });
        completeTurn(turnId, summarizePrompts(promptResult.prompts), promptMeta);
      }

      const nextStepStates = get().stepStates;
      const requiredSteps: Array<keyof WorkflowStepStates> = ["product", "research", "style", "design", "prompts"];
      const isCompleted = requiredSteps.every((item) => nextStepStates[item].status === "success");
      set({
        status: isCompleted ? "completed" : "ready",
        globalStatus: isCompleted ? "completed" : "partial_completed",
        error: null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "步骤重试失败。";
      const nextStepStates = markStepFailed(get().stepStates, step, message);
      set({
        planningSession: failPlanningTurn(get().planningSession, activeTurnId, message),
        stepStates: nextStepStates,
        status: step === "product" && !get().productAnalysis ? "error" : "ready",
        globalStatus: step === "product" && !get().productAnalysis ? "error" : "partial_completed",
        error: message
      });
    }
  },
  runAnalysis: async () => {
    const { uploadedImages, imagePreviewUrl, imageName, imageSize, manualProductInfo, outputScope } = get();
    const images = uploadedImages.length
      ? uploadedImages
      : imagePreviewUrl && imageName && imageSize
        ? [{ previewUrl: imagePreviewUrl, imageName, imageSize }]
        : [];

    if (!images.length) {
      set({ error: "请先上传至少一张产品图片。", status: "error" });
      return;
    }

    const providerConfig = useProviderStore.getState().getActiveConfig();
    const searchConfig = useSearchProviderStore.getState().getActiveConfig();
    const providerCapabilities = getProviderCapabilities(providerConfig);

    if (!providerCapabilities.supportsVision) {
      const message = "当前模型不支持图片识别，请换用支持视觉理解的模型。";
      set({
        status: "error",
        globalStatus: "error",
        error: message,
        stepStates: markStepFailed(get().stepStates, "product", message)
      });
      return;
    }

    let failedStep: keyof WorkflowStepStates = "product";
    let activeTurnId: string | null = null;
    const beginTurn = (step: keyof WorkflowStepStates, title: string, inputSummary: string) => {
      const started = startPlanningTurn(get().planningSession, {
        step,
        title,
        inputSummary
      });
      set({ planningSession: started.session });
      activeTurnId = started.turnId;
      return started.turnId;
    };
    const completeTurn = (turnId: string, outputSummary: string, generationMeta?: GenerationMeta) => {
      set({
        planningSession: completePlanningTurn(get().planningSession, turnId, outputSummary, generationMeta)
      });
      activeTurnId = null;
    };

    try {
      const apiImages = getApiImages(images);
      const freshPlanningSession = createPlanningSession(
        manualProductInfo.productName || imageName || "AI电商视觉策划多轮会话"
      );

      set({
        status: "running",
        globalStatus: "processing",
        error: null,
        stepStates: createInitialStepStates(),
        currentStepIndex: 1,
        activeTab: "product",
        productAnalysis: null,
        marketResearch: null,
        mainImages: [],
        detailPages: [],
        prompts: [],
        generationMeta: {},
        planningSession: freshPlanningSession
      });

      set({ stepStates: markStepPending(get().stepStates, "product") });
      const productTurnId = beginTurn(
        "product",
        "第1轮：产品识图",
        `上传图片${apiImages.length}张；文件=${apiImages.map((image) => image.imageName).join("、")}；用户补充=${JSON.stringify(manualProductInfo ?? {})}`
      );
      const productAnalysis = await postJson<ProductAnalysis>("/api/analyze-product", {
        imageBase64: apiImages[0]?.apiUrl,
        imageBase64s: apiImages.map((image) => image.apiUrl),
        imageName: apiImages[0]?.imageName,
        imageNames: apiImages.map((image) => image.imageName),
        imageSize: apiImages[0]?.apiSize,
        imageSizes: apiImages.map((image) => image.apiSize),
        manualProductInfo,
        providerConfig
      });
      const productMeta = createGenerationMeta("product", {
        sourceType: providerConfig ? "real_ai" : "mock",
        usedAI: Boolean(providerConfig),
        usedMock: !providerConfig,
        usedFallback: !providerConfig,
        evidenceLevel: providerConfig ? "A" : "C",
        note: providerConfig ? "产品识图使用当前配置的视觉模型。" : "未配置页面 AI，产品识图使用演示数据。",
        ...providerMeta(providerConfig)
      });
      set({ productAnalysis, currentStepIndex: 1, activeTab: "product", stepStates: markStepSuccess(get().stepStates, "product") });
      set({
        generationMeta: {
          ...get().generationMeta,
          product: productMeta
        }
      });
      completeTurn(productTurnId, summarizeProductAnalysis(productAnalysis), productMeta);
      await pause();

      failedStep = "research";
      set({ stepStates: markStepPending(get().stepStates, "research") });
      const researchTurnId = beginTurn(
        "research",
        "第2轮：市场验证与用户资料提炼",
        `基于产品=${productAnalysis.productNameGuess || productAnalysis.category}；用户竞品资料长度=${manualProductInfo.competitorText?.length ?? 0}；评论资料长度=${manualProductInfo.reviewText?.length ?? 0}`
      );
      const marketResearch = await postJson<MarketResearch>("/api/research-product", {
        productAnalysis,
        manualProductInfo,
        providerConfig,
        searchConfig
      });
      const researchMeta = inferMarketGenerationMeta(marketResearch, providerConfig);
      set({ marketResearch, currentStepIndex: 2, activeTab: "market", stepStates: markStepSuccess(get().stepStates, "research") });
      set({
        generationMeta: {
          ...get().generationMeta,
          research: researchMeta
        }
      });
      completeTurn(researchTurnId, summarizeMarketResearch(marketResearch), researchMeta);
      await pause();

      failedStep = "style";
      set({ stepStates: markStepPending(get().stepStates, "style") });
      const styleTurnId = beginTurn(
        "style",
        "第3轮：视觉风格体系",
        summarizePlanningSessionForAI(get().planningSession)
      );
      const visualStyleSystem = await postJson<VisualStyleSystem>("/api/generate-visual-style", {
        productAnalysis,
        marketResearch,
        manualProductInfo,
        providerConfig,
        searchConfig
      });
      const productAnalysisWithVisualStyle = mergeManualInfoIntoProductArchive(
        productAnalysis,
        visualStyleSystem,
        manualProductInfo
      );
      const styleMeta = createGenerationMeta("style", {
        sourceType: providerConfig ? "real_ai" : "mock",
        usedAI: Boolean(providerConfig),
        usedMock: !providerConfig,
        usedFallback: !providerConfig,
        evidenceLevel: providerConfig ? "B" : "C",
        note: providerConfig ? "视觉风格体系由 AI 结合产品档案和市场输入生成。" : "视觉风格体系使用演示模式生成。",
        ...providerMeta(providerConfig)
      });
      set({ productAnalysis: productAnalysisWithVisualStyle, currentStepIndex: 3, activeTab: "product", stepStates: markStepSuccess(get().stepStates, "style") });
      set({
        generationMeta: {
          ...get().generationMeta,
          style: styleMeta
        }
      });
      completeTurn(
        styleTurnId,
        `风格=${visualStyleSystem.overallTone.slice(0, 3).join("、")}；质感=${visualStyleSystem.imageTexture.slice(0, 2).join("、")}；构图=${visualStyleSystem.compositionRules.slice(0, 2).join("、")}`,
        styleMeta
      );
      await pause();

      failedStep = "design";
      set({ currentStepIndex: 4, stepStates: markStepPending(get().stepStates, "design") });
      const designTurnId = beginTurn(
        "design",
        "第4轮：主图与详情页销售策划",
        summarizePlanningSessionForAI(get().planningSession)
      );
      const design = await postJson<DesignPlanGenerationResult>("/api/generate-design-plan", {
        productAnalysis: productAnalysisWithVisualStyle,
        marketResearch,
        manualProductInfo,
        providerConfig,
        outputScope,
        planningContext: summarizePlanningSessionForAI(get().planningSession)
      });
      const designMeta = design.generationMeta ?? createGenerationMeta("design", {
        sourceType: "real_ai",
        usedAI: true,
        usedMock: false,
        usedFallback: false,
        evidenceLevel: "B",
        note: "策划方案由 AI 生成。",
        ...providerMeta(providerConfig)
      });
      set({
        mainImages: design.mainImages,
        detailPages: design.detailPages,
        activeTab: resultTabForScope(outputScope),
        currentStepIndex: 4,
        generationMeta: {
          ...get().generationMeta,
          design: designMeta
        },
        stepStates: markStepSuccess(get().stepStates, "design")
      });
      completeTurn(designTurnId, summarizeDesignPlan(design), designMeta);
      await pause();

      failedStep = "prompts";
      set({ stepStates: markStepPending(get().stepStates, "prompts") });
      const promptTurnId = beginTurn(
        "prompts",
        "第5轮：AI 生图提示词",
        summarizePlanningSessionForAI(get().planningSession)
      );
      const promptResult = await postJson<PromptGenerationResult>("/api/generate-prompts", {
        productAnalysis: productAnalysisWithVisualStyle,
        designPlan: design,
        marketResearch,
        manualProductInfo,
        providerConfig,
        outputScope,
        planningContext: summarizePlanningSessionForAI(get().planningSession)
      });
      validatePromptResultCoverage(promptResult, outputScope, design.mainImages, design.detailPages);
      const promptMeta = promptResult.generationMeta ?? createGenerationMeta("prompts", {
        sourceType: "real_ai",
        usedAI: true,
        usedMock: false,
        usedFallback: false,
        evidenceLevel: "B",
        note: "提示词由 AI 生成。",
        ...providerMeta(providerConfig)
      });

      set({
        prompts: promptResult.prompts,
        status: "completed",
        globalStatus: "completed",
        activeTab: "prompts",
        currentStepIndex: 5,
        generationMeta: {
          ...get().generationMeta,
          prompts: promptMeta
        },
        stepStates: markStepSuccess(get().stepStates, "prompts")
      });
      completeTurn(promptTurnId, summarizePrompts(promptResult.prompts), promptMeta);
    } catch (error) {
      const message = error instanceof Error ? error.message : "分析流程出现未知错误。";
      const nextStepStates = markStepFailed(get().stepStates, failedStep, message);
      const shouldBlock = failedStep === "product" && !get().productAnalysis;
      set({
        planningSession: failPlanningTurn(get().planningSession, activeTurnId, message),
        status: shouldBlock ? "error" : "ready",
        globalStatus: shouldBlock ? "error" : hasAnySuccessfulStep(nextStepStates) ? "partial_completed" : "error",
        stepStates: nextStepStates,
        error: message
      });
    }
  }
}));
