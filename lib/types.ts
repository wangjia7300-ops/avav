export type InfoSource =
  | "image_fact"
  | "user_input"
  | "web_search"
  | "llm_inference"
  | "mock";

export type EvidenceLevel =
  | "S"
  | "A"
  | "B"
  | "C"
  | "forbidden";

export type SourcedInfo = {
  text: string;
  source?: InfoSource;
  evidenceLevel?: EvidenceLevel;
  sourceLink?: string;
  sourceNote?: string;
};

export type ProductEvidenceField =
  | "category"
  | "productNameGuess"
  | "appearance"
  | "visibleFeatures"
  | "materials"
  | "colors"
  | "styleKeywords"
  | "risks"
  | "brandNames"
  | "brandVisualStyle"
  | "specifications"
  | "sellingPoints"
  | "dataSellingPoints"
  | "targetAudience"
  | "parameters"
  | "productDetails"
  | "visualStyleSystem";

export type MarketEvidenceField =
  | "hotSellingPoints"
  | "userPainPoints"
  | "userFeedbackPros"
  | "userFeedbackCons"
  | "copywritingSellingPoints"
  | "certificationSellingPoints"
  | "featureSellingPoints"
  | "dataSellingPointInsights"
  | "userQuestions"
  | "aiShoppingInsights"
  | "targetUserProfiles"
  | "functionProblemMapping"
  | "targetAudienceInsights"
  | "productParameterInsights"
  | "productDetailInsights"
  | "designStyleJudgement"
  | "competitorTitleStyles"
  | "visualStyles"
  | "competitorVisualBenchmarks"
  | "designStrategyNotes";

export type EvidenceMap<TField extends string> = Partial<Record<TField, SourcedInfo[]>>;

export type ProductAnalysis = {
  category: string;
  productNameGuess: string;
  appearance: string[];
  visibleFeatures: string[];
  materials: string[];
  colors: string[];
  styleKeywords: string[];
  risks: string[];
  brandNames?: {
    chinese?: string;
    english?: string;
  };
  brandVisualStyle?: string[];
  specifications?: string[];
  sellingPoints?: string[];
  dataSellingPoints?: string[];
  targetAudience?: string[];
  parameters?: string[];
  productDetails?: string[];
  specialRequirements?: {
    needModel?: string;
    needScene?: string;
    needDataVisualization?: string;
    others?: string[];
  };
  visualStyleSystem?: VisualStyleSystem;
  visualAnchor?: ProductVisualAnchor;
  evidence?: EvidenceMap<ProductEvidenceField>;
};

export type ProductVisualAnchor = {
  categoryShape: string;
  mainColor: string;
  secondaryColor?: string;
  materialLook?: string;
  keyParts: string[];
  proportions?: string;
  mustKeep: string[];
  mustAvoid: string[];
};

export type ProductDriveType = "rational_functional" | "emotional_aesthetic";

export type OutputScope = "all" | "main_only" | "detail_only";

export type UploadedProductImage = {
  id?: string;
  previewUrl: string;
  analysisUrl?: string;
  imageName: string;
  imageSize: number;
  originalSize?: number;
  compressedSize?: number;
  width?: number;
  height?: number;
};

export type ProductManualInfo = {
  productName?: string;
  category?: string;
  brand?: string;
  productDriveType?: ProductDriveType;
  sellingPoints?: string;
  targetAudience?: string;
  competitorText?: string;
  reviewText?: string;
  targetPlatform?: string;
  priceRange?: string;
  salesRange?: string;
  notes?: string;
};

export type VisualStyleSystem = {
  overallTone: string[];
  imageTexture: string[];
  lightingLogic: string[];
  colorSystem: string[];
  typographyRules: string[];
  compositionRules: string[];
};

export type MarketResearch = {
  hotSellingPoints: string[];
  userPainPoints: string[];
  userFeedbackPros?: string[];
  userFeedbackCons?: string[];
  copywritingSellingPoints?: string[];
  certificationSellingPoints?: string[];
  featureSellingPoints?: string[];
  dataSellingPointInsights?: string[];
  userQuestions?: string[];
  aiShoppingInsights?: string[];
  targetUserProfiles?: string[];
  functionProblemMapping?: string[];
  targetAudienceInsights?: string[];
  productParameterInsights?: string[];
  productDetailInsights?: string[];
  designStyleJudgement?: string[];
  competitorTitleStyles: string[];
  visualStyles: string[];
  competitorVisualBenchmarks?: string[];
  designStrategyNotes?: string[];
  competitorAnalysis?: CompetitorAnalysisResult;
  reviewInsight?: ReviewInsightResult;
  sourceNote?: string;
  evidence?: EvidenceMap<MarketEvidenceField>;
};

export type PlanCopywriting = {
  headline: string;
  subheadline?: string;
  body?: string;
};

export type PlanVisualGuidelines = {
  overallTone: string;
  imageTexture: string;
  lightingLogic: string;
  colorPaletteSystem: string;
  typographyRules: string;
  compositionRules: string;
  productAppearanceFeatures: string;
  unifiedVisualStyle: string;
};

export type FabCopyAsset = {
  feature: string;
  advantage?: string;
  benefit?: string;
  scene?: string;
  painPoint?: string;
  desirePoint?: string;
  emotionalTrigger?: string;
  proof?: string;
  claimBoundary?: string;
  headlineAngle?: string;
};

export type SellingPointAsset = {
  name: string;
  source: InfoSource;
  evidenceLevel: EvidenceLevel;
  feature: string;
  advantage?: string;
  benefit?: string;
  scene?: string;
  painPoint?: string;
  desirePoint?: string;
  emotionalTrigger?: string;
  proof?: string;
  claimBoundary?: string;
  userPainPoint?: string;
  userBenefit?: string;
  suitableFor: Array<"main_image" | "detail_page" | "prompt" | "forbidden">;
  expressionStrength: "strong" | "medium" | "soft";
  priority: "P0" | "P1" | "P2";
  fab?: FabCopyAsset;
};

export type MainImageExpressionMethod =
  | "number"
  | "scene"
  | "comparison"
  | "person"
  | "pain_point";

export type UserDecisionPath = {
  productCategory: string;
  productType: string;
  userSegments: string[];
  decisionPath: string[];
  coreQuestions: string[];
  purchaseTriggers: string[];
  hesitationPoints: string[];
  evidenceBoundary: string;
};

export interface MainClickReason {
  productCategory: string;
  productType: string;
  userDecisionPath: string[];
  primaryClickReason: string;
  selectedSellingPointAssetId: string;
  expressionMethod: MainImageExpressionMethod;
  userPainPoint?: string;
  expectedUserBenefit: string;
  proofOrBoundary: string;
  whyThisWillTriggerClick: string;
}

export type DetailFunnelStage =
  | "attention"
  | "resonance"
  | "need"
  | "solution"
  | "proof"
  | "comparison"
  | "scene_desire"
  | "trust"
  | "detail_confirmation"
  | "risk_reversal"
  | "conversion";

export interface DetailPageFunnelPlan {
  screenIndex: number;
  funnelStage: DetailFunnelStage;
  screenRole: string;
  userQuestionAnswered: string;
  userPainPoint?: string;
  sellingPointAssetIds: string[];
  headline: string;
  subheadline: string;
  body: string;
  visualStrategy: string;
  proofOrBoundary: string;
  conversionPurpose: string;
}

export interface CompetitorAnalysisResult {
  competitorCount: number;
  mainImagePatterns: string[];
  titleKeywordLibrary: string[];
  sellingPointPatterns: string[];
  pricePositionMap: Array<{
    priceRange: string;
    commonSellingPoints: string[];
    visualStyle: string;
  }>;
  differentiationOpportunities: string[];
  evidenceNote: string;
}

export interface ReviewInsightResult {
  reviewCount: number;
  topPurchaseReasons: string[];
  topPainPoints: string[];
  userConcerns: string[];
  usageScenarios: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  sellingPointWordCloud: string[];
  reviewWordCloud: string[];
  conversionOpportunities: string[];
}

export type MainImagePlan = {
  index: number;
  title: string;
  goal: string;
  scene: string;
  layout: string;
  imageBrief?: string;
  textImageLayout?: string;
  visualFocus?: string;
  visualGuidelines?: PlanVisualGuidelines;
  copywriting: PlanCopywriting;
  visualElements: string[];
  assignedSellingPoint?: SellingPointAsset;
  role?: string;
  primaryClickReason?: string;
  expressionMethod?: MainImageExpressionMethod;
  visualStrategy?: string;
  productSizeRatio?: "60-80%";
  compositionRule?: string;
  proofOrBoundary?: string;
  clickTriggerExplanation?: string;
  mainClickReason?: MainClickReason;
  generationMeta?: GenerationMeta;
};

export type DetailPagePlan = {
  index: number;
  title: string;
  goal: string;
  layout: string;
  imageBrief?: string;
  textImageLayout?: string;
  visualFocus?: string;
  visualGuidelines?: PlanVisualGuidelines;
  copywriting: PlanCopywriting;
  visualElements: string[];
  structureMode?: DetailPageStructureMode;
  structureNote?: string;
  assignedSellingPoint?: SellingPointAsset;
  funnelStage?: DetailFunnelStage;
  screenRole?: string;
  userQuestionAnswered?: string;
  userPainPoint?: string;
  sellingPointAssetIds?: string[];
  visualStrategy?: string;
  proofOrBoundary?: string;
  conversionPurpose?: string;
  generationMeta?: GenerationMeta;
};

export type PromptPlatform = "gpt";

export type DetailPageStructureMode = "full" | "cropped" | "lightweight";

export type DetailPageStructureMeta = {
  mode: DetailPageStructureMode;
  screenCount: number;
  defaultScreenCount: number;
  reason: string;
  mergedScreens?: string[];
  downgradedScreens?: string[];
  evidenceSummary?: string;
};

export type PromptTextLayer = {
  headline?: string;
  subheadline?: string;
  body?: string;
  labels?: string[];
  cta?: string;
  layoutHint?: string;
};

export type GeneratedPrompt = {
  imageType: "main_image" | "detail_page";
  index: number;
  title: string;
  backgroundPrompt: string;
  textLayer: PromptTextLayer;
  negativePrompt: string;
  generationMeta?: GenerationMeta;
};

export type PromptCoverageIssue = {
  imageType: "main_image" | "detail_page";
  index: number;
  title?: string;
};

export type PromptCoverageMeta = {
  expectedCount: number;
  receivedCount: number;
  missing: PromptCoverageIssue[];
  duplicates: PromptCoverageIssue[];
  unexpected: PromptCoverageIssue[];
  batchCount?: number;
};

export type WorkflowStepId =
  | "upload"
  | "product"
  | "research"
  | "style"
  | "design"
  | "prompts"
  | "export";

export type AnalysisStatus = "idle" | "ready" | "running" | "completed" | "error";

export type GlobalAnalysisStatus =
  | "idle"
  | "processing"
  | "partial_completed"
  | "completed"
  | "error";

export type StepStatus =
  | "idle"
  | "pending"
  | "success"
  | "failed";

export type WorkflowStepState = {
  status: StepStatus;
  errorMessage?: string;
  retryCount: number;
  startedAt?: string;
  completedAt?: string;
};

export type WorkflowStepStates = Record<Exclude<WorkflowStepId, "upload">, WorkflowStepState>;

export type GenerationStepId = Exclude<WorkflowStepId, "upload">;

export type GenerationSourceType =
  | "real_ai"
  | "web_search"
  | "user_input"
  | "ai_inference"
  | "mock"
  | "template_fallback"
  | "not_generated";

export type GenerationMeta = {
  step: GenerationStepId;
  sourceType: GenerationSourceType;
  usedAI: boolean;
  usedMock: boolean;
  usedFallback: boolean;
  usedSearch?: boolean;
  evidenceLevel?: EvidenceLevel;
  providerName?: string;
  model?: string;
  fallbackReason?: string;
  note?: string;
  generatedAt: string;
};

export type GenerationMetaMap = Partial<Record<GenerationStepId, GenerationMeta>>;

export type PlanningTurnStatus = "pending" | "success" | "failed";

export type PlanningTurn = {
  id: string;
  step: GenerationStepId;
  title: string;
  status: PlanningTurnStatus;
  inputSummary: string;
  outputSummary?: string;
  errorMessage?: string;
  generationMeta?: GenerationMeta;
  startedAt: string;
  completedAt?: string;
};

export type PlanningSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: PlanningTurn[];
};

export type DesignPlanGenerationResult = {
  mainImages: MainImagePlan[];
  detailPages: DetailPagePlan[];
  detailStructure?: DetailPageStructureMeta;
  generationMeta?: GenerationMeta;
};

export type PromptGenerationResult = {
  prompts: GeneratedPrompt[];
  generationMeta?: GenerationMeta;
  promptCoverage?: PromptCoverageMeta;
};

export type GeneratedImageAsset = {
  imageUrl: string;
  mimeType: string;
  model: string;
  size: string;
  revisedPrompt?: string;
  createdAt: string;
};

export type ResultTab =
  | "product"
  | "market"
  | "mainImages"
  | "detailPages"
  | "prompts";

export type AIProviderId =
  | "openai"
  | "volcengine"
  | "deepseek"
  | "anthropic"
  | "moonshot"
  | "zhipu"
  | "custom";

export type AIProviderConfig = {
  providerId: AIProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
  displayName?: string;
  capabilities?: ProviderCapabilities;
};

export type ProviderCapabilities = {
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  supportsWebSearch: boolean;
  supportsLongContext: boolean;
};

export type SearchProviderId = "serpapi" | "firecrawl";

export type SearchProviderConfig = {
  providerId: SearchProviderId;
  apiKey: string;
};

export type ProjectState = {
  uploadedImages: UploadedProductImage[];
  imagePreviewUrl: string | null;
  imageName: string | null;
  imageSize: number | null;
  manualProductInfo: ProductManualInfo;
  outputScope: OutputScope;
  status: AnalysisStatus;
  globalStatus: GlobalAnalysisStatus;
  stepStates: WorkflowStepStates;
  currentStepIndex: number;
  activeTab: ResultTab;
  productAnalysis: ProductAnalysis | null;
  marketResearch: MarketResearch | null;
  mainImages: MainImagePlan[];
  detailPages: DetailPagePlan[];
  prompts: GeneratedPrompt[];
  generationMeta: GenerationMetaMap;
  planningSession: PlanningSession;
  error: string | null;
};
