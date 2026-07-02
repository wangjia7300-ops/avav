import { getEvidenceItem } from "@/lib/evidence";
import { sanitizeComplianceText } from "@/lib/services/compliance";
import { getSceneEmotionMap } from "@/lib/services/scene-emotion-map";
import {
  generateConcreteUserBenefit,
  strengthenUserBenefit
} from "@/lib/services/copywriting-guardrails";
import {
  generateFabCopyAsset,
  validateBenefit,
  validateFabCopyAsset
} from "@/lib/services/fab-copywriting";
import type {
  EvidenceLevel,
  InfoSource,
  MarketEvidenceField,
  MarketResearch,
  ProductAnalysis,
  ProductEvidenceField,
  ProductManualInfo,
  SellingPointAsset,
  SourcedInfo
} from "@/lib/types";

type SellingPointAssetContext = {
  category?: string;
  targetAudience?: string;
  scene?: string;
  painPoint?: string;
  desirePoint?: string;
  proof?: string;
};

const priorityRank: Record<SellingPointAsset["priority"], number> = {
  P0: 3,
  P1: 2,
  P2: 1
};

const evidenceRank: Record<EvidenceLevel, number> = {
  S: 5,
  A: 4,
  B: 3,
  C: 2,
  forbidden: 0
};

function splitItems(value?: string) {
  return (value ?? "")
    .split(/[、，,;；\n]/)
    .map((item) => sanitizeComplianceText(item).trim())
    .filter(Boolean);
}

function splitEvidenceText(value?: string, limit = 8) {
  return (value ?? "")
    .split(/[\n。！？!?；;，,、]/)
    .map((item) =>
      sanitizeComplianceText(item)
        .replace(/^(?:竞品标题|竞品文案|标题|好评|差评|中评|评论|反馈|用户反馈|买家说|用户说)\s*[:：]\s*/, "")
        .trim()
    )
    .filter((item) => item.length >= 4)
    .map((item) => item.slice(0, 36))
    .slice(0, limit);
}

function compactAssetName(text: string) {
  return sanitizeComplianceText(text)
    .replace(/^(?:核心卖点|热门卖点|文案卖点|特征卖点|数据卖点|卖点|竞品标题|竞品文案|标题|好评|差评|评论|反馈)\s*[:：]\s*/, "")
    .replace(/\s+/g, "")
    .slice(0, 20);
}

function compactContextValue(value?: string, max = 16) {
  const text = sanitizeComplianceText(value ?? "").trim();

  if (!text) return undefined;

  const sceneMatch = text.match(/场景\s*[=：:]\s*([^；;，,。]+)/);
  if (sceneMatch?.[1]) return sceneMatch[1].trim().slice(0, max);

  const needMatch = text.match(/核心需求\s*[=：:]\s*([^；;，,。]+)/);
  if (needMatch?.[1]) return needMatch[1].trim().slice(0, max);

  return text
    .replace(/^(?:人群标签|目标人群|场景|核心需求|价格敏感度|决策速度)\s*[=：:]\s*/, "")
    .split(/[；;，,。]/)[0]
    .trim()
    .slice(0, max);
}

function inferBenefit(name: string, painPoint?: string) {
  const value = sanitizeComplianceText(name);
  return generateConcreteUserBenefit({
    feature: value,
    painPoint
  });
}

function inferStrength(level: EvidenceLevel, source: InfoSource): SellingPointAsset["expressionStrength"] {
  if (level === "S" || level === "A" || source === "user_input") return "strong";
  if (level === "B") return "medium";
  return "soft";
}

function inferPriority(
  index: number,
  level: EvidenceLevel,
  source: InfoSource,
  name: string
): SellingPointAsset["priority"] {
  if (level === "forbidden") return "P2";
  if (source === "user_input" || level === "S" || level === "A") return index < 3 ? "P0" : "P1";
  if (/认证|质检|售后|保障|尺寸|参数|规格/.test(name)) return "P2";
  return index < 2 ? "P0" : index < 5 ? "P1" : "P2";
}

function inferSuitableFor(level: EvidenceLevel, name: string): SellingPointAsset["suitableFor"] {
  if (level === "forbidden") return ["forbidden"];
  // 认证/质检/售后/规格/参数 这类更适合详情页深入展开，不作主图主打
  if (/认证|质检|售后|保障|规格|尺寸|参数/.test(name)) return ["detail_page", "prompt"];
  // C 级（AI 推断）卖点仍可上主图：主图是卖点展示位，证据强弱由文案层 claimBoundary 控制，
  // 否则证据偏弱的品类会出现主图拿不到任何卖点、只能退到泛化兜底的情况。
  return ["main_image", "detail_page", "prompt"];
}

function evidenceToAsset(
  text: string,
  info: SourcedInfo | undefined,
  index: number,
  fallbackSource: InfoSource,
  fallbackLevel: EvidenceLevel,
  painPoint?: string,
  context?: SellingPointAssetContext
): SellingPointAsset | null {
  const name = compactAssetName(text);

  if (!name || name.length < 2) return null;

  const source = info?.source ?? fallbackSource;
  const evidenceLevel = info?.evidenceLevel ?? fallbackLevel;
  const suitableFor = inferSuitableFor(evidenceLevel, name);
  const fab = generateFabCopyAsset({
    feature: name,
    sellingPointName: name,
    source,
    evidenceLevel,
    category: context?.category,
    targetAudience: context?.targetAudience,
    scene: context?.scene,
    painPoint: painPoint || context?.painPoint,
    desirePoint: context?.desirePoint,
    proof: context?.proof || info?.sourceNote
  });

  const preliminaryAsset: SellingPointAsset = {
    name,
    source,
    evidenceLevel,
    feature: fab.feature,
    advantage: fab.advantage,
    benefit: fab.benefit,
    scene: fab.scene,
    painPoint: fab.painPoint,
    desirePoint: fab.desirePoint,
    emotionalTrigger: fab.emotionalTrigger,
    proof: fab.proof,
    claimBoundary: fab.claimBoundary,
    userPainPoint: painPoint || fab.painPoint,
    userBenefit: fab.benefit || inferBenefit(name, painPoint),
    suitableFor,
    expressionStrength: inferStrength(evidenceLevel, source),
    priority: inferPriority(index, evidenceLevel, source, name),
    fab
  };

  const strengthened = strengthenUserBenefit(preliminaryAsset);
  const benefitValidation = validateBenefit(strengthened.userBenefit, strengthened.fab);
  const fabValidation = strengthened.fab ? validateFabCopyAsset(strengthened.fab) : { passed: false };

  if ((!benefitValidation.passed || !fabValidation.passed) && strengthened.priority === "P0") {
    return {
      ...strengthened,
      priority: "P1",
      expressionStrength: "soft",
      suitableFor: Array.from(new Set(strengthened.suitableFor.filter((slot) => slot !== "main_image").concat(["detail_page", "prompt"]))) as SellingPointAsset["suitableFor"]
    };
  }

  return strengthened;
}

function pushProductField(
  target: SellingPointAsset[],
  product: ProductAnalysis,
  field: ProductEvidenceField,
  items: string[] | undefined,
  source: InfoSource,
  level: EvidenceLevel,
  context?: SellingPointAssetContext
) {
  (items ?? []).forEach((item, index) => {
    const asset = evidenceToAsset(item, getEvidenceItem(product.evidence, field, index), target.length, source, level, context?.painPoint, context);
    if (asset) target.push(asset);
  });
}

function pushMarketField(
  target: SellingPointAsset[],
  market: MarketResearch,
  field: MarketEvidenceField,
  items: string[] | undefined,
  source: InfoSource,
  level: EvidenceLevel,
  painPoints: string[],
  context?: SellingPointAssetContext
) {
  (items ?? []).forEach((item, index) => {
    const asset = evidenceToAsset(
      item,
      getEvidenceItem(market.evidence, field, index),
      target.length,
      source,
      level,
      painPoints[index % Math.max(painPoints.length, 1)],
      context
    );
    if (asset) target.push(asset);
  });
}

export function buildSellingPointAssets(
  product: ProductAnalysis,
  market: MarketResearch,
  manualProductInfo?: ProductManualInfo
): SellingPointAsset[] {
  const assets: SellingPointAsset[] = [];
  const manualSellingPoints = splitItems(manualProductInfo?.sellingPoints);
  const manualAudience = splitItems(manualProductInfo?.targetAudience);
  const manualNotes = splitItems(manualProductInfo?.notes);
  const painPoints = [
    ...(market.reviewInsight?.topPainPoints ?? []),
    ...(market.reviewInsight?.userConcerns ?? []),
    ...(market.userFeedbackCons ?? []),
    ...(market.userPainPoints ?? []),
    ...manualNotes.filter((item) => /怕|担心|顾虑|麻烦|不方便|不够|太|难|烦|犹豫/.test(item))
  ].map(sanitizeComplianceText).filter(Boolean);
  // 场景优先用真实使用场景；usageScenarios/targetUserProfiles 里常混入「用户群体：…」式人群描述，
  // 必须过滤掉，只取真正的场景，否则文案副标题会变成「用户群体，…」。无真实场景时用品类常见场景兜底。
  const realUsageScene = (market.reviewInsight?.usageScenarios ?? [])
    .map((item) => sanitizeComplianceText(item).replace(/^场景[:：]\s*/, "").trim())
    .find((item) => item && !/用户群体|人群|目标用户|适合人群|^适合/.test(item));
  const assetContext: SellingPointAssetContext = {
    category: manualProductInfo?.category || product.category || product.productNameGuess,
    targetAudience: compactContextValue(manualAudience[0] || product.targetAudience?.[0]),
    scene: compactContextValue(
      realUsageScene ||
        getSceneEmotionMap(manualProductInfo?.category || product.category || product.productNameGuess)
          .commonScenes[0],
      14
    ),
    painPoint: compactContextValue(painPoints[0], 14),
    desirePoint: undefined,
    proof: product.evidence?.sellingPoints?.[0]?.sourceNote || market.evidence?.hotSellingPoints?.[0]?.sourceNote
  };

  manualSellingPoints.forEach((item, index) => {
    const asset = evidenceToAsset(item, undefined, index, "user_input", "A", painPoints[index], assetContext);
    if (asset) assets.push(asset);
  });

  splitEvidenceText(manualProductInfo?.competitorText, 8).forEach((item, index) => {
    const asset = evidenceToAsset(
      item,
      {
        text: item,
        source: "user_input",
        evidenceLevel: "A",
        sourceNote: "用户粘贴的竞品文案或平台资料"
      },
      assets.length + index,
      "user_input",
      "A",
      painPoints[index],
      assetContext
    );
    if (asset) assets.push(asset);
  });

  splitEvidenceText(manualProductInfo?.reviewText, 8).forEach((item, index) => {
    const asset = evidenceToAsset(
      item,
      {
        text: item,
        source: "user_input",
        evidenceLevel: "A",
        sourceNote: "用户粘贴的评论或用户反馈资料"
      },
      assets.length + index,
      "user_input",
      "A",
      painPoints[index],
      assetContext
    );
    if (asset) assets.push(asset);
  });

  pushProductField(assets, product, "sellingPoints", product.sellingPoints, "image_fact", "B", assetContext);
  pushProductField(assets, product, "visibleFeatures", product.visibleFeatures, "image_fact", "B", assetContext);
  pushProductField(assets, product, "dataSellingPoints", product.dataSellingPoints, "image_fact", "B", assetContext);
  pushProductField(assets, product, "parameters", product.parameters, "image_fact", "B", assetContext);
  pushMarketField(assets, market, "hotSellingPoints", market.hotSellingPoints, "llm_inference", "C", painPoints, assetContext);
  pushMarketField(assets, market, "copywritingSellingPoints", market.copywritingSellingPoints, "llm_inference", "C", painPoints, assetContext);
  pushMarketField(assets, market, "featureSellingPoints", market.featureSellingPoints, "llm_inference", "C", painPoints, assetContext);
  pushMarketField(assets, market, "dataSellingPointInsights", market.dataSellingPointInsights, "llm_inference", "C", painPoints, assetContext);

  const bestByName = new Map<string, SellingPointAsset>();

  for (const asset of assets) {
    const key = asset.name;
    const current = bestByName.get(key);

    if (!current) {
      bestByName.set(key, asset);
      continue;
    }

    const currentScore = evidenceRank[current.evidenceLevel] + priorityRank[current.priority];
    const nextScore = evidenceRank[asset.evidenceLevel] + priorityRank[asset.priority];
    if (nextScore > currentScore) bestByName.set(key, asset);
  }

  return Array.from(bestByName.values())
    .filter((asset) => !asset.suitableFor.includes("forbidden"))
    .sort((a, b) => {
      const priorityDiff = priorityRank[b.priority] - priorityRank[a.priority];
      if (priorityDiff) return priorityDiff;
      return evidenceRank[b.evidenceLevel] - evidenceRank[a.evidenceLevel];
    })
    .slice(0, 12);
}

export function selectAssetForSlot(
  assets: SellingPointAsset[],
  slot: "main_image" | "detail_page" | "prompt",
  preferredPriorities: SellingPointAsset["priority"][],
  used: Set<string>
) {
  const match =
    assets.find(
      (asset) =>
        !used.has(asset.name) &&
        asset.suitableFor.includes(slot) &&
        preferredPriorities.includes(asset.priority)
    ) ??
    assets.find((asset) => !used.has(asset.name) && asset.suitableFor.includes(slot));

  if (match) used.add(match.name);
  return match;
}

export function formatSellingPointAsset(asset: SellingPointAsset) {
  return `${asset.name}（${asset.priority}/${asset.evidenceLevel}/${asset.source}，${asset.userBenefit ?? "用户利益待补充"}，场景：${asset.scene ?? "待补充"}）`;
}
