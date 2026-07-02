import type {
  EvidenceLevel,
  PlanCopywriting,
  PromptTextLayer,
  SellingPointAsset
} from "@/lib/types";
import {
  buildConciseTextInstruction,
  dedupePromptSegments,
  promptAlreadyContainsTextLayer
} from "@/lib/services/prompt-compaction";

export type CopywritingValidationResult = {
  passed: boolean;
  reasons: string[];
  needsRewrite: boolean;
};

export type ParameterExpressionLevel = "fact" | "interpretation" | "benefit" | "blocked";

type RewriteContext = {
  assignedSellingPoint?: SellingPointAsset;
  audience?: string;
  scene?: string;
  fallbackPoint?: string;
  evidenceLevel?: EvidenceLevel;
  usedCopies?: string[];
};

const internalModulePattern =
  /产品功能集合|核心卖点展开|信任证据清单|解决方案|后期文字层|首屏产品定位|用户痛点开场|用户反馈问题回应|用户好评卖点放大|痛点解决对比图|核心卖点证明图|下单决策收口图|场景钩子|痛点共鸣|收心文案|详情页方案|主图方案|模块名称|本屏任务|转化目标|画面目标|产品定位|最终转化|收口转化/g;

const fieldNamePattern =
  /产品品类|品类|适合|重点|分配卖点|证据等级|证据|来源|结构模式|结构说明|完整结构|裁剪结构|轻量结构|字段|字段名|userBenefit|assignedSellingPoint|backgroundPrompt|textLayer|layoutHint/g;

const processLanguagePattern =
  /本屏只(?:呈现|讲)|围绕[^，。；;]{1,24}(?:做|展开|表达)|场景能感知|有依据再放大|结果一眼看懂|按场景表达|不写死事实|隐性完成|方案里|生成该屏|用于后期|后期叠加|留给后期|作为整体装饰|放角落/g;

const genericBenefitPattern =
  /^(?:日常使用更省心|体验更好|用着更方便|场景更清爽|适合日常|更有品质感|看起来更高级|用户更放心|少一点麻烦|日常更顺手|这点很实用|一眼看懂重点|核心方案|目标人群|家庭用户|适合你的日常|实际使用时.*变成可看见的使用结果|实际使用时.*变成可见的使用结果|点开理由很清楚|场景里一眼懂|用细节做支撑|能用上|只写已知依据|只写已知信息|来自当前资料|按当前资料表达|按当前资料下判断|差别更好判断|结果更好判断|更好判断|判断更轻松)$/;

const vagueBenefitWords =
  /更省心|更方便|更好用|更清爽|更高级|更有品质|更放心|很实用|体验更好|适合日常|核心方案|用户更放心|变成可看见的使用结果|变成可见的使用结果|点开理由很清楚|场景里一眼懂|用细节做支撑|能用上|只写已知依据|只写已知信息|来自当前资料|按当前资料|更好判断|结果更好判断|差别更好判断|判断更轻松/g;

const unsupportedMarketingPattern =
  /好评如潮|用户都说好|全线通过|权威认证|品质认证|官方认证|销量领先|排名靠前|排名第一|实力见证|品质之选|高品质|精选好物|卓越|完美结合|高效制冷|快速降温|降温佳品|解暑神器|替代空调|提升生活空间品味|温暖心境/g;

const truncatedTextPattern =
  /(?:\.\.\.|…|->\s*$|→\s*$|\/\s*$|[：:]\s*$|第\d+[\.、-]?\s*$|[A-Za-z0-9_-]{1,3}\s*$)/;

const parameterPattern =
  /\d+\s*(?:w|W|kw|KW|cm|mm|m|㎡|mAh|Ah|v|V|kg|g|mg|ml|ML|l|L|升|分钟|小时|h|H|分贝|db|dB|%|℃|度|档|rpm|转|GB|TB|Hz|mah)/;

const riskyParameterClaimPattern =
  /绝对|保证|静音|无噪|省电|制冷|降温\d|净化率|杀菌率|续航一整天|全天不断|不占空间|官方背书|认证通过|实验验证|检测证明|销量领先|排名靠前/g;

const backgroundForbiddenPattern =
  /证书文字|公章文字|检测报告文字|公章|检测报告|后期文字层|本屏只呈现|围绕[^，。；;]{1,24}做|有依据再放大|结果一眼看懂|品牌\s*Logo\s*位|品牌Logo位|Logo位|品牌字样|具体英文\s*slogan/gi;

const layoutForbiddenPattern =
  /底图(?:出现|生成).*Logo|品牌\s*Logo\s*位|Logo位|可读图标文字|后期文字层/g;

const stopWords = /产品|主体|核心|卖点|功能|参数|详情|方案|使用|场景|用户|信息|品质|体验|日常|重点|适合/g;

function baseClean(text: string | undefined) {
  return (text ?? "")
    .replace(/\[待确认\]|\[需确认\]|待确认|需人工复核|需要人工复核|待人工补充/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；、,.])/g, "$1")
    .trim();
}

function compact(text: string | undefined, max: number) {
  return Array.from(baseClean(text)).slice(0, max).join("");
}

function normalize(text: string) {
  return baseClean(text)
    .replace(/[，。；;、,.!！?？\s]+/g, "")
    .toLowerCase();
}

function extractKeyword(text: string | undefined) {
  const cleaned = baseClean(text)
    .replace(/^(?:核心卖点|热门卖点|文案卖点|特征卖点|数据卖点|卖点|参数|功能)\s*[:：]\s*/, "")
    .replace(stopWords, "")
    .replace(/[，。；;、,.].*$/, "")
    .trim();

  return compact(cleaned || text || "重点", 8);
}

function firstMeaningful(items: Array<string | undefined>, fallback: string) {
  return items.map(baseClean).find(Boolean) || fallback;
}

function sceneFromContext(context?: RewriteContext) {
  const source = firstMeaningful([
    context?.scene,
    context?.assignedSellingPoint?.scene,
    context?.assignedSellingPoint?.userPainPoint
  ], "使用场景里");

  return compact(
    source
      .replace(/日常使用顾虑/g, "")
      .replace(/目标人群|用户|人群标签/g, "")
      .replace(/^(?:食品饮品|小家电|美妆个护|通用商品)$/g, "使用场景里"),
    12
  ) || "使用场景里";
}

function evidenceRank(level?: EvidenceLevel) {
  if (level === "S") return 5;
  if (level === "A") return 4;
  if (level === "B") return 3;
  if (level === "C") return 2;
  return 0;
}

export function detectInternalTerms(text: string | undefined) {
  const value = baseClean(text);
  const reasons: string[] = [];

  if (!value) return reasons;
  if (internalModulePattern.test(value)) reasons.push("包含内部模块名");
  if (fieldNamePattern.test(value)) reasons.push("包含字段名或系统结构词");
  if (processLanguagePattern.test(value)) reasons.push("包含生成过程语言");
  if (genericBenefitPattern.test(value) || vagueBenefitWords.test(value)) reasons.push("包含占位型泛词");
  if (unsupportedMarketingPattern.test(value)) reasons.push("包含无证据强营销词");
  if (truncatedTextPattern.test(value)) reasons.push("疑似截断文本");

  internalModulePattern.lastIndex = 0;
  fieldNamePattern.lastIndex = 0;
  processLanguagePattern.lastIndex = 0;
  vagueBenefitWords.lastIndex = 0;
  unsupportedMarketingPattern.lastIndex = 0;

  return reasons;
}

export function validateUserBenefit(benefit: string | undefined) {
  const value = baseClean(benefit);
  const reasons = detectInternalTerms(value);

  if (!value) reasons.push("用户利益为空");
  if (genericBenefitPattern.test(value)) reasons.push("用户利益过于泛化");
  if (vagueBenefitWords.test(value) && value.length < 16) reasons.push("缺少具体场景或结果");
  if (!/(在|当|用|放|拿|看|选|买|前|后|时|里|少|不用|减少|避免|更容易|能|让)/.test(value)) {
    reasons.push("缺少场景或体感结果");
  }

  vagueBenefitWords.lastIndex = 0;

  return {
    passed: reasons.length === 0,
    reasons
  };
}

export function generateConcreteUserBenefit(input: {
  feature: string;
  painPoint?: string;
  scene?: string;
  audience?: string;
  evidenceLevel?: EvidenceLevel;
}) {
  const feature = baseClean(input.feature);
  const keyword = extractKeyword(feature);
  const scene = compact(
    (input.scene || input.audience || "")
      .replace(/日常使用顾虑/g, "")
      .replace(/目标人群|人群标签/g, ""),
    12
  ) || "使用场景里";

  if (!feature) return "";

  if (/便携|移动|折叠|轻量|小巧|收纳|挂|可拆|调节|安装|拆装/.test(feature)) {
    return `${scene}，少一次搬挪和重新摆放`;
  }

  if (/容量|续航|电池|水箱|持久|长效|补充|储存|大容量/.test(feature)) {
    return `${scene}，少一点频繁补充或中断`;
  }

  if (/低噪|噪音|静音|柔和|亲肤|舒适|透气|散热|缓震|护眼/.test(feature)) {
    return `${scene}，长时间用也少打扰`;
  }

  if (/材质|工艺|玻璃|金属|塑料|硅胶|木|棉|皮|涂层|一体|纹理/.test(feature)) {
    return `${scene}，细节质感更容易看见`;
  }

  if (/防护|防滑|防烫|锁|保护|儿童|老人|安全|认证|保障|售后/.test(feature)) {
    return `${scene}，少一点使用前的顾虑`;
  }

  if (/清洁|净化|吸收|保湿|显色|防水|防摔|加热|制冷|送风|照明|收纳|支撑|稳定|快速|高效/.test(feature)) {
    return `${scene}，先看清${keyword}怎么用`;
  }

  if (input.painPoint) {
    return `${scene}，少点${compact(input.painPoint, 10)}带来的犹豫`;
  }

  return `${scene}，先把${keyword}看清楚`;
}

export function strengthenUserBenefit(asset: SellingPointAsset): SellingPointAsset {
  const validation = validateUserBenefit(asset.userBenefit);

  if (validation.passed) return asset;

  const concreteBenefit = generateConcreteUserBenefit({
    feature: asset.name,
    painPoint: asset.userPainPoint,
    evidenceLevel: asset.evidenceLevel
  });
  const concreteValidation = validateUserBenefit(concreteBenefit);
  const canBeStrong = concreteValidation.passed && asset.evidenceLevel !== "C" && asset.evidenceLevel !== "forbidden";

  return {
    ...asset,
    userBenefit: concreteBenefit || asset.userBenefit,
    priority: canBeStrong ? asset.priority : asset.priority === "P0" ? "P1" : asset.priority,
    expressionStrength: canBeStrong ? asset.expressionStrength : "soft",
    suitableFor: canBeStrong
      ? asset.suitableFor
      : Array.from(new Set(asset.suitableFor.filter((slot) => slot !== "main_image").concat(["detail_page", "prompt"]))) as SellingPointAsset["suitableFor"]
  };
}

export function classifyParameterExpression(text: string | undefined, evidenceLevel?: EvidenceLevel): ParameterExpressionLevel {
  const value = baseClean(text);

  if (!parameterPattern.test(value)) return "interpretation";
  if (riskyParameterClaimPattern.test(value) && evidenceRank(evidenceLevel) < 4) return "blocked";
  if (evidenceRank(evidenceLevel) >= 4 && /体验|效果|体感|减少|提升|降低|改善/.test(value)) return "benefit";
  return "fact";
}

export function guardParameterClaims(text: string | undefined, evidenceLevel?: EvidenceLevel) {
  let value = baseClean(text);
  const level = classifyParameterExpression(value, evidenceLevel);

  if (level === "blocked" || (parameterPattern.test(value) && evidenceRank(evidenceLevel) < 3)) {
    value = value
      .replace(/绝对|保证|必然/g, "")
      .replace(/静音/g, "运行声音以实际环境为准")
      .replace(/省电/g, "能耗表现需结合使用条件")
      .replace(/制冷|降温/g, "体感改善")
      .replace(/不占空间/g, "空间占用需结合摆放场景")
      .replace(/官方背书|认证通过|实验验证|检测证明/g, "如有资料可后期补充");
  }

  return value;
}

export function validateCopywriting(
  copy: PlanCopywriting,
  context?: RewriteContext
): CopywritingValidationResult {
  const reasons = [
    ...detectInternalTerms(copy.headline),
    ...detectInternalTerms(copy.subheadline),
    ...detectInternalTerms(copy.body)
  ];
  const allText = [copy.headline, copy.subheadline, copy.body].map(baseClean).filter(Boolean);
  const point = context?.assignedSellingPoint?.name || context?.fallbackPoint || "";
  const benefit = context?.assignedSellingPoint?.userBenefit || "";

  if (!allText.length) reasons.push("文案为空");
  if (
    !/(在|当|用|放|看|买|前|后|时|里|少|不用|能|让|一眼|清楚|安心|轻松|舒服|吃|喝|尝|闻|穿|洗|护|擦|涂|戴|鲜|甜|香|嫩|脆|滑|爽|润|汁|味|口|入口|新鲜|原|直供|现|当季|健康|质|品|感|细|节|雅|优|高|家|居|省|稳|久|顺|适|陪|享|受|调|装|型|款|色|静|凉|暖|帮|便|捷|简|易|选|配|置|融|坐|站|找|持|耐|固|松|材|计|提|改|善|满|足|贴|心|体|验|搞定|解决|日常|生活|场景|空间|角度|结构|操作|设计|细节)/.test(
      allText.join("")
    )
  ) {
    reasons.push("缺少可上屏的场景或结果");
  }
  if (context?.evidenceLevel === "C" && /确定|一定|直接|明显|完全|真实验证|实测|官方|认证/.test(allText.join(""))) {
    reasons.push("C级信息被写成确定事实");
  }
  if (point && allText.every((item) => !normalize(item).includes(normalize(extractKeyword(point))))) {
    if (!benefit || allText.every((item) => !normalize(benefit).includes(normalize(item)) && !normalize(item).includes(normalize(benefit).slice(0, 4)))) {
      reasons.push("未对应当前分配卖点");
    }
  }
  if (context?.usedCopies?.some((item) => normalize(item) && allText.some((copyItem) => normalize(copyItem) === normalize(item)))) {
    reasons.push("与其他屏重复表达");
  }

  return {
    passed: reasons.length === 0,
    reasons,
    needsRewrite: reasons.length > 0
  };
}

function rewriteHeadline(context?: RewriteContext) {
  const point = context?.assignedSellingPoint?.name || context?.fallbackPoint || "重点";
  const benefit = context?.assignedSellingPoint?.userBenefit || generateConcreteUserBenefit({ feature: point, scene: context?.scene, audience: context?.audience });
  const keyword = extractKeyword(point);
  const scene = sceneFromContext(context);
  const desire = compact(context?.assignedSellingPoint?.desirePoint || benefit.replace(/^.*?，/, ""), 8);
  const pain = compact(context?.assignedSellingPoint?.userPainPoint || context?.assignedSellingPoint?.painPoint, 8);

  if (/顾虑|风险|售后|保障|认证|证据/.test(point)) return "买前少顾虑";
  if (/参数|尺寸|规格|容量|重量/.test(point)) return "重点看清楚";
  // 卖点优先做标题，避免兜底退化成「少折腾一点」这类通用 desire
  const cleanPoint = compact(point.replace(/[，。：:].*$/, ""), 10);
  if (cleanPoint && Array.from(cleanPoint).length >= 2 && !/^(重点|核心|信息|产品|使用体验|卖点|功能|参数|日常使用)$/.test(cleanPoint)) {
    return cleanPoint;
  }
  if (pain && /怕|痛|麻烦|担心|吐槽|不够|太/.test(pain)) return compact(`${pain}有办法`, 10);
  if (benefit.includes("少一次") || benefit.includes("少一点")) return compact(benefit.replace(/^.*?，/, ""), 10);
  if (desire) return compact(desire, 10);
  if (scene && keyword) return compact(`${scene}${keyword}`, 10);

  return compact(keyword.length >= 3 ? keyword : benefit.replace(/^.*?，/, ""), 10) || "看完就懂";
}

function rewriteSubheadline(context?: RewriteContext) {
  const point = context?.assignedSellingPoint?.name || context?.fallbackPoint || "重点";
  const scene = sceneFromContext(context);
  const cleanPoint = compact(point.replace(/[，。：:].*$/, ""), 8);
  const benefit = context?.assignedSellingPoint?.userBenefit || generateConcreteUserBenefit({ feature: point, scene: context?.scene, audience: context?.audience });
  // 场景 + 卖点：避免退化成被截断的通用 desire（如「少折腾一点，轻松一」）
  if (scene && cleanPoint && !/^(重点|核心|信息|产品|使用体验|卖点|功能|参数|日常使用)$/.test(cleanPoint)) {
    return compact(`${scene}，${cleanPoint}看得见`, 20);
  }
  return compact(benefit, 20) || "把使用结果说清楚";
}

function rewriteBody(context?: RewriteContext) {
  const point = context?.assignedSellingPoint?.name || context?.fallbackPoint || "产品细节";
  const scene = sceneFromContext(context);
  const benefit = context?.assignedSellingPoint?.userBenefit || generateConcreteUserBenefit({ feature: point, scene });
  const keyword = extractKeyword(point);
  const cleanPoint = compact(point.replace(/[，。：:].*$/, ""), 12);
  const support = context?.evidenceLevel === "C" ? "仅作方向参考" : "按已知信息表达";
  // 正文首行优先讲卖点，避免退化成通用 desire
  const firstLine =
    cleanPoint && !/^(重点|核心|信息|产品|产品细节|使用体验|卖点|功能|参数|日常使用)$/.test(cleanPoint)
      ? cleanPoint
      : benefit.replace(/^.*?，/, "") || `${keyword}更清楚`;

  return [
    compact(firstLine, 15),
    compact(`${scene}里看清楚`, 15),
    compact(support, 15)
  ].filter(Boolean).join("\n");
}

export function sanitizeCopywritingInput(copy: PlanCopywriting): PlanCopywriting {
  return {
    headline: baseClean(copy.headline),
    subheadline: copy.subheadline ? baseClean(copy.subheadline) : undefined,
    body: copy.body
      ? copy.body.split("\n").map(baseClean).filter(Boolean).join("\n")
      : undefined
  };
}

export function sanitizeCopywritingOutput(
  copy: PlanCopywriting,
  context?: RewriteContext
): PlanCopywriting {
  const guarded: PlanCopywriting = {
    headline: guardParameterClaims(baseClean(copy.headline), context?.evidenceLevel),
    subheadline: copy.subheadline ? guardParameterClaims(baseClean(copy.subheadline), context?.evidenceLevel) : undefined,
    body: copy.body
      ? copy.body
          .split("\n")
          .map((line) => guardParameterClaims(baseClean(line), context?.evidenceLevel))
          .filter(Boolean)
          .slice(0, 3)
          .join("\n")
      : undefined
  };
  const validation = validateCopywriting(guarded, context);

  if (validation.passed) return guarded;

  return {
    headline: rewriteHeadline(context),
    subheadline: rewriteSubheadline(context),
    body: rewriteBody(context)
  };
}

function buildOnImageTextInstruction(textLayer?: PromptTextLayer) {
  return buildConciseTextInstruction(textLayer);
}

export function sanitizeBackgroundPrompt(text: string, textLayer?: PromptTextLayer) {
  const value = baseClean(text)
    .replace(/标题(?:文字|排版|区)?(?:统一)?(?:使用)?(?:左对齐或)?居中(?:对齐)?/g, "标题顶部左对齐")
    .replace(/顶部\s*12%[-–]\s*18%[^。；;]{0,24}居中(?:对齐)?标题/g, "顶部12%-18%区域标题左对齐")
    .replace(/主标题、?副标题[^。；;]{0,20}居中(?:对齐)?/g, "主标题、副标题统一左对齐")
    .replace(backgroundForbiddenPattern, (match) => {
      if (/Logo|品牌/.test(match)) return "品牌安全留白区，不额外生成Logo或品牌字样";
      if (/证书|公章|检测报告/.test(match)) return "真实证据素材区域以简洁信息卡表达，不生成证书、公章或检测报告画面";
      return "专业电商画面表达";
    })
    .replace(/无文字(?:信息卡片底板|线性图标容器|图形标签容器)/g, "信息卡片、线性图标和图形标签容器")
    .replace(/底图(?:本身)?不得生成任何可读文字、?标识、?数字或品牌字样/g, "画面生成清晰可读的商业文字排版，不额外生成品牌字样")
    .replace(/不生成可读文字、?logo、?证书或数据/g, "生成清晰可读文字和图形化数据，不生成证书或公章")
    .replace(/不生成可读文字、?logo、?证书、?公章、?检测报告、?排名榜单或虚构数据/g, "生成清晰可读文字和图形化信息，不生成证书、公章、检测报告、排名榜单或虚构数据")
    .replace(/后期文字区域|后期排版区域|后期文字/g, "文字排版区域");
  const textInstruction = promptAlreadyContainsTextLayer(value, textLayer)
    ? ""
    : buildOnImageTextInstruction(textLayer);

  return dedupePromptSegments([value, textInstruction].filter(Boolean).join("。"), {
    maxChars: 900
  });
}

export function validateBackgroundPrompt(text: string) {
  const reasons = detectInternalTerms(text);
  if (backgroundForbiddenPattern.test(text)) reasons.push("提示词包含证书、公章、Logo位或生成过程语言");
  backgroundForbiddenPattern.lastIndex = 0;
  return {
    passed: reasons.length === 0,
    reasons
  };
}

export function sanitizeTextLayer(layer: PromptTextLayer): PromptTextLayer {
  const copy = sanitizeCopywritingOutput({
    headline: layer.headline || "",
    subheadline: layer.subheadline,
    body: layer.body
  });
  const cleanLayout = baseClean(layer.layoutHint)
    .replace(/标题(?:文字|排版|区)?(?:统一)?(?:使用)?(?:左对齐或)?居中(?:对齐)?/g, "标题顶部左对齐")
    .replace(/顶部\s*12%[-–]\s*18%[^。；;]{0,24}居中(?:对齐)?标题/g, "顶部12%-18%区域标题左对齐")
    .replace(/主标题、?副标题[^。；;]{0,20}居中(?:对齐)?/g, "主标题、副标题统一左对齐")
    .replace(layoutForbiddenPattern, "品牌素材区只作安全排版，不额外生成Logo")
    .replace(/后期文字层|后期文字区域|后期排版区域/g, "文字排版区域")
    .replace(/含中文标题/g, "标题区")
    .replace(/英文辅助小字/g, "辅助说明区")
    .replace(/数字卖点/g, "重点信息区");

  return {
    headline: copy.headline || undefined,
    subheadline: copy.subheadline,
    body: copy.body,
    labels: (layer.labels ?? []).map(baseClean).filter((item) => item && !detectInternalTerms(item).length).slice(0, 5),
    cta: layer.cta ? baseClean(layer.cta) : undefined,
    layoutHint: cleanLayout || undefined
  };
}

export function validateTextLayer(layer: PromptTextLayer) {
  const reasons = [
    ...detectInternalTerms(layer.headline),
    ...detectInternalTerms(layer.subheadline),
    ...detectInternalTerms(layer.body),
    ...detectInternalTerms(layer.layoutHint)
  ];

  if (layer.layoutHint && layoutForbiddenPattern.test(layer.layoutHint)) {
    reasons.push("layoutHint 包含会诱导底图生成文字或标识的描述");
  }

  layoutForbiddenPattern.lastIndex = 0;

  return {
    passed: reasons.length === 0,
    reasons
  };
}

export function sanitizeMarkdownExport(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => baseClean(line))
    .join("\n")
    .replace(internalModulePattern, "")
    .replace(processLanguagePattern, "")
    .replace(/来自当前资料|按当前资料表达|按当前资料下判断/g, "按已知信息表达")
    .replace(/实际使用时(?:，|,)?[^，。；;]{0,30}变成可看见的使用结果/g, "按真实场景展示")
    .replace(/场景里一眼懂|点开理由很清楚|结果更好判断|更好判断|判断更轻松/g, "信息更容易看清")
    .replace(/好评如潮|用户都说好/g, "真实评价有来源再展示")
    .replace(/品质认证|权威认证|官方认证|全线通过/g, "真实凭证有来源再展示")
    .replace(/销量领先|排名靠前|排名第一/g, "市场数据有来源再展示")
    .replace(/高效制冷|快速降温|解暑神器|降温佳品|替代空调/g, "按资料表达使用体验")
    .replace(/温暖心境/g, "真实场景感")
    .replace(/后期文字层/g, "文字层")
    .replace(/本屏只呈现/g, "画面聚焦")
    .replace(/围绕([^，。；;]{1,24})做/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
