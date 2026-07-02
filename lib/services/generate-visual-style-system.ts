import { ENABLE_REAL_SEARCH, shouldUseMockData } from "@/lib/config";
import { createAIChatCompletion } from "@/lib/services/openai-client";
import {
  collectProductSearchEvidence,
  formatSearchEvidenceForPrompt
} from "@/lib/services/product-search";
import { mockProductAnalysis } from "@/lib/services/mock-data";
import type {
  AIProviderConfig,
  MarketResearch,
  ProductAnalysis,
  ProductManualInfo,
  SearchProviderConfig,
  VisualStyleSystem
} from "@/lib/types";
import type { ChatCompletionParams } from "@/lib/ai-providers";

type GenerateVisualStyleSystemInput = {
  productAnalysis: ProductAnalysis;
  marketResearch?: MarketResearch;
  manualProductInfo?: ProductManualInfo;
  providerConfig?: AIProviderConfig | null;
  searchConfig?: SearchProviderConfig | null;
};

const visualStyleSystemJsonSchema = {
  name: "visual_style_system",
  strict: true,
  schema: {
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
} as const;

function uniqueItems(items: string[], limit: number) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function splitManualItems(value?: string) {
  return (value ?? "")
    .split(/[、，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function cleanItems(items: string[], fallback: string[], limit = 6) {
  const cleaned = uniqueItems(
    items.filter((item) => !/AI\s*返回|格式异常|人工复核|需人工|系统内部|待确认/.test(item)),
    limit
  );

  return cleaned.length ? cleaned : fallback.slice(0, limit);
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

function parseVisualStyleSystem(text: string): VisualStyleSystem {
  const value = JSON.parse(extractJsonLikeText(text)) as unknown;

  if (
    !isRecord(value) ||
    !isStringArray(value.overallTone) ||
    !isStringArray(value.imageTexture) ||
    !isStringArray(value.lightingLogic) ||
    !isStringArray(value.colorSystem) ||
    !isStringArray(value.typographyRules) ||
    !isStringArray(value.compositionRules)
  ) {
    throw new Error("Invalid visual style system JSON");
  }

  return {
    overallTone: cleanItems(value.overallTone, ["高级转化型电商视觉", "场景共情", "卖点可视化"]),
    imageTexture: cleanItems(value.imageTexture, ["高清商业摄影", "真实材质表现", "细节清晰"]),
    lightingLogic: cleanItems(value.lightingLogic, ["柔和主光", "产品轮廓光", "卖点区域高光"]),
    colorSystem: cleanItems(value.colorSystem, ["主色不超过3种", "品牌色为强调色", "背景色服务场景氛围"]),
    typographyRules: cleanItems(value.typographyRules, [
      "统一使用思源黑体 / 阿里巴巴普惠体 / HarmonyOS Sans 风格",
      "主标题、副标题、正文、标签层级清晰",
      "移动端阅读行距舒适"
    ]),
    compositionRules: cleanItems(value.compositionRules, [
      "2:3移动端竖屏适配",
      "顶部标题区固定",
      "产品主体与卖点信息保持安全距离"
    ])
  };
}

function providerSupportsBuiltInSearch(providerConfig?: AIProviderConfig | null) {
  if (!ENABLE_REAL_SEARCH) {
    return false;
  }

  if (!providerConfig?.apiKey || !providerConfig.model) {
    return false;
  }

  return providerConfig.providerId === "volcengine" || /volces\.com/i.test(providerConfig.baseURL);
}

function manualInfoToSummary(info?: ProductManualInfo) {
  if (!info || !Object.values(info).some(Boolean)) {
    return "用户未填写补充信息。";
  }

  return [
    info.productName ? `产品名称：${info.productName}` : "",
    info.category ? `品类：${info.category}` : "",
    info.brand ? `品牌：${info.brand}` : "",
    info.sellingPoints ? `卖点：${info.sellingPoints}` : "",
    info.targetAudience ? `目标人群：${info.targetAudience}` : "",
    info.notes ? `补充要求：${info.notes}` : ""
  ]
    .filter(Boolean)
    .join("；");
}

function inferVisualStyleSystem(
  product: ProductAnalysis,
  marketResearch?: MarketResearch,
  manualProductInfo?: ProductManualInfo
): VisualStyleSystem {
  const category = manualProductInfo?.category || product.category || product.productNameGuess || "产品";
  const sellingPoints = uniqueItems([
    ...splitManualItems(manualProductInfo?.sellingPoints),
    ...(product.sellingPoints ?? []),
    ...product.visibleFeatures
  ], 5);
  const audiences = uniqueItems([
    ...splitManualItems(manualProductInfo?.targetAudience),
    ...(product.targetAudience ?? [])
  ], 4);
  const colors = uniqueItems(product.colors, 4);
  const materials = uniqueItems(product.materials, 4);
  const styleKeywords = uniqueItems(product.styleKeywords, 4);
  const marketStyles = uniqueItems([
    ...(marketResearch?.visualStyles ?? []),
    ...(marketResearch?.designStyleJudgement ?? []),
    ...(marketResearch?.competitorVisualBenchmarks ?? [])
  ], 5);
  const painPoints = uniqueItems(marketResearch?.userPainPoints ?? [], 3);

  return {
    overallTone: uniqueItems(
      [
        `${category}专属转化型电商详情页`,
        audiences.length ? `${audiences[0]}场景共情` : "真实使用场景共情",
        sellingPoints.length ? `${sellingPoints[0]}卖点可视化` : "核心卖点可视化",
        marketStyles[0] ? `参考同类详情页趋势：${marketStyles[0]}` : "",
        "高级干净但避免纯色空背景",
        "主图赢点击，详情页赢转化"
      ],
      6
    ),
    imageTexture: uniqueItems(
      [
        "高清商业摄影质感",
        materials.length ? `${materials.slice(0, 2).join("/")}材质细节清晰` : "真实材质细节清晰",
        "场景真实、有生活温度",
        "产品边缘高光与质感微距结合",
        painPoints.length ? `用真实场景回应${painPoints[0]}` : "",
        "信息卡片轻玻璃拟态"
      ],
      6
    ),
    lightingLogic: uniqueItems(
      [
        "柔和主光突出产品主体",
        "侧逆光勾勒产品轮廓",
        "卖点区域使用局部高光引导视线",
        "场景背景保持自然环境光",
        "避免过曝和廉价强反光"
      ],
      6
    ),
    colorSystem: uniqueItems(
      [
        colors.length ? `${colors.slice(0, 3).join(" / ")}作为产品识别主色` : "沿用产品真实配色作为主色",
        "背景色与使用场景匹配，不使用单一纯色背景",
        "强调色只用于核心卖点、按钮和数据标签",
        "整体色彩不超过3个主色层级",
        ...styleKeywords.map((keyword) => `${keyword}氛围色彩`)
      ],
      6
    ),
    typographyRules: uniqueItems(
      [
        "统一使用思源黑体 / 阿里巴巴普惠体 / HarmonyOS Sans 风格",
        "主标题大字号高字重，副标题中字号中高字重",
        "正文不超过3行，每行不超过15字",
        "标签文字短句化，口语化，像朋友推荐",
        "字号、字重、行距按黄金比例拉开层级"
      ],
      6
    ),
    compositionRules: uniqueItems(
      [
        "移动端2:3竖屏优先，适配手机阅读",
        "标题统一在画面顶部区域，整套页面位置有秩序",
        "产品为视觉核心，文字不遮挡产品",
        "场景共情 + 卖点可视化 + 信息卡片组合",
        "每屏留白充足，图文安全距离清晰",
        "前后屏风格统一，避免割裂"
      ],
      6
    )
  };
}

export async function generateVisualStyleSystem(
  input: GenerateVisualStyleSystemInput
): Promise<VisualStyleSystem> {
  const productAnalysis = input.productAnalysis ?? mockProductAnalysis;
  const hasProviderConfig = Boolean(input.providerConfig?.apiKey && input.providerConfig?.model);
  const canUseAI = hasProviderConfig || Boolean(process.env.OPENAI_API_KEY);
  const searchBundle = await collectProductSearchEvidence({
    productAnalysis,
    manualProductInfo: input.manualProductInfo,
    searchConfig: input.searchConfig ?? null
  });
  const enableProviderWebSearch = providerSupportsBuiltInSearch(input.providerConfig);

  if (shouldUseMockData() && !canUseAI) {
    return productAnalysis.visualStyleSystem ?? inferVisualStyleSystem(productAnalysis, input.marketResearch, input.manualProductInfo);
  }

  const params: ChatCompletionParams = {
    model: process.env.OPENAI_STYLE_MODEL ?? "gpt-4.1-mini",
    messages: [
      {
        role: "user",
        content: [
          "你是电商详情页视觉策略、品牌视觉和消费心理分析专家。",
          "这是四轮递进工作流的第三轮：视觉风格体系。请根据第一轮产品识图、第二轮市场验证/卖点体系/用户画像、用户手动填写信息和市场资料摘要，反推这套产品专属的电商主图与详情页【视觉风格体系】。",
          "",
          "必须严格按照固定六大模块输出 JSON，不要输出 Markdown，不要输出解释文字。",
          "",
          "【分析要求】",
          "1. 依据产品属性、品类属性、目标人群、卖点体系、用户痛点和同类产品详情页风格定位来反推。",
          "2. 风格定位必须贴合电商爆款逻辑，主图赢点击，详情页赢转化。",
          "3. 避免纯色背景，主打场景共情、卖点可视化、移动端竖屏适配。",
          "4. 文案格式统一字体类型，字号 / 字重层级分明，行距舒适。",
          "5. 适配手机竖屏阅读，标题、正文、标签、信息卡片要有统一秩序。",
          "6. 如果真实搜索结果不足，必须基于产品识别和品类研究框架推导，不要编造销量、排名、评价原文。",
          "",
          "【固定六大模块】",
          "- overallTone：整体调性，5-6条，必须具体到该品类和目标用户。",
          "- imageTexture：画面质感，5-6条，包含摄影质感、材质细节、场景氛围。",
          "- lightingLogic：布光逻辑，5-6条，包含主光、补光、轮廓光、卖点高光。",
          "- colorSystem：色彩体系，5-6条，结合产品真实颜色、场景色、强调色。",
          "- typographyRules：字体规范，5-6条，统一使用思源黑体 / 阿里巴巴普惠体 / HarmonyOS Sans 风格，字号/字重/行距层级清晰。",
          "- compositionRules：构图规范，5-6条，移动端2:3竖屏适配，标题顶部区域统一，图文安全距离，产品不被遮挡。",
          "",
          "【产品识别结果】",
          JSON.stringify(productAnalysis),
          "",
          "【第二轮市场验证与卖点体系】",
          JSON.stringify(input.marketResearch ?? {}),
          "",
          "【用户补充信息】",
          manualInfoToSummary(input.manualProductInfo),
          "",
          "【联网状态】",
          `模型自带联网搜索工具：未启用`,
          `真实搜索状态：${searchBundle.sourceNote}`,
          "",
          "【市场资料摘要】",
          formatSearchEvidenceForPrompt(searchBundle)
        ].join("\n")
      }
    ],
    jsonSchema: visualStyleSystemJsonSchema,
    maxTokens: 1800,
    enableWebSearch: enableProviderWebSearch
  };

  try {
    return parseVisualStyleSystem(await createAIChatCompletion(input.providerConfig ?? null, params));
  } catch (error) {
    console.warn("AI visual style system failed, using dynamic fallback.", error);
    return inferVisualStyleSystem(productAnalysis, input.marketResearch, input.manualProductInfo);
  }
}
