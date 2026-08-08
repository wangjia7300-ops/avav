export type AIProviderId =
  | "openai"
  | "volcengine"
  | "gemini"
  | "anthropic"
  | "zhipu"
  | "custom";

export type AIProviderConfig = {
  providerId: AIProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
  displayName?: string;
};

export type ImageProviderId = "openai" | "volcengine" | "custom";

export type ImageProviderConfig = {
  scope: "image_generation";
  providerId: ImageProviderId;
  apiKey: string;
  baseURL: string;
  imageModel: string;
};

export type GeneratedImageAsset = {
  imageUrl: string;
  mimeType: string;
  model: string;
  size: string;
  revisedPrompt?: string;
  width?: number;
  height?: number;
  referenceImagesUsed?: number;
  createdAt: string;
};

export type WorkflowStage = "research" | "planning" | "execution" | "qa";

export type ProjectAsset = {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
};

type EvidenceStatus = "verified" | "candidate" | "blocked";

export type EvidenceSourceType =
  | "visual_observation"
  | "image_text"
  | "user_input"
  | "model_inference";

export type EvidenceClaimScope =
  | "appearance"
  | "visible_text"
  | "specification"
  | "material"
  | "performance"
  | "mechanism"
  | "service"
  | "promotion";

export type EvidenceEntityType =
  | "product"
  | "brand"
  | "decorative_badge"
  | "specification"
  | "feature"
  | "material"
  | "other";

export type EvidenceFact = {
  id: string;
  label: string;
  value: string;
  evidence: string;
  sourceAssetIds: string[];
  sourceType: EvidenceSourceType;
  claimScope: EvidenceClaimScope;
  entityType: EvidenceEntityType;
  ocrConfidence: number;
  status: EvidenceStatus;
  commercialUse: boolean;
};

export type VisualAuditDimension = {
  key:
    | "composition"
    | "sellingHierarchy"
    | "color"
    | "typography"
    | "visualPath"
    | "material"
    | "algorithmFit"
    | "emotion";
  title: string;
  finding: string;
  recommendation: string;
};

export type ProductResearch = {
  productName: string;
  category: string;
  brand: string;
  summary: string;
  facts: EvidenceFact[];
  visualAudit: VisualAuditDimension[];
  visualKeywords: string[];
  risks: string[];
  source: "model" | "sample";
  generatedAt: string;
};

export type SupplementalBrief = {
  priceRange: string;
  platform: string;
  promotionMoment: string;
  competitorDifference: string;
  geoGoal: string;
  brandAssets: string;
  productProofs: string;
  targetAudience: string;
  tone: string;
  notes: string;
};

type CopyBlock = {
  headline: string;
  subheadline: string;
  body: string;
  keyPoints: string[];
};

/** Backward-compatible name for the authoritative per-screen CopyBlock. */
export type ScreenCopy = CopyBlock;

export type DetailScreen = {
  id: string;
  index: number;
  /**
   * Deterministic owner for this screen's information task. It is assigned by
   * the server contract and cannot be changed during a repair pass.
   */
  subjectKey: string;
  /**
   * The single user question this screen must answer. Copy may improve the
   * wording, but a repair cannot switch to another question or selling point.
   */
  userQuestion: string;
  role: string;
  conversionTask: string;
  primarySellingPoint: string;
  claimScope: EvidenceClaimScope | "creative" | "mixed";
  evidenceIds: string[];
  proofMethod: string;
  copy: ScreenCopy;
  scene: string;
  shot: string;
  composition: string;
  transition: string;
};

type AudiencePersona = {
  name: string;
  context: string;
  pain: string;
  decisionTrigger: string;
};

export type DetailPlanFoundation = {
  productPositioning: string;
  coreSellingPoints: string[];
  personas: AudiencePersona[];
  decisionChain: string[];
  globalVisualDirection: string;
};

export type DetailPlan = {
  productPositioning: string;
  coreSellingPoints: string[];
  personas: AudiencePersona[];
  decisionChain: string[];
  globalVisualDirection: string;
  screens: DetailScreen[];
  source: "model" | "sample";
  generatedAt: string;
};

export type ExecutionMode = "A" | "B" | "D" | "E";

export type ScreenExecution = {
  screenId: string;
  copyFinal: ScreenCopy;
  visualInstruction: string;
  visualPrompt: string;
  /** 历史字段名；当前保存服务端编译、实际发送给即梦的中文生图指令。 */
  englishPrompt: string;
  /** 历史字段名；当前仅表示一条简短中文约束，不是独立 API 参数。 */
  negativePrompt: string;
  geo: {
    query: string;
    answer: string;
    entities: string[];
  };
  productionReference: {
    information: string;
    wireframe: string;
    typography: string;
    sceneDirection: string;
    palette: string[];
    darkMode: string;
    designNotes: string;
  };
  aiLabel: "AI辅助生成";
  source: "model" | "sample";
  generatedAt: string;
};

export type ExecutionRunStatus =
  | "not_started"
  | "queued"
  | "running"
  | "succeeded"
  | "failed_retryable"
  | "blocked"
  | "stale"
  | "cancelled";

type QAFindingSeverity = "error" | "warning" | "pass";

export type QAFinding = {
  id: string;
  severity: QAFindingSeverity;
  module: string;
  screenId?: string;
  title: string;
  evidence: string;
  fix: string;
};

type QAStatus =
  | "incomplete"
  | "rules_only"
  | "prompt_complete"
  | "blocked";

type QACheckState = "evaluated" | "not_evaluated";

export type QACoverage = {
  expectedScreens: 15;
  planScreens: number;
  executionScreens: number;
  generatedImageScreens: number;
  pixelVerifiedScreens: number;
  missingPlanIds: string[];
  missingExecutionIds: string[];
  missingImageIds: string[];
  unexpectedPlanIds: string[];
  unexpectedExecutionIds: string[];
};

export type QANotEvaluated = {
  check: "semantic" | "render" | "pixel";
  status: "not_evaluated";
  reason: string;
  screenIds?: string[];
};

type PublishDecision = "not_ready" | "review_required" | "ready";

export type QAReport = {
  status: QAStatus;
  coverage: QACoverage;
  checks: {
    rules: QACheckState;
    semantic: QACheckState;
    render: QACheckState;
    pixel: QACheckState;
  };
  notEvaluated: QANotEvaluated[];
  publishDecision: PublishDecision;
  findings: QAFinding[];
  summary: string;
  source: "rules" | "rules+model";
  generatedAt: string;
};

export type DetailPageProject = {
  id: string;
  name: string;
  assets: ProjectAsset[];
  brief: SupplementalBrief;
  research: ProductResearch | null;
  plan: DetailPlan | null;
  executions: Record<string, ScreenExecution>;
  qa: QAReport | null;
  updatedAt: string;
};
