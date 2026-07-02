import { guardParameterClaims, sanitizeCopywritingOutput } from "@/lib/services/copywriting-guardrails";
import { sanitizeComplianceText } from "@/lib/services/compliance";
import { pickSceneEmotionContext } from "@/lib/services/scene-emotion-map";
import type {
  EvidenceLevel,
  FabCopyAsset,
  InfoSource,
  PlanCopywriting,
  SellingPointAsset
} from "@/lib/types";

export type CopyScore = {
  total: number;
  hasFeature: boolean;
  hasAdvantage: boolean;
  hasBenefit: boolean;
  hasScene: boolean;
  hasEmotion: boolean;
  hasProofOrBoundary: boolean;
  noGenericWords: boolean;
  noInternalTerms: boolean;
  noOverclaim: boolean;
};

type FabGenerationInput = {
  feature: string;
  sellingPointName?: string;
  source?: InfoSource;
  evidenceLevel?: EvidenceLevel;
  category?: string;
  targetAudience?: string;
  scene?: string;
  painPoint?: string;
  desirePoint?: string;
  emotionalTrigger?: string;
  proof?: string;
};

type RewriteInput = {
  asset?: SellingPointAsset;
  fallbackFeature?: string;
  fallbackScene?: string;
  fallbackAudience?: string;
  fallbackCopy?: PlanCopywriting;
  imageType: "main_image" | "detail_page";
  slotIndex?: number;
};

const invalidBenefitPattern =
  /实际使用时|变成可看见的使用结果|变成可见的使用结果|用起来更方便|体验更好|日常使用更省心|场景里一眼懂|点开理由很清楚|能用上|用细节做支撑|更有品质感|更值得选择|更适合你|更放心|更好用|更高级|核心方案|目标人群|家庭用户|来自当前资料|按当前资料|更好判断|结果更好判断|判断更轻松/;

const internalTermsPattern =
  /产品功能集合|核心卖点展开|信任证据清单|解决方案|后期文字层|模块名称|本屏任务|转化目标|画面目标|分配卖点|证据等级|来源|结构模式|backgroundPrompt|textLayer|layoutHint|本屏只呈现|围绕[^，。；;]{1,24}(?:做|展开|表达)|有依据再放大|结果一眼看懂/;

const overclaimPattern =
  /绝对|保证|100%|治疗|治愈|根治|防病|药用|静音|无噪|制冷|替代空调|销量领先|排名第一|官方认证|检测证明|实验验证|终身不坏|永久有效/;

const parameterPattern =
  /\d+\s*(?:w|W|kw|KW|cm|mm|m|㎡|mAh|Ah|v|V|kg|g|mg|ml|ML|l|L|升|分钟|小时|h|H|分贝|db|dB|%|℃|度|档|rpm|转|GB|TB|Hz|mah)/;

function clean(text?: string, fallback = "") {
  return sanitizeComplianceText(text ?? "")
    .replace(/\[待确认\]|\[需确认\]|待确认|需人工复核|需要人工复核|待人工补充/g, "")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

function clip(text: string | undefined, max: number, fallback = "") {
  const value = clean(text, fallback);
  const chars = Array.from(value);
  if (chars.length <= max) return value;

  // 超长时优先在标点/分隔符边界截断，避免切出「客厅/卧室/厨房等家庭日」这类半截词
  const head = chars.slice(0, max).join("");
  const boundary = Math.max(
    head.lastIndexOf("，"),
    head.lastIndexOf("、"),
    head.lastIndexOf("/"),
    head.lastIndexOf("。"),
    head.lastIndexOf("；"),
    head.lastIndexOf("："),
    head.lastIndexOf(" ")
  );
  if (boundary >= Math.floor(max * 0.5)) {
    return head.slice(0, boundary);
  }
  return head;
}

function compactPhrase(text: string | undefined, max: number, fallback = "") {
  return clip(
    text
      ?.replace(/日常使用顾虑/g, "")
      .replace(/目标人群|人群标签|核心需求|适合|产品功能集合|核心卖点展开/g, "")
      .replace(/^(?:食品饮品|小家电|美妆个护|通用商品)$/g, "")
      .replace(/实际使用时/g, "使用时")
      .replace(/少忍一次/g, "少点")
      .replace(/只写已知依据|只写已知信息|来自当前资料|按当前资料表达|按当前资料下判断/g, "按已知信息表达"),
    max,
    fallback
  );
}

function featureKeyword(feature: string) {
  const value = clean(feature)
    .replace(/^(?:核心卖点|热门卖点|文案卖点|特征卖点|数据卖点|卖点|参数|功能)\s*[:：]\s*/, "")
    .replace(/产品|核心|卖点|功能|参数|详情|方案|使用|场景|用户|信息|品质|体验|日常|重点|适合/g, "")
    .replace(/[，。；;、,.].*$/, "")
    .trim();

  return clip(value || feature, 10, "重点信息");
}

// 卖点 → 标题：优先用真实卖点本身（电商主图/详情标题最抓眼且不空泛），
// 仅当卖点为空或过于泛化时才退到给定 fallback。
function featureHeadline(feature: string | undefined, fallback = "重点看清楚") {
  const cleaned = clean(feature)
    .replace(/^(?:核心卖点|热门卖点|文案卖点|特征卖点|数据卖点|卖点|参数|功能|产品)\s*[:：]\s*/, "")
    .split(/[，。；;、,.／/]/)[0]
    .replace(/^(?:这款|该|本)/, "")
    .trim();

  if (
    !cleaned ||
    Array.from(cleaned).length < 2 ||
    /^(?:核心卖点|使用体验|产品信息|重点信息|重点|核心|信息|功能|卖点|参数)$/.test(cleaned)
  ) {
    return fallback;
  }

  return clip(cleaned, 12);
}

// 去掉痛点的「怕/担心」前缀，让「少点…」句更通顺
function painCore(pain: string) {
  return pain.replace(/^(?:怕|担心)/, "");
}

function evidenceRank(level?: EvidenceLevel) {
  if (level === "S") return 5;
  if (level === "A") return 4;
  if (level === "B") return 3;
  if (level === "C") return 2;
  return 0;
}

function advantageFromFeature(feature: string) {
  const value = clean(feature);

  if (/便携|移动|折叠|轻量|小巧|收纳|挂|可拆|调节|安装|拆装/.test(value)) return "减少摆放、移动或上手时的折腾";
  if (/容量|续航|电池|水箱|持久|长效|补充|储存|大容量/.test(value)) return "减少中途补充、等待或被打断的情况";
  if (/低噪|噪音|静音|柔和|亲肤|舒适|透气|散热|缓震|护眼/.test(value)) return "让长时间使用时的打扰感更低";
  if (/材质|工艺|玻璃|金属|塑料|硅胶|木|棉|皮|涂层|一体|纹理/.test(value)) return "让质感、结构和耐用感更容易被看见";
  if (/防护|防滑|防烫|锁|保护|儿童|老人|安全|认证|保障|售后/.test(value)) return "降低购买前和使用前的顾虑";
  if (/清洁|净化|吸收|保湿|显色|防水|防摔|加热|送风|照明|支撑|稳定|快速|高效/.test(value)) return "把功能结果转成更容易感知的使用变化";
  if (parameterPattern.test(value)) return "帮助用户在买前快速确认关键信息";

  return "把产品细节转成更容易判断的购买理由";
}

// 卖点 → 简短利益句（随卖点变化，避免副标题全是同一个通用 desire）
function advantageShort(feature: string, fallback = "更合用") {
  const v = clean(feature);
  if (/便携|移动|折叠|轻量|收纳|挂|可拆|调节|安装|高度|伸缩|拉绳/.test(v)) return "摆放使用更省心";
  if (/容量|续航|电池|水箱|持久|长效|大容量|储存|补充/.test(v)) return "中途少打断";
  if (/低噪|噪音|静音|柔和|舒适|透气|散热|护眼|风速|风量|送风|档|风/.test(v)) return "用起来更舒服";
  if (/材质|工艺|金属|塑料|木|涂层|一体|纹理|做工|网罩|按钮|接口|结构|面板/.test(v)) return "质感细节看得见";
  if (/防护|防滑|安全|认证|保障|售后|稳定|底座|防倒/.test(v)) return "用着更放心";
  if (/复古|简约|现代|风格|外观|颜值|配色|造型|高级|轻奢/.test(v)) return "颜值更耐看";
  if (/清洁|净化|防水|加热|照明|高效|快速/.test(v)) return "效果更明显";
  if (parameterPattern.test(v)) return "关键信息看得清";
  return fallback;
}

function claimBoundaryFor(input: FabGenerationInput, feature: string) {
  const parts: string[] = [];
  const category = input.category ?? "";
  const level = input.evidenceLevel;

  if (level === "C" || !level) parts.push("仅作场景化弱表达，不写成确定事实");
  if (parameterPattern.test(feature)) parts.push("参数只作事实或辅助说明，不直接推导绝对体验");
  if (/营养|保健|膳食|维生素|蛋白|益生菌|补充剂|胶囊|片剂/.test(category + feature)) {
    parts.push("不写治疗、改善疾病、抗衰、美白、增强免疫等未经证实功效");
  }
  if (/美妆|护肤|彩妆|香水|个护|精华|面霜/.test(category + feature)) {
    parts.push("不写医疗化功效或绝对改善承诺");
  }
  if (/风扇|冷风|送风|家电|电机|小家电/.test(category + feature)) {
    parts.push("不把送风写成制冷，不把噪音或功率写成绝对静音或绝对省电");
  }
  if (/认证|检测|报告|专利|销量|排名/.test(feature) && evidenceRank(level) < 4) {
    parts.push("无可靠来源时不写认证、检测、排名或销量承诺");
  }

  return parts.length ? parts.join("；") : "只表达可由当前资料支撑的用户利益";
}

function proofFor(input: FabGenerationInput) {
  if (input.proof) return clean(input.proof);
  if (input.source === "image_fact") return "来自图片可见信息";
  if (input.source === "user_input") return "来自用户补充信息";
  if (input.source === "web_search") return "来自搜索资料";
  if (input.source === "mock") return "模拟数据，仅作演示";
  return "AI推断，仅作弱表达";
}

function buildBenefitText(context: ReturnType<typeof pickSceneEmotionContext>, evidenceLevel?: EvidenceLevel, feature?: string) {
  const scene = compactPhrase(context.scene, 12, "使用场景里");
  const pain = normalizePainPoint(context.painPoint, context.categoryGroup);
  const desire = normalizeDesirePoint(context.desirePoint, context.categoryGroup, context.scene, feature);
  const emotion = compactPhrase(context.emotionalTrigger, 6, "安心");

  if (pain && /怕|担心|麻烦|不够|太|难|烦|犹豫|看不懂|踩坑/.test(pain)) {
    // 痛点多以「怕/担心」开头，「少点」后去掉该前缀更通顺：少点怕不够新鲜 → 少点不够新鲜
    const painCore = pain.replace(/^(?:怕|担心)/, "");
    return guardParameterClaims(`${scene}，少点${painCore}，${desire}`, evidenceLevel);
  }

  return guardParameterClaims(`${scene}，${desire}，${emotion}一点`, evidenceLevel);
}

function normalizePainPoint(text: string | undefined, categoryGroup?: string) {
  const pain = compactPhrase(text, 12);

  if (!pain) return "";
  if (/适合送什么人|送什么人|送谁|送礼对象/.test(pain)) return "怕送错场合";
  if (/包装.*高级|不够高级|不体面|拿不出手/.test(pain)) return "怕送礼不体面";
  if (/太浓|太苦|口味重|不好入口|喝不惯/.test(pain)) return "怕味道太重";
  if (/看不懂|配料|成分|产地|等级/.test(pain) && categoryGroup === "食品饮品") return "怕买前看不懂";

  return pain;
}

function normalizeDesirePoint(text: string | undefined, categoryGroup?: string, scene?: string, feature?: string) {
  const desire = compactPhrase(text, 12);
  const sceneText = compactPhrase(scene, 12);
  const signal = `${desire}${feature ?? ""}`;

  if (categoryGroup === "食品饮品") {
    if (/礼盒|送礼|体面|客户|伴手礼/.test(signal + sceneText)) return "送出去更稳妥";
    if (/小袋|独立|密封|保存|受潮|便携|单袋/.test(signal)) return "拿取保存更省事";
    if (/茶香|清淡|口味|味道|风味|入口|不苦|不涩|甜|香/.test(signal)) {
      return /办公室|下午|茶歇/.test(sceneText) ? "下午喝得轻松" : "入口更轻松";
    }
  }

  if (/更省心|更方便|更好用|更清爽|更高级|更有品质|更放心|体验更好|判断更轻松/.test(desire)) {
    return "先看清关键细节";
  }

  return desire || "先看清关键细节";
}

function supportLineFromProof(fab: FabCopyAsset, level?: EvidenceLevel) {
  if (level === "C") return "仅作方向参考";
  if (fab.proof?.includes("图片")) return "按可见细节表达";
  if (fab.proof?.includes("用户")) return "按商家资料表达";
  if (fab.proof?.includes("搜索")) return "按搜索资料表达";
  if (fab.proof?.includes("模拟")) return "模拟数据演示";
  if (fab.proof?.includes("AI推断")) return "仅作表达方向";
  return "按已知信息表达";
}

function resultPhrase(fab: FabCopyAsset, max = 10) {
  const desire = compactPhrase(fab.desirePoint, max);
  if (desire && !invalidBenefitPattern.test(desire)) return desire;

  const benefit = compactPhrase(fab.benefit?.replace(/^.*?，/, ""), max);
  if (benefit && !invalidBenefitPattern.test(benefit)) return benefit;

  return "买前少纠结";
}

function painPhrase(fab: FabCopyAsset, max = 8) {
  const pain = compactPhrase(fab.painPoint, max);
  return pain && !invalidBenefitPattern.test(pain) ? pain : "怕买错";
}

function scenePhrase(fab: FabCopyAsset, max = 8) {
  const scene = compactPhrase(fab.scene, max, "使用时");
  return scene || "使用时";
}

export function validateBenefit(benefit: string | undefined, fab?: Partial<FabCopyAsset>) {
  const value = clean(benefit);
  const reasons: string[] = [];

  if (!value) reasons.push("Benefit 为空");
  if (invalidBenefitPattern.test(value)) reasons.push("Benefit 是泛化或系统化表达");
  if (internalTermsPattern.test(value)) reasons.push("Benefit 含内部生成语言");
  if (overclaimPattern.test(value)) reasons.push("Benefit 存在夸大或高风险承诺");

  const checks = [
    Boolean(fab?.scene || /(在|当|早上|晚上|睡前|出门|上班|下班|厨房|客厅|卧室|办公室|通勤|买前|日常|家里|外出|旅行|使用时)/.test(value)),
    Boolean(fab?.painPoint || /(怕|担心|麻烦|费劲|打扰|焦虑|犹豫|看不懂|找不到|不顺|累|乱|踩坑|买错|用不上)/.test(value)),
    Boolean(fab?.desirePoint || /(少|不用|减少|更快|更稳|更轻松|更清楚|更安心|更顺手|更舒服|下单|判断|找到|上手)/.test(value)),
    Boolean(fab?.emotionalTrigger || /(安心|轻松|省事|体面|踏实|清爽|少纠结|少麻烦|有秩序|掌控)/.test(value)),
    !overclaimPattern.test(value),
    value.length >= 8
  ];

  const passedCount = checks.filter(Boolean).length;
  if (passedCount < 3) reasons.push("缺少具体场景、烦恼、愿望或结果");

  return {
    passed: reasons.length === 0,
    reasons
  };
}

export function generateFabCopyAsset(input: FabGenerationInput): FabCopyAsset {
  const feature = clean(input.feature || input.sellingPointName, "产品信息");
  const context = pickSceneEmotionContext({
    category: input.category,
    scene: input.scene || input.targetAudience,
    painPoint: input.painPoint,
    desirePoint: input.desirePoint,
    emotionalTrigger: input.emotionalTrigger
  });
  const advantage = advantageFromFeature(feature);
  const keyword = featureKeyword(feature);
  const claimBoundary = claimBoundaryFor(input, feature);
  const proof = proofFor(input);
  const safeBenefit = buildBenefitText(context, input.evidenceLevel, feature);
  const normalizedPain = normalizePainPoint(context.painPoint, context.categoryGroup);
  const normalizedDesire = normalizeDesirePoint(context.desirePoint, context.categoryGroup, context.scene, feature);

  return {
    feature,
    advantage,
    benefit: clean(safeBenefit),
    scene: context.scene,
    painPoint: normalizedPain || context.painPoint,
    desirePoint: normalizedDesire || context.desirePoint,
    emotionalTrigger: context.emotionalTrigger,
    proof,
    claimBoundary,
    headlineAngle: `${compactPhrase(context.scene, 10)}中的${keyword}，指向${compactPhrase(context.desirePoint, 10)}`
  };
}

export function validateFabCopyAsset(fab: FabCopyAsset) {
  const reasons: string[] = [];
  if (!clean(fab.feature)) reasons.push("缺少 Feature");
  if (!clean(fab.advantage)) reasons.push("缺少 Advantage");
  if (!clean(fab.benefit)) reasons.push("缺少 Benefit");
  if (!clean(fab.scene)) reasons.push("缺少 Scene");
  if (!clean(fab.emotionalTrigger)) reasons.push("缺少 Emotion");
  if (!clean(fab.claimBoundary)) reasons.push("缺少 Claim Boundary");

  const benefitValidation = validateBenefit(fab.benefit, fab);
  reasons.push(...benefitValidation.reasons);

  return {
    passed: reasons.length === 0,
    reasons
  };
}

function lineFromBoundary(fab: FabCopyAsset, level?: EvidenceLevel) {
  return supportLineFromProof(fab, level);
}

function detailCopyFromFab(fab: FabCopyAsset, asset?: SellingPointAsset): PlanCopywriting {
  const headline = featureHeadline(fab.feature, resultPhrase(fab, 10) || "看懂再选择");
  const scene = scenePhrase(fab, 8);
  const benefit = advantageShort(fab.feature, resultPhrase(fab, 10));

  return {
      headline: clip(headline, 10, "看懂再选择"),
      subheadline: clip(`${scene}，${benefit}`, 20, "把买前顾虑讲清楚"),
      body: [
        clip(benefit, 15, "买前少一点犹豫"),
        clip(`${scene}里看清楚`, 15, "使用场景更清楚"),
        lineFromBoundary(fab, asset?.evidenceLevel)
      ].join("\n")
  };
}

function mainCopyFromFab(fab: FabCopyAsset, slotIndex = 0, asset?: SellingPointAsset): PlanCopywriting {
  const scene = scenePhrase(fab, 8);
  const benefit = advantageShort(fab.feature, resultPhrase(fab, 10));
  const pain = painPhrase(fab, 8);
  const emotion = clip(compactPhrase(fab.emotionalTrigger, 6, "安心"), 6);
  const support = lineFromBoundary(fab, asset?.evidenceLevel);

  // 五张主图：标题始终以真实卖点为主体，副标题/正文按分工切换角度
  const slotFallback = ["一眼看重点", "差别看得见", "别再将就", "放进生活里", "买前看清楚"][slotIndex] ?? "重点看清楚";
  const headline = clip(featureHeadline(fab.feature, slotFallback), 10, slotFallback);

  if (slotIndex === 1) {
    // 差异图
    return {
      headline,
      subheadline: clip(`${scene}，差别看得出`, 20, "差异点变成使用结果"),
      body: [headline, clip(`${scene}更好对比`, 15, "使用场景更清楚"), support].join("\n")
    };
  }

  if (slotIndex === 2) {
    // 痛点图
    return {
      headline,
      subheadline: clip(`少点${painCore(pain)}，${benefit}`, 20, "问题和答案同屏看"),
      body: [clip(`少点${painCore(pain)}`, 15, "少一点麻烦"), clip(`${scene}里看清楚`, 15), support].join("\n")
    };
  }

  if (slotIndex === 3) {
    // 生活方式图
    return {
      headline,
      subheadline: clip(`${scene}，${emotion}一点`, 20, "拥有后的样子更清楚"),
      body: [clip(benefit, 15, "使用更顺手"), clip(scene, 15), support].join("\n")
    };
  }

  if (slotIndex === 4) {
    // 决策信息图
    return {
      headline,
      subheadline: clip(`${scene}，买前看清再下单`, 20, "重点信息一屏看懂"),
      body: [headline, clip(benefit, 15, "关键信息看得清"), support].join("\n")
    };
  }

  // slot 0 场景抓点击图
  return {
    headline,
    subheadline: clip(`${scene}，${benefit}`, 20, "看一眼就知道适不适合"),
    body: [headline, clip(scene, 15, "真实使用场景"), support].join("\n")
  };
}

export function rewriteCopyWithFab(input: RewriteInput): PlanCopywriting {
  const fab =
    input.asset?.fab ??
    generateFabCopyAsset({
      feature: input.asset?.feature || input.asset?.name || input.fallbackFeature || input.fallbackCopy?.headline || "产品信息",
      sellingPointName: input.asset?.name,
      source: input.asset?.source,
      evidenceLevel: input.asset?.evidenceLevel,
      category: input.fallbackAudience,
      scene: input.asset?.scene,
      painPoint: input.asset?.painPoint || input.asset?.userPainPoint,
      desirePoint: input.asset?.desirePoint,
      emotionalTrigger: input.asset?.emotionalTrigger,
      proof: input.asset?.proof
    });
  const validation = validateFabCopyAsset(fab);
  const copy = input.imageType === "main_image"
    ? mainCopyFromFab(fab, input.slotIndex ?? 0, input.asset)
    : detailCopyFromFab(fab, input.asset);
  const guarded = sanitizeCopywritingOutput(copy, {
    assignedSellingPoint: input.asset,
    audience: input.fallbackAudience,
    scene: fab.scene,
    fallbackPoint: fab.feature,
    evidenceLevel: input.asset?.evidenceLevel
  });
  const score = scoreCopywritingByFab(guarded, fab);

  if (!validation.passed || score.total < 60) {
    // 兜底也要讲真实卖点 + 场景，而不是退回「买前看清」这类空泛词
    const fallbackHeadline = featureHeadline(fab.feature, input.imageType === "main_image" ? "买前看清楚" : "先看清楚");
    const fbScene = scenePhrase(fab, 8);
    const fbResult = advantageShort(fab.feature, resultPhrase(fab, 10));
    return {
      headline: clip(fallbackHeadline, 10, input.imageType === "main_image" ? "买前看清楚" : "先看清楚"),
      subheadline: clip(`${fbScene}，${fbResult}`, 20, "把适不适合讲清楚"),
      body: [
        clip(fallbackHeadline, 15, "先看使用场景"),
        clip(`${fbScene}里看清楚`, 15, "再看产品细节"),
        supportLineFromProof(fab, input.asset?.evidenceLevel)
      ].join("\n")
    };
  }

  return guarded;
}

export function scoreCopywritingByFab(copy: PlanCopywriting, fab?: Partial<FabCopyAsset>): CopyScore {
  const text = [copy.headline, copy.subheadline, copy.body].filter(Boolean).join(" ");
  const hasFeature = Boolean(fab?.feature && text.includes(featureKeyword(fab.feature)));
  const hasAdvantage = Boolean(fab?.advantage && overlaps(text, fab.advantage));
  const hasBenefit = Boolean(fab?.benefit && overlaps(text, fab.benefit));
  const hasScene = Boolean(fab?.scene && overlaps(text, fab.scene)) || /(在|当|早上|晚上|睡前|出门|上班|下班|厨房|客厅|卧室|办公室|通勤|买前|日常|家里|外出|使用时)/.test(text);
  const hasEmotion = Boolean(fab?.emotionalTrigger && overlaps(text, fab.emotionalTrigger)) || /(安心|轻松|省事|体面|踏实|清爽|少纠结|少麻烦|有秩序|掌控)/.test(text);
  const hasProofOrBoundary = Boolean(fab?.proof || fab?.claimBoundary) || /(图片|用户|搜索|资料|边界|保守|已知|参数|细节|来源)/.test(text);
  const noGenericWords = !invalidBenefitPattern.test(text);
  const noInternalTerms = !internalTermsPattern.test(text);
  const noOverclaim = !overclaimPattern.test(text);
  const total =
    (hasFeature ? 10 : 0) +
    (hasAdvantage ? 10 : 0) +
    (hasBenefit ? 20 : 0) +
    (hasScene ? 20 : 0) +
    (hasEmotion ? 10 : 0) +
    (hasProofOrBoundary ? 10 : 0) +
    (noGenericWords ? 10 : 0) +
    (noInternalTerms ? 5 : 0) +
    (noOverclaim ? 5 : 0);

  return {
    total,
    hasFeature,
    hasAdvantage,
    hasBenefit,
    hasScene,
    hasEmotion,
    hasProofOrBoundary,
    noGenericWords,
    noInternalTerms,
    noOverclaim
  };
}

function overlaps(a: string, b: string) {
  const left = clean(a).replace(/[，,。；;、/\s]+/g, "");
  const right = clean(b).replace(/[，,。；;、/\s]+/g, "");

  if (!left || !right) return false;
  return left.includes(right.slice(0, Math.min(6, right.length))) || right.includes(left.slice(0, Math.min(6, left.length)));
}
