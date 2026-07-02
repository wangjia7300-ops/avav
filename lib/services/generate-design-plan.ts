import { shouldUseMockData } from "@/lib/config";
import { getMarketEvidenceTexts } from "@/lib/evidence";
import { createAIChatCompletion } from "@/lib/services/openai-client";
import { ServiceError } from "@/lib/services/errors";
import {
  hasRealTrustEvidence,
  hasReliableParameters,
  sanitizePlanCompliance
} from "@/lib/services/compliance";
import {
  sanitizeCopywritingOutput,
  validateCopywriting
} from "@/lib/services/copywriting-guardrails";
import { buildCompetitorAnalysis } from "@/lib/services/competitor-analysis";
import {
  rewriteCopyWithFab,
  scoreCopywritingByFab
} from "@/lib/services/fab-copywriting";
import { selectMainClickReason } from "@/lib/services/main-click-reason";
import { buildReviewInsight } from "@/lib/services/review-insight";
import {
  buildSellingPointAssets,
  selectAssetForSlot
} from "@/lib/services/selling-point-assets";
import { buildUserDecisionPath } from "@/lib/services/user-decision-path";
import { designPlanSchema, mainImagesSchema, detailPagesSchema } from "@/lib/services/schemas/product-analysis-schema";
import type {
  AIProviderConfig,
  DetailFunnelStage,
  DetailPageStructureMeta,
  DesignPlanGenerationResult,
  GenerationMeta,
  DetailPagePlan,
  MainImagePlan,
  MainImageExpressionMethod,
  MarketResearch,
  OutputScope,
  PlanVisualGuidelines,
  ProductManualInfo,
  ProductAnalysis,
  SellingPointAsset,
  UserDecisionPath
} from "@/lib/types";
import type { ChatCompletionParams } from "@/lib/ai-providers";

type GenerateDesignPlanInput = {
  productAnalysis: ProductAnalysis;
  marketResearch: MarketResearch;
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

function outputScopeInstruction(scope: OutputScope) {
  if (scope === "main_only") {
    return "本次用户只需要【主图策划与主图提示词】，不要生成详情页方案。";
  }

  if (scope === "detail_only") {
    return "本次用户只需要【详情页策划与详情页提示词】，不要生成主图方案。";
  }

  return "本次用户需要完整方案：5张主图 + 详情页方案 + 全部提示词。";
}

function createDesignGenerationMeta(
  input: GenerateDesignPlanInput,
  payload: Partial<GenerationMeta>
): GenerationMeta {
  return {
    step: "design",
    sourceType: payload.sourceType ?? "real_ai",
    usedAI: payload.usedAI ?? Boolean(input.providerConfig?.apiKey && input.providerConfig?.model),
    usedMock: payload.usedMock ?? false,
    usedFallback: payload.usedFallback ?? false,
    usedSearch: payload.usedSearch,
    evidenceLevel: payload.evidenceLevel ?? "B",
    providerName: payload.providerName ?? input.providerConfig?.displayName ?? input.providerConfig?.providerId,
    model: payload.model ?? input.providerConfig?.model ?? designPlanModel(),
    fallbackReason: payload.fallbackReason,
    note: payload.note,
    generatedAt: payload.generatedAt ?? new Date().toISOString()
  };
}

function attachDesignGenerationMeta<T extends { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] }>(
  result: T,
  meta: GenerationMeta
): T & { generationMeta: GenerationMeta } {
  return {
    ...result,
    generationMeta: meta,
    mainImages: result.mainImages.map((item) => ({ ...item, generationMeta: meta })),
    detailPages: result.detailPages.map((item) => ({ ...item, generationMeta: meta }))
  };
}

const visualGuidelinesJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "overallTone",
    "imageTexture",
    "lightingLogic",
    "colorPaletteSystem",
    "typographyRules",
    "compositionRules",
    "productAppearanceFeatures",
    "unifiedVisualStyle"
  ],
  properties: {
    overallTone: { type: "string" },
    imageTexture: { type: "string" },
    lightingLogic: { type: "string" },
    colorPaletteSystem: { type: "string" },
    typographyRules: { type: "string" },
    compositionRules: { type: "string" },
    productAppearanceFeatures: { type: "string" },
    unifiedVisualStyle: { type: "string" }
  }
} as const;

const MAIN_IMAGE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "index",
    "title",
    "goal",
    "scene",
    "layout",
    "imageBrief",
    "textImageLayout",
    "visualFocus",
    "visualGuidelines",
    "copywriting",
    "visualElements"
  ],
  properties: {
    index: { type: "number" },
    title: { type: "string" },
    goal: { type: "string" },
    scene: { type: "string" },
    layout: { type: "string" },
    imageBrief: { type: "string" },
    textImageLayout: { type: "string" },
    visualFocus: { type: "string" },
    visualGuidelines: visualGuidelinesJsonSchema,
    copywriting: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "subheadline", "body"],
      properties: {
        headline: { type: "string" },
        subheadline: { type: "string" },
        body: { type: "string" }
      }
    },
    visualElements: { type: "array", items: { type: "string" } }
  }
} as const;

const DETAIL_PAGE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "index",
    "title",
    "goal",
    "layout",
    "imageBrief",
    "textImageLayout",
    "visualFocus",
    "visualGuidelines",
    "copywriting",
    "visualElements"
  ],
  properties: {
    index: { type: "number" },
    title: { type: "string" },
    goal: { type: "string" },
    layout: { type: "string" },
    imageBrief: { type: "string" },
    textImageLayout: { type: "string" },
    visualFocus: { type: "string" },
    visualGuidelines: visualGuidelinesJsonSchema,
    copywriting: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "subheadline", "body"],
      properties: {
        headline: { type: "string" },
        subheadline: { type: "string" },
        body: { type: "string" }
      }
    },
    visualElements: { type: "array", items: { type: "string" } }
  }
} as const;

// 旧单次模式仍使用：一次产出 mainImages + detailPages
const designPlanJsonSchema = {
  name: "ecommerce_design_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["mainImages", "detailPages"],
    properties: {
      mainImages: {
        type: "array",
        minItems: 5,
        items: MAIN_IMAGE_ITEM_SCHEMA
      },
      detailPages: {
        type: "array",
        minItems: 8,
        maxItems: 14,
        items: DETAIL_PAGE_ITEM_SCHEMA
      }
    }
  }
} as const;

// 分批模式：仅主图
const mainImagesOnlySchema = {
  name: "ecommerce_main_images",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["mainImages"],
    properties: {
      mainImages: {
        type: "array",
        minItems: 5,
        items: MAIN_IMAGE_ITEM_SCHEMA
      }
    }
  }
} as const;

// 分批模式：仅详情页，按本批屏数固定数量
function buildDetailPagesSchema(count: number) {
  return {
    name: "ecommerce_detail_pages",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["detailPages"],
      properties: {
        detailPages: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: DETAIL_PAGE_ITEM_SCHEMA
        }
      }
    }
  } as const;
}

function uniqueItems(items: string[], limit: number) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function firstItem(items: string[], fallback: string) {
  return items.find((item) => item.trim()) ?? fallback;
}

function splitManualItems(value?: string) {
  return (value ?? "")
    .split(/[、，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCandidateItems(items: Array<string | undefined>) {
  return items.flatMap((item) => splitManualItems(item));
}

type DetailExpansionKind = "standard" | "electronics" | "bio" | "material" | "mixed";

type DetailExpansionProfile = {
  shouldExpand: boolean;
  targetCount: 14;
  kind: DetailExpansionKind;
  reason: string;
  specialEffectRule: string;
};

function countKeywordMatches(text: string, keywords: string[]) {
  return keywords.filter((keyword) => text.includes(keyword)).length;
}

function buildProductSignalText(
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo
) {
  return [
    manualProductInfo?.category,
    manualProductInfo?.productName,
    manualProductInfo?.brand,
    manualProductInfo?.sellingPoints,
    manualProductInfo?.notes,
    product.category,
    product.productNameGuess,
    product.brandNames?.chinese,
    product.brandNames?.english,
    ...product.appearance,
    ...product.visibleFeatures,
    ...product.materials,
    ...product.colors,
    ...product.styleKeywords,
    ...(product.sellingPoints ?? []),
    ...(product.parameters ?? []),
    ...(product.specifications ?? []),
    ...(product.productDetails ?? []),
    ...market.hotSellingPoints,
    ...market.visualStyles,
    ...(market.productParameterInsights ?? []),
    ...(market.productDetailInsights ?? []),
    ...(market.designStyleJudgement ?? []),
    ...(market.copywritingSellingPoints ?? []),
    ...(market.featureSellingPoints ?? []),
    ...(market.dataSellingPointInsights ?? []),
    ...(market.targetUserProfiles ?? []),
    ...(market.functionProblemMapping ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isMotorPointText(text?: string) {
  return /电机|马达|motor|无刷|直流变频|变频|纯铜|铜芯|铜线/.test(
    sanitizeCommercialText(text).toLowerCase()
  );
}

function getMotorDrivenProductProfile(
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo
) {
  const signalText = buildProductSignalText(product, market, manualProductInfo);
  const fanLike = /风扇|电风扇|循环扇|空气循环扇|冷风扇|空调扇|落地扇|台扇|塔扇|吊扇|风机|送风|扇叶|风叶|摇头/.test(signalText);
  const motorLike = /高速电机|纯铜电机|无刷电机|直流变频电机|电机|马达|motor|无刷|直流变频|变频|纯铜|铜芯|铜线/.test(signalText);

  if (!fanLike || !motorLike) {
    return null;
  }

  const detectedMotorTerms = uniqueItems(
    [
      /直流变频/.test(signalText) ? "直流变频电机" : "",
      /无刷/.test(signalText) ? "无刷电机" : "",
      /纯铜|铜芯|铜线/.test(signalText) ? "纯铜电机" : ""
    ],
    3
  );
  const motorName = detectedMotorTerms[0] ?? "电机结构";
  const airflowCopy = fanLike ? "带动扇叶更稳定" : "动力路径更清楚";
  const resultCopy = fanLike ? "风路走向看得见" : "运行逻辑看得见";

  return {
    motorName,
    detectedMotorTerms,
    bodyLines: uniqueItems([`${motorName}可视化`, airflowCopy, resultCopy], 3),
    subheadline: fanLike ? "动力稳，风感更顺" : "动力稳，使用更顺",
    imageBrief: fanLike
      ? `以「${motorName}」为视觉重点，使用半透明 C4D 剖面/爆炸拆解，展示电机、扇叶联动和蓝色气流路径；产品实物保持真实比例，右侧用短标签说明动力稳定、送风连续，不展示功率和转速数字。`
      : `以「${motorName}」为视觉重点，使用半透明 C4D 剖面/爆炸拆解，展示电机位置、动力路径和关键结构标注；产品实物保持真实比例，用短标签说明运行更稳定，不展示功率和转速数字。`
  };
}

function getDetailExpansionProfile(
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo
): DetailExpansionProfile {
  const signalText = buildProductSignalText(product, market, manualProductInfo);
  const electronicsKeywords = [
    "电子",
    "数码",
    "家电",
    "电器",
    "智能",
    "芯片",
    "电机",
    "电池",
    "电路",
    "传感",
    "屏幕",
    "led",
    "蓝牙",
    "充电",
    "无线",
    "风扇",
    "冷风扇",
    "空调扇",
    "洗地机",
    "扫地机",
    "吸尘器",
    "摄像",
    "耳机",
    "音箱",
    "手机",
    "电脑",
    "相机"
  ];
  const bioKeywords = [
    "化妆",
    "护肤",
    "美妆",
    "保健",
    "营养",
    "膳食",
    "胶囊",
    "片剂",
    "口服液",
    "精华",
    "面霜",
    "乳液",
    "防晒",
    "洗护",
    "成分",
    "配方",
    "分子",
    "生物",
    "活性",
    "肽",
    "胶原",
    "烟酰胺",
    "玻尿酸",
    "透明质酸",
    "益生菌",
    "维生素",
    "氨基酸",
    "植物提取",
    "酵母",
    "a醇"
  ];
  const materialKeywords = [
    "特殊材料",
    "新材料",
    "纳米",
    "石墨烯",
    "碳纤维",
    "钛",
    "陶瓷",
    "合金",
    "涂层",
    "镀层",
    "抗菌",
    "抑菌",
    "纤维",
    "膜",
    "多层",
    "复合材料",
    "微孔",
    "晶体",
    "导热",
    "散热"
  ];
  const explicitEffectKeywords = [
    "3d",
    "c4d",
    "建模",
    "爆炸图",
    "分子",
    "微观",
    "机理",
    "结构解析",
    "透明拆解",
    "剖面",
    "粒子",
    "能量流",
    "科技感"
  ];

  const electronicsScore = countKeywordMatches(signalText, electronicsKeywords);
  const bioScore = countKeywordMatches(signalText, bioKeywords);
  const materialScore = countKeywordMatches(signalText, materialKeywords);
  const explicitEffectScore = countKeywordMatches(signalText, explicitEffectKeywords);
  const matchedKinds: DetailExpansionKind[] = [];

  if (electronicsScore >= 2 || (electronicsScore >= 1 && explicitEffectScore >= 1)) {
    matchedKinds.push("electronics");
  }

  if (bioScore >= 2 || (bioScore >= 1 && explicitEffectScore >= 1)) {
    matchedKinds.push("bio");
  }

  if (materialScore >= 2 || (materialScore >= 1 && explicitEffectScore >= 1)) {
    matchedKinds.push("material");
  }

  if (!matchedKinds.length) {
    return {
      shouldExpand: false,
      targetCount: 14,
      kind: "standard",
      reason: "常规产品，14 屏详情页足够完成痛点、卖点、场景、参数、信任和收口。",
      specialEffectRule: "不强行增加 3D/C4D 或分子可视化页面，避免为了炫技而拉长详情页。"
    };
  }

  const kind: Exclude<DetailExpansionKind, "standard"> =
    matchedKinds.length > 1
      ? "mixed"
      : (matchedKinds[0] as Exclude<DetailExpansionKind, "standard">);
  const reasonMap: Record<Exclude<DetailExpansionKind, "standard">, string> = {
    electronics:
      "识别到电子/数码/家电/智能设备属性，产品结构、工作路径或核心技术适合用 3D/C4D/爆炸图辅助用户理解。",
    bio:
      "识别到护肤/化妆品/保健品/成分配方属性，成分、质地、分子或作用路径适合用 3D 分子/微观可视化辅助说明。",
    material:
      "识别到特殊材料/工艺/涂层/微观结构属性，适合用 3D 材料结构、剖面或 C4D 工艺层级增强信任。",
    mixed:
      "识别到多个适合微观或结构可视化的属性，详情页需要在 14 屏内安排 3D/C4D/分子/材料解析表达辅助转化。"
  };
  const ruleMap: Record<Exclude<DetailExpansionKind, "standard">, string> = {
    electronics:
      "保持 14 屏：把结构爆炸图、核心技术路径、场景性能模拟、安全耐用结构等 C4D/3D 视觉表达放进核心卖点、参数可视化或信任证据屏内；不得编造芯片、电路、功率、续航等未确认参数。",
    bio:
      "保持 14 屏：把成分分子可视化、质地/吸收路径示意、微观质感特写、配方安全背书等 3D 表达放进核心卖点、参数可视化或信任证据屏内；不得做医疗化承诺或夸大功效。",
    material:
      "保持 14 屏：把材料微观结构、工艺层级剖面、性能场景验证、材料信任证明等 3D/C4D 表达放进核心卖点、参数可视化或信任证据屏内；不得编造检测数据或认证。",
    mixed:
      "保持 14 屏：根据运营策划需要在核心卖点、参数可视化或信任证据屏内加入 3D/C4D/分子/材料解析，优先解释用户看不见但影响购买判断的结构、材料、机理或质地。"
  };

  return {
    shouldExpand: false,
    targetCount: 14,
    kind,
    reason: reasonMap[kind],
    specialEffectRule: ruleMap[kind]
  };
}

function hasManualInfo(info?: ProductManualInfo) {
  return Boolean(info && Object.values(info).some(Boolean));
}

function manualInfoToSummary(info?: ProductManualInfo) {
  if (!hasManualInfo(info)) {
    return "";
  }

  return [
    info?.productName ? `产品名称/型号：${info.productName}` : "",
    info?.category ? `产品品类：${info.category}` : "",
    info?.brand ? `品牌：${info.brand}` : "",
    info?.productDriveType ? `商品驱动类型：${info.productDriveType === "emotional_aesthetic" ? "感性美学型" : "理性功能型"}` : "",
    info?.targetAudience ? `目标人群：${info.targetAudience}` : "",
    info?.targetPlatform ? `目标平台：${info.targetPlatform}` : "",
    info?.priceRange ? `价格/销量线索：${info.priceRange}` : "",
    info?.sellingPoints ? `已知卖点：${info.sellingPoints}` : "",
    info?.competitorText ? `竞品资料：${info.competitorText.slice(0, 300)}` : "",
    info?.reviewText ? `用户评论资料：${info.reviewText.slice(0, 300)}` : "",
    info?.notes ? `策划补充：${info.notes}` : ""
  ]
    .filter(Boolean)
    .join("；");
}

const forbiddenWordReplacements: Array<[RegExp, string]> = [
  [/替代空调/g, "辅助降温"],
  [/空调替代/g, "辅助降温"],
  [/国家级/g, "专业感"],
  [/世界级/g, "高级感"],
  [/行业第一/g, "表现出色"],
  [/全网第一/g, "更受关注"],
  [/排名第一/g, "更受关注"],
  [/第一/g, "优先选择"],
  [/NO\.?1/gi, "优选"],
  [/最强/g, "更强"],
  [/最佳/g, "更适合"],
  [/最好/g, "更好"],
  [/最高/g, "更高"],
  [/最低/g, "更低"],
  [/最大/g, "更大"],
  [/最小/g, "更小"],
  [/最省/g, "更省"],
  [/顶级/g, "高级"],
  [/绝对/g, ""],
  [/100%/g, ""],
  [/保证/g, "帮助"],
  [/最终/g, "收口"],
  [/最后/g, "收口"]
];

function sanitizeCommercialText(text?: string) {
  return forbiddenWordReplacements
    .reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text ?? "")
    .replace(/最/g, "更")
    .replace(/\[待确认\]|\[需确认\]|待确认|需人工复核|需要人工复核/g, "")
    .replace(/来自当前资料|按当前资料表达|按当前资料下判断/g, "按已知信息表达")
    .replace(/实际使用时(?:，|,)?[^，。；;]{0,30}变成可看见的使用结果/g, "按真实场景展示")
    .replace(/场景里一眼懂|点开理由很清楚|结果更好判断|更好判断|判断更轻松/g, "信息更容易看清")
    .replace(/好评如潮|用户都说好/g, "真实评价有来源再展示")
    .replace(/品质认证|权威认证|官方认证|全线通过/g, "真实凭证有来源再展示")
    .replace(/销量领先|排名靠前|排名第一/g, "市场数据有来源再展示")
    .replace(/高效制冷|快速降温|解暑神器|降温佳品|替代空调/g, "送风体验按资料表达")
    .replace(/温暖心境/g, "真实场景感")
    .replace(/收口转化收口/g, "转化收口")
    .replace(/更终/g, "收口")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；、,.])/g, "$1")
    .trim();
}

function compactText(text: string | undefined, max = 42) {
  const value = sanitizeCommercialText(text)
    .replace(/^(?:第[一二三四五六七八九十]+优先级|核心卖点|已知卖点|卖点|参数|规格)\s*[:：]\s*/, "")
    .replace(/^(?:第一|第二|第三|第四|第五|第六)\s*[:：]\s*/, "")
    .replace(/\s+/g, "");
  const firstClause = value.split(/[。；;]/)[0]?.split(/，(?=.{8,})/)[0] ?? value;
  return Array.from(firstClause).slice(0, max).join("");
}

function isUsefulSellingPoint(text: string) {
  const value = sanitizeCommercialText(text);

  if (!value || value.length < 2) {
    return false;
  }

  if (
    /用户补充|需要解决|目标人群|购买动机|决策顾虑|触达渠道|整体调性|画面质感|布光逻辑|色彩|字体|构图|统一视觉|产品外观|PANTONE|真实比例的|用户补充方向/.test(value)
  ) {
    return false;
  }

  if (
    /\d+\s*(?:w|W|cm|mm|mAh|v|V|kg|g|ml|L|升|分钟|小时|分贝|db|dB)/.test(value) &&
    !/扇叶|叶片|档|风速|容量|续航|净含量|含量/.test(value)
  ) {
    return false;
  }

  return true;
}

function isParameterLikeText(text: string) {
  const value = sanitizeCommercialText(text);
  return /\d+\s*(?:w|W|cm|mm|mAh|v|V|kg|g|ml|L|升|分钟|小时|分贝|db|dB)/.test(value);
}

function collectSellingPoints(items: Array<string | undefined>, limit = 8) {
  return uniqueItems(
    splitCandidateItems(items)
      .map((item) => compactText(item, 32))
      .filter(isUsefulSellingPoint),
    limit
  );
}

function compactList(items: Array<string | undefined>, limit = 4, maxChars = 24) {
  return uniqueItems(
    splitCandidateItems(items)
      .map((item) => compactText(item, maxChars))
      .filter(Boolean),
    limit
  );
}

function headlineFromPoint(point: string, fallback = "看完就懂") {
  const value = sanitizeCommercialText(point);
  const keyword = compactText(
    value
      .replace(/^(?:核心卖点|热门卖点|文案卖点|特征卖点|数据卖点|卖点|参数|功能)\s*[:：]\s*/, "")
      .replace(/产品|主体|核心|卖点|功能|参数|体验|使用|日常/g, "")
      .replace(/[，。；;、,.].*$/, ""),
    8
  );

  if (/尺寸|规格|大小|重量|容量|包装|型号/.test(value)) {
    return "重点看清楚";
  }

  if (/便携|移动|折叠|轻量|收纳|挂|可拆|安装|调节/.test(value)) {
    return "少点折腾";
  }

  if (/低噪|噪音|静音|柔和|亲肤|舒适|透气|护眼|缓震/.test(value)) {
    return "久用少打扰";
  }

  if (/材质|工艺|玻璃|金属|塑料|硅胶|木|棉|皮|涂层|一体|纹理/.test(value)) {
    return "细节看得见";
  }

  if (/安全|防护|防滑|防烫|保护|认证|保障|售后/.test(value)) {
    return "用前少顾虑";
  }

  if (/清洁|净化|吸收|保湿|显色|防水|防摔|加热|制冷|送风|照明|收纳|支撑|稳定|快速|高效/.test(value)) {
    return keyword ? `${keyword}看得见` : fallback;
  }

  return limitChars(keyword || value, 10, fallback);
}

function subheadlineFromPoint(point: string, audience: string, fallback = "使用结果更清楚") {
  const value = sanitizeCommercialText(point);
  const scene = sanitizeCommercialText(audience || "日常");

  if (/尺寸|规格|大小|重量|容量|包装|型号/.test(value)) {
    return "买前重点先看明白";
  }

  if (/便携|移动|折叠|轻量|收纳|挂|可拆|安装|调节/.test(value)) {
    return `${scene}用，少点来回折腾`;
  }

  if (/低噪|噪音|静音|柔和|亲肤|舒适|透气|护眼|缓震/.test(value)) {
    return `${scene}用，长时间少打扰`;
  }

  if (/材质|工艺|玻璃|金属|塑料|硅胶|木|棉|皮|涂层|一体|纹理/.test(value)) {
    return "近看细节更有依据";
  }

  if (/安全|防护|防滑|防烫|保护|认证|保障|售后/.test(value)) {
    return "把担心点提前说明白";
  }

  if (/清洁|净化|吸收|保湿|显色|防水|防摔|加热|制冷|送风|照明|收纳|支撑|稳定|快速|高效/.test(value)) {
    return `${scene}里，结果更容易看见`;
  }

  return limitChars(`${scene}里，${headlineFromPoint(value, "结果更清楚")}`, 20, fallback);
}

function bodyLinesForPoint(point: string, audience: string) {
  const sub = subheadlineFromPoint(point, audience);
  const value = sanitizeCommercialText(point);

  if (/尺寸|规格|大小|重量|容量|包装|型号/.test(value)) {
    return normalizeBodyCopy("", [
      sub,
      "信息先讲清",
      "买前少猜测"
    ]);
  }

  if (/便携|移动|折叠|轻量|收纳|挂|可拆|安装|调节/.test(value)) {
    return normalizeBodyCopy("", [
      sub,
      "位置更好安排",
      "用完也好收"
    ]);
  }

  if (/低噪|噪音|静音|柔和|亲肤|舒适|透气|护眼|缓震/.test(value)) {
    return normalizeBodyCopy("", [
      sub,
      "长时间少打扰",
      "场景更容易待住"
    ]);
  }

  if (/材质|工艺|玻璃|金属|塑料|硅胶|木|棉|皮|涂层|一体|纹理/.test(value)) {
    return normalizeBodyCopy("", [
      sub,
      "细节给出证据",
      "质感不靠空话"
    ]);
  }

  return normalizeBodyCopy("", [
    sub,
    "场景里能看懂",
    "结果讲得更实在"
  ]);
}

function kvHeadlineFromPoint(point: string, fallback = "一眼就想用") {
  const value = sanitizeCommercialText(point);
  return headlineFromPoint(point, fallback);
}

function limitChars(text: string | undefined, max: number, fallback: string) {
  const value = sanitizeCommercialText(text) || fallback;
  return Array.from(value).slice(0, max).join("");
}

function splitCopyLines(text: string | undefined) {
  return (text ?? "")
    .split(/[。；;\n]/)
    .flatMap((item) => item.split(/(?<=，)/))
    .map((item) => sanitizeCommercialText(item).replace(/[。；;，,]+$/g, ""))
    .filter(Boolean);
}

function normalizeBodyCopy(text: string | undefined, fallbackLines: string[]) {
  const lines = splitCopyLines(text);
  const nextLines = (lines.length ? lines : fallbackLines)
    .map((line) => limitChars(line, 15, ""))
    .filter(Boolean)
    .slice(0, 3);

  return nextLines.join("\n");
}

function toSceneEffectSellingPoint(point: string, scene: string, audience: string) {
  const cleanPoint = sanitizeCommercialText(point);
  const cleanAudience = sanitizeCommercialText(audience || "日常使用");
  const cleanScene = sanitizeCommercialText(scene || cleanAudience);

  if (!cleanPoint) {
    return `${cleanAudience}先看清重点`;
  }

  if (/场景|空间|客厅|厨房|办公室|宿舍|门店|家居|户外|餐桌|卧室|书房/.test(cleanPoint)) {
    return `${cleanPoint}，一看就代入`;
  }

  return `${cleanScene}用，${cleanPoint}`;
}

const typographySystemRule =
  "字体统一使用思源黑体 / 阿里巴巴普惠体 / HarmonyOS Sans，不混乱换字体。文案层级：主标题 64–76px Heavy/Bold（主图 1:1 方图为 54–68px），4–10 字，可并列两排；副标题 32–40px Medium（主图 26–34px），12–18 字；标签文字 24–30px Medium；参数小字 20–24px Regular。只有存在真实参数、价格、规格或用户补充资料时，才使用数字重点字；只有存在真实品牌英文或用户补充短句时，才使用英文小字。标题与正文字号差≥8pt，标题、副标题、正文和标签按黄金比例优化字号、字重、行距、间距和留白层级。";

const layoutSystemRule =
  "每张图片必须包含中文主标题、中文副标题和必要的正文/标签排版；线性图标 UI、信息卡片和图形标签按本屏卖点需要使用。英文辅助小字、数字卖点、品牌区、Logo 或认证元素必须有图片识别、用户补充或搜索资料支撑；没有真实来源时不得生成英文 slogan、品牌字样、Logo、认证、排名、销量或虚构数字。标题位置统一在画面顶部 12%–18% 区域，主标题、副标题、正文说明统一左对齐，不使用居中或右对齐；正文在标题下方，标签和重点信息放在文案附近。产品不能被文字遮挡，文字与产品保持安全距离。画面高级留白充足，遵循黄金分割和模块化构图，模块之间至少预留24px视觉停顿，信息层次清晰不堆满文字。字体、字重、标题位置和信息区位置固定，整套页面保持有秩序的统一排版。";

const conversionVisualRule =
  "视觉动线采用 F 型引导：顶部横向扫视承接主标题/核心利益点，左侧纵向浏览承接卖点证据和说明，核心卖点落在高关注度热区；闭眼3秒再睁开，第一眼必须看到本屏最想让用户看的核心信息。CTA 若出现在收口屏或决策屏，必须做全宽按钮，使用主色系最饱和色+白色文字，上下留白=左右留白×1.5。";

const visualCreativeRule =
  "视觉必须大胆新颖、场景高清、整体有美感且高级，整套视觉风格统一不割裂。突出产品核心卖点并做可视化表达，产品展示角度多元化。创意使用道具、光影、局部放大、数据图、分子/材料/内部爆炸式拆分等方式体现卖点，不喧宾夺主。常规屏以产品为视觉中心；功能、材料、成分分子或内部结构屏可以不展示完整产品，但必须让用户理解该卖点如何服务购买决策。";

const trustEvidenceRule =
  "信任构建必须用证据链而不是空声明：资质证明只展示真实可确认的1-2个关键证据，包含证书编号/发证机关/有效期等高亮信息；用户证言写成谁+用了多久+什么效果；买家评价区包含头像+星级+短评，带图评价优先，每条之间1px浅灰分割线；保障条款旁使用盾牌/印章图标，深蓝色图标+深灰色文字；销量数据如果有来源则单独成行，数字深绿加粗+单位灰色小字；价格对比仅在用户提供价格时出现，原价灰色小字、现价橙红大字，未提供价格时改用权益/保障条，不编造价格、证书、销量和评价。";

function joinGuidelineItems(items: Array<string | undefined>, fallback: string) {
  return uniqueItems(
    items
      .map((item) => sanitizeCommercialText(item))
      .map((item) => compactText(item, 36))
      .filter(Boolean),
    5
  ).join("、") || fallback;
}

function buildPlanVisualGuidelines(
  product: ProductAnalysis,
  market: MarketResearch,
  params: {
    aspectRatio: "1:1 方图" | "2:3 竖版";
    scene?: string;
    layout?: string;
    visualElements?: string[];
    manualProductInfo?: ProductManualInfo;
  }
): PlanVisualGuidelines {
  const styleSystem = product.visualStyleSystem;
  const productFeatures = uniqueItems(
    [
      ...product.appearance,
      ...product.visibleFeatures,
      ...product.materials,
      ...product.colors,
      ...(product.productDetails ?? [])
    ],
    10
  );
  const visualDirection = joinGuidelineItems(
    [
      ...(styleSystem?.overallTone ?? []),
      ...market.visualStyles,
      ...product.styleKeywords
    ],
    "高级、真实、场景共情、电商转化型视觉"
  );

  return {
    overallTone: visualDirection,
    imageTexture: joinGuidelineItems(
      [
        ...(styleSystem?.imageTexture ?? []),
        "高清商业摄影",
        "真实产品质感",
        "画面干净但不使用纯色空背景"
      ],
      "高清商业摄影、真实产品质感、画面干净但不使用纯色空背景"
    ),
    lightingLogic: joinGuidelineItems(
      [
        ...(styleSystem?.lightingLogic ?? []),
        "柔和主光",
        "产品边缘轮廓光",
        "卖点区域轻高光"
      ],
      "柔和主光、产品边缘轮廓光、卖点区域轻高光"
    ),
    colorPaletteSystem: joinGuidelineItems(
      [
        ...(styleSystem?.colorSystem ?? []),
        ...product.colors,
        "主色不超过3种",
        "辅助色服务卖点层级"
      ],
      "参考产品真实配色，主色不超过3种，辅助色服务卖点层级"
    ),
    typographyRules: typographySystemRule,
    compositionRules: joinGuidelineItems(
      [
        ...(styleSystem?.compositionRules ?? []),
        params.aspectRatio,
        params.layout,
        "顶部标题区",
        "标题顶部左对齐",
        "F型视觉动线",
        "高级留白",
        "黄金分割构图",
        "产品主体优先",
        "核心卖点落在高关注热区",
        "模块间24px留白",
        "文案不遮挡产品",
        "移动端安全边距"
      ],
      `${params.aspectRatio}，顶部标题区，标题顶部左对齐，F型视觉动线，高级留白，黄金分割，产品主体优先，核心卖点落在高关注热区，模块间24px留白，移动端安全边距`
    ),
    productAppearanceFeatures:
      compactList(productFeatures, 5, 22).join("、") || "保持参考图外观、结构比例、材质质感和关键细节",
    unifiedVisualStyle: joinGuidelineItems(
      [
        params.scene,
        ...(params.visualElements ?? []),
        "整套画面统一视觉语言",
        "不割裂",
        "线性图标 UI",
        "文字不遮挡产品",
        "留白充足"
      ],
      "整套画面统一视觉语言，不割裂，线性图标 UI，文字不遮挡产品，留白充足"
    )
  };
}

function extractJsonLikeText(text: string) {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const objectStart = clean.indexOf("{");
  const objectEnd = clean.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return clean.slice(objectStart, objectEnd + 1);
  }

  return clean;
}

function parseDesignPlanJson(text: string) {
  const cleanText = extractJsonLikeText(text);

  try {
    const parsed = JSON.parse(cleanText) as Record<string, unknown>;
    const container =
      parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
        ? (parsed.data as Record<string, unknown>)
        : parsed;

    return designPlanSchema.parse({
      mainImages:
        container.mainImages ??
        container.main_images ??
        container.mainImagePlans ??
        container.main_image_plans,
      detailPages:
        container.detailPages ??
        container.detail_pages ??
        container.detailPagePlans ??
        container.detail_page_plans
    });
  } catch {
    throw new ServiceError("AI 返回格式异常，请重试", {
      statusCode: 502,
      code: "AI_RESPONSE_SCHEMA_INVALID"
    });
  }
}

function unwrapJsonContainer(text: string): Record<string, unknown> {
  const parsed = JSON.parse(extractJsonLikeText(text)) as Record<string, unknown>;
  return parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
    ? (parsed.data as Record<string, unknown>)
    : parsed;
}

// 分批模式：仅解析主图数组
function parseMainImagesJson(text: string): MainImagePlan[] {
  try {
    const container = unwrapJsonContainer(text);
    return mainImagesSchema.parse({
      mainImages:
        container.mainImages ?? container.main_images ?? container.mainImagePlans ?? container.main_image_plans
    });
  } catch {
    throw new ServiceError("AI 主图返回格式异常，请重试", {
      statusCode: 502,
      code: "AI_RESPONSE_SCHEMA_INVALID"
    });
  }
}

// 分批模式：仅解析详情页数组
function parseDetailPagesJson(text: string): DetailPagePlan[] {
  try {
    const container = unwrapJsonContainer(text);
    return detailPagesSchema.parse({
      detailPages:
        container.detailPages ?? container.detail_pages ?? container.detailPagePlans ?? container.detail_page_plans
    });
  } catch {
    throw new ServiceError("AI 详情页返回格式异常，请重试", {
      statusCode: 502,
      code: "AI_RESPONSE_SCHEMA_INVALID"
    });
  }
}

function buildFallbackDesignPlan(
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo
): {
  mainImages: MainImagePlan[];
  detailPages: DetailPagePlan[];
} {
  const manualSellingPoints = splitManualItems(manualProductInfo?.sellingPoints);
  const manualSellingPointsForCopy = manualSellingPoints.filter(isUsefulSellingPoint);
  const manualAudience = splitManualItems(manualProductInfo?.targetAudience);
  const manualNotes = splitManualItems(manualProductInfo?.notes);
  const category = manualProductInfo?.category || product.category || product.productNameGuess || "产品";
  const productName = manualProductInfo?.productName || product.productNameGuess || category;
  const displayName = manualProductInfo?.brand
    ? `${manualProductInfo.brand} ${productName}`
    : productName;
  const sellingPointPool = collectSellingPoints(
    [
      manualProductInfo?.sellingPoints,
      ...(product.sellingPoints ?? []),
      ...getMarketEvidenceTexts(market, "copywritingSellingPoints"),
      ...getMarketEvidenceTexts(market, "hotSellingPoints"),
      ...getMarketEvidenceTexts(market, "featureSellingPoints"),
      ...product.visibleFeatures
    ],
    8
  );
  const heroFeature = firstItem(sellingPointPool, "核心卖点");
  const secondFeature =
    sellingPointPool[1] ??
    "使用体验";
  const mainPain = firstItem(market.userPainPoints, "用户使用痛点");
  const manualDirection = manualNotes.length ? `用户补充方向：${manualNotes.join("、")}` : "";
  const styleSystem = product.visualStyleSystem;
  const visualStyle = firstItem(
    [
      ...(styleSystem?.overallTone ?? []),
      ...market.visualStyles,
      ...product.styleKeywords
    ],
    "场景共情高级电商风"
  );
  const typography = "思源黑体/HarmonyOS Sans，标题粗，副标题中等，正文克制";
  const composition = "顶部标题区，产品与卖点模块分区清晰，留白充足";
  const lighting = firstItem(styleSystem?.lightingLogic ?? [], "柔和主光 + 产品边缘轮廓光 + 卖点区域轻高光");
  const featureTags = sellingPointPool.slice(0, 4);
  const coreSellingPoints = uniqueItems([heroFeature, secondFeature, ...sellingPointPool], 6);
  const feedbackPros = uniqueItems(market.userFeedbackPros ?? [], 4);
  const feedbackCons = uniqueItems(market.userFeedbackCons ?? [], 4);
  const productDetails = compactList([...product.appearance, ...product.materials, ...product.colors], 6, 22);
  const hardParameters = compactList(
    [
      ...(product.parameters ?? []),
      ...(product.specifications ?? []),
      ...(product.dataSellingPoints ?? []),
      ...(market.dataSellingPointInsights ?? [])
    ],
    6,
    24
  );
  const audienceScene =
    manualAudience.length
      ? `${manualAudience.slice(0, 2).join("、")}常见使用空间，结合当下流行家居/商业空间风格`
      : product.targetAudience?.length
        ? `${product.targetAudience.slice(0, 2).join("、")}常见使用空间，结合当下流行家居/商业空间风格`
      : "目标人群真实使用空间，结合当下流行装修风格和实际使用场景";
  const detailExpansionProfile = getDetailExpansionProfile(product, market, manualProductInfo);

  const mainImages: MainImagePlan[] = [
    {
      index: 1,
      title: headlineFromPoint(heroFeature, "一眼想点开"),
      goal: "用真实使用情境提高点击率，让用户在 3 秒内看到产品与自己生活场景的关系",
      scene: `${audienceScene}中的真实使用瞬间，${visualStyle}，${displayName}作为场景核心自然出现，${lighting}${manualDirection ? `，${manualDirection}` : ""}`,
      layout: `视觉层级严格遵循：场景情绪先抓人 > 产品主体最清楚 > 主标题第二 > 副标题第三；真实场景大画面 + 产品核心位置 + 3个场景化决策卖点标签；${composition}`,
      copywriting: {
        headline: headlineFromPoint(heroFeature, "一眼想点开"),
        subheadline: subheadlineFromPoint(heroFeature, manualAudience[0] ?? "日常")
      },
	      visualElements: uniqueItems(["KV视觉场景", "真实使用场景", "大产品主体", ...featureTags.slice(0, 2), "卖点信息卡片", "柔和阴影", "标题排版区"], 8)
    },
    {
      index: 2,
      title: "差别看得见",
      goal: "回答为什么点这个产品，而不是普通同类；突出一个差异点和用户能感知到的结果",
      scene: `${audienceScene}中用产品局部放大、同类抽象对照或使用细节对比，突出${secondFeature}与普通同类的差异，背景保持真实空间而不是棚拍白底`,
      layout: `差异点 > 可感知结果 > 产品细节证据的高点击层级，产品主体 + 局部放大窗 + 对比信息卡片；${composition}`,
      copywriting: {
        headline: "差别看得见",
        subheadline: subheadlineFromPoint(secondFeature, manualAudience[0] ?? "日常")
      },
      visualElements: ["差异对比", "局部放大框", "卖点说明卡", "功能指示线", "细节高亮", "对照信息卡"]
    },
    {
      index: 3,
      title: "别再硬忍了",
      goal: "呈现用户日常遭遇的小麻烦，并同屏给出产品解决方案和解决后的结果",
      scene: `同一个真实使用空间中，左侧表现用户日常遭遇的「${mainPain}」，右侧表现${displayName}介入后的结果，中间用产品作为解决方案连接点`,
      layout: `真实场景左右对比 + 左侧痛点 + 中间产品解决方案 + 右侧改善结果；${composition}`,
      copywriting: {
        headline: "别再硬忍了",
        subheadline: "问题和解决办法同屏看"
      },
      visualElements: ["真实痛点场景", "产品解决方案", "结果标签", "前后对比", "产品居中", "使用前后变化"]
    },
    {
      index: 4,
      title: "放进生活里",
      goal: "让目标用户快速代入真实场景，判断拥有产品后的生活状态是否符合自己",
      scene: `${audienceScene}的真实生活方式场景，产品自然融入空间，人物/道具只服务使用结果，不喧宾夺主`,
      layout: `生活方式场景大画面 + 产品自然出现 + 情绪价值短句 + 使用场景标签；${composition}`,
      copywriting: {
        headline: "放进生活里",
        subheadline: `${manualAudience[0] ?? "日常"}也能轻松用`
      },
      visualElements: ["生活方式场景", "真实场景卡片", "使用路径", "图标标签", "空间层次", "目标人群代入"]
    },
    {
      index: 5,
      title: "买前看这张",
      goal: "把关键参数和购买决策信息放进使用场景里，降低下单前的判断成本",
      scene: `${audienceScene}中的决策型画面，产品正在被使用或摆放在真实空间里，参数信息像电商信息卡片一样沿着场景重点分区呈现`,
      layout: `真实场景 + 产品主体 + 重点信息卡片（仅展示真实参数/规格） + 参数标签；${composition}`,
      copywriting: {
        headline: "买前看这张",
        subheadline: hardParameters.length ? hardParameters.slice(0, 2).join(" / ") : "重点信息一屏看懂"
      },
      visualElements: ["真实使用场景", "参数卡片", "真实规格信息", "图标矩阵", "信息可视化", "场景辅助说明"]
    }
  ];

  const detailTemplates: Array<Omit<DetailPagePlan, "index">> = [
    {
      title: "场景钩子",
      goal: "让用户快速代入真实使用场景，第一眼明白产品能让生活/工作场景变好在哪里",
      layout: `2:3 竖版，场景大图占画面60%以上 + 产品自然融入场景 + 顶部黄金三行文案；${composition}`,
      copywriting: {
        headline: `先看${heroFeature}`,
        subheadline: `${displayName}，放进场景再判断`,
        body: `先看真实使用\n再看产品怎么用\n仅写已知信息`
      },
      visualElements: ["场景钩子", "产品大图", "黄金三行", "真实生活场景", "高分辨率图片", typography]
    },
    {
      title: "痛点共鸣",
      goal: "用2-3个日常小麻烦制造代入，并同屏给出产品解决方案和改善后的结果",
      layout: `2:3 竖版，左/上展示使用前痛点，右/下展示使用后结果，中间用产品作为解决方案连接；${composition}`,
      copywriting: {
        headline: "这些麻烦，别忍了",
        subheadline: `${mainPain}，用${heroFeature}来改善`,
        body: uniqueItems([
          `以前：${mainPain}`,
          feedbackCons[0] ? `担心：${feedbackCons[0]}` : "",
          feedbackPros[0] ? `现在：${feedbackPros[0]}` : `${heroFeature}让场景更顺手`
        ], 3).join("\n")
      },
      visualElements: ["前后对比图", "痛点气泡", "产品解决方案", "结果标签", "对比箭头", "场景图", typography]
    },
    {
      title: "这套怎么用",
      goal: "把产品能解决的问题讲清楚：谁会用、在哪用、最关键的使用价值是什么",
      layout: `2:3 竖版，产品居中大图 + 产品档案卡片 + 4-6个功能图标矩阵；${composition}`,
      copywriting: {
        headline: "方案都在这",
        subheadline: `${displayName}能帮上的地方`,
        body: uniqueItems([
          `${manualAudience[0] ?? product.targetAudience?.[0] ?? "日常使用者"}也用得上`,
          `${audienceScene}更好安排`,
          `关键在${heroFeature}`
        ], 3).join("\n")
      },
      visualElements: ["产品档案卡片", "图标矩阵", "使用场景摘要", "利益点卡片", typography]
    },
    {
      title: headlineFromPoint(coreSellingPoints[0] ?? heroFeature, "这个点很实用"),
      goal: "展开优先级最高的核心卖点，用场景图、局部放大或对比图证明它能解决什么问题",
      layout: `2:3 竖版，大场景图 + 产品关键部位局部放大 + 2-3行场景化说明 + 结果标签；${composition}`,
      copywriting: {
        headline: `${coreSellingPoints[0] ?? heroFeature}看得见`,
        subheadline: toSceneEffectSellingPoint(coreSellingPoints[0] ?? heroFeature, manualAudience[0] ?? "日常场景", manualAudience[0] ?? "日常场景"),
        body: feedbackPros[0] ? `用户喜欢：${feedbackPros[0]}` : "用场景和细节证明，不靠空话。"
      },
      visualElements: ["场景图", "局部放大", "高光圈标注", "结果标签", "卖点可视化表格", typography]
    },
    {
      title: headlineFromPoint(coreSellingPoints[1] ?? secondFeature, "用起来更顺手"),
      goal: "用第二核心卖点补充购买理由，展示使用动作、效果变化和用户能获得的好处",
      layout: `2:3 竖版，真实使用动作 + 功能路径箭头 + 使用前后状态对比；${composition}`,
      copywriting: {
        headline: `${coreSellingPoints[1] ?? secondFeature}更顺手`,
        subheadline: toSceneEffectSellingPoint(coreSellingPoints[1] ?? secondFeature, manualAudience[0] ?? "日常场景", manualAudience[0] ?? "日常场景"),
        body: "把卖点放进动作里，让用户知道怎么用、用完有什么变化。"
      },
      visualElements: ["使用动作", "功能路径", "场景效果", "标注图", "动效帧", typography]
    },
    {
      title: headlineFromPoint(coreSellingPoints[2] ?? "重点数据", "重点一屏看懂"),
      goal: "把第三卖点转成可视化证据，优先使用数据图、对比标尺、进度条或环形图",
      layout: `2:3 竖版，产品/场景辅助 + 大数字或图表可视化 + 卖点解释短句；${composition}`,
      copywriting: {
        headline: `${coreSellingPoints[2] ?? "重点数据"}一眼懂`,
        subheadline: "用图表讲清楚",
        body: hardParameters.length
          ? hardParameters.slice(0, 3).join("\n")
          : toSceneEffectSellingPoint(coreSellingPoints[2] ?? heroFeature, manualAudience[0] ?? "日常场景", manualAudience[0] ?? "日常场景")
      },
      visualElements: ["数据图", "柱状图", "环形图", "进度条", "对比标尺", "信息图", typography]
    },
    {
      title: "细节先看清",
      goal: "通过产品细节、材质、结构或工艺建立品质感，降低用户对实物质感的顾虑",
      layout: `2:3 竖版，微距细节特写 + 材质/结构标签 + 品质光影 + 真实纹理保留；${composition}`,
      copywriting: {
        headline: "细节先看清",
        subheadline: "买前更放心",
        body: productDetails.length
          ? productDetails.slice(0, 3).join("\n")
          : `${coreSellingPoints[3] ?? "细节"}放大展示，减少实物顾虑。`
      },
      visualElements: ["微距特写", "材质标签", "结构标注", "瑕疵美学真实纹理", "缩放功能感", typography]
    },
    {
      title: "放进生活里",
      goal: "用目标人群的生活方式或工作场景补充最后一个核心卖点，帮助用户想象拥有后的体验",
      layout: `2:3 竖版，目标人群真实空间 + 产品自然出现 + 场景效果标签；${composition}`,
      copywriting: {
        headline: "放进生活里",
        subheadline: toSceneEffectSellingPoint(coreSellingPoints[4] ?? heroFeature, manualAudience[0] ?? "日常场景", manualAudience[0] ?? "日常场景"),
        body: `围绕${audienceScene}，让用户看到自己的使用画面。`
      },
      visualElements: ["生活方式场景", "目标用户画像", "场景效果", "产品自然出现", "种草触发点", typography]
    },
    {
      title: "多角度展示",
      goal: "提供高质量视觉内容：多角度视图、细节缩放、360度展示感，让用户看清产品本身",
      layout: `2:3 竖版，正面/45度/侧面/俯拍视图分区 + 局部缩放窗 + 尺寸或结构提示；${composition}`,
      copywriting: {
        headline: "各个角度看清",
        subheadline: "细节不藏着",
        body: "多角度看外观\n局部放大看细节\n下单前更安心"
      },
      visualElements: ["多角度视图", "360度展示", "缩放功能", "局部放大", "产品三视图", typography]
    },
    {
      title: "使用体验演示",
      goal: "用视频分镜/GIF帧思路展示产品如何使用，降低上手成本并强化体验感",
      layout: `2:3 竖版，3-4步视频分镜卡片 + 手部/人物动作 + 产品状态变化；${composition}`,
      copywriting: {
        headline: "照着做就能用",
        subheadline: "步骤简单，看一遍就懂",
        body: uniqueItems([
          "第一步：放好产品",
          "第二步：开始使用",
          "第三步：看到效果"
        ], 3).join("\n")
      },
      visualElements: ["视频分镜", "GIF动效帧", "步骤编号", "手部动作", "使用路径", typography]
    },
    {
      title: "参数信息可视化",
      goal: "把关键参数、规格或可确认数据做成易读的信息图，帮助理性用户快速判断",
      layout: `2:3 竖版，参数卡片 + 图标矩阵 + 大数字/进度条/对比标尺 + 产品辅助图；${composition}`,
      copywriting: {
        headline: "重点信息看这里",
        subheadline: "一屏帮你判断",
        body: hardParameters.length
          ? hardParameters.slice(0, 4).join("\n")
          : uniqueItems([...coreSellingPoints, ...productDetails], 4).join("\n")
      },
      visualElements: ["参数卡片", "信息图", "柱状图", "环形图", "进度条", "对比标尺", typography]
    },
    {
      title: "常见顾虑回应",
      goal: "回应用户下单前最担心的问题，用简洁问答和视觉证据减少犹豫",
      layout: `2:3 竖版，左侧用户疑问气泡，右侧产品答案卡片，下方放真实细节/保障提示；${composition}`,
      copywriting: {
        headline: "买前疑问讲清",
        subheadline: "少一点犹豫",
        body: (feedbackCons.length ? feedbackCons : ["适用场景", "材质细节", "使用方式"]).slice(0, 3).join("\n")
      },
      visualElements: ["问题气泡", "答案卡片", "真实细节证据", "风险逆转", "保障提示", "1px浅灰分割线", typography]
    },
    {
      title: "买前放心看",
      goal: "倒数第2屏用可确认的证据或顾虑回应打消踩坑担心",
      layout: `2:3 竖版，1-2个关键证据放大 + 用户证言/评价结构 + 保障条款 + 盾牌/印章图标；${composition}`,
      copywriting: {
        headline: "用着更踏实",
        subheadline: "证据放这儿",
        body: uniqueItems([
          feedbackPros[0] ? `用户反馈：${feedbackPros[0]}` : "",
          productDetails[0] ? `细节证据：${productDetails[0]}` : "",
          "售后/保障/资质如有来源再展示"
        ], 3).join("\n")
      },
      visualElements: ["顾虑回应信息组", "头像+星级+短评", "带图评价结构", "盾牌/印章图标", "风险逆转", typography]
    },
    {
      title: "收心文案",
      goal: "最后一屏用感性收尾和清晰行动理由完成转化，不写欢迎购买式空话",
      layout: `2:3 竖版，产品 Hero + 感性收心文案 + 3个决策理由 + 权益/保障条 + 全宽 CTA；${composition}`,
      copywriting: {
        headline: "让日常更省心",
        subheadline: "把麻烦少一点",
        body: uniqueItems([heroFeature, secondFeature, ...coreSellingPoints], 4).join("\n")
      },
      visualElements: ["感性收尾", "决策理由卡片", "权益/保障条", "全宽CTA按钮", "行动引导", typography]
    }
  ];
  const specialEffectTemplates: Array<Omit<DetailPagePlan, "index">> =
    detailExpansionProfile.kind === "electronics"
      ? [
          {
            title: "3D结构爆炸解析",
            goal: "用 C4D/3D 爆炸图解释用户看不见的结构价值，提升专业感和信任感",
            layout: `2:3 竖版，产品半透明 3D 爆炸图 + 结构分层标注 + 场景化利益说明；${composition}`,
            copywriting: {
              headline: "结构看清楚",
              body: `围绕${category}的可见结构与${heroFeature}，用 3D 分层说明工作路径，不写未确认参数。`
            },
            visualElements: ["C4D爆炸图", "半透明外壳", "结构分层", "能量/气流/信号路径", "线性标注", typography]
          },
          {
            title: "核心技术路径可视化",
            goal: "把电子产品的工作逻辑转化为用户能理解的场景收益",
            layout: `2:3 竖版，产品真实场景 + 3D 技术路径光效 + 结果说明卡片；${composition}`,
            copywriting: {
              headline: "原理一眼懂",
              body: "用光路、气流、能量流或信号线表达使用效果，避免编造芯片和功率数据。"
            },
            visualElements: ["3D技术路径", "能量流线", "场景结果", "信息卡片", "科技蓝光效", typography]
          },
          {
            title: "场景性能模拟",
            goal: "用可视化模拟把性能感知放回真实使用空间，帮助用户判断适不适合自己",
            layout: `2:3 竖版，真实使用空间 + C4D 粒子/气流/热量/声音路径模拟 + 前后变化；${composition}`,
            copywriting: {
              headline: "效果看得见",
              body: `结合${audienceScene}，用粒子路径表达${heroFeature}带来的场景变化。`
            },
            visualElements: ["粒子模拟", "气流/能量路径", "前后变化", "真实场景", "效果标签", typography]
          },
          {
            title: "安全耐用结构背书",
            goal: "回应电子产品安全、耐用、做工等购买顾虑",
            layout: `2:3 竖版，关键结构细节 + 材质特写 + 保护/稳定性说明卡；${composition}`,
            copywriting: {
              headline: "用着更放心",
              body: "展示外壳、接口、支撑、控制区等可见细节，用结构与做工建立信任。"
            },
            visualElements: ["结构细节", "材质微距", "保护说明", "稳定感", "信任标签", typography]
          }
        ]
      : detailExpansionProfile.kind === "bio"
        ? [
            {
              title: "3D成分分子可视化",
              goal: "把保健品/护肤品的核心成分做成直观可理解的视觉资产",
              layout: `2:3 竖版，产品包装/瓶身 + 3D 分子球棍模型 + 成分标签；${composition}`,
              copywriting: {
                headline: "成分看得懂",
                body: `以${heroFeature}和可确认配方信息为视觉重点，做分子视觉化，不做医疗化承诺。`
              },
              visualElements: ["3D分子模型", "成分标签", "蓝白实验室光效", "产品包装", "安全留白", typography]
            },
            {
              title: "质地与吸收路径示意",
              goal: "把质地、溶解、吸收或使用触感转化为用户能感知的画面",
              layout: `2:3 竖版，微观质地特写 + 皮肤/水相/营养路径抽象示意 + 场景效果；${composition}`,
              copywriting: {
                headline: "质地更直观",
                body: "用微观流动、透明层次和柔和光效说明使用感，不夸大功效。"
              },
              visualElements: ["微观质地", "透明层次", "分子粒子", "柔和光效", "使用路径", typography]
            },
            {
              title: "核心配方场景证明",
              goal: "把成分卖点放进目标人群的真实日常场景里，避免只堆成分名",
              layout: `2:3 竖版，真实生活/护肤/营养场景 + 成分粒子环绕 + 产品主体；${composition}`,
              copywriting: {
                headline: "日常更好坚持",
                body: `结合${audienceScene}，用场景说明${heroFeature}带来的日常价值。`
              },
              visualElements: ["场景化成分", "产品主体", "分子粒子", "生活方式", "卖点标签", typography]
            },
            {
              title: "配方安全与品质背书",
              goal: "回应成分安全、来源、品质感等购买顾虑",
              layout: `2:3 竖版，实验室质感背景 + 包装细节 + 配方透明信息卡；${composition}`,
              copywriting: {
                headline: "配方讲清楚",
                body: "用成分透明、包装细节和品质视觉建立信任，不编造认证或检测数据。"
              },
              visualElements: ["实验室场景", "包装细节", "配方信息卡", "品质背书", "透明视觉", typography]
            }
          ]
        : detailExpansionProfile.kind === "material"
          ? [
              {
                title: "3D材料微观结构",
                goal: "把特殊材料的微观结构可视化，解释产品为什么值得信任",
                layout: `2:3 竖版，产品实物 + 3D 材料微观结构剖面 + 材料标签；${composition}`,
                copywriting: {
                  headline: "材料看得见",
                  body: `围绕${productDetails.slice(0, 3).join("、") || heroFeature}做微观结构表达，不编造检测数据。`
                },
                visualElements: ["材料微观结构", "C4D剖面", "材质标签", "产品实物", "局部放大", typography]
              },
              {
                title: "工艺层级C4D解析",
                goal: "展示涂层、复合层、结构层级或工艺细节，增强专业感",
                layout: `2:3 竖版，多层结构 C4D 拆解 + 工艺节点标注 + 实物对应位置；${composition}`,
                copywriting: {
                  headline: "工艺讲清楚",
                  body: "用层级剖面和线性标注说明材质/工艺价值，参数不确定不写死数字。"
                },
                visualElements: ["多层剖面", "工艺节点", "线性标注", "实物对应", "高级质感", typography]
              },
              {
                title: "材料性能场景验证",
                goal: "把材料优势放进真实使用场景，通过画面证明用户能获得什么",
                layout: `2:3 竖版，真实场景 + 材料效果可视化 + 使用前后对比；${composition}`,
                copywriting: {
                  headline: "场景里见效果",
                  body: `结合${audienceScene}，用可视化方式表达材料带来的使用变化。`
                },
                visualElements: ["真实场景", "材料效果", "前后对比", "局部放大", "信任标签", typography]
              },
              {
                title: "材料信任证明",
                goal: "回应用户对材质真实性、耐用性、触感或安全性的顾虑",
                layout: `2:3 竖版，材质微距 + 品质检查感画面 + 可信信息卡；${composition}`,
                copywriting: {
                  headline: "细节更踏实",
                  body: "用材质微距和品质检查氛围增强信任，不虚构认证。"
                },
                visualElements: ["材质微距", "品质检查", "可信信息卡", "安全留白", "统一视觉", typography]
              }
            ]
          : detailExpansionProfile.shouldExpand
            ? [
                {
                  title: "3D机理可视化",
                  goal: "解释产品看不见但影响购买判断的结构、材料或成分机理",
                  layout: `2:3 竖版，产品主体 + 3D/C4D 机理图 + 场景收益说明；${composition}`,
                  copywriting: {
                    headline: "原理看得懂",
                    body: `以${heroFeature}为视觉重点，做结构或成分视觉化，帮助用户理解购买理由。`
                  },
                  visualElements: ["3D机理图", "C4D光效", "结构/成分标注", "场景收益", typography]
                },
                {
                  title: "微观结构解析",
                  goal: "用微观视觉增强产品专业感和可信度",
                  layout: `2:3 竖版，微观结构/分子/材料层 + 产品实物 + 信息标签；${composition}`,
                  copywriting: {
                    headline: "细节放大看",
                    body: "把用户平时看不到的关键细节转化为直观画面。"
                  },
                  visualElements: ["微观结构", "局部放大", "信息标签", "产品实物", typography]
                },
                {
                  title: "场景效果模拟",
                  goal: "把专业技术转化为真实使用场景里的可感知效果",
                  layout: `2:3 竖版，真实场景 + 粒子/能量/质地路径 + 前后变化；${composition}`,
                  copywriting: {
                    headline: "效果有画面",
                    body: `结合${audienceScene}，用场景结果说明产品价值。`
                  },
                  visualElements: ["场景模拟", "粒子路径", "前后变化", "卖点可视化", typography]
                },
                {
                  title: "透明信任证明",
                  goal: "用透明信息和细节说明降低购买顾虑",
                  layout: `2:3 竖版，产品细节 + 品质信息卡 + 可信场景；${composition}`,
                  copywriting: {
                    headline: "买前更放心",
                    body: "用真实细节、透明信息和统一视觉完成信任补强。"
                  },
                  visualElements: ["透明信息卡", "品质细节", "信任背书", "统一视觉", typography]
                }
              ]
            : [];
  const finalDetailTemplates =
    detailExpansionProfile.shouldExpand
      ? [
          ...detailTemplates.slice(0, -1),
          ...specialEffectTemplates,
          detailTemplates[detailTemplates.length - 1]
        ]
      : detailTemplates;

  return {
    mainImages,
    detailPages: finalDetailTemplates.slice(0, detailExpansionProfile.targetCount).map((plan, index) => ({
      ...plan,
      index: index + 1
    }))
  };
}

function completeDesignPlan(
  plan: { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] },
  fallback: { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] },
  outputScope: OutputScope = "all"
) {
  const shouldIncludeMain = includesMainImages(outputScope);
  const shouldIncludeDetail = includesDetailPages(outputScope);
  const targetDetailCount = shouldIncludeDetail ? fallback.detailPages.length : 0;

  return {
    mainImages: shouldIncludeMain
      ? [...plan.mainImages, ...fallback.mainImages.slice(plan.mainImages.length)]
          .slice(0, 5)
          .map((item, index) => ({ ...item, index: index + 1 }))
      : [],
    detailPages: shouldIncludeDetail
      ? [...plan.detailPages, ...fallback.detailPages.slice(plan.detailPages.length)]
          .slice(0, targetDetailCount)
          .map((item, index) => ({ ...item, index: index + 1 }))
      : []
  };
}

function assertCompleteAiDesignPlan(
  plan: { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] },
  expectedDetailCount: number,
  outputScope: OutputScope = "all"
) {
  const shouldIncludeMain = includesMainImages(outputScope);
  const shouldIncludeDetail = includesDetailPages(outputScope);

  if (shouldIncludeMain && plan.mainImages.length !== 5) {
    throw new ServiceError(`AI 主图策划返回 ${plan.mainImages.length} 张，要求 5 张；已停止使用模板兜底。`, {
      statusCode: 502,
      code: "DESIGN_PLAN_MAIN_COUNT_INVALID"
    });
  }

  if (shouldIncludeDetail && plan.detailPages.length !== expectedDetailCount) {
    throw new ServiceError(`AI 详情页策划返回 ${plan.detailPages.length} 屏，要求 ${expectedDetailCount} 屏；已停止使用模板兜底。`, {
      statusCode: 502,
      code: "DESIGN_PLAN_DETAIL_COUNT_INVALID"
    });
  }

  const badMain = shouldIncludeMain ? plan.mainImages.filter((item) => copyLooksCorrupted(item.copywriting)).length : 0;
  const badDetail = shouldIncludeDetail ? plan.detailPages.filter((item) => copyLooksCorrupted(item.copywriting)).length : 0;
  if (badMain || badDetail) {
    throw new ServiceError(`AI 策划文案存在异常：主图 ${badMain} 张，详情页 ${badDetail} 屏；已停止使用模板兜底。`, {
      statusCode: 502,
      code: "DESIGN_PLAN_COPY_INVALID"
    });
  }
}

function applyManualInfoToDesignPlan(
  plan: { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] },
  product: ProductAnalysis,
  manualProductInfo?: ProductManualInfo
) {
  if (!hasManualInfo(manualProductInfo)) {
    return plan;
  }

  const manualSellingPoints = splitManualItems(manualProductInfo?.sellingPoints);
  const manualSellingPointsForCopy = manualSellingPoints.filter(isUsefulSellingPoint);
  const manualAudience = splitManualItems(manualProductInfo?.targetAudience);
  const manualNotes = splitManualItems(manualProductInfo?.notes);
  const displayName = manualProductInfo?.brand
    ? `${manualProductInfo.brand} ${manualProductInfo.productName || product.productNameGuess || product.category}`
    : manualProductInfo?.productName || product.productNameGuess || product.category;
  const manualSummary = manualInfoToSummary(manualProductInfo);
  const manualVisualElements = uniqueItems(
    [
      ...manualSellingPoints,
      ...manualAudience.map((item) => `${item}场景`),
      manualProductInfo?.brand ? `${manualProductInfo.brand}品牌露出` : ""
    ].filter((item) => !isParameterLikeText(item)),
    6
  );

  return {
    mainImages: plan.mainImages.map((item, index) => {
      if (index > 2) {
        return {
          ...item,
          visualElements: uniqueItems([...manualVisualElements.slice(0, 2), ...item.visualElements], 8)
        };
      }

      return {
        ...item,
        title: index === 0 && manualProductInfo?.productName ? `${displayName}首屏点击主图` : item.title,
        scene:
          index === 0 && manualAudience.length
            ? `${manualAudience.slice(0, 2).join("、")}真实使用场景，${item.scene}`
            : item.scene,
        copywriting: {
          ...item.copywriting,
          subheadline: limitChars(
            item.copywriting.subheadline,
            20,
            manualSellingPointsForCopy[0]
              ? subheadlineFromPoint(manualSellingPointsForCopy[0], manualAudience[0] ?? "日常")
              : manualAudience[0]
                ? `适合${manualAudience[0]}`
                : "一眼看懂重点"
          )
        },
        visualElements: uniqueItems([...manualVisualElements.slice(0, 2), ...item.visualElements], 8)
      };
    }),
    detailPages: plan.detailPages.map((item, index) => {
      const shouldInjectBody = index === 2 || index === 8 || index === 10;
      const bodyParts = uniqueItems(
        [
          item.copywriting.body ?? "",
          shouldInjectBody && manualProductInfo?.productName ? `品名：${manualProductInfo.productName}` : "",
          shouldInjectBody && manualProductInfo?.brand ? `品牌：${manualProductInfo.brand}` : "",
          shouldInjectBody && manualSellingPointsForCopy.length
            ? `重点：${manualSellingPointsForCopy.slice(0, 2).map((point) => compactText(point, 12)).join("、")}`
            : "",
          shouldInjectBody && manualAudience.length
            ? `适合：${manualAudience.slice(0, 2).join("、")}`
            : ""
        ],
        3
      );

      return {
        ...item,
        copywriting: {
          ...item.copywriting,
          body: bodyParts.join("；")
        },
        visualElements: uniqueItems([...manualVisualElements.slice(0, 3), ...item.visualElements], 8)
      };
    })
  };
}

const mainImageRoles: Array<{
  role: string;
  expressionMethod: MainImageExpressionMethod;
  compositionRule: string;
}> = [
  {
    role: "货架首图",
    expressionMethod: "scene",
    compositionRule: "只保留一个核心点击理由，产品主体占画面60%-80%，0.5秒看清品类和主利益。"
  },
  {
    role: "差异主图",
    expressionMethod: "comparison",
    compositionRule: "用差异点连接用户可感知结果，避免空泛地说更好或更优。"
  },
  {
    role: "痛点主图",
    expressionMethod: "pain_point",
    compositionRule: "先呈现真实小麻烦，再同屏给出产品解决后的结果。"
  },
  {
    role: "场景主图",
    expressionMethod: "scene",
    compositionRule: "让用户脑补拥有后的生活状态，人物或道具服务产品，不喧宾夺主。"
  },
  {
    role: "决策主图",
    expressionMethod: "number",
    compositionRule: "压缩尺寸、适用场景、使用方式、保障等买前确认信息，降低下单犹豫。"
  }
];

type DetailFunnelMeta = {
  funnelStage: DetailFunnelStage;
  screenRole: string;
  userQuestionAnswered: string;
  conversionPurpose: string;
};

function detailFunnelMeta(index: number): DetailFunnelMeta {
  const map: Record<number, DetailFunnelMeta> = {
    1: {
      funnelStage: "attention",
      screenRole: "3秒成交区",
      userQuestionAnswered: "我是谁？这个产品跟我有什么关系？",
      conversionPurpose: "快速建立品类识别和第一购买理由"
    },
    2: {
      funnelStage: "resonance",
      screenRole: "痛点共鸣",
      userQuestionAnswered: "这是不是我正在忍受的小麻烦？",
      conversionPurpose: "让用户产生代入和继续滑动的理由"
    },
    3: {
      funnelStage: "solution",
      screenRole: "核心解决方案",
      userQuestionAnswered: "产品怎么系统解决这个问题？",
      conversionPurpose: "把痛点、功能和结果串成解决方案"
    },
    4: {
      funnelStage: "need",
      screenRole: "核心卖点1",
      userQuestionAnswered: "第一购买理由是否足够明确？",
      conversionPurpose: "展开最强购买理由"
    },
    5: {
      funnelStage: "need",
      screenRole: "核心卖点2",
      userQuestionAnswered: "还有什么值得继续了解？",
      conversionPurpose: "补充第二购买理由"
    },
    6: {
      funnelStage: "need",
      screenRole: "核心卖点3",
      userQuestionAnswered: "这个卖点在真实场景里怎么发生？",
      conversionPurpose: "用场景或细节证明价值"
    },
    7: {
      funnelStage: "proof",
      screenRole: "数据/证据证明",
      userQuestionAnswered: "这些说法有没有依据或边界？",
      conversionPurpose: "用可确认信息增强可信度"
    },
    8: {
      funnelStage: "comparison",
      screenRole: "竞品对比",
      userQuestionAnswered: "为什么比普通同类更值得看？",
      conversionPurpose: "突出差异化机会，不攻击竞品"
    },
    9: {
      funnelStage: "scene_desire",
      screenRole: "场景种草",
      userQuestionAnswered: "买后生活状态会有什么变化？",
      conversionPurpose: "放大拥有后的场景想象"
    },
    10: {
      funnelStage: "trust",
      screenRole: "用户见证/体验线索",
      userQuestionAnswered: "别人为什么会买，反馈里提到了什么？",
      conversionPurpose: "用用户材料或结构化评价降低不确定"
    },
    11: {
      funnelStage: "detail_confirmation",
      screenRole: "细节确认",
      userQuestionAnswered: "材质、结构、尺寸或外观细节看清了吗？",
      conversionPurpose: "降低买前信息差"
    },
    12: {
      funnelStage: "detail_confirmation",
      screenRole: "使用方式/体验演示",
      userQuestionAnswered: "到手后怎么用，是否容易理解？",
      conversionPurpose: "降低上手成本"
    },
    13: {
      funnelStage: "risk_reversal",
      screenRole: "售后保障/顾虑回应",
      userQuestionAnswered: "下单风险大不大，踩坑点有没有回应？",
      conversionPurpose: "处理最后犹豫"
    },
    14: {
      funnelStage: "conversion",
      screenRole: "收心转化",
      userQuestionAnswered: "为什么现在可以做决定？",
      conversionPurpose: "总结利益和低风险行动理由"
    }
  };

  return map[index] ?? {
    funnelStage: "need",
    screenRole: `核心卖点${index - 3}`,
    userQuestionAnswered: "这一屏解决哪个购买理由？",
    conversionPurpose: "把单一卖点讲透并避免重复"
  };
}

function compactDecisionPath(path: UserDecisionPath) {
  return path.decisionPath.slice(0, 5).join(" → ");
}

// 优先采用大模型生成的文案：三件套齐全且通过合规/质量校验时使用模型文案，
// 否则回退到确定性模板（templateCopy）。修复「接了 AI 却被模板覆盖」的问题。
// 校验时放宽「必须对应确定性分配卖点」这一条（模型按自身叙事组织各屏），
// 但保留内部术语、过度承诺、缺少场景/结果等真正的合规检查。
function preferModelCopy(
  modelCopy: Partial<Parameters<typeof sanitizeCopywritingOutput>[0]> | undefined,
  templateCopy: ReturnType<typeof sanitizeCopywritingOutput>,
  context?: Parameters<typeof sanitizeCopywritingOutput>[1]
): ReturnType<typeof sanitizeCopywritingOutput> {
  const headline = (modelCopy?.headline ?? "").trim();
  const subheadline = (modelCopy?.subheadline ?? "").trim();
  const body = (modelCopy?.body ?? "").trim();

  if (!headline || !subheadline || !body) return templateCopy;

  // 去掉卖点对应相关字段，避免「未对应当前分配卖点」误判模型文案
  const checkContext = context
    ? { audience: context.audience, scene: context.scene, evidenceLevel: context.evidenceLevel }
    : undefined;

  const candidate = { headline, subheadline, body };
  if (!validateCopywriting(candidate, checkContext).passed) return templateCopy;

  const guarded = sanitizeCopywritingOutput(candidate, checkContext);
  return guarded.headline ? guarded : templateCopy;
}

function applyCreativeRulesToDesignPlan(
  plan: { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] },
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo
) {
  const manualSellingPoints = splitManualItems(manualProductInfo?.sellingPoints);
  const manualAudience = splitManualItems(manualProductInfo?.targetAudience);
  const sellingPointAssets = buildSellingPointAssets(product, market, manualProductInfo);
  const competitorAnalysis = buildCompetitorAnalysis(manualProductInfo, market);
  const reviewInsight = buildReviewInsight(manualProductInfo, market);
  const userDecisionPath = buildUserDecisionPath({
    product,
    market,
    manualProductInfo,
    competitorAnalysis,
    reviewInsight
  });
  const mainClickReason = selectMainClickReason({
    product,
    assets: sellingPointAssets,
    decisionPath: userDecisionPath
  });
  const sellingPointsFromAssets = sellingPointAssets.map((asset) => asset.name);
  const sellingPoints = sellingPointsFromAssets.length ? sellingPointsFromAssets : collectSellingPoints(
    [
      manualProductInfo?.sellingPoints,
      ...(product.sellingPoints ?? []),
      ...getMarketEvidenceTexts(market, "copywritingSellingPoints"),
      ...getMarketEvidenceTexts(market, "hotSellingPoints"),
      ...getMarketEvidenceTexts(market, "featureSellingPoints"),
      ...product.visibleFeatures
    ],
    8
  );
  const audience = manualAudience[0] ?? product.targetAudience?.[0] ?? "日常使用";
  const category = manualProductInfo?.category || product.category || product.productNameGuess || "产品";
  const productName = manualProductInfo?.productName || product.productNameGuess || category;
  const displayName = manualProductInfo?.brand ? `${manualProductInfo.brand} ${productName}` : productName;
  const heroPoint = sellingPoints[0] ?? "使用更省心";
  const secondPoint = sellingPoints[1] ?? heroPoint;
  const mainPain = compactText(market.userPainPoints[0], 22) || "日常使用不顺手";
  const feedbackPros = compactList(market.userFeedbackPros ?? [], 4, 18);
  const feedbackCons = compactList(market.userFeedbackCons ?? market.userPainPoints, 4, 18);
  const hardParameters = compactList(
    [
      ...(product.parameters ?? []),
      ...(product.specifications ?? []),
      ...(product.dataSellingPoints ?? []),
      ...(market.dataSellingPointInsights ?? []),
    ],
    5,
    18
  );
  const productDetails = compactList(
    [
      ...product.appearance,
      ...product.materials,
      ...product.colors,
      ...(product.productDetails ?? []),
      ...(market.productDetailInsights ?? [])
    ],
    5,
    18
  );
  const styleHint =
    manualProductInfo?.notes ||
    market.visualStyles[0] ||
    product.visualStyleSystem?.overallTone?.[0] ||
    "高级统一的电商视觉风格";
  const totalDetailPages = plan.detailPages.length;
  const specialEffectNeeded = totalDetailPages > 14;
  const motorProductProfile = getMotorDrivenProductProfile(product, market, manualProductInfo);
  const coreSellingPoints = motorProductProfile
    ? sellingPoints.filter((point) => !isMotorPointText(point))
    : sellingPoints;
  const solutionPoint = coreSellingPoints[0] ?? (motorProductProfile ? "稳定送风" : heroPoint);
  const usedMainAssets = new Set<string>();
  const usedDetailAssets = new Set<string>();

  function assetName(asset: SellingPointAsset | undefined, fallback: string) {
    return asset?.name ?? fallback;
  }

  function assetBenefit(asset: SellingPointAsset | undefined, fallback: string) {
    return sanitizeCommercialText(asset?.fab?.benefit ?? asset?.userBenefit ?? asset?.benefit ?? fallback);
  }

  function fabCopyForMain(
    asset: SellingPointAsset | undefined,
    index: number,
    fallbackPoint: string,
    fallbackCopy: { headline: string; subheadline?: string; body?: string }
  ) {
    const copy = rewriteCopyWithFab({
      asset,
      fallbackFeature: fallbackPoint,
      fallbackScene: audience,
      fallbackAudience: category,
      fallbackCopy,
      imageType: "main_image",
      slotIndex: index
    });
    const score = scoreCopywritingByFab(copy, asset?.fab);

    return score.total < 75 && asset?.fab
      ? rewriteCopyWithFab({
          asset,
          fallbackFeature: fallbackPoint,
          fallbackScene: audience,
          fallbackAudience: category,
          fallbackCopy: copy,
          imageType: "main_image",
          slotIndex: index
        })
      : copy;
  }

  function fabCopyForDetail(
    asset: SellingPointAsset | undefined,
    index: number,
    fallbackPoint: string,
    fallbackCopy: { headline: string; subheadline?: string; body?: string }
  ) {
    const copy = rewriteCopyWithFab({
      asset,
      fallbackFeature: fallbackPoint,
      fallbackScene: audience,
      fallbackAudience: category,
      fallbackCopy,
      imageType: "detail_page",
      slotIndex: index
    });
    const score = scoreCopywritingByFab(copy, asset?.fab);

    return score.total < 75 && asset?.fab
      ? rewriteCopyWithFab({
          asset,
          fallbackFeature: fallbackPoint,
          fallbackScene: audience,
          fallbackAudience: category,
          fallbackCopy: copy,
          imageType: "detail_page",
          slotIndex: index
        })
      : copy;
  }

  function mainSlotAsset(index: number) {
    const priorityMap: SellingPointAsset["priority"][][] = [
      ["P0"],
      ["P0", "P1"],
      ["P1", "P0"],
      ["P1", "P2"],
      ["P2", "P1"]
    ];

    return selectAssetForSlot(sellingPointAssets, "main_image", priorityMap[index] ?? ["P2"], usedMainAssets);
  }

  function detailSlotAsset(index: number) {
    if (index <= 2) return selectAssetForSlot(sellingPointAssets, "detail_page", ["P0"], usedDetailAssets);
    if (index >= 3 && index <= 7) return selectAssetForSlot(sellingPointAssets, "detail_page", ["P1", "P0"], usedDetailAssets);
    return selectAssetForSlot(sellingPointAssets, "detail_page", ["P2", "P1"], usedDetailAssets);
  }

  function enrichLayout(baseLayout: string | undefined, defaultRelation: string, aspectRule: string) {
    const layout = sanitizeCommercialText(baseLayout) || "产品主体 + 标题 + 卖点标签";
    return `${layout}；画幅：${aspectRule}；图文排版关系：${defaultRelation}；顶部12%-18%为标题区，主标题、副标题、正文说明统一左对齐；中部为场景/产品/卖点可视化主体；底部为标签、数据卡片、保障条或CTA；文案不遮挡产品，留白充足。`;
  }

  function enrichVisualElements(items: string[], index: number) {
    const cleanedItems = items
      .map(sanitizeCommercialText)
      .map((item) => compactText(item, 18))
      .filter(
        (item) =>
          item &&
          !/(字体|字号|构图|排版|文案层级|整体调性|画面质感|布光逻辑|色彩|统一视觉|产品外观|用户补充|需要解决|PANTONE|F型视觉动线|核心信息热区|模块留白|黄金分割)/.test(item)
      );

    return uniqueItems(
      [
        ...cleanedItems,
        "场景+效果卖点",
        index % 2 === 0 ? "局部放大" : "前后对比",
        index % 3 === 0 ? "数据可视化" : "卖点标签",
        "高级留白",
        "口语化短文案"
      ],
      8
    );
  }

  function lineSupportFromAsset(asset: SellingPointAsset | undefined) {
    if (asset?.evidenceLevel === "C") return "仅作方向参考";
    if (asset?.proof?.includes("图片")) return "按可见细节表达";
    if (asset?.proof?.includes("用户")) return "按商家资料表达";
    if (asset?.proof?.includes("搜索")) return "按搜索资料表达";
    if (asset?.source === "image_fact") return "按可见细节表达";
    if (asset?.source === "user_input") return "按商家资料表达";
    if (asset?.source === "web_search") return "按搜索资料表达";
    return "不夸大事实";
  }

  function differenceHeadline(point: string) {
    const value = sanitizeCommercialText(point);

    if (/材质|工艺|纹理|做工|金属|塑料|玻璃|硅胶|木|皮|棉|涂层/.test(value)) return "细节不一样";
    if (/结构|网罩|接口|按钮|面板|底座|支架|折叠|调节|拆装|模块/.test(value)) return "结构有讲究";
    if (/外观|颜值|复古|简约|配色|造型|风格/.test(value)) return "不止看颜值";
    if (/容量|续航|规格|尺寸|参数|净含量|包装/.test(value)) return "买前看差别";
    return "差别看得见";
  }

  function painHeadlineFromPain(pain: string) {
    const value = sanitizeCommercialText(pain);

    if (/热|闷|汗|晒/.test(value)) return "别再闷着";
    if (/吵|噪|打扰|睡|休息/.test(value)) return "别被打扰";
    if (/乱|占地|放不下|收纳/.test(value)) return "别再乱放";
    if (/麻烦|费劲|折腾|不方便/.test(value)) return "别再折腾";
    if (/怕|担心|犹豫|买错|踩坑/.test(value)) return "别怕买错";
    return "这事别忍";
  }

  function enforceMainRoleCopy(input: {
    index: number;
    copy: MainImagePlan["copywriting"];
    asset?: SellingPointAsset;
    assignedPoint: string;
    assignedBenefit: string;
  }): MainImagePlan["copywriting"] {
    const { index, copy, asset, assignedPoint, assignedBenefit } = input;

    if (index === 1) {
      const point = sanitizeCommercialText(asset?.feature || asset?.name || assignedPoint);
      const result = limitChars(asset?.fab?.desirePoint || asset?.benefit || assignedBenefit, 15, "差别看得清楚");
      return sanitizeCopywritingOutput(
        {
          headline: differenceHeadline(point),
          subheadline: limitChars(`${compactText(point, 8)}，结果看得清楚`, 20, "差异点看得清楚"),
          body: normalizeBodyCopy("", [
            `差异：${compactText(point, 10)}`,
            `结果：${compactText(result, 10)}`,
            lineSupportFromAsset(asset)
          ])
        },
        {
          assignedSellingPoint: asset,
          audience,
          scene: asset?.scene || audience,
          fallbackPoint: point,
          evidenceLevel: asset?.evidenceLevel
        }
      );
    }

    if (index === 2) {
      const pain = compactText(asset?.painPoint || asset?.userPainPoint || mainPain, 12) || "买前小麻烦";
      const result = limitChars(asset?.fab?.benefit || asset?.userBenefit || assignedBenefit, 15, "解决办法看得见");
      return sanitizeCopywritingOutput(
        {
          headline: painHeadlineFromPain(pain),
          subheadline: limitChars(`${painCoreText(pain)}，解决办法同屏看`, 20, "问题和解决办法同屏看"),
          body: normalizeBodyCopy("", [
            `以前：${compactText(pain, 10)}`,
            `现在：${compactText(result, 10)}`,
            lineSupportFromAsset(asset)
          ])
        },
        {
          assignedSellingPoint: asset,
          audience,
          scene: asset?.scene || audience,
          fallbackPoint: result,
          evidenceLevel: asset?.evidenceLevel
        }
      );
    }

    return copy;
  }

  function painCoreText(pain: string) {
    return sanitizeCommercialText(pain).replace(/^(?:怕|担心)/, "");
  }

  const mainBlueprints = [
    {
      title: kvHeadlineFromPoint(heroPoint, "一眼想点开"),
      subheadline: subheadlineFromPoint(heroPoint, audience),
      bodyLines: [toSceneEffectSellingPoint(heroPoint, audience, audience), "看一眼就懂", "跟你的场景有关"],
      relation: "全屏真实场景+文字叠加，产品为视觉核心，卖点标签围绕使用结果",
      visualFocus: "场景先抓人，产品最清楚，主标题第二层级。"
    },
    {
      title: headlineFromPoint(secondPoint, "这点真省心"),
      subheadline: "差异点和结果同屏看",
      bodyLines: [`差异：${headlineFromPoint(secondPoint)}`, `结果：${subheadlineFromPoint(secondPoint, audience)}`, "不靠空话"],
      relation: "局部放大+对照信息卡，左侧展示差异细节，右侧展示用户可感知结果",
      visualFocus: "只回答为什么点你，不讲痛点故事。"
    },
    {
      title: "别再硬忍了",
      subheadline: "问题和解决办法同屏看",
      bodyLines: [`以前：${mainPain}`, `现在：${headlineFromPoint(heroPoint)}`, "解决结果清楚"],
      relation: "左右前后对比，左侧痛点场景，右侧产品解决后的结果，中间产品连接两边",
      visualFocus: "只讲一个真实麻烦和一个解决结果，不再重复差异卖点。"
    },
    {
      title: "放进生活里",
      subheadline: `${audience}也能轻松用`,
      bodyLines: ["场景更真实", "产品不抢戏", "效果能感知"],
      relation: "生活方式场景大画面，产品自然出现，标题顶部居中或左对齐",
      visualFocus: "让用户脑补拥有后的状态。"
    },
    {
      title: "买前看这张",
      subheadline: hardParameters.length ? hardParameters.slice(0, 2).join(" / ") : "重点信息一屏看懂",
      bodyLines: hardParameters.length ? hardParameters.slice(0, 3) : ["规格看清楚", "细节看明白", "下单少犹豫"],
      relation: "真实场景+产品主体+关键参数信息卡，参数只讲买前要看的重点",
      visualFocus: "降低决策成本，不重复堆参数。"
    }
  ];

  function detailBlueprint(index: number) {
    const corePoint =
      coreSellingPoints[
        Math.min(Math.max(index - 3, 0), Math.max(coreSellingPoints.length - 1, 0))
      ] ??
      sellingPoints[Math.min(Math.max(index - 3, 0), Math.max(sellingPoints.length - 1, 0))] ??
      heroPoint;
    const finalIndex = totalDetailPages - 1;
    const trustIndex = totalDetailPages - 2;

    if (index === 0) {
      return {
        title: kvHeadlineFromPoint(heroPoint, "一眼就想用"),
        stage: "KV视觉场景钩子",
        subheadline: subheadlineFromPoint(heroPoint, audience),
        bodyLines: ["先看到场景", "再看到结果", "记住产品"],
        layout: "2:3竖版，场景主图占60%以上，产品自然融入真实使用空间，顶部黄金三行文案",
        imageBrief: `${audience}真实使用场景，产品自然出现，画面先给出使用后的舒适/省心结果，避免纯白底。`,
        visualElements: ["KV场景图", "产品大图", "黄金三行", "场景钩子"]
      };
    }

    if (index === 1) {
      return {
        title: "这些麻烦别忍",
        stage: "痛点共鸣/前后对比",
        subheadline: "同屏给出解决办法",
        bodyLines: [`以前：${mainPain}`, `换成：${headlineFromPoint(heroPoint)}`, "前后差别清楚"],
        layout: "2:3竖版，使用前/使用后对比图，中间用产品作为解决方案连接点",
        imageBrief: `左侧呈现${mainPain}的真实小麻烦，右侧呈现产品介入后的改善结果，中间用产品和箭头连接。`,
        visualElements: ["前后对比", "痛点气泡", "改善结果", "结果标签"]
      };
    }

    if (index === 2) {
      return {
        title: "方案都在这",
        stage: "产品价值总览",
        subheadline: `${displayName}能帮上的地方`,
        bodyLines: uniqueItems([`${audience}也用得上`, "用在哪都说清", `关键在${solutionPoint}`], 3),
        layout: "2:3竖版，产品居中大图，基础信息卡片+4-6个功能图标矩阵",
        imageBrief: `产品居中展示，周围用图标矩阵说明主要用途，把${displayName}能帮用户解决的问题讲清楚。`,
        visualElements: ["产品信息卡", "功能图标矩阵", "使用价值摘要", "利益点卡片"]
      };
    }

    if (motorProductProfile && index === 5) {
      return {
        title: motorProductProfile.motorName,
        stage: "高速电机介绍",
        subheadline: motorProductProfile.subheadline,
        bodyLines: motorProductProfile.bodyLines,
        layout: "2:3竖版，产品实物+高速电机C4D剖面/爆炸拆解+扇叶联动+气流路径+短句利益点",
        imageBrief: motorProductProfile.imageBrief,
        visualElements: [
          motorProductProfile.motorName,
          "C4D电机剖面",
          "扇叶联动",
          "蓝色气流路径",
          "结构标注"
        ]
      };
    }

    if (index >= 3 && index <= 7) {
      return {
        title: headlineFromPoint(corePoint, "这点很实用"),
        stage: `卖点证明${index - 2}`,
        subheadline: subheadlineFromPoint(corePoint, audience),
        bodyLines: bodyLinesForPoint(corePoint, audience).split("\n"),
        layout: "2:3竖版，一屏一个核心卖点，大场景图/对比图/标注图+2-3行支撑文案",
        imageBrief: `以「${corePoint}」为视觉重点做卖点可视化：优先使用真实场景、局部放大、箭头圈注、数据图或前后对比，不重复其他屏卖点。`,
        visualElements: ["卖点可视化", index % 2 === 0 ? "局部放大" : "场景图", index % 3 === 0 ? "数据图" : "标注图", "结果标签"]
      };
    }

    if (index === 8) {
      return {
        title: "各面都看清",
        stage: "多角度展示",
        subheadline: "买前先看真实样子",
        bodyLines: ["正面/侧面/细节", "比例不夸张", "下单更安心"],
        layout: "2:3竖版，正面/45度/侧面/俯拍视图分区+局部缩放窗",
        imageBrief: `用多角度高清视图展示${displayName}，加入局部缩放窗，帮助用户看清外观、结构和质感。`,
        visualElements: ["多角度视图", "360度展示感", "局部缩放", "产品三视图"]
      };
    }

    if (index === 9) {
      return {
        title: "照着做就行",
        stage: "使用体验演示",
        subheadline: "步骤简单，看一遍会用",
        bodyLines: ["放好产品", "开始使用", "看到变化"],
        layout: "2:3竖版，3-4步视频分镜卡片+手部/人物动作+产品状态变化",
        imageBrief: `像短视频分镜一样展示产品使用过程，动作清楚，结果明确，降低上手成本。`,
        visualElements: ["视频分镜", "步骤编号", "手部动作", "动效帧"]
      };
    }

    if (index === 10) {
      return {
        title: "重点看这里",
        stage: "参数信息可视化",
        subheadline: "参数只讲关键",
        bodyLines: hardParameters.length ? hardParameters.slice(0, 3) : productDetails.slice(0, 3),
        layout: "2:3竖版，参数卡片+图标矩阵+大数字/进度条/对比标尺",
        imageBrief: `只展示买前关键参数或规格，用信息图表达，不把全部参数重复铺满。`,
        visualElements: ["参数卡片", "信息图", "进度条", "对比标尺"]
      };
    }

    if (index === 11) {
      return {
        title: "疑问讲清楚",
        stage: "常见顾虑回应",
        subheadline: "少一点犹豫",
        bodyLines: feedbackCons.length ? feedbackCons.slice(0, 3) : ["适用场景", "材质细节", "使用方式"],
        layout: "2:3竖版，用户疑问气泡+产品答案卡+真实细节证据",
        imageBrief: `把用户下单前常见顾虑做成问答卡，旁边用产品细节、场景结果或保障信息回答。`,
        visualElements: ["问题气泡", "答案卡片", "真实细节证据", "保障提示"]
      };
    }

    if (specialEffectNeeded && index > 11 && index < trustIndex) {
      const specialTitles = ["结构看明白", "原理一眼懂", "效果看得见", "细节更踏实"];
      const specialTitle = specialTitles[(index - 12) % specialTitles.length];

      return {
        title: specialTitle,
        stage: "3D/C4D特殊效果解析",
        subheadline: "看不见的价值做成图",
        bodyLines: ["结构/材料可视化", "场景收益说清楚", "不编造参数"],
        layout: "2:3竖版，产品实物+3D/C4D结构、材料或机理可视化+短句解释",
        imageBrief: `根据品类需要加入3D建模、C4D爆炸图、材料微观结构、分子或能量路径，必须服务购买决策。`,
        visualElements: ["3D/C4D", "结构解析", "微观可视化", "专业标注"]
      };
    }

    if (index === trustIndex) {
      return {
        title: "买得更放心",
        stage: "购买顾虑回应",
        subheadline: "证据摆出来",
        bodyLines: uniqueItems([
          feedbackPros[0] ? `用户反馈：${feedbackPros[0]}` : "",
          productDetails[0] ? `细节证据：${productDetails[0]}` : "",
          "保障/资质有来源再展示"
        ], 3),
        layout: "2:3竖版，1-2个关键证据放大+评价结构+保障条款+盾牌/印章图标",
        imageBrief: `用证据链打消踩坑顾虑，资质、评价、售后和保障只展示有来源的信息，不编造。`,
        visualElements: ["信任证据", "评价结构", "盾牌图标", "保障条款"]
      };
    }

    if (index === finalIndex) {
      const closingBenefitText =
        sanitizeCommercialText(mainClickReason.expectedUserBenefit) ||
        assetBenefit(sellingPointAssets[0], "买前少一点犹豫");
      const closingBenefit =
        closingBenefitText
          .split(/[，,]/)
          .map((item) => sanitizeCommercialText(item))
          .filter(Boolean)
          .at(-1) || "买前少纠结";

      return {
        title: limitChars(closingBenefit, 10, "买前少纠结"),
        stage: "收心文案",
        subheadline: limitChars(`${audience}也能少点犹豫`, 20, "把适不适合讲清楚"),
        bodyLines: uniqueItems([closingBenefit, "场景和细节都看清", "按已知信息判断"], 3),
        layout: "2:3竖版，产品Hero+感性收尾文案+3个决策理由+权益/保障条+全宽CTA",
        imageBrief: `延续整套视觉风格，用产品Hero和一句感性收尾完成转化，不写欢迎购买。`,
        visualElements: ["感性收尾", "决策理由", "保障条", "全宽CTA"]
      };
    }

    return {
      title: headlineFromPoint(corePoint, "这点很实用"),
      stage: "核心卖点展开",
      subheadline: subheadlineFromPoint(corePoint, audience),
      bodyLines: bodyLinesForPoint(corePoint, audience).split("\n"),
      layout: "2:3竖版，一屏一个卖点，场景图+支撑文案+视觉证据",
      imageBrief: `围绕「${corePoint}」用场景和证据讲透，不重复其他屏内容。`,
      visualElements: ["场景图", "卖点证明", "信息卡片", "高级留白"]
    };
  }

  function detailVisualRhythm(index: number) {
    if (index === 1) {
      return "对比屏采用左右双区/上下双区/斜切对比之一，负面场景和正面结果分别描述，避免矛盾元素混在同一画面。";
    }

    const rhythmMap: Record<number, string> = {
      3: "第4屏景别：远景场景，用真实空间承接核心卖点，产品自然成为视觉中心。",
      4: "第5屏景别：局部特写，用微距、圈点和高光标注关键部件或材质。",
      5: "第6屏景别：功能意象，用气流、路径、分子、结构或数据图表达看不见的效果。",
      6: "第7屏景别：斜侧产品视角，突出产品体积、轮廓、结构和空间关系。",
      7: "第8屏景别：人机交互中景，用手部、人物背影或真实动作证明使用体验。"
    };

    if (rhythmMap[index]) {
      return rhythmMap[index];
    }

    if (/参数|规格|顾虑|多角度|尺寸|结构/.test(detailBlueprint(index).title)) {
      return "理性信息屏允许使用干净单色或低噪背景，优先保证信息可读，不强行复杂场景。";
    }

    return "保持与前后屏统一，但镜头距离、产品角度和信息密度要有变化，避免连续相似画面。";
  }

  return {
    mainImages: plan.mainImages.map((item, index) => {
      const blueprint = mainBlueprints[index] ?? mainBlueprints[0];
      const assignedSellingPoint = mainSlotAsset(index);
      const assignedPoint = assetName(
        assignedSellingPoint,
        index === 0 ? heroPoint : index === 1 ? secondPoint : index === 2 ? heroPoint : index === 3 ? audience : hardParameters[0] ?? "买前重点"
      );
      const assignedBenefit = assetBenefit(assignedSellingPoint, subheadlineFromPoint(assignedPoint, audience));
      const scene = sanitizeCommercialText(item.scene) || `${audience}真实使用场景`;
      const mainCopy = fabCopyForMain(
        assignedSellingPoint,
        index,
        assignedPoint,
        {
          headline: index === 4 ? "买前看清" : headlineFromPoint(assignedPoint, "一眼少纠结"),
          subheadline: limitChars(assignedBenefit, 20, "看一眼就知道适不适合"),
          body: normalizeBodyCopy("", [
            assignedBenefit,
            assignedSellingPoint?.scene || audience,
            assignedSellingPoint?.claimBoundary || "按资料保守表达"
          ])
        }
      );
      const guardedMainCopy = sanitizeCopywritingOutput(mainCopy, {
        assignedSellingPoint,
        audience,
        scene: limitChars(scene, 14, "真实使用场景"),
        fallbackPoint: assignedPoint,
        evidenceLevel: assignedSellingPoint?.evidenceLevel
      });
      const finalMainCopy = preferModelCopy(item.copywriting, guardedMainCopy, {
        audience,
        scene: limitChars(scene, 14, "真实使用场景"),
        evidenceLevel: assignedSellingPoint?.evidenceLevel
      });
      const roleSeparatedMainCopy = enforceMainRoleCopy({
        index,
        copy: finalMainCopy,
        asset: assignedSellingPoint,
        assignedPoint,
        assignedBenefit
      });
      const mainGoal =
        index === 0
          ? "货架首图：0.5秒看清品类、主体和核心利益，不承载复杂解释"
          : index === 1
            ? "差异主图：回答为什么点你，不点别人，用差异点连接可感知结果"
            : index === 2
              ? "痛点主图：展示真实使用麻烦，并同屏给出解决方案和改善结果"
              : index === 3
                ? "场景主图：让用户脑补拥有后的生活状态和情绪价值"
              : "决策主图：压缩购买前关键确认信息，降低下单判断成本";
      const defaultRelation = blueprint.relation;
      const roleMeta = mainImageRoles[index] ?? mainImageRoles[0];
      const primaryClickReason =
        index === 0
          ? mainClickReason.primaryClickReason
          : index === 1
            ? `差异点：${assignedPoint}`
            : index === 2
              ? `痛点解决：${mainPain}`
              : assignedBenefit || assignedPoint;
      const expressionMethod = index === 0 ? mainClickReason.expressionMethod : roleMeta.expressionMethod;
      const proofOrBoundary = assignedSellingPoint?.claimBoundary || assignedSellingPoint?.proof || mainClickReason.proofOrBoundary;
      const roleImageBrief =
        index === 1
          ? `1:1 方图，${scene}，以「${assignedPoint}」做差异主图：不要表现痛点情绪，重点用局部放大、同类抽象对照、结构/材质/使用细节对比，证明为什么这个产品比普通同类更值得点开；产品主体清晰，占画面60%-80%，文字只讲差异点和可感知结果。`
          : index === 2
            ? `1:1 方图，${scene}，以「${mainPain}」做痛点主图：左侧表现用户正在忍受的小麻烦，右侧表现产品介入后的解决结果，中间用产品连接前后变化；必须同屏给出解决方案，不要只发问，不重复第2张的差异对比逻辑。`
            : "";

      return {
        ...item,
        title: roleSeparatedMainCopy.headline,
        goal: mainGoal,
        scene,
        layout: enrichLayout(item.layout, defaultRelation, "1:1 方图"),
        imageBrief:
          roleImageBrief ||
          sanitizeCommercialText(item.imageBrief) ||
          `1:1 方图，${scene}，以「${assignedPoint}」为视觉重点呈现${mainGoal.replace(/：.*/, "")}。以真实使用场景、目标人群空间、痛点情境或使用结果为画面主体，产品 45 度侧前方或正面清晰展示并自然融入场景，禁止纯白底、纯棚拍、孤立产品摆拍，高清商业摄影，去 AI 化如相机实拍，产品与场景光影统一不割裂，氛围贴合${audience}，${styleHint}`,
	        textImageLayout: `${sanitizeCommercialText(item.textImageLayout) || defaultRelation}；1:1 方图，顶部 12%–18% 作为标题安全区，标签和重点信息作为完整画面排版的一部分生成；品牌素材区仅在图片或用户资料明确提供时出现；产品与文字保持安全距离，文字清晰端正。`,
        visualFocus:
          mainGoal,
        visualGuidelines: buildPlanVisualGuidelines(product, market, {
          aspectRatio: "1:1 方图",
          scene,
          layout: item.layout,
          visualElements: enrichVisualElements(item.visualElements, index),
          manualProductInfo
        }),
        copywriting: {
          ...item.copywriting,
          headline: roleSeparatedMainCopy.headline,
          subheadline: roleSeparatedMainCopy.subheadline,
          body: roleSeparatedMainCopy.body
        },
        visualElements: uniqueItems([assignedPoint, assignedBenefit, ...enrichVisualElements(item.visualElements, index)], 8),
        assignedSellingPoint,
        role: roleMeta.role,
        primaryClickReason,
        expressionMethod,
        visualStrategy:
          index === 0
            ? `围绕唯一主点击理由「${primaryClickReason}」做首图，先让用户识别品类，再看到一个明确购买利益。决策路径：${compactDecisionPath(userDecisionPath)}`
            : `${roleMeta.role}只解决一个点击问题：${mainGoal}`,
        productSizeRatio: "60-80%" as const,
        compositionRule: roleMeta.compositionRule,
        proofOrBoundary,
        clickTriggerExplanation:
          index === 0
            ? mainClickReason.whyThisWillTriggerClick
            : index === 1
              ? "第2张只回答差异理由：让用户知道为什么点这个，而不是普通同类；不得写成痛点解决图。"
              : index === 2
                ? "第3张只回答痛点解决：先让用户看到具体麻烦，再看到产品给出的解决结果；不得重复第2张差异逻辑。"
                : `该图作为${roleMeta.role}，用${expressionMethod}表达方式补齐点击链路，不重复首图主理由。`,
        mainClickReason: index === 0 ? mainClickReason : undefined
      };
    }),
    detailPages: plan.detailPages.map((item, index) => {
      const blueprint = detailBlueprint(index);
      const assignedSellingPoint = detailSlotAsset(index);
      const assignedPoint = assetName(
        assignedSellingPoint,
        index >= 3 && index <= 7
          ? coreSellingPoints[Math.min(index - 3, Math.max(coreSellingPoints.length - 1, 0))] ?? heroPoint
          : blueprint.title
      );
      const assignedBenefit = assetBenefit(assignedSellingPoint, blueprint.subheadline);
      const rhythm = detailVisualRhythm(index);
      const shouldUseAssignedCopy = Boolean(assignedSellingPoint);
      const fabDetailCopy = fabCopyForDetail(
        assignedSellingPoint,
        index,
        assignedPoint,
        {
          headline: blueprint.title,
          subheadline: limitChars(blueprint.subheadline, 20, "买前少一点犹豫"),
          body: normalizeBodyCopy("", blueprint.bodyLines)
        }
      );
      const detailHeadline = shouldUseAssignedCopy ? fabDetailCopy.headline : blueprint.title;
      const detailSubheadline = shouldUseAssignedCopy ? fabDetailCopy.subheadline : limitChars(blueprint.subheadline, 20, "买前少一点犹豫");
      const detailBody = shouldUseAssignedCopy
        ? fabDetailCopy.body
        : normalizeBodyCopy("", blueprint.bodyLines);
      const guardedDetailCopy = sanitizeCopywritingOutput(
        {
          headline: detailHeadline,
          subheadline: detailSubheadline,
          body: detailBody
        },
        {
          assignedSellingPoint,
          audience,
          fallbackPoint: assignedPoint,
          evidenceLevel: assignedSellingPoint?.evidenceLevel
        }
      );
      const finalDetailCopy = preferModelCopy(item.copywriting, guardedDetailCopy, {
        audience,
        evidenceLevel: assignedSellingPoint?.evidenceLevel
      });
      const defaultRelation =
        index % 3 === 0
          ? "图上文下，顶部固定标题，中部产品/场景大图，底部卖点说明"
          : index % 3 === 1
            ? "图右文左，左侧短文案和标签，右侧产品/细节特写"
            : "全屏图+文字叠加，文字放安全区，产品不被遮挡";
      const funnelMeta = detailFunnelMeta(index + 1);
      const proofOrBoundary =
        assignedSellingPoint?.claimBoundary ||
        assignedSellingPoint?.proof ||
        (index === 0 ? mainClickReason.proofOrBoundary : userDecisionPath.evidenceBoundary);
      const sellingPointAssetIds = assignedSellingPoint ? [assignedSellingPoint.name] : [];

      return {
        ...item,
        title: finalDetailCopy.headline,
        goal: `${rhythm}${sanitizeCommercialText(item.goal) ? ` ${sanitizeCommercialText(item.goal)}` : ""}`.trim(),
        layout: enrichLayout(`${blueprint.layout || item.layout}；${rhythm}`, defaultRelation, "2:3 竖版"),
        imageBrief:
          `${blueprint.imageBrief || `${audience}真实日常场景，去 AI 化如商业相机实拍，产品按本屏卖点选择正面/侧面/局部特写，产品与场景光影统一不割裂，氛围高级统一，${styleHint}`} ${shouldUseAssignedCopy ? `画面聚焦「${assignedBenefit}」，用清晰场景和产品细节表达，避免重复其他屏信息。` : ""} ${rhythm}` ||
          `${audience}真实日常场景，去 AI 化如商业相机实拍，产品按本屏卖点选择正面/侧面/局部特写，产品与场景光影统一不割裂，氛围高级统一，${styleHint}`,
	        textImageLayout: `${sanitizeCommercialText(item.textImageLayout) || defaultRelation}；2:3 竖版移动端，顶部 12%–18% 作为标题安全区，标签和重点信息作为完整画面排版的一部分生成；品牌素材区仅在图片或用户资料明确提供时出现；产品与文字保持安全距离，文字清晰端正。`,
        visualFocus:
          sanitizeCommercialText(item.visualFocus) ||
          "产品和场景是主视觉，文字做辅助说明，层次清楚，留白充足。",
        visualGuidelines: buildPlanVisualGuidelines(product, market, {
          aspectRatio: "2:3 竖版",
          layout: blueprint.layout || item.layout,
          visualElements: blueprint.visualElements,
          manualProductInfo
        }),
        copywriting: {
          ...item.copywriting,
          headline: finalDetailCopy.headline,
          subheadline: finalDetailCopy.subheadline,
          body: finalDetailCopy.body
        },
        visualElements: uniqueItems([assignedPoint, assignedBenefit, ...enrichVisualElements(blueprint.visualElements, index)], 8),
        assignedSellingPoint,
        funnelStage: funnelMeta.funnelStage,
        screenRole: funnelMeta.screenRole,
        userQuestionAnswered: funnelMeta.userQuestionAnswered,
        userPainPoint: assignedSellingPoint?.painPoint || userDecisionPath.hesitationPoints[0],
        sellingPointAssetIds,
        visualStrategy: `${funnelMeta.screenRole}：${blueprint.stage}。${rhythm}`,
        proofOrBoundary,
        conversionPurpose: funnelMeta.conversionPurpose
      };
    })
  };
}

function getDecisionSignals(
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo
) {
  const sellingPoints = collectSellingPoints(
    [
      manualProductInfo?.sellingPoints,
      ...(product.sellingPoints ?? []),
      ...getMarketEvidenceTexts(market, "copywritingSellingPoints"),
      ...getMarketEvidenceTexts(market, "hotSellingPoints"),
      ...getMarketEvidenceTexts(market, "featureSellingPoints"),
      ...product.visibleFeatures
    ],
    8
  );
  const signalText = buildProductSignalText(product, market, manualProductInfo);
  const highDecisionCost = /家电|电子|数码|美妆|护肤|保健|食品|母婴|宠物|医疗|器械|高客单|专业|功率|成分|配方|电机/.test(signalText);
  const complianceRisk = /保健|食品|化妆|护肤|母婴|医疗|药|成分|功效|治疗|认证|检测|报告|电器|家电/.test(signalText);
  const complexityScore = [
    product.visibleFeatures.length >= 5,
    product.productDetails?.length ? product.productDetails.length >= 4 : false,
    product.parameters?.length ? product.parameters.length >= 2 : false,
    market.functionProblemMapping?.length ? market.functionProblemMapping.length >= 3 : false,
    highDecisionCost,
    complianceRisk
  ].filter(Boolean).length;

  return {
    sellingPoints,
    highDecisionCost,
    complianceRisk,
    complexityScore,
    hasParameters: hasReliableParameters(product, market),
    hasTrustEvidence: hasRealTrustEvidence(product, market, manualProductInfo?.notes)
  };
}

function decideDetailStructure(
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo: ProductManualInfo | undefined,
  defaultScreenCount: number
): DetailPageStructureMeta {
  const signals = getDecisionSignals(product, market, manualProductInfo);
  const effectiveSellingPointCount = signals.sellingPoints.length;
  const hasEnoughEvidence = signals.hasParameters || signals.hasTrustEvidence || effectiveSellingPointCount >= 5;
  const downgradedScreens: string[] = [];
  const mergedScreens: string[] = [];
  let mode: DetailPageStructureMeta["mode"] = "full";
  let screenCount = Math.min(defaultScreenCount, 14);
  const reasons: string[] = [];
  const isEmotionalAesthetic = manualProductInfo?.productDriveType === "emotional_aesthetic";

  if (isEmotionalAesthetic) {
    mode = "cropped";
    screenCount = 10;
    mergedScreens.push("感性美学型商品弱化参数屏和硬证据屏，增加视觉意象、搭配场景和情绪留白表达");
    reasons.push("商品驱动类型为感性美学型，采用 SVE 风格/氛围/情绪优先结构");
  }

  if (!signals.hasParameters) {
    downgradedScreens.push("第11屏参数信息可视化降级为尺寸/结构/使用方式说明");
    reasons.push("缺少明确参数证据");
  }

  if (!signals.hasTrustEvidence) {
    downgradedScreens.push("倒数第2屏改为购买顾虑回应，避免伪造资质或检测信息");
    reasons.push("缺少认证、检测、售后或品牌背书证据");
  }

  if (!isEmotionalAesthetic && effectiveSellingPointCount < 4) {
    mode = "full";
    screenCount = 14;
    mergedScreens.push("理性功能型仍保持14屏销售漏斗，但第4-8屏需合并表达角度，避免硬拆注水");
    reasons.push(`有效核心卖点仅 ${effectiveSellingPointCount} 个`);
  } else if (!isEmotionalAesthetic && !signals.highDecisionCost && signals.complexityScore <= 2) {
    mode = "full";
    screenCount = 14;
    reasons.push("低复杂度、低决策成本理性功能型仍输出14屏，弱证据屏改为场景、细节和顾虑回应");
  } else if (!isEmotionalAesthetic && signals.highDecisionCost && signals.complexityScore >= 4 && hasEnoughEvidence) {
    mode = "full";
    screenCount = 14;
    reasons.push("高功能/高决策成本品类且证据较充分，保留完整结构");
  } else if (!isEmotionalAesthetic && !hasEnoughEvidence) {
    mode = "full";
    screenCount = 14;
    reasons.push("证据不足时不减少屏数，参数/信任屏降级为结构说明、适用场景或购买顾虑回应");
  }

  return {
    mode,
    screenCount,
    defaultScreenCount: 14,
    reason: reasons.join("；") || "证据与卖点数量支持完整14屏结构",
    mergedScreens,
    downgradedScreens,
    evidenceSummary: `有效卖点 ${effectiveSellingPointCount} 个；参数证据：${signals.hasParameters ? "有" : "无"}；信任证据：${signals.hasTrustEvidence ? "有" : "无"}；复杂度评分：${signals.complexityScore}`
  };
}

function downgradeUnsupportedEvidenceScreens(
  pages: DetailPagePlan[],
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo
) {
  const hasParameters = hasReliableParameters(product, market);
  const hasTrustEvidence = hasRealTrustEvidence(product, market, manualProductInfo?.notes);

  return pages.map((page) => {
    if (page.index === 11 && !hasParameters) {
      return {
        ...page,
        title: "结构看清楚",
        goal: "不编造参数，用尺寸感、结构、使用方式和适用场景帮助用户判断",
        layout: "2:3竖版，产品多角度视图 + 结构/使用方式说明 + 适用场景卡片，不展示未确认参数表",
        imageBrief: "展示产品正面、侧面、局部结构和真实使用方式，使用图标说明适用空间与摆放方式，不出现虚构数字。",
        copywriting: {
          headline: "结构看清楚",
          subheadline: "买前先看真实样子",
          body: "外观看清楚\n用法看明白\n适合场景再判断"
        },
        visualElements: ["多角度视图", "结构说明", "使用方式", "适用场景", "局部放大"]
      };
    }

    if (page.index === 13 && !hasTrustEvidence) {
      return {
        ...page,
        title: "顾虑讲清楚",
        goal: "没有真实证据时不伪造认证或检测报告，改为购买顾虑回应",
        layout: "2:3竖版，用户顾虑列表 + 对应回应卡片 + 真实细节图，不生成证书、公章、检测报告或排名榜单",
	        imageBrief: "用真实产品细节、使用说明、售后规则提示和场景结果回应用户顾虑；没有真实来源时不生成证书、公章或检测报告画面。",
        copywriting: {
          headline: "顾虑讲清楚",
          subheadline: "下单前少点犹豫",
          body: "参数按实说明\n售后看店铺规则\n细节用实拍说话"
        },
        visualElements: ["购买顾虑回应", "真实细节图", "问答卡片", "售后规则提示", "不伪造证据"]
      };
    }

    return page;
  });
}

function selectDetailPagesForStructure(
  pages: DetailPagePlan[],
  meta: DetailPageStructureMeta,
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo
) {
  const downgraded = downgradeUnsupportedEvidenceScreens(pages, product, market, manualProductInfo);

  if (meta.screenCount >= downgraded.length) {
    return downgraded;
  }

  const byIndex = new Map(downgraded.map((page) => [page.index, page]));
  const selectedIndexes =
    meta.screenCount <= 8
      ? [1, 2, 3, 4, 5, 11, 13, 14]
      : meta.screenCount <= 10
        ? [1, 2, 3, 4, 5, 6, 8, 11, 13, 14]
        : [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 14];

  return selectedIndexes
    .map((index) => byIndex.get(index))
    .filter(Boolean) as DetailPagePlan[];
}

function finalizeDesignPlan(
  plan: { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] },
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo,
  outputScope: OutputScope = "all"
): {
  mainImages: MainImagePlan[];
  detailPages: DetailPagePlan[];
  detailStructure: DetailPageStructureMeta;
} {
  const shouldIncludeDetail = includesDetailPages(outputScope);
  const shouldIncludeMain = includesMainImages(outputScope);

  if (!shouldIncludeDetail) {
    return {
      mainImages: shouldIncludeMain
        ? plan.mainImages.map((item, index) =>
            sanitizePlanCompliance({
              ...item,
              index: index + 1
            })
          )
        : [],
      detailPages: [],
      detailStructure: {
        mode: "lightweight",
        screenCount: 0,
        defaultScreenCount: 14,
        reason: "本次输出范围为仅主图，未生成详情页策划。"
      }
    };
  }

  const detailStructure = decideDetailStructure(product, market, manualProductInfo, plan.detailPages.length);
  const selectedDetailPages = selectDetailPagesForStructure(
    plan.detailPages,
    detailStructure,
    product,
    market,
    manualProductInfo
  );
  const structureNote = `${detailStructure.mode === "full" ? "完整结构" : detailStructure.mode === "lightweight" ? "轻量结构" : "裁剪结构"}：${detailStructure.reason}`;

  return {
    mainImages: shouldIncludeMain
      ? plan.mainImages.map((item, index) =>
          sanitizePlanCompliance({
            ...item,
            index: index + 1
          })
        )
      : [],
    detailPages: selectedDetailPages.map((item, index) =>
      sanitizePlanCompliance({
        ...item,
        index: index + 1,
        structureMode: detailStructure.mode,
        structureNote
      })
    ),
    detailStructure: {
      ...detailStructure,
      screenCount: selectedDetailPages.length
    }
  };
}

function designPlanModel() {
  return process.env.OPENAI_DESIGN_PLAN_MODEL ?? "gpt-4.1-mini";
}

// 崩坏检测：模型偶发 token 耗尽会吐出超长字符堆（标题/副标题异常长）。
// 命中则该屏用模板兜底替换，避免崩坏文案进入最终结果。
function copyLooksCorrupted(copy?: { headline?: string; subheadline?: string; body?: string }) {
  if (!copy) return true;
  const headline = (copy.headline ?? "").trim();
  const subheadline = (copy.subheadline ?? "").trim();
  const body = (copy.body ?? "").trim();
  if (!headline) return true;
  if (Array.from(headline).length > 16) return true;
  if (Array.from(subheadline).length > 32) return true;
  // 正文任意一行异常长（正常每行 ≤15 字，放宽到 26 作为崩坏阈值）
  if (body.split("\n").some((line) => Array.from(line.trim()).length > 26)) return true;
  return false;
}

// 分批模式：单独生成 5 张主图
async function requestMainImagesFromAI(args: {
  input: GenerateDesignPlanInput;
  fallbackPlan: { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] };
  sharedPromptLines: string[];
  dataContextLines: string[];
}): Promise<MainImagePlan[]> {
  const { input, fallbackPlan, sharedPromptLines, dataContextLines } = args;
  const content = [
    ...sharedPromptLines,
    "",
    "# 本次任务：只生成 5 张主图",
    "必须只输出 JSON，不要输出 Markdown，不要输出解释文字。",
    "JSON 顶层只包含 mainImages 一个数组，必须输出 5 条；本次不要输出 detailPages。",
    ...dataContextLines
  ].join("\n");

  // 偶发 token 崩坏 → 最多重试 2 次，取崩坏最少的一次；全部正常则立即采用
  let best: MainImagePlan[] | null = null;
  let bestBad = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await createAIChatCompletion(input.providerConfig ?? null, {
        model: designPlanModel(),
        messages: [{ role: "user", content }],
        jsonSchema: mainImagesOnlySchema,
        maxTokens: 8000
      });
      const images = parseMainImagesJson(text);
      if (!images.length) continue;
      const badCount = images.filter((image) => copyLooksCorrupted(image.copywriting)).length;
      if (badCount === 0) return images;
      if (badCount < bestBad) {
        bestBad = badCount;
        best = images;
      }
    } catch (error) {
      console.warn(`主图分批生成失败（attempt ${attempt + 1}）。`, error);
    }
  }
  if (best) {
    const badCount = best.filter((image) => copyLooksCorrupted(image.copywriting)).length;
    throw new ServiceError(`主图策划 AI 返回中有 ${badCount} 条文案异常，已停止使用模板兜底，请重试策划方案。`, {
      statusCode: 502,
      code: "DESIGN_PLAN_AI_COPY_INVALID"
    });
  }
  throw new ServiceError("主图策划 AI 没有返回可用结构，已停止使用模板兜底，请检查模型配置后重试。", {
    statusCode: 502,
    code: "DESIGN_PLAN_AI_EMPTY"
  });
}

// 分批模式：只生成指定的几屏详情页
async function requestDetailBatchFromAI(args: {
  input: GenerateDesignPlanInput;
  sharedPromptLines: string[];
  dataContextLines: string[];
  batchAnchors: Array<{ index: number; title: string; goal: string }>;
  globalOutline: string;
  existingTitles: string[];
  fallbackSlice: DetailPagePlan[];
}): Promise<DetailPagePlan[]> {
  const { input, sharedPromptLines, dataContextLines, batchAnchors, globalOutline, existingTitles, fallbackSlice } =
    args;
  const count = batchAnchors.length;
  const batchRoleLines = batchAnchors.map((a) => `- 第${a.index}屏【${a.title}】：${a.goal}`).join("\n");
  const content = [
    ...sharedPromptLines,
    "",
    "# 本次任务：只生成指定的几屏详情页",
    "全部详情页屏的角色概览（用于把握整体漏斗，本次只产出其中一部分，注意与其它屏内容区隔）：",
    globalOutline,
    "",
    `本批只负责生成以下 ${count} 屏，必须严格对应各屏漏斗角色，按列出顺序输出，不要生成其它屏：`,
    batchRoleLines,
    existingTitles.length
      ? `以下标题已在其它屏使用，本批标题/文案必须与之明显不同，避免雷同：${existingTitles.join("、")}`
      : "",
    "必须只输出 JSON，不要输出 Markdown，不要输出解释文字。",
    `JSON 顶层只包含 detailPages 一个数组，必须输出 ${count} 条，顺序对应上面列出的屏；本次不要输出 mainImages。`,
    ...dataContextLines
  ]
    .filter(Boolean)
    .join("\n");

  // 偶发 token 崩坏 → 最多重试 2 次，取崩坏屏最少的一次；全部正常则立即采用
  let best: DetailPagePlan[] | null = null;
  let bestBad = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await createAIChatCompletion(input.providerConfig ?? null, {
        model: designPlanModel(),
        messages: [{ role: "user", content }],
        jsonSchema: buildDetailPagesSchema(count),
        maxTokens: 8000
      });
      const pages = parseDetailPagesJson(text);
      if (pages.length !== count) continue;
      const badCount = pages.filter((page) => copyLooksCorrupted(page.copywriting)).length;
      if (badCount === 0) return pages;
      if (badCount < bestBad) {
        bestBad = badCount;
        best = pages;
      }
    } catch (error) {
      console.warn(`详情页分批生成失败（attempt ${attempt + 1}）。`, error);
    }
  }
  if (best) {
    const badCount = best.filter((page) => copyLooksCorrupted(page.copywriting)).length;
    throw new ServiceError(`详情页策划 AI 返回中有 ${badCount} 屏文案异常，已停止使用模板兜底，请重试策划方案。`, {
      statusCode: 502,
      code: "DESIGN_PLAN_AI_COPY_INVALID"
    });
  }
  throw new ServiceError("详情页策划 AI 没有返回可用结构，已停止使用模板兜底，请检查模型配置后重试。", {
    statusCode: 502,
    code: "DESIGN_PLAN_AI_EMPTY"
  });
}

// 分批编排：主图 1 批 + 详情页按 BATCH_SIZE 屏串行分批（前批标题传入后批去重）
async function requestDesignPlanBatched(args: {
  input: GenerateDesignPlanInput;
  fallbackPlan: { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] };
  screenCount: number;
  sharedPromptLines: string[];
  dataContextLines: string[];
  outputScope: OutputScope;
}): Promise<{ mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] }> {
  const { input, fallbackPlan, sharedPromptLines, dataContextLines, outputScope } = args;
  const BATCH_SIZE = 3;

  const mainImages = includesMainImages(outputScope)
    ? await requestMainImagesFromAI({ input, fallbackPlan, sharedPromptLines, dataContextLines })
    : [];

  if (!includesDetailPages(outputScope)) {
    return { mainImages, detailPages: [] };
  }

  // 屏数与漏斗角色锚点以 fallbackPlan 为权威（completeDesignPlan 也按此长度对齐）
  const detailAnchors = fallbackPlan.detailPages.map((page, i) => ({
    index: i + 1,
    title: page.title,
    goal: page.goal
  }));
  const globalOutline = detailAnchors.map((a) => `- 第${a.index}屏【${a.title}】：${a.goal}`).join("\n");

  const detailPages: DetailPagePlan[] = [];
  const existingTitles: string[] = [];
  for (let start = 0; start < detailAnchors.length; start += BATCH_SIZE) {
    const batchAnchors = detailAnchors.slice(start, start + BATCH_SIZE);
    const fallbackSlice = fallbackPlan.detailPages.slice(start, start + batchAnchors.length);
    const pages = await requestDetailBatchFromAI({
      input,
      sharedPromptLines,
      dataContextLines,
      batchAnchors,
      globalOutline,
      existingTitles: [...existingTitles],
      fallbackSlice
    });
    detailPages.push(...pages);
    for (const page of pages) {
      const headline = page.copywriting?.headline?.trim();
      if (headline) existingTitles.push(headline);
    }
  }

  return { mainImages, detailPages };
}

export async function generateDesignPlan(input: GenerateDesignPlanInput): Promise<DesignPlanGenerationResult> {
  const hasProviderConfig = Boolean(input.providerConfig?.apiKey && input.providerConfig?.model);
  const outputScope = normalizeOutputScope(input.outputScope);

  if (!input.productAnalysis || !input.marketResearch) {
    throw new ServiceError("生成视觉方案缺少产品分析或市场分析数据。", {
      statusCode: 400,
      code: "DESIGN_PLAN_INPUT_MISSING"
    });
  }

  const fallbackPlan = buildFallbackDesignPlan(
    input.productAnalysis,
    input.marketResearch,
    input.manualProductInfo
  );
  const detailExpansionProfile = getDetailExpansionProfile(
    input.productAnalysis,
    input.marketResearch,
    input.manualProductInfo
  );
  const detailPageTargetCount = fallbackPlan.detailPages.length;
  const detailStructurePreview = decideDetailStructure(
    input.productAnalysis,
    input.marketResearch,
    input.manualProductInfo,
    detailPageTargetCount
  );
  const detailExpansionInstruction = `详情页默认标准结构为14屏，本次预判采用 ${detailStructurePreview.mode}，建议输出 ${detailStructurePreview.screenCount} 屏。原因：${detailStructurePreview.reason}。${detailExpansionProfile.reason} ${detailExpansionProfile.specialEffectRule}`;

  if (shouldUseMockData() && !hasProviderConfig) {
    const mockMeta = createDesignGenerationMeta(input, {
      sourceType: "mock",
      usedAI: false,
      usedMock: true,
      usedFallback: true,
      evidenceLevel: "C",
      fallbackReason: "未配置页面 AI 模型，使用演示策划数据。",
      note: "演示模式数据仅用于测试流程，不代表真实 AI 策划结果。"
    });
    return attachDesignGenerationMeta(finalizeDesignPlan(
      applyCreativeRulesToDesignPlan(
        applyManualInfoToDesignPlan(fallbackPlan, input.productAnalysis, input.manualProductInfo),
        input.productAnalysis,
        input.marketResearch,
        input.manualProductInfo
      ),
      input.productAnalysis,
      input.marketResearch,
      input.manualProductInfo,
      outputScope
    ), mockMeta);
  }

  // 共享规则池：主图规则 + 详情页规则 + 视觉/信任规则 + 新增要求，单次与分批模式共用。
  const sharedPromptLines: string[] = [
          "# 主图方案 Role（高点击率专家）",
          "你是电商主图点击率策划、广告文案和商业视觉设计专家。核心原则：用场景先让用户代入，再让产品解决场景里的问题；一眼看懂卖什么、适合谁、为什么点我。",
          "",
          "主图 5 张爆款分工（全部以场景情景化为主，不要做纯白底孤立产品图）：",
          "- 第1张【场景抓点击】：目标人群真实使用场景 + 产品自然成为画面核心 + 1条核心利益点。文案≤10字，背景干净但必须是生活/工作/商业空间场景，让用户0.5秒内知道「这和我有关」。",
          "- 第2张【痛点情境】：把用户日常遭的小麻烦拍出来，再让产品在同一个场景里解决问题。痛点场景真实到用户觉得「拍的就是我家/我的店/我的办公室」。文案用「你」或口语句制造代入感。",
          "- 第3张【效果对比场景】：用使用前/使用后、普通产品/本产品、凌乱/清爽、费力/省心等场景对比突出差异。对比必须发生在真实空间里，不要只做参数表。",
          "- 第4张【生活方式信任】：产品自然出现在目标人群的理想生活方式或当下流行空间中，帮助用户脑补「拥有后的样子」。可加入手部、人物背影、真实道具，但不要抢产品主体。",
          "- 第5张【场景决策信息】：在真实使用场景里叠加关键参数、购买顾虑回应和信息卡片，降低决策成本。参数信息服务场景，不要做冷冰冰的纯参数白底图。",
          "",
          "主图点击率铁律：",
          "- 主图整体以场景情景化为主，禁止纯白底/纯棚拍/孤立产品摆拍，除非用户明确要求。",
          "- 场景不是装饰背景，必须表达用户、空间、动作、痛点或使用结果。",
          "- 产品必须最大最清楚，建议占画面45%–65%；场景提供代入感但不能抢产品，轮廓清晰不融背景。",
          "- 1张图只讲1个核心信息，不要贪多。",
          "- 文案口语化、有情绪、像朋友推荐，拒绝书面腔。",
          "- 色彩对比度要高，移动端缩略图也能看清产品和主标题。",
          "- 每张必须是 1:1 方图。",
          "",
          "# 策划前判断（必须先在方案里隐性完成，不要输出分析过程）",
          "- 底层框架必须围绕电商三要素「人、货、场」：人=目标用户/决策顾虑/购买触发；货=产品属性/供应链/参数/毛利感知；场=淘宝京东货架、抖音小红书兴趣内容、移动端竖屏阅读。",
          "- 明确至少2类目标用户画像：新客/老客、价格敏感型/品质型/效率型/送礼型等，并把画面语言对准他们。",
          "- 梳理用户决策链路：看到主图→点进详情页→产生犹豫→寻找证据→下单。每个节点都要回答用户脑子里的问题。",
          "- 核心卖点最多5-6个，按用户关注度排序，不按产品功能罗列；次要卖点放到参数/更多详情中。",
          "- 参考市场洞察和搜索来源，至少吸收3个同品类TOP竞品的首屏策略、卖点排序和信任构建方式；没有真实搜索结果时不要假装看过排名、销量、价格或评价。",
          "- 方案中必须隐性形成产品基础信息卡片：品名/品类/价格线索/目标用户/核心卖点一句话。未提供价格时只写价格带感知或不写具体价格。",
          "",
          "# 详情页策划方案 Role（高转化率专家）",
          "你是电商 CVR 转化策划、详情页文案和视觉信息架构专家。核心方法：先制造需求→再证明方案→最后促成行动。",
          "",
          "详情页默认 14 屏转化漏斗，但必须根据卖点数量、证据充分度和决策成本裁剪、合并或降级（每屏一个转化任务）：",
          "- 策划底层必须先完成产品档案摘要：品名/品类/价格线索/目标用户/核心卖点一句话。它可以体现在第3屏的产品价值总览或需要说明产品档案的屏幕里，未提供价格时不要编造具体价格。",
          "- 策划底层必须先完成【目标用户画像与决策链路】：每类人群都要判断看到主图想什么、进详情页想什么、犹豫什么、什么推动下单。它要影响场景、文案语气、卖点排序和信任证据，不要作为空泛报告输出。",
          "- 第1屏【场景钩子】：真实生活/工作/商业场景 + 产品自然出现 + 一句结果型利益点，让用户3秒内代入。",
          "- 第2屏【痛点共鸣/前后对比】：写2-3个用户日常遭的小罪，可做使用前 vs 使用后对比图；必须同屏给解决方案和改善结果，严禁只发问不解决。",
          "- 第3屏负责讲清产品如何帮用户解决问题：用产品档案卡片 + 功能图标矩阵 + 核心利益短句，把产品价值讲清楚。",
          "- 第4屏起【核心卖点展开】：一屏一个卖点，每屏包含标题、展开说明、场景化描述、支撑数据/视觉证据；优先用场景图、对比图、数据图、标注图、拆解图或动效帧表达。",
          "- 第4-8屏默认展开5个核心卖点；如果有效核心卖点少于4个，不得硬拆4-8屏，必须合并为2-3屏，避免重复注水。",
          "- 第9屏【多角度展示】：高分辨率图片、多角度视图、细节缩放、360度展示感，让用户看清产品。",
          "- 第10屏【使用体验演示】：用视频分镜/GIF帧思路说明怎么用，降低上手成本。",
          "- 第11屏【参数信息可视化】：只有存在可确认规格/参数/数据时才做参数信息图；缺少明确参数时改为尺寸、结构、使用方式或适用场景说明，不得编造数字。",
          "- 第12屏【常见顾虑回应】：用问答气泡 + 产品答案卡 + 真实细节证据，解决用户可能存在的常见问题。",
          "- 倒数第2屏展示可确认的资质/证言/评价/晒图/售后/风险逆转等证据链；缺少认证、检测、售后或品牌背书时，必须改为“购买顾虑回应”，不得伪造证书、报告、评价、销量或排名。",
          "- 第14屏【收心文案】：最后一屏用一句感性收尾 + 3个决策理由 + 权益/保障条 + 全宽 CTA，不写「欢迎购买」式空话。",
          "- 风扇、循环扇、冷风扇、空调扇、风机等含电机产品，只有在图片、包装、参数、用户补充或市场资料中明确出现高速电机/纯铜电机/无刷电机/直流变频电机等证据时，才允许在固定 14 屏内安排 1 屏【电机结构介绍】；无证据时只能降级为风路结构、使用场景或顾虑回应，不得编造电机类型、功率、转速、分贝、认证或实验数据。",
          "- 电子产品/化妆品/保健品/特殊材料等如果需要 3D/C4D/分子/材料解析，必须同时有品类触发词和证据支撑，并压缩进固定 14 屏内表达；证据不足时降级为结构示意、使用场景或顾虑回应，不能伪造芯片、功率、续航、成分功效、医学承诺、材料等级或检测数据。",
          `- 当前特殊效果判断：${detailExpansionInstruction}`,
          "",
          "详情页转化铁律：",
          "- 痛点画面必须同屏给解决方案：先让用户看到问题，再立刻看到产品怎么解决以及解决后的结果。",
          "- 不要把「用户痛点开场」「用户反馈问题回应」「核心卖点拆解」「用户好评卖点放大」拆成四个空泛页面；新结构中第2屏负责痛点+解决方案，第3屏负责产品解决方案，第4屏起负责核心卖点证明。",
          "- 前3屏绝不放冷冰冰参数表，用场景代入、痛点解决、产品价值总览让用户产生「我需要」的感觉。",
          "- 首屏不是单纯产品图，而是场景图；用户必须能在3秒内代入「这个场景和我有关」。首屏主视觉高度应占移动端可视区域60%以上，且只放一个核心差异化卖点。",
          "- 首屏黄金三行：第一行核心卖点，第二行差异化优势，第三行紧迫提示/行动理由；文案短、口语化、可扫读。",
          "- 每屏只讲一件事，卖点排序按「用户最关心的」不是「功能分类」。",
          "- 卖点总数控制在5-6个核心项，次要卖点折叠到参数/更多详情；每个卖点模块结构统一：大字主标题 + 1张场景图/对比图 + 2-3行支撑文案。",
          "- 能用图表/箭头/圈点/高光标注表达的，不用长段文字；关键部位必须用箭头、圈点或高光圈强化。",
          "- layout 字段必须写成可落地的排版线框说明，标清图片区域占比、文案区域、数据/标签/按钮组件、装饰元素位置。",
          "- imageBrief 字段必须给摄影师/AI出图具体指令：场景、产品角度/状态、光线、人物/道具、特殊效果。",
          "- copywriting 必须是可直接上屏的文案：主标题≤10字，副标题≤20字，正文≤3行且每行≤15字。",
          "- 平台适配建议要隐含在方案中：淘宝/京东重信任证据和参数，小红书/抖音重场景种草和痛点短句，移动端重竖屏扫读。",
          "- 所有抽象形容词替换为具体视觉证据、实拍对比图、局部细节或用户能看懂的场景结果；没有来源的数据不要编造。",
          "- 视觉必须大胆新颖，场景高清，整体设计有美感、高级、统一视觉风格，不要有割裂感。",
          "- 突出产品核心卖点，产品卖点必须可视化表达，产品展示角度多元化（正面、45度、侧面、俯拍、手持、拆解、微距、局部放大）。",
          "- 标题文字固定在画面顶部区域，主标题、副标题、正文说明统一左对齐，不使用居中或右对齐，字体、字重、位置固定。",
          "- 部分页面可以不展示完整产品，以产品功能、材料、成分分子、内部爆炸式拆分、C4D结构或微观材质来可视化呈现，但必须服务卖点理解。",
          "- 构图必须体现高级留白和黄金分割，视觉中心明确，产品为核心，层次清晰。",
          "- 创意必须用道具、光影、局部放大、对比、数据图或材料特效体现卖点，不喧宾夺主。",
          "- 排版统一，文案不遮挡产品，适配移动端。",
          "- 视觉动线采用 F 型引导：顶部横向扫视→左侧纵向浏览，核心卖点落在高关注度热区。",
          "- 字号阶梯清晰：标题与正文字号差≥8pt，价格/数字重点与普通说明至少差2级。",
          "- 模块间留白至少24px，制造视觉停顿；闭眼3秒再睁开，第一眼必须看到本屏核心信息。",
          "- CTA 只在决策/收口屏强化：全宽按钮，主色系更饱和色+白色文字，上下留白=左右留白×1.5。",
          "- 价格对比只在用户补充或搜索结果提供价格时使用：原价灰色小字 vs 现价橙红大字；没有价格就改成权益/保障模块，绝不编造价格。",
          "- 保障条款旁加盾牌/印章图标，深蓝色图标+深灰色文字。",
          "",
          "信任构建规则：",
          "- 证据链不是声明。资质证明、专利证书、质检报告、食品经营许可证等只展示真实可确认的信息，挑最相关1-2个放大展示，并高亮证书编号、发证机关、有效期；没有来源不得编造。",
          "- 用户证言必须具体到「谁+用了多久+什么效果」，不要写「好评如潮」「用户都说好」这类空话。",
          "- 买家评价区必须包含头像+星级+短评三要素，优先展示带图评价，每条之间用1px浅灰分割线；没有真实评价时用“评价结构设计”表达，不伪造真人评价。",
          "- 品牌背书：新品牌强调专注年限或工艺专注，大品牌突出累计销量；没有来源不写具体数字。",
          "- 销量数据如有来源要单独成行，数字深绿加粗+单位灰色小字；无来源不编造。",
          "- 保留适当真实质感和瑕疵美学，如皮革纹路、手工痕迹、材质微纹理，避免过度磨皮失真。",
          "- 工厂/产线实拍、食品类合规资质、门店实地视频核验等只在用户提供或搜索结果确认时使用。",
          "",
          `请基于产品识别结果里的【视觉风格体系】、市场洞察里的卖点/目标受众/产品参数/产品细节/设计风格判断、用户反馈痛点问题、用户反馈优点、用户反馈问题和用户补充信息，生成 5 张主图方案和 ${detailStructurePreview.screenCount} 屏电商详情页方案。`,
          "用户补充信息是高优先级业务输入：如果用户填写了产品名称/型号、品类、品牌、目标人群、已知卖点或其他补充，必须在主图标题/副标题/场景/卖点标签，以及详情页的产品定位、场景共情、卖点拆解、转化收口中明确体现。",
          "详情页必须是 2:3 竖版移动端适配，整体视觉统一，不割裂。",
          "要求：不要夸大功能，不要写无法从图片、市场洞察或用户补充信息支撑的绝对参数。",
          "涉及容量、功率、分贝、风速、制冷效果等具体数据时，如用户未提供，不要写具体数字，也不要输出内部占位词。",
          "场景必须与目标群体符合，主图和详情页都要优先使用情景式场景化表达，真实自然、去 AI 化，像商业相机实拍出来的感觉，光影统一不割裂。产品与场景光影必须一致，不能像抠图贴上去。整体画面配色突出主题产品，画面干净。",
          "方案要偏电商转化，突出卖点表达、用户反馈优缺点提炼、场景共情、卖点可视化、字体层级、信息可视化。",
          "文案视觉策划要求：不要重复卖点，不要啰嗦，不要一屏塞多个核心卖点。每张图/每屏详情页只负责一个清晰转化任务，文案短、口语化、像朋友推荐。",
          "卖点分配规则：先列出卖点优先级，再把卖点分配到不同主图/详情页屏幕；同一个卖点不要在多个屏幕用相同角度重复表达，如必须再次出现，必须换成不同场景、不同用户顾虑或不同视觉证据。",
          "避免纯色空背景；每张图片必须包含中文主标题、中文副标题和必要的正文/标签排版。线性图标 UI、信息卡片和图形标签按本屏卖点需要使用。英文辅助小字、数字卖点、品牌区、Logo、认证、排名或销量元素必须有图片识别、用户补充或搜索资料支撑；没有真实来源时不得生成。",
          "每张主图和每屏详情页都必须输出 visualGuidelines 对象，包含：overallTone、imageTexture、lightingLogic、colorPaletteSystem、typographyRules、compositionRules、productAppearanceFeatures、unifiedVisualStyle。",
          "visualGuidelines 字段要求：",
          "- overallTone：整体调性，贴合目标人群与品类消费心理，真实自然去 AI 化。",
          "- imageTexture：画面质感，明确商业摄影、真实材质、高清氛围，像相机实拍。",
          "- lightingLogic：布光逻辑，明确主光、辅光、轮廓光和卖点高光，产品与场景光源方向统一。",
          "- colorPaletteSystem：色彩配色体系，基于产品真实颜色，主色不超过3种，突出主题产品，画面干净。",
          "- typographyRules：字体统一使用思源黑体 / 阿里巴巴普惠体 / HarmonyOS Sans；主标题 64–76px Heavy/Bold（主图 1:1 方图 54–68px）4–10 字可并列两排；副标题 32–40px Medium（主图 26–34px）12–18 字；标签文字 24–30px Medium；参数小字 20–24px Regular。只有真实参数、价格、规格或用户补充资料存在时，才使用数字重点字；只有真实品牌英文或用户补充短句存在时，才使用英文小字。按黄金比例优化字号、字重、行距、间距和留白层级。",
          "- compositionRules：主图写 1:1 方图，详情页写 2:3 竖版；标题统一在画面顶部 12%–18% 区域，正文在标题下方，图标、标签和重点信息放在文案附近；只允许左对齐，整套有秩序；构图体现高级留白、黄金分割、产品视觉中心。",
          "- productAppearanceFeatures：产品外观特征，写清颜色、结构、材质、关键细节，要求保持参考图一致。",
          "- unifiedVisualStyle：每张图片包含中文主标题、中文副标题和必要的标签/信息卡片；英文小字、数字卖点、品牌区、Logo、认证或排名只在真实资料支撑时出现。整套不割裂，线性 UI 图标统一，产品不被文字遮挡，留白充足，信息层次清晰不堆满文字；功能、材料、成分分子或内部爆炸式拆分屏可以不展示完整产品，但必须让卖点更好理解。",
          "",
          "新增方案要求：",
          "- 文案需要口语化，像跟朋友推荐，不要书面腔。",
          "- 卖点必须用“场景+效果”描述，不要纯参数堆砌。",
          "- 每个卖点让人读完就觉得“这事跟我有关”。",
          "- 痛点要写用户日常遭的那些小罪，不要写抽象需求。",
          "- 主标题 4–10 个字，字数多就并列两排，例如「加密网罩」「挂墙省地」「强劲送风」「拉绳调档」。",
          "- 副标题 12–18 个字，例如「细密防护，日常使用更安心」「挂在墙上，不占地面空间」「轻轻一拉，风速随手调节」。",
          "- 正文文案不超过 3 行，每行不超过 15 字，使用换行符分隔。",
          "- 每张图必须有 imageBrief：给设计师的配图指令，写清楚什么场景、什么角度、什么氛围。",
          "- 每张图必须有 textImageLayout：图文排版关系，例如图右文左、图上文下、全屏图+文字叠加；排版统一，字体、字重、位置固定，文案不遮挡产品，适配移动端。",
          "- 每张图必须有 visualFocus：产品为核心，层次清晰，留白充足。",
          "- 标题文字在画面顶部，统一使用左对齐。",
          "- 每张图必须包含中文主标题、中文副标题和必要的正文/标签排版。英文辅助、数字卖点、品牌区、Logo、认证、排名或销量信息只有在用户补充、图片识别或搜索资料明确提供时才能出现；否则用无品牌的线性图标、信息卡片和视觉容器表达。",
          "- 图标统一使用线性图标 UI；产品不能被文字遮挡，文字与产品保持安全距离；画面留白充足，信息层次清晰，不要堆满文字。",
          "- 构图采用高级留白和黄金分割，视觉中心为产品或本屏卖点可视化主体，层次清晰。",
          "- 创意用道具、光影、局部放大、对比、数据图、材料/成分/结构特效体现卖点，不喧宾夺主。",
          "- 情景式场景化必须真实自然，尤其是 5 张主图都要以真实使用场景、目标人群空间、痛点情境或使用结果为主体，不要输出纯白底、纯棚拍、孤立产品展示图。去 AI 化，像商业相机实拍，产品与场景光影统一，不能像抠图贴上去。整体画面配色突出主题产品，画面干净。",
          `- ${detailStructurePreview.screenCount} 屏详情页之间必须规避内容雷同：每屏的文案、卖点角度、场景画面、视觉表达必须有明确差异，不能换几个字就变成另一屏；文案高质量制作，情景式场景化画面高质量表达。`,
          "- 文案要克制：主标题只讲结论，副标题讲场景效果，正文补充一句真实理由；不要写长句，不要解释过度，不要堆叠形容词。",
          "- 视觉大胆新颖，场景高清，整体设计有美感、高级、统一视觉风格，不割裂，贴合目标人群和当下流行趋势风格。",
          "- 突出产品核心卖点，产品卖点可视化，产品的展示角度多元化。部分页面可以不展示完整产品，以产品功能、材料、成分分子、内部爆炸式拆分、C4D结构或微观材质进行可视化呈现，但必须服务卖点理解。",
          "- 产品占主要画面空间，背景不要比产品强势，不要把产品和背景融为一体看不清轮廓。排版按 Z 形或 F 形排列，视线流畅。",
          "- 前3屏不放参数表，用场景钩子、痛点解决和产品解决方案说话。卖点排序按用户关注度，不是按功能分类。每个核心卖点配对比图、局部放大、场景结果或实物标尺；没有来源的数据不要编造。",
          "- 主图第1张必须是货架首图：产品要大，只讲一个核心点击理由，让用户0.5秒识别品类和主利益。",
          "- 主图第2张必须是差异主图：回答为什么点这个产品而不是普通同类；用局部放大、结构/材质/使用细节对照或抽象同类对比表达差异点+用户可感知结果；不得写成痛点解决图。",
          "- 主图第3张必须是痛点主图：呈现用户正在忍受的具体小麻烦，并同屏给产品解决方案和解决后结果；不得重复第2张的差异对比逻辑。",
          "- 主图第4张必须是场景主图：展示拥有产品后的生活/工作状态和情绪价值，人物或道具只服务产品。",
          "- 主图第5张必须是场景决策信息图：尺寸、适用场景、使用方式、保障或套装等买前确认信息一目了然，但不能变成纯参数白底图。",
          "- 禁止使用违禁词：最、第一、国家级、替代空调、绝对、100%、保证等，按品类替换成合规表达。",
          "- 策划时必须参考市场洞察中的 competitorVisualBenchmarks（竞品视觉标杆）和 designStrategyNotes（设计策略笔记），在视觉方案中体现差异化，避免与竞品撞车。"
  ];
  sharedPromptLines.push(outputScopeInstruction(outputScope));
  // 单次模式专属输出指令（分批模式各批自行声明输出范围）
  const singleOutputInstructionLines: string[] = [
    "必须只输出 JSON，不要输出 Markdown，不要输出解释文字。",
    outputScope === "main_only"
      ? "JSON 顶层必须包含 mainImages 数组，必须输出 5 条，不要输出 detailPages。"
      : outputScope === "detail_only"
        ? `JSON 顶层必须包含 detailPages 数组，必须输出 ${detailStructurePreview.screenCount} 条，不要输出 mainImages。`
        : "JSON 顶层必须包含 mainImages 和 detailPages 两个数组。",
    outputScope === "all"
      ? `mainImages 必须输出 5 条，detailPages 必须输出 ${detailStructurePreview.screenCount} 条。`
      : ""
  ];
  // 产品 / 市场 / 用户数据上下文，所有模式共用
  const dataContextLines: string[] = [
    `多轮策划会话摘要：${input.planningContext ?? "暂无前置会话结论。"}`,
    `产品分析：${JSON.stringify(input.productAnalysis)}`,
    `市场洞察（含竞品视觉标杆和设计策略）：${JSON.stringify(input.marketResearch)}`,
    `用户补充信息：${JSON.stringify(input.manualProductInfo ?? {})}`
  ];

  const useSingleCall = Boolean(process.env.DESIGN_PLAN_SINGLE_CALL) && outputScope === "all";

  try {
    let merged: { mainImages: MainImagePlan[]; detailPages: DetailPagePlan[] };

    if (useSingleCall) {
      // 旧单次模式：一次生成 19 屏（保留作可切换回退）
      const text = await createAIChatCompletion(input.providerConfig ?? null, {
        model: process.env.OPENAI_DESIGN_PLAN_MODEL ?? "gpt-4.1-mini",
        messages: [
          {
            role: "user",
            content: [...sharedPromptLines, ...singleOutputInstructionLines, ...dataContextLines].join("\n")
          }
        ],
        jsonSchema: designPlanJsonSchema,
        maxTokens: 6500
      });
      const parsed = parseDesignPlanJson(text);
      assertCompleteAiDesignPlan(parsed, detailPageTargetCount, outputScope);
      merged = completeDesignPlan(parsed, fallbackPlan, outputScope);
    } else {
      // 分批模式：主图 1 批 + 详情页按 5 屏串行分批，避免单次巨型 JSON 后半段崩坏
      const batched = await requestDesignPlanBatched({
        input,
        fallbackPlan,
        screenCount: detailStructurePreview.screenCount,
        sharedPromptLines,
        dataContextLines,
        outputScope
      });
      assertCompleteAiDesignPlan(batched, detailPageTargetCount, outputScope);
      merged = completeDesignPlan(batched, fallbackPlan, outputScope);
    }

    const aiMeta = createDesignGenerationMeta(input, {
      sourceType: "real_ai",
      usedAI: true,
      usedMock: false,
      usedFallback: false,
      evidenceLevel: "B",
      note: "策划方案由当前配置的 AI 模型生成；市场证据边界仍以各条来源标签为准。"
    });
    return attachDesignGenerationMeta(finalizeDesignPlan(
      applyCreativeRulesToDesignPlan(
        applyManualInfoToDesignPlan(merged, input.productAnalysis, input.manualProductInfo),
        input.productAnalysis,
        input.marketResearch,
        input.manualProductInfo
      ),
      input.productAnalysis,
      input.marketResearch,
      input.manualProductInfo,
      outputScope
    ), aiMeta);
  } catch (error) {
    console.warn("AI design plan generation failed. Template fallback is disabled.", error);
    if (error instanceof ServiceError) {
      throw error;
    }
    throw new ServiceError(
      `AI 策划方案生成失败，已停止使用模板兜底。请检查 API Key、模型权限、结构化输出能力或稍后重试。${error instanceof Error ? `原因：${error.message}` : ""}`,
      {
        statusCode: 502,
        code: "DESIGN_PLAN_AI_FAILED"
      }
    );
  }
}
