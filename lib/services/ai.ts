import { shouldUseMockData } from "@/lib/config";
import { createMarketEvidence } from "@/lib/evidence";
import { providerSupportsBuiltInSearch } from "@/lib/ai-providers";
import { createAIChatCompletion } from "@/lib/services/openai-client";
import { buildCompetitorAnalysis } from "@/lib/services/competitor-analysis";
import {
  collectProductSearchEvidence,
  formatSearchEvidenceForPrompt,
  type ProductSearchBundle
} from "@/lib/services/product-search";
import { buildReviewInsight } from "@/lib/services/review-insight";
import { getSceneEmotionMap } from "@/lib/services/scene-emotion-map";
import { marketResearchSchema } from "@/lib/services/schemas/product-analysis-schema";
import type {
  AIProviderConfig,
  MarketResearch,
  ProductManualInfo,
  ProductAnalysis,
  SearchProviderConfig
} from "@/lib/types";
import type { ChatCompletionParams } from "@/lib/ai-providers";

export { analyzeProductImage } from "@/lib/services/analyze-product-image";
export { generateDesignPlan } from "@/lib/services/generate-design-plan";
export { generateImagePrompts } from "@/lib/services/generate-prompts";
export { generateVisualStyleSystem } from "@/lib/services/generate-visual-style-system";

type ResearchInput = {
  productAnalysis: ProductAnalysis;
  manualProductInfo?: ProductManualInfo;
  providerConfig?: AIProviderConfig | null;
  searchConfig?: SearchProviderConfig | null;
};

const marketResearchJsonSchema = {
  name: "market_research",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "hotSellingPoints",
      "userPainPoints",
      "userFeedbackPros",
      "userFeedbackCons",
      "copywritingSellingPoints",
      "certificationSellingPoints",
      "featureSellingPoints",
      "dataSellingPointInsights",
      "userQuestions",
      "aiShoppingInsights",
      "targetUserProfiles",
      "functionProblemMapping",
      "targetAudienceInsights",
      "productParameterInsights",
      "productDetailInsights",
      "designStyleJudgement",
      "competitorTitleStyles",
      "visualStyles",
      "competitorVisualBenchmarks",
      "designStrategyNotes",
      "sourceNote"
    ],
    properties: {
      hotSellingPoints: { type: "array", items: { type: "string" } },
      userPainPoints: { type: "array", items: { type: "string" } },
      userFeedbackPros: { type: "array", items: { type: "string" } },
      userFeedbackCons: { type: "array", items: { type: "string" } },
      copywritingSellingPoints: { type: "array", items: { type: "string" } },
      certificationSellingPoints: { type: "array", items: { type: "string" } },
      featureSellingPoints: { type: "array", items: { type: "string" } },
      dataSellingPointInsights: { type: "array", items: { type: "string" } },
      userQuestions: { type: "array", items: { type: "string" } },
      aiShoppingInsights: { type: "array", items: { type: "string" } },
      targetUserProfiles: { type: "array", items: { type: "string" } },
      functionProblemMapping: { type: "array", items: { type: "string" } },
      targetAudienceInsights: { type: "array", items: { type: "string" } },
      productParameterInsights: { type: "array", items: { type: "string" } },
      productDetailInsights: { type: "array", items: { type: "string" } },
      designStyleJudgement: { type: "array", items: { type: "string" } },
      competitorTitleStyles: { type: "array", items: { type: "string" } },
      visualStyles: { type: "array", items: { type: "string" } },
      competitorVisualBenchmarks: { type: "array", items: { type: "string" } },
      designStrategyNotes: { type: "array", items: { type: "string" } },
      sourceNote: { type: "string" }
    }
  }
} as const;

function uniqueItems(items: string[], limit: number) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function isInternalAnalysisNote(item: string) {
  return /AI\s*返回|格式异常|模型返回|兜底结构|人工复核|待人工|需人工|需要人工|无法仅凭图片确认|不能仅凭图片确认/.test(
    item
  );
}

function publicItems(items: string[]) {
  return items.filter((item) => !isInternalAnalysisNote(item));
}

function splitManualItems(value?: string) {
  return (value ?? "")
    .split(/[、，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function audienceSceneFromText(audience: string, category = "") {
  // 品类优先：生鲜/食品类的使用场景由品类决定，而非人群，
  // 避免「家庭」人群把番茄等产品错误带到客厅/卧室场景。
  if (
    /生鲜|蔬菜|水果|果蔬|时蔬|净菜|番茄|西红柿|黄瓜|青椒|辣椒|莓|草莓|蓝莓|车厘子|提子|葡萄|柑|橘|橙|苹果|香蕉|梨|桃|西瓜|甜瓜|哈密瓜|芒果|火龙果|鲜肉|牛肉|猪肉|羊肉|鸡肉|鸭肉|海鲜|水产|鲜鱼|鲜虾|活虾|螃蟹|鲜蛋|禽蛋|菌菇|玉米|土豆|红薯|地瓜/.test(
      category
    )
  ) {
    return "厨房备菜/餐桌摆盘/冰箱保鲜等真实食用场景";
  }
  if (/食品|饮品|茶|咖啡|酒|饮料|零食|糕点|坚果|糖果|冲饮|粮油|调味|礼盒|特产/.test(category)) {
    return "餐桌/茶歇/招待客人等真实食用场景";
  }
  if (/白领|办公|职场|办公室/.test(audience)) {
    return "办公室工位/通勤后快速使用";
  }
  if (/学生|宿舍|校园/.test(audience)) {
    return "宿舍桌面/寝室共享空间";
  }
  if (/户外|露营|车载|旅行/.test(audience)) {
    return "露营户外/车内/旅行收纳场景";
  }
  if (/家庭|宝妈|有娃|父母|家用/.test(audience)) {
    return "家庭日常使用场景";
  }

  return "目标人群最常见的真实使用场景";
}

function manualInfoToSummary(info?: ProductManualInfo) {
  if (!info || !Object.values(info).some(Boolean)) {
    return "用户未填写补充信息。";
  }

  return [
    info.productName ? `产品名称/型号：${info.productName}` : "",
    info.category ? `产品品类：${info.category}` : "",
    info.brand ? `品牌：${info.brand}` : "",
    info.targetAudience ? `目标人群：${info.targetAudience}` : "",
    info.sellingPoints ? `已知卖点：${info.sellingPoints}` : "",
    info.notes ? `策划补充：${info.notes}` : ""
  ]
    .filter(Boolean)
    .join("；");
}

function inferDynamicMarketResearch(
  product: ProductAnalysis,
  manualProductInfo?: ProductManualInfo,
  searchBundle?: ProductSearchBundle
): MarketResearch {
  const category = manualProductInfo?.category || product.category || product.productNameGuess || "该产品";
  const productName = manualProductInfo?.productName || product.productNameGuess || category;
  const features = uniqueItems(product.visibleFeatures, 5);
  const appearance = uniqueItems(product.appearance, 4);
  const styles = uniqueItems(product.styleKeywords, 4);
  const manualSellingPoints = splitManualItems(manualProductInfo?.sellingPoints);
  const manualAudience = splitManualItems(manualProductInfo?.targetAudience);
  const manualNotes = splitManualItems(manualProductInfo?.notes);
  const brand = manualProductInfo?.brand;
  const searchTitleSignals = uniqueItems(searchBundle?.results.map((result) => result.title) ?? [], 3);

  const hotSellingPoints = uniqueItems(
    [
      ...manualSellingPoints,
      ...features,
      brand ? `${brand}品牌信息可用于信任背书` : "",
      manualNotes.length ? manualNotes[0] : "",
      appearance.length ? "外观细节清晰可见" : "",
      styles.includes("家用") ? "家用场景友好" : "",
      styles.includes("实用") ? "实用型配置" : "",
      product.colors.length ? `${product.colors.slice(0, 2).join("/")}配色` : ""
    ],
    5
  );

  const userPainPoints = uniqueItems(
    [
      ...manualAudience.map((audience) => `${audience}需要快速判断是否适合自己的使用场景`),
      "担心实物质感与图片表现不一致",
      "担心参数、规格或适用范围不清晰",
      "不知道是否适合自己的使用场景和空间风格",
      "担心同类竞品太多，难以判断差异化价值",
      ...publicItems(product.risks).map((risk) =>
        risk
          .replace(/需要人工确认|无法仅凭图片确认|不能仅凭图片确认/g, "")
          .replace(/具体|参数/g, "")
          .trim()
      )
    ],
    6
  );

  const userFeedbackPros = uniqueItems(
    [
      ...manualSellingPoints.map((point) => `${point}是用户补充的重点转化卖点`),
      ...features.map((feature) => `${feature}带来使用便利`),
      ...manualAudience.map((audience) => `适合${audience}的场景表达更容易形成代入感`),
      "外观与详情表达清楚时更容易建立信任",
      "场景化展示有助于用户判断是否适合自己"
    ],
    6
  );

  const userFeedbackCons = uniqueItems(
    [
      // 用品类真实顾虑替代「{人群}会关注页面是否讲清真实使用收益」这类伪痛点
      ...getSceneEmotionMap(category).commonPains,
      "担心参数描述不清导致预期落差",
      "担心细节图不足，看不清材质和结构",
      "担心实际使用场景与页面展示不一致",
      "担心 AI 购物助手无法准确识别核心卖点与适用人群",
      ...publicItems(product.risks).map((risk) =>
        risk
          .replace(/需要人工确认|无法仅凭图片确认|不能仅凭图片确认/g, "")
          .replace(/具体|参数/g, "")
          .trim()
      )
    ],
    6
  );

  const competitorTitleStyles = uniqueItems(
    [
      ...searchTitleSignals,
      `${productName} ${manualSellingPoints[0] ?? "核心卖点"}款`,
      `${category} ${manualAudience[0] ?? "多场景"}适用`,
      `${category} 高颜值便捷款`,
      `${category} 省心之选`,
      `${category} 高级质感款`
    ],
    5
  );

  const visualStyles = uniqueItems(
    [
      ...manualNotes.map((note) => `${note}视觉方向`),
      ...manualAudience.map((audience) => `${audience}场景共情图`),
      ...styles.map((style) => `${style}视觉风格`),
      "产品结构拆解图",
      "卖点标签卡片",
      "场景化使用图",
      "痛点对比图"
    ],
    5
  );

  const targetAudienceInsights = uniqueItems(
    [
      ...manualAudience.map((audience) => `${audience}是优先沟通对象，页面要直接讲清日常使用场景和省心效果`),
      ...(product.targetAudience ?? []).map((audience) => `${audience}关注场景是否匹配、使用是否方便、外观是否适合空间`),
      "目标用户会先看产品是否解决眼前小麻烦，再看价格和参数是否合理",
      "移动端用户浏览时间短，前3屏必须快速建立“这和我有关”的代入感"
    ],
    6
  );

  const productParameterInsights = uniqueItems(
    [
      ...(product.parameters ?? []),
      ...(product.specifications ?? []),
      ...(product.dataSellingPoints ?? []),
      "未由用户提供的容量、功率、尺寸、噪音、风速等参数不要写死数字",
      "参数表达应放在详情页中后段，以信息卡片、图标和对比表呈现"
    ],
    6
  );

  const productDetailInsights = uniqueItems(
    [
      ...(product.productDetails ?? []),
      ...appearance,
      ...features,
      ...product.materials,
      "产品细节需要用局部放大、结构标注和真实材质特写表达",
      "产品外观、比例、配色和关键部件必须保持与上传参考图一致"
    ],
    8
  );

  const designStyleJudgement = uniqueItems(
    [
      ...(product.visualStyleSystem?.overallTone ?? []),
      ...(product.visualStyleSystem?.imageTexture ?? []),
      ...visualStyles,
      "设计风格必须承接视觉风格体系，先统一调性，再展开卖点画面",
      "主图突出点击理由，详情页突出信任、理解和转化，不重复堆卖点"
    ],
    6
  );
  const copywritingSellingPoints = uniqueItems(
    [
      ...manualSellingPoints.map((point) => `${point}：适合做主标题/卖点标签的高转化关键词`),
      ...features.map((feature) => `${feature}：从图片可见功能提炼出的文案卖点`),
      ...searchTitleSignals.map((title) => `${title}：可参考其关键词结构，不照搬文案`)
    ],
    6
  );
  const certificationSellingPoints = uniqueItems(
    [
      ...(product.specifications ?? []).filter((item) =>
        /认证|证书|质检|3C|CCC|CE|FDA|ROHS|有机|专利|能效/i.test(item)
      ),
      "该品类常见认证需以后续商家资料或官方页面确认，未确认前不写具体证书编号",
      "认证类信息适合放在信任屏或保障条款，不适合前3屏抢主视觉"
    ],
    5
  );
  const featureSellingPoints = uniqueItems(
    [
      ...features.map((feature) => `${feature}：可用局部放大、箭头标注或场景动作表达`),
      ...appearance.map((item) => `${item}：可转化为差异化外观/结构卖点`),
      ...product.materials.map((item) => `${item}：可用微距材质特写表达质感`)
    ],
    6
  );
  const dataSellingPointInsights = uniqueItems(
    [
      ...(product.dataSellingPoints ?? []),
      ...(product.parameters ?? []).filter((item) => /\d/.test(item)),
      "该品类核心数据应以信息卡、对比尺、柱状图或环形图表达；未确认数据不写死数字"
    ],
    6
  );
  const userQuestions = uniqueItems(
    [
      "这个产品适不适合我的真实使用场景？",
      "材质、尺寸、规格和操作方式是否讲清楚？",
      "和同类产品相比差别在哪里？",
      "售后、质保、认证或安全信息是否可信？",
      ...userFeedbackCons.map((item) => `${item}怎么解决？`)
    ],
    5
  );
  const aiShoppingInsights = uniqueItems(
    [
      "AI购物助手更容易抓取结构化标签：品类、场景、核心功能、适用人群、价格带和保障信息",
      "页面应把卖点写成“场景+效果”，便于对话式推荐回答用户问题",
      "标题和详情页应避免夸大词，使用可验证的功能、材质、场景和用户价值表达"
    ],
    5
  );
  const targetUserProfiles = uniqueItems(
    [
      ...(manualAudience.length ? manualAudience : product.targetAudience ?? []).map((audience, index) =>
        `${index + 1}. ${audience}：使用场景=${audienceSceneFromText(audience, category)}；核心需求=快速判断是否适合自己；价格敏感度=中；决策速度=比价型`
      ),
      `品质型新客：场景=${category}首次购买或升级；核心需求=怕踩坑，想看真实细节和证据链；价格敏感度=中；决策速度=研究型`
    ],
    4
  );
  const functionProblemMapping = uniqueItems(
    [
      ...features.map((feature) => `${feature} → 解决用户“不知道是否好用/是否方便”的疑问 → 场景里看见效果更安心`),
      ...hotSellingPoints.slice(0, 3).map((point) => `${point} → 放进真实使用场景 → 用户不用再忍受对应的小麻烦`)
    ],
    6
  );

  const research: MarketResearch = {
    hotSellingPoints,
    userPainPoints,
    userFeedbackPros,
    userFeedbackCons,
    copywritingSellingPoints,
    certificationSellingPoints,
    featureSellingPoints,
    dataSellingPointInsights,
    userQuestions,
    aiShoppingInsights,
    targetUserProfiles,
    functionProblemMapping,
    targetAudienceInsights,
    productParameterInsights,
    productDetailInsights,
    designStyleJudgement,
    competitorTitleStyles,
    visualStyles,
    competitorVisualBenchmarks: [
      "同品类头部商品多采用白底棚拍+场景化拼图的主图模式",
      "详情页前3屏以痛点场景+产品解决方案为主",
      "参数表通常在详情页中后段以信息卡片形式呈现",
      "移动端详情页以2:3竖版长图为主流格式"
    ],
    designStrategyNotes: [
      "建议主图第1张以纯产品+1条核心卖点差异化突围",
      "详情页前3屏用真实痛点场景引发共鸣而非直接展示参数",
      "注意品类视觉惯例但寻找1-2个打破惯例的记忆点"
    ],
    sourceNote:
      searchBundle?.sourceNote ??
      `当前为基于产品识别结果、用户补充信息（${manualInfoToSummary(manualProductInfo)}）与电商策划框架的 AI 市场洞察；真实搜索已关闭，不调用搜索 API 或模型联网插件。`
  };

  const hasSearch = Boolean(searchBundle?.usedSearch);
  return {
    ...research,
    evidence: createMarketEvidence(research, hasSearch ? "web_search" : "llm_inference", hasSearch ? "A" : "C", {
      sourceLink: searchBundle?.results[0]?.link,
      sourceNote: research.sourceNote
    })
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

function parseMarketResearchJson(text: string): MarketResearch {
  try {
    return marketResearchSchema.parse(JSON.parse(extractJsonLikeText(text)));
  } catch {
    throw new Error("Invalid market research JSON");
  }
}

function enrichMarketResearchAssets(
  research: MarketResearch,
  manualProductInfo?: ProductManualInfo
): MarketResearch {
  const competitorAnalysis = buildCompetitorAnalysis(manualProductInfo, research);
  const reviewInsight = buildReviewInsight(manualProductInfo, research);

  return {
    ...research,
    competitorAnalysis,
    reviewInsight
  };
}

export async function researchProductOnline(input: ResearchInput): Promise<MarketResearch> {
  if (!input.productAnalysis) {
    const fallback = inferDynamicMarketResearch({
      category: "未知产品",
      productNameGuess: "未知产品",
      appearance: [],
      visibleFeatures: [],
      materials: [],
      colors: [],
      styleKeywords: [],
      risks: ["缺少产品识别结果"]
    }, input.manualProductInfo);
    return enrichMarketResearchAssets({
      ...fallback,
      evidence: createMarketEvidence(fallback, "llm_inference", "C", {
        sourceNote: "缺少产品识别结果，仅保留最低置信度推断"
      })
    }, input.manualProductInfo);
  }

  const hasProviderConfig = Boolean(input.providerConfig?.apiKey && input.providerConfig?.model);
  const canUseAI = hasProviderConfig || Boolean(process.env.OPENAI_API_KEY);
  const searchBundle = await collectProductSearchEvidence({
    productAnalysis: input.productAnalysis,
    manualProductInfo: input.manualProductInfo,
    searchConfig: input.searchConfig ?? null,
    providerConfig: input.providerConfig ?? null
  });
  const enableProviderWebSearch = providerSupportsBuiltInSearch(input.providerConfig);
  const searchEvidenceText = formatSearchEvidenceForPrompt(searchBundle);

  if (shouldUseMockData() && !canUseAI) {
    const fallback = inferDynamicMarketResearch(input.productAnalysis, input.manualProductInfo, searchBundle);
    return enrichMarketResearchAssets({
      ...fallback,
      evidence: createMarketEvidence(fallback, "mock", "C", {
        sourceNote: fallback.sourceNote
      })
    }, input.manualProductInfo);
  }

  const params: ChatCompletionParams = {
    model: process.env.OPENAI_RESEARCH_MODEL ?? "gpt-4.1-mini",
    messages: [
      {
        role: "user",
        content: [
          "你是电商市场分析、视觉策划和消费行为分析专家。请根据产品识别结果、视觉风格体系、用户补充信息和市场资料摘要，输出可直接驱动策划的市场洞察。",
          "",
          "【分析维度】",
          "",
          "一、产品信息补齐",
          "在不调用真实搜索的前提下，基于产品识别、用户补充资料和电商研究框架推导品类卖点、用户痛点、标题风格和视觉方向。不要假装联网，不要编造平台排名、销量、价格、品牌或评价原文。",
          "",
          "二、卖点体系构建（按四类分类）",
          "- 文案卖点：从竞品标题、详情页、品牌官方描述提取高频关键词，按说服力排序。",
          "- 认证卖点：该品类常见认证、行业标配认证、差异化加分认证；未确认不得写成已拥有。",
          "- 特征卖点：颜色、材质、工艺、结构带来的差异化价值。",
          "- 数据卖点：用户最关注的数据指标、可量化表达方式、竞品可见数据对比；无依据不写死数字。",
          "",
          "三、用户评价挖掘",
          "提取好评TOP5、差评TOP5、疑问TOP5；搜索小红书/抖音测评和种草内容中的真实使用场景、种草触发点和拔草顾虑点。没有真实评价时，只输出品类常见评价方向，并在 sourceNote 说明未使用真实评价原文。",
          "",
          "四、目标用户画像",
          "至少2类人群，每类必须包含：人群标签、具体使用场景、核心需求、购买触发、价格敏感度、决策速度。",
          "",
          "五、产品功能与问题解决",
          "按重要性列出核心功能，并建立 功能→场景→情绪 的映射链，例如「4档风速 → 闷热办公室可调到舒适风 → 不再吹着冷、关了热」。",
          "",
          "六、结合视觉风格体系进行设计风格判断",
          "先读取第一轮产品识图的 visualStyleSystem 作为初步线索，再结合市场验证，给第三轮视觉风格体系提供依据。",
          "",
          "【输出字段】",
          "- hotSellingPoints：热门卖点5-6个，按用户关注度排序，每条写清卖点+用户利益。",
          "- userPainPoints：用户痛点+购买顾虑+AI购物常见疑问，按决策影响度排序。",
          "- userFeedbackPros：用户好评提炼，场景价值和正向体验关键词。",
          "- userFeedbackCons：用户差评和犹豫点，需要页面回应的问题。",
          "- copywritingSellingPoints：文案卖点5-6条，来自标题/详情/品牌叙事关键词，按说服力排序。",
          "- certificationSellingPoints：认证卖点3-5条，区分行业标配、差异化加分项和待确认项。",
          "- featureSellingPoints：特征卖点5-6条，颜色/材质/工艺/结构分别说明。",
          "- dataSellingPointInsights：数据卖点5-6条，说明可视化方式；无依据不写死数字。",
          "- userQuestions：用户疑问TOP5，详情页必须回答。",
          "- aiShoppingInsights：AI购物助手推荐逻辑3-5条，便于千问/豆包/京东AI助手抓取。",
          "- targetUserProfiles：至少2类目标用户画像，每条包含人群标签、使用场景、核心需求、购买触发、价格敏感度、决策速度。",
          "- functionProblemMapping：功能→场景→情绪映射5-6条。",
          "- targetAudienceInsights：目标受众推断5-6条，写具体人群、场景、购买动机。",
          "- productParameterInsights：产品参数提取5-6条，说明哪些参数可用、哪些不写死数字、适合如何可视化。",
          "- productDetailInsights：产品细节识别5-8条，写清可被画面表达的结构/材质/颜色/部件。",
          "- designStyleJudgement：结合视觉风格体系的设计风格判断5-6条。",
          "- competitorTitleStyles：竞品高转化标题风格5条，含关键词布局。",
          "- visualStyles：视觉风格方向5条，具体到画面类型（如「微距材质特写+数据标签」「使用前后冷暖对比图」）。",
          "- competitorVisualBenchmarks：竞品视觉标杆3-5条，描述竞品详情页的视觉特征和可借鉴点。",
          "- designStrategyNotes：设计策略笔记3-5条，明确差异化方向和执行建议。",
          "- sourceNote：说明真实搜索未启用；市场洞察基于产品识别、用户资料和 AI 推断。",
          "",
          "【铁律】",
          "必须围绕该产品本身，不沿用其他品类信息。用户补充信息和视觉风格体系是高优先级输入。不编造具体排名/销量/价格。卖点不要重复，不要啰嗦。必须只输出JSON。",
          `产品识别结果：${JSON.stringify(input.productAnalysis)}`,
          `用户补充信息：${JSON.stringify(input.manualProductInfo ?? {})}`,
          `模型自带联网搜索工具：未启用`,
          `真实搜索状态：${searchBundle.sourceNote}`,
          `市场资料摘要：\n${searchEvidenceText}`
        ].join("\n")
      }
    ],
    jsonSchema: marketResearchJsonSchema,
    maxTokens: 2200,
    enableWebSearch: enableProviderWebSearch
  };

  try {
    const text = await createAIChatCompletion(input.providerConfig ?? null, params);
    const research = parseMarketResearchJson(text);

    const normalizedResearch: MarketResearch = {
      ...research,
      hotSellingPoints: uniqueItems(research.hotSellingPoints, 6),
      userPainPoints: uniqueItems(research.userPainPoints, 6),
      userFeedbackPros: uniqueItems(research.userFeedbackPros ?? [], 6),
      userFeedbackCons: uniqueItems(research.userFeedbackCons ?? [], 6),
      copywritingSellingPoints: uniqueItems(research.copywritingSellingPoints ?? [], 6),
      certificationSellingPoints: uniqueItems(research.certificationSellingPoints ?? [], 5),
      featureSellingPoints: uniqueItems(research.featureSellingPoints ?? [], 6),
      dataSellingPointInsights: uniqueItems(research.dataSellingPointInsights ?? [], 6),
      userQuestions: uniqueItems(research.userQuestions ?? [], 5),
      aiShoppingInsights: uniqueItems(research.aiShoppingInsights ?? [], 5),
      targetUserProfiles: uniqueItems(research.targetUserProfiles ?? [], 4),
      functionProblemMapping: uniqueItems(research.functionProblemMapping ?? [], 6),
      targetAudienceInsights: uniqueItems(research.targetAudienceInsights ?? [], 6),
      productParameterInsights: uniqueItems(research.productParameterInsights ?? [], 6),
      productDetailInsights: uniqueItems(research.productDetailInsights ?? [], 8),
      designStyleJudgement: uniqueItems(research.designStyleJudgement ?? [], 6),
      competitorTitleStyles: uniqueItems(research.competitorTitleStyles, 5),
      visualStyles: uniqueItems(research.visualStyles, 5),
      competitorVisualBenchmarks: uniqueItems((research as Record<string, unknown>).competitorVisualBenchmarks as string[] ?? [], 5),
      designStrategyNotes: uniqueItems((research as Record<string, unknown>).designStrategyNotes as string[] ?? [], 5),
      sourceNote: searchBundle.usedSearch
        ? `${searchBundle.sourceNote} 搜索词：${searchBundle.queries.join("；")}`
        : enableProviderWebSearch
          ? `${research.sourceNote || "已启用模型自带联网搜索工具，但未提取到可核验来源链接；本轮市场洞察按 AI 推断处理。"} ${searchBundle.sourceNote}`
          : research.sourceNote || searchBundle.sourceNote
    };

    return enrichMarketResearchAssets({
      ...normalizedResearch,
      evidence: createMarketEvidence(
        normalizedResearch,
        searchBundle.usedSearch ? "web_search" : "llm_inference",
        searchBundle.usedSearch ? "A" : "C",
        {
          sourceLink: searchBundle.results[0]?.link,
          sourceNote: normalizedResearch.sourceNote
        }
      )
    }, input.manualProductInfo);
  } catch (error) {
    console.warn("AI market research failed, using dynamic fallback.", error);
    return enrichMarketResearchAssets(
      inferDynamicMarketResearch(input.productAnalysis, input.manualProductInfo, searchBundle),
      input.manualProductInfo
    );
  }
}
