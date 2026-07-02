import {
  MAX_ANALYSIS_IMAGE_BYTES,
  MAX_TOTAL_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_COUNT,
  formatBytes,
  shouldUseMockData
} from "@/lib/config";
import { createProductEvidence, mergeEvidenceMaps, buildEvidenceItems } from "@/lib/evidence";
import { mockProductAnalysis } from "@/lib/services/mock-data";
import { createAIChatCompletion } from "@/lib/services/openai-client";
import { ServiceError } from "@/lib/services/errors";
import { buildProductVisualAnchor } from "@/lib/services/product-visual-anchor";
import { productAnalysisSchema } from "@/lib/services/schemas/product-analysis-schema";
import type { AIProviderConfig, ProductManualInfo, ProductAnalysis } from "@/lib/types";
import type { ChatCompletionParams } from "@/lib/ai-providers";

type AnalyzeProductImageInput = {
  imageBase64?: string;
  imageBase64s?: string[];
  imageUrl?: string;
  imageUrls?: string[];
  imageName?: string;
  imageNames?: string[];
  imageSize?: number;
  imageSizes?: number[];
  manualProductInfo?: ProductManualInfo;
  providerConfig?: AIProviderConfig | null;
};

const productAnalysisJsonSchema = {
  name: "product_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "category",
      "productNameGuess",
      "appearance",
      "visibleFeatures",
      "materials",
      "colors",
      "styleKeywords",
      "risks",
      "brandNames",
      "brandVisualStyle",
      "specifications",
      "sellingPoints",
      "dataSellingPoints",
      "targetAudience",
      "parameters",
      "productDetails",
      "specialRequirements",
      "visualStyleSystem"
    ],
    properties: {
      category: { type: "string" },
      productNameGuess: { type: "string" },
      appearance: { type: "array", items: { type: "string" } },
      visibleFeatures: { type: "array", items: { type: "string" } },
      materials: { type: "array", items: { type: "string" } },
      colors: { type: "array", items: { type: "string" } },
      styleKeywords: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      brandNames: {
        type: "object",
        additionalProperties: false,
        required: ["chinese", "english"],
        properties: {
          chinese: { type: "string" },
          english: { type: "string" }
        }
      },
      brandVisualStyle: { type: "array", items: { type: "string" } },
      specifications: { type: "array", items: { type: "string" } },
      sellingPoints: { type: "array", items: { type: "string" } },
      dataSellingPoints: { type: "array", items: { type: "string" } },
      targetAudience: { type: "array", items: { type: "string" } },
      parameters: { type: "array", items: { type: "string" } },
      productDetails: { type: "array", items: { type: "string" } },
      specialRequirements: {
        type: "object",
        additionalProperties: false,
        required: ["needModel", "needScene", "needDataVisualization", "others"],
        properties: {
          needModel: { type: "string" },
          needScene: { type: "string" },
          needDataVisualization: { type: "string" },
          others: { type: "array", items: { type: "string" } }
        }
      },
      visualStyleSystem: {
        type: "object",
        additionalProperties: false,
        required: [
          "overallTone",
          "imageTexture",
          "lightingLogic",
          "colorSystem",
          "typographyRules",
          "compositionRules"
        ],
        properties: {
          overallTone: { type: "array", items: { type: "string" } },
          imageTexture: { type: "array", items: { type: "string" } },
          lightingLogic: { type: "array", items: { type: "string" } },
          colorSystem: { type: "array", items: { type: "string" } },
          typographyRules: { type: "array", items: { type: "string" } },
          compositionRules: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
} as const;

const analysisSystemPrompt =
  [
    "# Role",
    "你是精通电商产品识图、包装文字识别、工业设计 CMF 分析的产品视觉分析专家。",
    "",
    "# Task",
    "这是四轮递进工作流的第一轮：产品识图。你只能基于用户上传的产品图片说话，不联网、不编造、不把无法确认的信息当事实。请智能识别产品类型、材质、场景、人群、卖点与品牌基因，并输出固定 JSON。",
    "",
    "## 一、产品基础识别",
    "- 品牌名称：从包装/产品上识别 LOGO 文字、中文品牌名、英文品牌名；提取品牌标志设计风格（字体、图标、配色）。看不清就留空，不要猜。",
    "- 产品品类归属：识别一级品类、二级品类、三级品类，并汇总到 category 字段，例如「家电 / 小家电 / 落地式冷风机」。",
    "- 具体产品名称：仅基于包装文字或产品形态推测 productNameGuess。",
    "- 产品规格：只提取图片中可见的尺寸、容量、重量、颜色、款式、包装规格、规格文字。",
    "",
    "## 二、外观特征与设计亮点",
    "- 整体外观：形状、大小感知、放置方式（手持/台式/落地/壁挂/外敷/内服等）、比例关系。",
    "- 设计亮点：区别于同类产品的特殊造型、配色、材质、结构设计。",
    "- 功能部件识别：按钮、接口、显示屏、配件、泵头、喷嘴、拉链、自封袋、可拆卸/折叠结构等可见部件逐一列出。",
    "- 材质观感：从图片推测金属、塑料、玻璃、木纹、布艺、纸盒、软袋等材质和光滑/粗糙/哑光/高光质感。",
    "- 色彩体系：主色+辅色+强调色，判断科技感、温暖感、简约感、轻奢感、清爽感等与产品属性匹配的风格关键词。",
    "",
    "## 三、初步卖点提取（仅基于图片可见）",
    "- 文案卖点：从包装文案、宣传语、功能标签、认证标识中提取关键词。",
    "- 认证卖点：只列出图片可见的有机、3C、CE、FDA、质检、专利、能效等标识。",
    "- 特征卖点：从颜色、材质、工艺、结构上的突出特征推断可视化卖点。",
    "- 数据卖点：提取图片中出现的百分比、含量、时长、功率、容量、净含量、尺寸、重量等数值。",
    "",
    "## 四、目标受众与参数细节",
    "- 目标受众推断：根据包装风格、产品类型、价格感知、使用方式推断目标用户、年龄段、消费层级。",
    "- 产品参数提取：从包装文字提取长宽高、净含量、尺码、功率、成分/配料/营养成分、使用说明、注意事项、生产日期、保质期、储存方式。",
    "- 产品细节识别：材质质感、结构特点、包装特色、配件/附件、使用状态。",
    "",
    "## 五、第一轮初步视觉线索",
    "visualStyleSystem 只是基于图片的初步视觉线索，第三轮会结合市场验证重新反推完整详情页视觉风格体系。请只写图片能支持的颜色、材质、光感、字体和构图线索。",
    "",
    "## 六、输出映射",
    "- category：包含一级/二级/三级品类的综合描述。",
    "- productNameGuess：图片可推断的具体产品名。",
    "- appearance：整体外观、大小感知、放置方式、造型结构。",
    "- visibleFeatures：可见功能部件和可见功能点。",
    "- materials：材质观感和表面质感。",
    "- colors：主色、辅色、强调色。",
    "- styleKeywords：图片可支持的风格关键词。",
    "- risks：不能从图片确认但后续需要验证的信息，如具体容量、功率、认证真实性、价格、销量、功效承诺。",
    "- brandNames / brandVisualStyle / specifications / sellingPoints / dataSellingPoints / targetAudience / parameters / productDetails / specialRequirements / visualStyleSystem 均按图片事实输出。",
    "",
    "## 分析原则",
    "1. 只看图说话。不能确认的具体数字参数、认证编号、价格、销量、功效承诺，不要写占位词，不要编造，放入 risks 字段。",
    "2. 可以做合理的品类/场景/人群推断，但必须写得克制，不能伪装成事实。",
    "3. 品牌/LOGO文字必须逐字识别，包括中英文、大小写、字体风格。",
    "4. 如果图片很模糊或信息不足，直接说明风险，不要输出系统内部词。",
    "5. 输出要为后续市场验证、视觉风格和详情页策划服务，但不要提前做联网市场结论。",
    "",
    "必须只输出 JSON，不要 Markdown，不要解释文字。"
  ].join("\n");

function estimateDataUrlBytes(dataUrl: string) {
  const [, base64 = ""] = dataUrl.split(",");
  return Math.floor((base64.length * 3) / 4);
}

function normalizeImageSource(imageSource: string) {
  if (!imageSource.startsWith("data:image/") && !/^https?:\/\//.test(imageSource)) {
    throw new ServiceError("图片参数格式不正确，请上传图片或提供可访问的图片 URL。", {
      statusCode: 400,
      code: "IMAGE_INPUT_INVALID"
    });
  }
}

function normalizeImageInputs(input: AnalyzeProductImageInput) {
  const imageSources = [
    ...(input.imageBase64s ?? []),
    ...(input.imageUrls ?? []),
    ...(input.imageBase64 ? [input.imageBase64] : []),
    ...(input.imageUrl ? [input.imageUrl] : [])
  ].filter(Boolean);
  const uniqueImageSources = Array.from(new Set(imageSources));

  if (!uniqueImageSources.length) {
    throw new ServiceError("请先上传产品图片。", {
      statusCode: 400,
      code: "IMAGE_REQUIRED"
    });
  }

  if (uniqueImageSources.length > MAX_UPLOAD_IMAGE_COUNT) {
    throw new ServiceError(`最多支持上传 ${MAX_UPLOAD_IMAGE_COUNT} 张产品图。`, {
      statusCode: 400,
      code: "IMAGE_COUNT_EXCEEDED"
    });
  }

  const imageSizes = input.imageSizes?.length ? input.imageSizes : input.imageSize ? [input.imageSize] : [];
  const normalized = uniqueImageSources.map((imageSource, index) => {
    normalizeImageSource(imageSource);

    const size =
      imageSizes[index] ??
      (imageSource.startsWith("data:image/") ? estimateDataUrlBytes(imageSource) : undefined);

    if (size && size > MAX_ANALYSIS_IMAGE_BYTES) {
      throw new ServiceError(
        `第 ${index + 1} 张接口图片过大，当前约 ${formatBytes(size)}，请压缩到 ${formatBytes(MAX_ANALYSIS_IMAGE_BYTES)} 以内。`,
        {
          statusCode: 413,
          code: "IMAGE_TOO_LARGE"
        }
      );
    }

    return {
      url: imageSource,
      name: input.imageNames?.[index] ?? (index === 0 ? input.imageName : undefined) ?? `产品图 ${index + 1}`,
      size
    };
  });

  const totalSize = normalized.reduce((total, image) => total + (image.size ?? 0), 0);
  if (totalSize > MAX_TOTAL_UPLOAD_IMAGE_BYTES) {
    throw new ServiceError(
      `图片总大小约 ${formatBytes(totalSize)}，请控制在 ${formatBytes(MAX_TOTAL_UPLOAD_IMAGE_BYTES)} 以内。`,
      {
        statusCode: 413,
        code: "IMAGE_TOTAL_TOO_LARGE"
      }
    );
  }

  return normalized;
}

function manualInfoToText(info?: ProductManualInfo) {
  if (!info || !Object.values(info).some(Boolean)) {
    return "用户未填写补充产品信息。";
  }

  return [
    info.productName ? `产品名称/型号：${info.productName}` : "",
    info.category ? `产品品类：${info.category}` : "",
    info.brand ? `品牌：${info.brand}` : "",
    info.productDriveType ? `商品驱动类型：${info.productDriveType === "emotional_aesthetic" ? "感性美学型" : "理性功能型"}` : "",
    info.targetAudience ? `目标人群：${info.targetAudience}` : "",
    info.targetPlatform ? `目标平台：${info.targetPlatform}` : "",
    info.priceRange ? `价格/销量线索：${info.priceRange}` : "",
    info.sellingPoints ? `已知卖点：${info.sellingPoints}` : "",
    info.competitorText ? `竞品资料摘要：${info.competitorText.slice(0, 300)}` : "",
    info.reviewText ? `用户评论摘要：${info.reviewText.slice(0, 300)}` : "",
    info.notes ? `其他补充：${info.notes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function splitManualItems(value?: string) {
  return (value ?? "")
    .split(/[、，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueItems(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function mergeManualInfoIntoAnalysis(
  analysis: ProductAnalysis,
  manualProductInfo?: ProductManualInfo
): ProductAnalysis {
  if (!manualProductInfo || !Object.values(manualProductInfo).some(Boolean)) {
    return analysis;
  }

  const manualSellingPoints = splitManualItems(manualProductInfo.sellingPoints);
  const manualAudience = splitManualItems(manualProductInfo.targetAudience);
  const manualNotes = splitManualItems(manualProductInfo.notes);

  const merged: ProductAnalysis = {
    ...analysis,
    category: manualProductInfo.category || analysis.category,
    productNameGuess: manualProductInfo.productName || analysis.productNameGuess,
    brandNames: {
      chinese: manualProductInfo.brand || analysis.brandNames?.chinese,
      english: analysis.brandNames?.english
    },
    sellingPoints: uniqueItems([
      ...manualSellingPoints,
      ...(analysis.sellingPoints ?? [])
    ]),
    visibleFeatures: uniqueItems([
      ...analysis.visibleFeatures,
      ...manualSellingPoints
    ]),
    targetAudience: uniqueItems([
      ...manualAudience,
      ...(analysis.targetAudience ?? [])
    ]),
    productDetails: uniqueItems([
      ...(analysis.productDetails ?? []),
      ...manualNotes
    ]),
    styleKeywords: uniqueItems([
      ...analysis.styleKeywords,
      ...(manualProductInfo.notes ? ["用户补充策划方向"] : [])
    ])
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
        sourceNote: "用户手动填写卖点，作为后续策划上下文"
      }),
      targetAudience: buildEvidenceItems(manualAudience, "user_input", "B", {
        sourceNote: "用户手动填写目标人群"
      }),
      productDetails: buildEvidenceItems(manualNotes, "user_input", "B", {
        sourceNote: "用户手动填写策划补充"
      })
    })
  };
}

function mergeMockWithManualInfo(info?: ProductManualInfo): ProductAnalysis {
  if (!info || !Object.values(info).some(Boolean)) {
    return {
      ...mockProductAnalysis,
      visualAnchor: buildProductVisualAnchor(mockProductAnalysis),
      evidence: createProductEvidence(mockProductAnalysis, "mock", "C", "Mock 演示数据")
    };
  }

  const merged = mergeManualInfoIntoAnalysis({
    ...mockProductAnalysis,
    category: info.category || mockProductAnalysis.category,
    productNameGuess: info.productName || mockProductAnalysis.productNameGuess,
    brandNames: {
      chinese: info.brand || mockProductAnalysis.brandNames?.chinese,
      english: mockProductAnalysis.brandNames?.english
    },
    visualAnchor: buildProductVisualAnchor(mockProductAnalysis),
    sellingPoints: [
      ...splitManualItems(info.sellingPoints),
      ...(mockProductAnalysis.sellingPoints ?? [])
    ],
    targetAudience: [
      ...splitManualItems(info.targetAudience),
      ...(mockProductAnalysis.targetAudience ?? [])
    ],
    risks: [
      ...mockProductAnalysis.risks,
      "mock 模式已合并用户手填信息，真实上架前仍需图片和参数复核"
    ],
    evidence: createProductEvidence(mockProductAnalysis, "mock", "C", "Mock 演示数据")
  }, info);

  return {
    ...merged,
    visualAnchor: buildProductVisualAnchor(merged)
  };
}

function parseProductAnalysisJson(text: string): ProductAnalysis {
  if (!text) {
    throw new ServiceError("AI 返回格式异常，请重试", {
      statusCode: 502,
      code: "AI_EMPTY_RESPONSE"
    });
  }

  const cleanText = extractJsonLikeText(
    text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
      .trim()
  );

  try {
    return normalizeProductAnalysis(JSON.parse(cleanText));
  } catch {
    throw new ServiceError("AI 返回格式异常，请重试", {
      statusCode: 502,
      code: "AI_RESPONSE_SCHEMA_INVALID"
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractJsonLikeText(text: string) {
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1);
  }

  return text;
}

function pickValue(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined) {
      return source[key];
    }
  }

  return undefined;
}

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return fallback;
}

function asStringArray(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => asString(item))
      .filter(Boolean);

    return items.length ? items : fallback;
  }

  if (typeof value === "string") {
    const items = value
      .split(/[、，,;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

    return items.length ? items : fallback;
  }

  return fallback;
}

function defaultVisualStyleSystem(category: string) {
  return {
    overallTone: ["电商转化型", "场景共情", "真实自然去AI化", "高级简洁", `${category}品类适配`],
    imageTexture: ["高清商业摄影", "真实产品质感", "像相机实拍", "卖点可视化", "细节清晰"],
    lightingLogic: ["柔和主光", "产品轮廓光", "卖点区域局部高亮", "产品与场景光源方向统一"],
    colorSystem: ["基于产品主色延展", "突出主题产品", "画面干净", "主色不超过3种", "深色正文", "品牌强调色按产品主色延展"],
    typographyRules: [
      "字体统一思源黑体/阿里巴巴普惠体/HarmonyOS Sans",
      "主标题64-76px Heavy/Bold（主图54-68px）4-10字",
      "副标题32-40px Medium（主图26-34px）12-18字",
      "真实参数/规格数字可用88-120px Heavy，无真实数字不生成数字卖点",
      "标签24-30px Medium",
      "参数小字20-24px Regular",
      "英文辅助仅用于真实品牌英文或用户提供短句",
      "黄金比例层级"
    ],
    compositionRules: [
      "2:3竖版移动端适配",
      "标题在画面顶部12%-18%区域",
      "中部产品/场景主体",
      "底部卖点信息卡片",
      "每图含中文标题/副标题/必要标签，英文、数字、品牌Logo仅在图片或用户资料确认时使用"
    ]
  };
}

const internalFallbackMarkers = [
  "待识别产品",
  "保持上传参考图",
  "参考产品图片",
  "结合产品图可见结构",
  "待确认",
  "占位"
];

function isInternalFallbackValue(value: string) {
  return internalFallbackMarkers.some((marker) => value.includes(marker));
}

function requireUsefulString(value: string, fieldName: string) {
  if (!value || isInternalFallbackValue(value)) {
    throw new Error(`Invalid product analysis: ${fieldName} missing`);
  }
}

function requireUsefulArray(items: string[], fieldName: string) {
  if (!items.length || items.every(isInternalFallbackValue)) {
    throw new Error(`Invalid product analysis: ${fieldName} missing`);
  }
}

function normalizeProductAnalysis(payload: unknown): ProductAnalysis {
  const root = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;

  if (!isRecord(root)) {
    throw new Error("Invalid product analysis payload");
  }

  const category = asString(
    pickValue(root, ["category", "productCategory", "productType", "产品品类", "产品类型", "类别"]),
    ""
  );
  const productNameGuess = asString(
    pickValue(root, ["productNameGuess", "productName", "name", "产品名称猜测", "具体产品名称", "产品名称"]),
    category
  );

  const appearance = asStringArray(
    pickValue(root, ["appearance", "appearanceInfo", "外观信息", "外观结构", "外观特征"]),
    []
  );
  const visibleFeatures = asStringArray(
    pickValue(root, ["visibleFeatures", "features", "visible_features", "可见功能", "可见功能点", "功能点"]),
    []
  );
  const materials = asStringArray(
    pickValue(root, ["materials", "material", "材质", "材质判断", "材质质感"]),
    []
  );
  const colors = asStringArray(
    pickValue(root, ["colors", "color", "颜色", "色彩", "色彩体系"]),
    []
  );
  const styleKeywords = asStringArray(
    pickValue(root, ["styleKeywords", "style_keywords", "visualKeywords", "风格关键词", "设计风格", "视觉风格"]),
    ["电商详情页", "场景化", "卖点可视化"]
  );
  const risks = asStringArray(
    pickValue(root, ["risks", "risk", "风险", "识别风险", "无法确认", "注意事项"]),
    ["图片未展示具体参数、认证、销量或价格信息", "真实参数和上架信息以商家资料为准"]
  );

  const brandNames = isRecord(root.brandNames)
    ? root.brandNames
    : isRecord(root["品牌名称识别"])
      ? (root["品牌名称识别"] as Record<string, unknown>)
      : {};
  const specialRequirements = isRecord(root.specialRequirements)
    ? root.specialRequirements
    : isRecord(root["特殊需求"])
      ? (root["特殊需求"] as Record<string, unknown>)
      : {};
  const visualStyleSystem = isRecord(root.visualStyleSystem)
    ? root.visualStyleSystem
    : isRecord(root["视觉风格体系"])
      ? (root["视觉风格体系"] as Record<string, unknown>)
      : {};
  const fallbackStyle = defaultVisualStyleSystem(category);
  requireUsefulString(category, "category");
  requireUsefulString(productNameGuess, "productNameGuess");
  requireUsefulArray(appearance, "appearance");
  requireUsefulArray(visibleFeatures, "visibleFeatures");
  requireUsefulArray(materials, "materials");
  requireUsefulArray(colors, "colors");

  const normalized = productAnalysisSchema.parse({
    category,
    productNameGuess,
    appearance,
    visibleFeatures,
    materials,
    colors,
    styleKeywords,
    risks,
    brandNames: {
      chinese: asString(pickValue(brandNames, ["chinese", "中文品牌名", "中文", "brandChinese"]), ""),
      english: asString(pickValue(brandNames, ["english", "英文品牌名", "英文", "brandEnglish"]), "")
    },
    brandVisualStyle: asStringArray(
      pickValue(root, ["brandVisualStyle", "品牌标志风格", "品牌视觉风格"]),
      ["图片未展示清晰品牌标识"]
    ),
    specifications: asStringArray(
      pickValue(root, ["specifications", "specs", "规格", "产品规格"]),
      ["具体规格以商家资料补充"]
    ),
    sellingPoints: asStringArray(
      pickValue(root, ["sellingPoints", "卖点提取", "核心卖点", "卖点"]),
      visibleFeatures
    ),
    dataSellingPoints: asStringArray(
      pickValue(root, ["dataSellingPoints", "数据卖点", "数字卖点"]),
      []
    ),
    targetAudience: asStringArray(
      pickValue(root, ["targetAudience", "目标受众", "目标用户"]),
      ["按品类和使用场景推断目标受众"]
    ),
    parameters: asStringArray(
      pickValue(root, ["parameters", "产品参数", "参数", "使用说明"]),
      ["具体参数以商家资料补充"]
    ),
    productDetails: asStringArray(
      pickValue(root, ["productDetails", "产品细节识别", "产品细节", "结构特点"]),
      [...appearance, ...materials].slice(0, 6)
    ),
    specialRequirements: {
      needModel: asString(pickValue(specialRequirements, ["needModel", "是否需要模特"]), "按品类和场景判断"),
      needScene: asString(pickValue(specialRequirements, ["needScene", "是否需要场景"]), "是，建议场景化表达"),
      needDataVisualization: asString(
        pickValue(specialRequirements, ["needDataVisualization", "是否需要数据可视化"]),
        "是，关键参数以商家资料为准"
      ),
      others: asStringArray(pickValue(specialRequirements, ["others", "其他特殊要求"]), ["需要产品实物", "需要卖点可视化"])
    },
    visualStyleSystem: {
      overallTone: asStringArray(pickValue(visualStyleSystem, ["overallTone", "整体调性"]), fallbackStyle.overallTone),
      imageTexture: asStringArray(pickValue(visualStyleSystem, ["imageTexture", "画面质感"]), fallbackStyle.imageTexture),
      lightingLogic: asStringArray(pickValue(visualStyleSystem, ["lightingLogic", "布光逻辑"]), fallbackStyle.lightingLogic),
      colorSystem: asStringArray(pickValue(visualStyleSystem, ["colorSystem", "色彩体系"]), fallbackStyle.colorSystem),
      typographyRules: asStringArray(pickValue(visualStyleSystem, ["typographyRules", "字体规范"]), fallbackStyle.typographyRules),
      compositionRules: asStringArray(pickValue(visualStyleSystem, ["compositionRules", "构图规范"]), fallbackStyle.compositionRules)
    }
  });

  return {
    ...normalized,
    visualAnchor: buildProductVisualAnchor(normalized),
    evidence: createProductEvidence(normalized, "image_fact", "A", "AI 根据上传图片识别；参数和认证仍需官方资料确认")
  };
}

export async function analyzeProductImage(input: AnalyzeProductImageInput): Promise<ProductAnalysis> {
  const hasProviderConfig = Boolean(input.providerConfig?.apiKey && input.providerConfig?.model);

  if (shouldUseMockData() && !hasProviderConfig) {
    return mergeMockWithManualInfo(input.manualProductInfo);
  }

  const images = normalizeImageInputs(input);
  const imageParts = images.map((image, index) => ({
    type: "image_url" as const,
    image_url: { url: image.url, detail: "high" as const },
    _metaName: `产品参考图 ${index + 1}：${image.name}`
  }));

  const params: ChatCompletionParams = {
    model: process.env.OPENAI_PRODUCT_ANALYSIS_MODEL ?? "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: analysisSystemPrompt
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `请综合分析 ${images.length} 张产品参考图。`,
              `图片文件名：${images.map((image, index) => `${index + 1}. ${image.name}`).join("；")}`,
              "多张图片可能包含正面、侧面、包装、细节或场景图，请综合判断，不要只看第一张。",
              "本轮是产品识图基础卡片，只基于图片可见事实输出。用户手动补充信息会在后续补充确认轮合并，不要把手动信息当成图片事实。",
              "请优先识别包装/产品上的品牌 LOGO 文字、中文品牌名、英文品牌名、规格、参数、成分/配料/营养成分、使用说明、注意事项、生产日期、保质期、储存方式等可见文字。",
              "如果图片没有对应文字，请返回空字符串，不要编造，不要写占位词。",
              "visualStyleSystem 只输出图片可支持的初步视觉线索，后续会结合市场验证重新生成完整风格体系。"
            ].join("\n")
          },
          ...imageParts.map(({ _metaName, ...part }) => part)
        ]
      }
    ],
    jsonSchema: productAnalysisJsonSchema,
    maxTokens: 3200
  };

  try {
    const text = await createAIChatCompletion(input.providerConfig ?? null, params);
    return parseProductAnalysisJson(text);
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "AI_RESPONSE_SCHEMA_INVALID" || error.code === "AI_EMPTY_RESPONSE")
    ) {
      throw new ServiceError(
        "AI 已返回内容，但不是可展示的产品识别 JSON。请确认当前接入点支持图片理解，并且模型会严格返回 JSON 后重试。",
        {
          statusCode: 502,
          code: "AI_PRODUCT_ANALYSIS_INVALID"
        }
      );
    }

    if (error instanceof ServiceError) {
      throw error;
    }

    throw new ServiceError("AI API 调用失败，请检查 API Key、模型权限或网络后重试。", {
      statusCode: 502,
      code: "AI_REQUEST_FAILED"
    });
  }
}
