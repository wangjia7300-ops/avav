import type {
  DetailPagePlan,
  GeneratedPrompt,
  MainImagePlan,
  MarketResearch,
  PlanVisualGuidelines,
  PromptTextLayer,
  ProductAnalysis
} from "@/lib/types";
import {
  backgroundNegativePrompt,
  sanitizeBackgroundPrompt,
  sanitizeGeneratedPromptCompliance,
  sanitizeTextLayer
} from "@/lib/services/compliance";
import {
  rewriteCopyWithFab,
  scoreCopywritingByFab
} from "@/lib/services/fab-copywriting";
import {
  buildProductVisualAnchor,
  formatCompactProductVisualAnchor,
  hasWeakVisualAnchor
} from "@/lib/services/product-visual-anchor";

const negativePrompt =
  `产品变形，比例异常，结构改变，材质失真，文字乱码，错别字，文字模糊，水印，logo错位，背景杂乱，光影不统一，产品遮挡文字，${backgroundNegativePrompt}`;

const unifiedTypographyRule =
  "字体统一使用思源黑体 / 阿里巴巴普惠体 / HarmonyOS Sans，不混乱换字体。文案层级规范：主标题 64–76px Heavy/Bold（主图 1:1 方图为 54–68px），副标题 32–40px Medium（主图为 26–34px），标签文字 24–30px Medium，参数小字 20–24px Regular。数字重点只用于真实参数、价格、规格或评论数据；英文辅助文字只用于真实品牌英文或用户提供短句。标题与正文字号差≥8pt，价格/数字重点与普通说明至少差2级。标题、副标题、正文和标签按黄金比例调整字号、字重、行距、间距和留白层级，信息层级清晰不堆满。";

const unifiedLayoutRule =
  "每张图都生成完整电商画面：标题区、正文区、图标区、信息卡片、标签和必要CTA都作为画面设计的一部分出现，中文文字清晰端正、无错别字、无伪文字。标题区固定在画面顶部 12%–18% 区域，主标题、副标题、正文说明统一左对齐，不使用居中或右对齐；正文区在标题下方，图标和重点信息位置用真实可读信息卡表达。产品占主要画面空间，背景不要比产品强势，不要把产品和背景融为一体看不清轮廓。视觉动线采用 F 型布局：顶部横向扫视，左侧纵向浏览，核心卖点落在高关注热区。构图体现高级留白和黄金分割，视觉中心为产品或本屏卖点可视化主体，层次清晰。文字不能遮挡产品主体。模块间至少24px留白，信息层次清晰，不要堆满。部分功能、材料、成分分子或内部结构屏可以不展示完整产品，但必须用分子、材料、C4D结构、爆炸式拆分或微观质感让卖点更好理解。整套页面保持有秩序的固定排版。";

const unifiedVisualCreativeRule =
  "视觉大胆新颖，场景高清，整体设计有美感、高级、统一视觉风格，不割裂。突出产品核心卖点，卖点必须可视化表达，产品展示角度多元化。创意用道具、光影、局部放大、对比、数据图、材料/成分/结构特效体现卖点，不喧宾夺主。排版统一，字体、字重、位置固定，文案不遮挡产品，适配移动端。";

const trustAndCtaPromptRule =
  "信任模块必须用证据链表达：盾牌/印章保障图标使用深蓝色图标+深灰色文字；评价区包含头像+星级+短评，条目间1px浅灰分割线；销量/价格/资质/证书仅在方案或用户信息提供时展示，不编造。若有价格信息，原价灰色小字、现价橙红大字；若有CTA，做全宽按钮，主色系最饱和色+白色文字，上下留白为左右留白1.5倍。";

const internalNoisePatterns = [
  /AI\s*返回格式异常[，,。；;]*/g,
  /AI\s*返回字段不完整[，,。；;]*/g,
  /模型返回不是标准\s*JSON[，,。；;]*/g,
  /已使用兜底结构继续流程[，,。；;]*/g,
  /[［\[\(（【]?\s*待\s*确认\s*[］\]\)）】]?/g,
  /使用\s*占位/g,
  /用\s*占位/g,
  /占位/g,
  /需人工复核/g,
  /需要人工复核/g,
  /待人工复核/g,
  /需人工确认/g,
  /需要人工确认/g,
  /待人工补充/g,
  /需结合实物确认/g,
  /需结合图片复核/g,
  /无法仅凭图片确认/g,
  /不能仅凭图片确认/g,
  /目标用户待确认/g,
  /待识别产品/g,
  /后期文字层/g,
  /本屏只呈现/g,
  /围绕[^，。；;]{1,24}(?:做|展开|表达)/g,
  /有依据再放大/g,
  /结果一眼看懂/g
];

const internalNoiseMatcher =
  /AI\s*返回|格式异常|模型返回|兜底结构|人工复核|待人工|需人工|需要人工|待确认|无法仅凭图片确认|不能仅凭图片确认|需结合实物确认|需结合图片复核|目标用户待确认|待识别产品|占位|后期文字层|本屏只呈现|有依据再放大|结果一眼看懂/;

const forbiddenPromptReplacements: Array<[RegExp, string]> = [
  [/替代空调/g, "辅助降温"],
  [/空调替代/g, "辅助降温"],
  [/国家级/g, "专业感"],
  [/世界级/g, "高级感"],
  [/行业第一|全网第一|排名第一|第一/g, "优先选择"],
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

const uncertaintyClauseMatcher =
  /待确认|占位|仅凭图片|图片.*(?:无法|不能|看不清|看不到)|(?:无法|不能|不可|不清楚|不确定|看不清|看不到|未能|未识别|缺少).*(?:确认|复核|补充|识别|看到|看清|判断)|(?:需|需要).*(?:人工|商家|资料|实物).*(?:确认|复核|补充)|(?:可能|疑似)(?:为|是|属于|来自|需要|无法|不能|存在)/;

const promptPlatformPrefixPatterns = [
  /^\s*(?:GPT\s*图像提示词|GPT\s*提示词|GPT\s*图像|ChatGPT\s*图像提示词)\s*[:：，,]\s*/i
];

function stripPromptPlatformPrefix(text: string) {
  let current = text;
  let next = text;

  do {
    current = next;
    next = promptPlatformPrefixPatterns
      .reduce((value, pattern) => value.replace(pattern, ""), current)
      .trimStart();
  } while (next !== current);

  return next;
}

function stripUncertaintyClauses(text: string) {
  const parts = text.split(/([，,、；;。])/);
  let cleaned = "";

  for (let index = 0; index < parts.length; index += 2) {
    const clause = parts[index] ?? "";
    const delimiter = parts[index + 1] ?? "";

    if (!clause.trim()) {
      continue;
    }

    if (uncertaintyClauseMatcher.test(clause)) {
      continue;
    }

    cleaned += clause + delimiter;
  }

  return cleaned;
}

export function sanitizePromptText(text: string) {
  const withoutUnknownParameterPlaceholders = text
    .replace(
      /(?:容量|功率|分贝|风速|风量|尺寸|重量|续航|噪音|噪声|参数|规格|品牌|型号|数据卖点|关键参数|目标用户|材质|认证|销量|价格)\s*[：:]?\s*[［\[\(（【]?\s*待\s*确认\s*[］\]\)）】]?/g,
      ""
    )
    .replace(/(?:关键参数|未知参数|不确定参数)?\s*(?:使用|用)\s*[［\[\(（【]?\s*待\s*确认\s*[］\]\)）】]?\s*占位/g, "");

  const withoutForbiddenWords = forbiddenPromptReplacements
    .reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), withoutUnknownParameterPlaceholders)
    .replace(/最/g, "更")
    .replace(/收口转化收口/g, "转化收口")
    .replace(/更终/g, "收口");

  return stripPromptPlatformPrefix(
    stripUncertaintyClauses(
      internalNoisePatterns.reduce(
        (value, pattern) => value.replace(pattern, ""),
        withoutForbiddenWords
      )
    )
  )
    .replace(/标题(?:文字|排版|区)?(?:统一)?(?:使用)?(?:左对齐或)?居中(?:对齐)?/g, "标题顶部左对齐")
    .replace(/标题在顶部12%-18%，?左对齐或居中/g, "标题在顶部12%-18%，统一左对齐")
    .replace(/只允许左对齐或居中对齐/g, "只允许左对齐")
    .replace(/只使用左对齐或居中对齐/g, "只使用左对齐")
    .replace(/整套对齐方式只选左对齐或居中一种/g, "整套对齐方式固定为顶部左对齐")
    .replace(/[；;]\s*[；;]+/g, "；")
    .replace(/[、，,]\s*[、，,]+/g, "、")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；、,.])/g, "$1")
    .replace(/^[，,、；;\s]+|[，,、；;\s]+$/g, "")
    .trim();
}

function cleanScalar(value: string | undefined, fallback: string) {
  const cleaned = sanitizePromptText(value ?? "");

  if (!cleaned || internalNoiseMatcher.test(value ?? "")) {
    return fallback;
  }

  return cleaned;
}

function cleanItems(items: Array<string | undefined>, fallback: string[]) {
  const cleanedItems = items
    .map((item) => sanitizePromptText(item ?? ""))
    .filter((item, index) => item && !internalNoiseMatcher.test(items[index] ?? ""));

  return Array.from(new Set(cleanedItems)).slice(0, 8).length
    ? Array.from(new Set(cleanedItems)).slice(0, 8)
    : fallback;
}

function cleanPlanText(text: string | undefined, fallback = "") {
  return sanitizePromptText(text ?? "") || fallback;
}

function isParameterLikePromptText(text: string) {
  return /\d+\s*(?:w|W|cm|mm|mAh|v|V|kg|g|ml|L|升|分钟|小时|分贝|db|dB)/.test(text);
}

function compactPromptSnippet(text: string | undefined, max = 96) {
  const cleaned = sanitizePromptText(text ?? "")
    .replace(/^(整体调性|画面质感|布光逻辑|色彩配色体系|字体规范|构图规范|统一要求)\s*[:：]\s*/, "")
    .trim();

  if (!cleaned) {
    return "";
  }

  const firstClause = cleaned.split(/[。；;]/)[0] || cleaned;
  return Array.from(firstClause).slice(0, max).join("");
}

const planningStageTitleMatcher =
  /^(?:首屏产品定位|用户痛点开场|用户反馈问题回应|核心卖点拆解|用户好评卖点放大|第二卖点强化|外观与材质细节|适用场景展示|使用便利性说明|竞品差异表达|参数信息透明|数据卖点可视化|目标人群共情|最终转化收口|收心转化收口|场景价值首屏|痛点解决对比图|核心卖点证明图|第二卖点场景证明|细节工艺信任图|多场景使用图|使用路径说明图|竞品差异对比图|参数信息可视化图|目标人群生活方式图|常见顾虑回应图|品质信任背书图|下单决策收口图|场景钩子|痛点共鸣|产品功能集合|核心卖点一|核心卖点二|核心卖点三|核心卖点四|核心卖点五|多角度展示|使用体验演示|信任证据清单|收心文案|场景点击主图|场景卖点图|多场景情境主图|痛点解决场景图|场景决策信息图|3D结构爆炸解析|核心技术路径可视化|场景性能模拟|安全耐用结构背书|3D成分分子可视化|质地与吸收路径示意|核心配方场景证明|配方安全与品质背书|3D材料微观结构|工艺层级C4D解析|材料性能场景验证|材料信任证明|3D机理可视化|微观结构解析|透明信任证明|模块名称|本屏任务|转化目标|画面目标|详情页方案|主图方案)$/;

export function isInternalPlanningTitle(text: string | undefined) {
  const cleaned = sanitizePromptText(text ?? "")
    .replace(/^第?\d+[\.、\s-]*/, "")
    .replace(/[【】]/g, "")
    .trim();

  return Boolean(cleaned && planningStageTitleMatcher.test(cleaned));
}

function compactPromptTitle(text: string | undefined, fallback: string) {
  const cleaned = cleanPlanText(text, "")
    .replace(/^(主标题|副标题|正文|标题)\s*[:：]\s*/, "")
    .replace(/[。；;].*$/, "")
    .trim();

  if (!cleaned || isInternalPlanningTitle(cleaned)) {
    return fallback;
  }

  return cleaned.length > 16 ? cleaned.slice(0, 16) : cleaned;
}

export function getPromptDeliverableTitle(
  plan: MainImagePlan | DetailPagePlan,
  fallback: string
) {
  const headline = compactPromptTitle(plan.copywriting.headline, "");

  if (headline && !isInternalPlanningTitle(headline)) {
    return headline;
  }

  const subheadline = compactPromptTitle(plan.copywriting.subheadline, "");

  if (subheadline && !isInternalPlanningTitle(subheadline)) {
    return subheadline;
  }

  const bodyLead = compactPromptTitle(plan.copywriting.body, "");

  if (bodyLead && !isInternalPlanningTitle(bodyLead)) {
    return bodyLead;
  }

  const title = compactPromptTitle(plan.title, fallback);
  return isInternalPlanningTitle(title) ? fallback : title;
}

function joinCleanItems(items: Array<string | undefined>, fallback: string) {
  return cleanItems(items, [fallback]).join("、");
}

function getPromptContext(product: ProductAnalysis, market: MarketResearch) {
  const category = cleanScalar(product.category, cleanScalar(product.productNameGuess, "产品"));
  const productName = cleanScalar(product.productNameGuess, category);
  const brandName = cleanItems(
    [product.brandNames?.chinese, product.brandNames?.english],
    []
  ).join(" / ");
  const sellingPoints = cleanItems(
    [...(product.sellingPoints ?? []), ...market.hotSellingPoints, ...product.visibleFeatures],
    ["核心卖点"]
  );
  const appearance = cleanItems(
    [...product.appearance, ...(product.productDetails ?? [])],
    [`保持上传参考图中的${category}外观、造型和比例`]
  );
  const visibleFeatures = cleanItems([...product.visibleFeatures, ...sellingPoints], sellingPoints);
  const materials = cleanItems(product.materials, ["参考产品图片呈现真实材质质感"]);
  const colors = cleanItems(product.colors, ["参考产品图片呈现真实配色"]);
  const targetAudience = cleanItems(product.targetAudience ?? [], ["目标人群使用场景"]);
  const feedbackPros = cleanItems(market.userFeedbackPros ?? [], []);
  const feedbackCons = cleanItems(market.userFeedbackCons ?? [], []);
  const visualStyles = cleanItems(market.visualStyles, product.styleKeywords.length ? product.styleKeywords : ["电商转化视觉"]);

  return {
    category,
    productName,
    brandName,
    sellingPoints,
    appearance,
    visibleFeatures,
    materials,
    colors,
    targetAudience,
    feedbackPros,
    feedbackCons,
    visualStyles
  };
}

function buildFallbackVisualGuidelines(
  product: ProductAnalysis,
  market: MarketResearch,
  aspectRatio: "1:1 方图" | "2:3 竖版"
): PlanVisualGuidelines {
  const context = getPromptContext(product, market);
  const styleSystem = product.visualStyleSystem;

  return {
    overallTone: joinCleanItems(
      [...(styleSystem?.overallTone ?? []), ...market.visualStyles, ...product.styleKeywords],
      "高级、真实、场景共情、电商转化型视觉"
    ),
    imageTexture: joinCleanItems(
      [...(styleSystem?.imageTexture ?? []), "高清商业摄影", "真实产品质感", "细节清晰"],
      "高清商业摄影、真实产品质感、细节清晰"
    ),
    lightingLogic: joinCleanItems(
      [...(styleSystem?.lightingLogic ?? []), "柔和主光", "侧前方补光", "产品轮廓光", "卖点区域轻高光"],
      "柔和主光、侧前方补光、产品轮廓光、卖点区域轻高光"
    ),
    colorPaletteSystem: joinCleanItems(
      [...(styleSystem?.colorSystem ?? []), ...context.colors, "主色不超过3种", "辅助色服务信息层级"],
      "参考产品真实配色，主色不超过3种，辅助色服务信息层级"
    ),
    typographyRules: unifiedTypographyRule,
    compositionRules: joinCleanItems(
      [
        ...(styleSystem?.compositionRules ?? []),
        aspectRatio,
        "顶部标题区",
        "标题顶部左对齐",
        "高级留白",
        "黄金分割",
        "产品主体优先",
        "产品卖点可视化",
        "文案不遮挡产品",
        "移动端安全边距",
        "功能材料结构屏可不展示完整产品"
      ],
      `${aspectRatio}，顶部标题区，标题顶部左对齐，高级留白，黄金分割，产品主体优先，产品卖点可视化，文案不遮挡产品，移动端安全边距`
    ),
    productAppearanceFeatures: joinCleanItems(
      [...context.appearance, ...context.materials, ...context.colors],
      `保持上传参考图中的${context.category}外观、结构比例、材质质感和关键细节位置`
    ),
    unifiedVisualStyle: `每张图直接生成完整电商视觉成图，包含清晰中文标题、副标题、正文、标签、线性图标UI和信息卡片；整套画面保持统一视觉语言不割裂；线性图标 UI 风格统一；文字不遮挡产品；画面留白充足，信息层次清晰不堆满。${unifiedVisualCreativeRule}`
  };
}

function visualGuidelinesToPromptText(guidelines: PlanVisualGuidelines) {
  return [
    `整体调性：${compactPromptSnippet(guidelines.overallTone, 56)}`,
    `画面质感：${compactPromptSnippet(guidelines.imageTexture, 48)}`,
    `布光逻辑：${compactPromptSnippet(guidelines.lightingLogic, 48)}`,
    `色彩体系：${compactPromptSnippet(guidelines.colorPaletteSystem, 48)}`,
    "字体规范：思源黑体/阿里巴巴普惠体/HarmonyOS Sans，标题粗、副标题中等、正文克制，字号按黄金比例分层",
    "构图规范：标题在顶部12%-18%，主标题、副标题、正文说明统一左对齐，产品/卖点主体居中，留白充足，文字不遮挡产品"
  ]
    .map(sanitizePromptText)
    .filter(Boolean)
    .join("；");
}

function pickPlanSellingPoint(
  plan: MainImagePlan | DetailPagePlan,
  context: ReturnType<typeof getPromptContext>,
  visualElements: string[]
) {
  const usefulVisualElement = visualElements.find(
    (item) =>
      item.length <= 18 &&
      !/(产品|主体|标题|副标题|正文|标签|卡片|图标|光影|高光|留白|排版|场景|商业|摄影|字体|参数|信息|模块|画面|结构|视觉|统一|黄金|F型|用户补充|整体调性|布光|色彩|PANTONE)/.test(item)
  );
  const fromCopy =
    plan.copywriting.subheadline ||
    plan.copywriting.body ||
    plan.copywriting.headline ||
    "";
  const fallback = context.sellingPoints[(Math.max(plan.index, 1) - 1) % context.sellingPoints.length] ?? "核心卖点";

  return cleanPlanText(usefulVisualElement || fromCopy, fallback);
}

function productAppearanceLock(product: ProductAnalysis, context: ReturnType<typeof getPromptContext>) {
  const anchor = product.visualAnchor ?? buildProductVisualAnchor(product);
  const brandPrefix =
    context.brandName && !context.productName.includes(context.brandName)
      ? `${context.brandName} `
      : "";
  const anchorText = formatCompactProductVisualAnchor(anchor);
  const weakAnchorNote = hasWeakVisualAnchor(anchor)
    ? "外观锚点较少，采用正面或45度清晰角度，避免夸张变形；"
    : "";

  return sanitizePromptText(
    `${weakAnchorNote}${anchorText || `产品外观锁定：${brandPrefix}${context.productName}，保持${context.appearance.slice(0, 3).map((item) => compactPromptSnippet(item, 18)).join("、")}，配色${context.colors.slice(0, 2).map((item) => compactPromptSnippet(item, 12)).join("、")}，材质${context.materials.slice(0, 2).map((item) => compactPromptSnippet(item, 14)).join("、")}，结构比例和关键细节不变`}`
  );
}

function getScreenCopy(plan: MainImagePlan | DetailPagePlan, fallbackTitle: string) {
  const imageType: "main_image" | "detail_page" = "scene" in plan ? "main_image" : "detail_page";
  const scoredCopy = scoreCopywritingByFab(plan.copywriting, plan.assignedSellingPoint?.fab);
  const sourceCopy = plan.assignedSellingPoint && scoredCopy.total < 75
    ? rewriteCopyWithFab({
        asset: plan.assignedSellingPoint,
        fallbackFeature: plan.assignedSellingPoint.name,
        fallbackScene: "scene" in plan ? plan.scene : undefined,
        fallbackCopy: plan.copywriting,
        imageType,
        slotIndex: plan.index - 1
      })
    : plan.copywriting;
  const title = getPromptDeliverableTitle(plan, fallbackTitle);
  const headline = compactPromptTitle(sourceCopy.headline, title);
  const subheadline = cleanPlanText(sourceCopy.subheadline, "");
  const body = cleanPlanText(sourceCopy.body, "");
  const lines = [headline, subheadline, body]
    .map((item) => sanitizePromptText(item))
    .filter((item) => item && !isInternalPlanningTitle(item));
  const uniqueLines = Array.from(new Set(lines));
  const primaryLine = uniqueLines[0] || title;
  const secondaryLine = uniqueLines.find((item) => item !== primaryLine) || "";
  const bodyLine =
    uniqueLines
      .filter((item) => item !== primaryLine && item !== secondaryLine)
      .find((item) => !isNearDuplicateCopy(item, primaryLine) && !isNearDuplicateCopy(item, secondaryLine)) || "";

  return {
    title,
    headline: primaryLine,
    subheadline: secondaryLine,
    body: bodyLine
  };
}

function normalizeCopyForCompare(text: string) {
  return sanitizePromptText(text)
    .replace(/[，,。；;、/\s]+/g, "")
    .toLowerCase();
}

function isNearDuplicateCopy(current: string, existing: string) {
  const currentValue = normalizeCopyForCompare(current);
  const existingValue = normalizeCopyForCompare(existing);

  if (!currentValue || !existingValue) {
    return false;
  }

  return currentValue.includes(existingValue) || existingValue.includes(currentValue);
}

function buildOnImageCopyText(copy: ReturnType<typeof getScreenCopy>) {
  const parts = [`主标题「${copy.headline}」`];

  if (copy.subheadline) {
    parts.push(`副标题「${copy.subheadline}」`);
  }

  if (copy.body) {
    parts.push(`正文「${copy.body}」`);
  }

  return parts.join("，");
}

function buildReadableCopyDesignInstruction(copy: ReturnType<typeof getScreenCopy>, imageType: "main_image" | "detail_page") {
  const copyText = buildOnImageCopyText(copy);
  const sizeRule = imageType === "main_image"
    ? "主标题54-68px Heavy，副标题26-34px Bold，标签24-28px Medium"
    : "主标题54-76px Heavy，副标题28-40px Bold，正文20-28px Regular，重点数字可用DIN/无衬线粗体";

  return [
    `直接生成清晰中文电商文字：${copyText}。`,
    `${sizeRule}，统一使用阿里巴巴普惠体/思源黑体/HarmonyOS Sans风格。`,
    "文字层级清楚，与产品保持安全距离，不遮挡主体和关键结构。"
  ].join("");
}

function buildTextLayer(
  copy: ReturnType<typeof getScreenCopy>,
  visualElements: string[],
  layoutHint: string,
  imageType: "main_image" | "detail_page"
): PromptTextLayer {
  return sanitizeTextLayer({
    headline: copy.headline,
    subheadline: copy.subheadline,
    body: copy.body,
    labels: visualElements
      .filter((item) => item.length <= 12 && !/(场景|产品主体|光影|留白|摄影|结构|画面|视觉|图|卡片|标题|文案|文字|容器|排版|布局)/.test(item))
      .slice(0, imageType === "main_image" ? 3 : 5),
    cta: imageType === "detail_page" ? "了解更多" : undefined,
    layoutHint
  });
}

function buildPromptsForMainImage(
  plan: MainImagePlan,
  product: ProductAnalysis,
  market: MarketResearch
): GeneratedPrompt {
  const context = getPromptContext(product, market);
  const appearanceLock = productAppearanceLock(product, context);
  const scene = cleanPlanText(plan.scene, "符合目标人群的真实使用场景");
  const layout = cleanPlanText(plan.layout, "产品主体 + 卖点标签 + 信息分区");
  const imageBrief = cleanPlanText(plan.imageBrief, scene);
  const textImageLayout = cleanPlanText(plan.textImageLayout, layout);
  const visualFocus = cleanPlanText(plan.visualFocus, "产品为核心，层次清晰，留白充足");
  const copy = getScreenCopy(plan, `主图${plan.index}`);
  const allowParameterElements = /买前|参数|重点/.test(plan.title + plan.copywriting.headline);
  const visualElements = cleanItems(plan.visualElements, ["产品主体", "卖点标签", "商业摄影光影"])
    .filter((item) => allowParameterElements || !isParameterLikePromptText(item));
  const screenSellingPoint = pickPlanSellingPoint(plan, context, visualElements);
  const readableCopyInstruction = buildReadableCopyDesignInstruction(copy, "main_image");
  const guidelinesBrief = visualGuidelinesToPromptText(
    plan.visualGuidelines ?? buildFallbackVisualGuidelines(product, market, "1:1 方图")
  );
  const photographyBrief = [
    imageBrief,
    "主图必须以真实使用场景、痛点情境、生活方式空间或使用结果为主体，不要纯白底、纯棚拍或孤立产品摆拍",
    `${scene}，真实自然的生活环境，像商业相机实拍而非CG渲染，光影与产品统一不割裂`,
    "产品采用三分之二正侧角度或正面主视觉，占据画面45%–65%空间，融入真实场景但仍是画面核心，保持参考图的结构比例和材质细节，轮廓清晰不与背景融合",
    "使用5500K自然白光，45度侧前方主光（柔光箱效果），辅光填充阴影，边缘轮廓光分离产品与背景，光源方向与场景环境光一致",
    "按品类需要加入真实生活化道具或手部动作，人物不抢产品主体地位；创意用道具、光影、局部放大、对比或数据图体现卖点，不喧宾夺主",
    `画面加入${visualElements.join("、")}，使用线性图标、对比箭头、放大窗、信息卡片、卖点标签等专业电商元素；${readableCopyInstruction}`
  ].join("；");
  const layoutAttention =
    `采用${textImageLayout}的版面骨架，${visualFocus}。顶部12%-18%区域放置主标题和副标题，标题统一左对齐，左侧或底部放置卖点标签、图标或辅助信息；产品不得被文字遮挡；一张图只呈现一个核心点击理由；采用F型视觉动线和黄金分割；模块间至少24px留白；产品占比最高，主图适合移动端缩略图识别；不仿冒真实品牌广告，不生成证书、公章、检测报告、排名榜单或虚假数据。`;
  const deliverableTitle = copy.title;
  const textLayer = buildTextLayer(copy, visualElements, layoutAttention, "main_image");
  const backgroundPrompt = sanitizeBackgroundPrompt(
    `${appearanceLock}。生成一张1:1方形电商主图。` +
    `画面聚焦一个点击理由：${screenSellingPoint}；用真实场景先让用户代入，再展示产品带来的改善结果，不堆参数、不重复卖点。` +
    `画面设计：${photographyBrief}。` +
    `排版要求：${layout}，产品在真实场景中居中偏大或视觉重心明确，卖点信息卡片围绕使用结果，文字不遮挡产品和关键场景，移动端安全边距。${layoutAttention}` +
    `统一视觉：${guidelinesBrief}。`,
    textLayer
  );

  return sanitizeGeneratedPromptCompliance({
    imageType: "main_image",
    index: plan.index,
    title: deliverableTitle,
    backgroundPrompt,
    textLayer,
    negativePrompt
  });
}

function buildPromptsForDetailPage(
  plan: DetailPagePlan,
  product: ProductAnalysis,
  market: MarketResearch,
  totalDetailPages: number
): GeneratedPrompt {
  const context = getPromptContext(product, market);
  const appearanceLock = productAppearanceLock(product, context);
  const layout = cleanPlanText(plan.layout, "2:3竖版移动端电商详情页，模块化信息分区");
  const imageBrief = cleanPlanText(plan.imageBrief, "符合目标人群的真实使用环境");
  const textImageLayout = cleanPlanText(plan.textImageLayout, layout);
  const visualFocus = cleanPlanText(plan.visualFocus, "产品和场景是主视觉，文字辅助说明");
  const copy = getScreenCopy(plan, `详情页${plan.index}`);
  const allowParameterElements = /买前|参数|重点/.test(plan.title + plan.copywriting.headline + plan.goal);
  const visualElements = cleanItems(plan.visualElements, ["产品主体", "卖点信息卡片", "场景化视觉"])
    .filter((item) => allowParameterElements || !isParameterLikePromptText(item));
  const screenSellingPoint = pickPlanSellingPoint(plan, context, visualElements);
  const readableCopyInstruction = buildReadableCopyDesignInstruction(copy, "detail_page");
  const guidelinesBrief = visualGuidelinesToPromptText(
    plan.visualGuidelines ?? buildFallbackVisualGuidelines(product, market, "2:3 竖版")
  );
  const prevNext =
    plan.index === 1
      ? "开场画面延续主图的色彩、光线和产品比例，下一屏可以自然展开使用场景或卖点细节"
      : plan.index === totalDetailPages
        ? "收尾画面延续前面统一的色彩、字体和产品呈现方式，用简洁信息完成购买前确认"
        : `画面与第${plan.index - 1}屏、第${plan.index + 1}屏保持同一字体、配色、光影和信息密度，视觉节奏自然连续`;
  const isSpecialEffectScreen = /3d|c4d|分子|微观|材料|爆炸|结构|机理|质地|吸收|剖面|粒子|能量|技术路径|工艺/i.test(
    [plan.title, plan.goal, plan.layout, plan.imageBrief, plan.textImageLayout, ...plan.visualElements].join(" ")
  );
  const isContrastScreen = /对比|痛点|以前|现在|解决/.test(
    [plan.title, plan.goal, plan.layout, plan.imageBrief, plan.copywriting.body].join(" ")
  );
  const isRationalInfoScreen = /参数|规格|顾虑|多角度|尺寸|结构|使用方式|买前/.test(
    [plan.title, plan.goal, plan.layout, plan.imageBrief].join(" ")
  );
  const rhythmInstruction =
    plan.index >= 4 && plan.index <= 8
      ? [
          "第4-8屏景别节奏：",
          plan.index === 4 ? "本屏使用远景场景，产品融入真实空间，先建立使用环境。" : "",
          plan.index === 5 ? "本屏使用局部特写，用微距、圈点和高光标注关键部件或材质。" : "",
          plan.index === 6 ? "本屏使用功能意象，用气流、路径、分子、结构或数据图表达看不见的效果。" : "",
          plan.index === 7 ? "本屏使用斜侧产品视角，突出体积、轮廓、结构和空间关系。" : "",
          plan.index === 8 ? "本屏使用人机交互中景，用手部、人物背影或真实动作证明使用体验。" : ""
        ].filter(Boolean).join("")
      : "";
  const detailPhotographyBrief = [
    imageBrief,
    isContrastScreen
      ? "对比屏采用左右双区、上下双区、斜切对比或两张底图合成布局；负面场景与正面结果必须分区呈现，负面区低饱和、正面区更清爽明亮，中间用产品作为解决方案连接点，避免矛盾元素混在同一空间"
      : "",
    rhythmInstruction,
    isRationalInfoScreen
      ? "理性信息屏允许使用干净单色、渐变或低噪背景，重点保证文字排版区域、图标容器、信息卡片和顾虑回应的可读性，不强行复杂场景"
      : "",
    "使用符合目标人群的真实生活场景，像商业相机实拍非CG，氛围与整套详情页统一不割裂",
    "根据画面内容选择最佳产品角度：正面展示整体轮廓，45度呈现真实场景，侧面展示结构，俯拍展示使用状态，微距展示材质工艺，拆解视角展示功能原理；保持比例和关键细节一致，产品与场景光影统一",
    isSpecialEffectScreen
      ? "本屏允许不展示完整产品，使用高级 3D/C4D/分子/材料微观可视化：半透明结构、爆炸图、剖面层级、分子球棍模型、粒子路径或能量流必须服务卖点理解，不能为了炫技堆特效，不能编造未确认参数或医疗功效"
      : "",
    "采用自然白光或柔光棚拍，色温5000K-5600K，侧前方主光+辅光降阴影+卖点区域局部高亮，光源方向与场景环境一致",
    "可加入手部操作、生活道具、场景模特，动作服务卖点说明不抢产品；创意用道具、光影、局部放大、对比、数据图、材料/成分/结构特效体现卖点，不喧宾夺主",
    `画面加入${visualElements.join("、")}，使用线性图标、信息卡片、爆炸图/局部放大/对比箭头/数据卡片形态/前后对比等专业电商元素；${readableCopyInstruction}`
  ].filter(Boolean).join("；");
  const detailAttention =
    `采用${textImageLayout}的版面骨架，${visualFocus}。2:3竖版移动端，顶部12%-18%放置标题区，主标题、副标题、正文说明统一左对齐；中部为视觉主体，下方放置说明、标签、图标或CTA信息模块；产品不得被文字遮挡；一屏只讲一个卖点；采用F型视觉动线、黄金分割和高级留白；模块间至少24px留白；卖点用场景图/对比图/图表形态/箭头圈点/高光标注表达；${isContrastScreen ? "对比信息必须清楚分区，不要混乱拼接；" : ""}${isRationalInfoScreen ? "本屏背景优先低噪、干净、留白足，保证文字信息可读；" : ""}功能、材料、成分分子或内部结构屏可以不展示完整产品，但必须让卖点更好理解；注意与前后屏视觉连续；不生成证书、公章、检测报告、排名榜单或虚构数据。`;
  const deliverableTitle = copy.title;
  const textLayer = buildTextLayer(copy, visualElements, `${detailAttention} ${prevNext}`, "detail_page");
  const backgroundPrompt = sanitizeBackgroundPrompt(
    `${appearanceLock}。生成第${plan.index}屏2:3竖版电商详情页底图。` +
    `画面聚焦一个转化信息：${screenSellingPoint}；用场景、证据形态和结果表达，不堆参数。` +
    `画面设计：${detailPhotographyBrief}。` +
    `排版要求：${layout}，前后屏视觉连续方式：${prevNext}。${detailAttention}` +
    `统一视觉：${guidelinesBrief}。`,
    textLayer
  );

  return sanitizeGeneratedPromptCompliance({
    imageType: "detail_page",
    index: plan.index,
    title: deliverableTitle,
    backgroundPrompt,
    textLayer,
    negativePrompt
  });
}

export function buildGeneratedPrompts(
  product: ProductAnalysis,
  market: MarketResearch,
  mainImages: MainImagePlan[],
  detailPages: DetailPagePlan[]
) {
  return [
    ...mainImages.map((plan) => buildPromptsForMainImage(plan, product, market)),
    ...detailPages.map((plan) => buildPromptsForDetailPage(plan, product, market, detailPages.length))
  ];
}
