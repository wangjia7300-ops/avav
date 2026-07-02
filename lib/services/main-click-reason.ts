import { sanitizeComplianceText } from "@/lib/services/compliance";
import type {
  MainClickReason,
  MainImageExpressionMethod,
  ProductAnalysis,
  SellingPointAsset,
  UserDecisionPath
} from "@/lib/types";

function hasNumberEvidence(asset?: SellingPointAsset) {
  const text = [asset?.name, asset?.feature, asset?.proof, asset?.userBenefit, asset?.claimBoundary].filter(Boolean).join(" ");
  return /\d|%|％/.test(text);
}

const nonClickReasonPattern =
  /人群标签|场景=|核心需求=|价格敏感度=|决策速度=|目标用户|证据等级|来源|竞品标题|好评[:：]|差评[:：]|用户粘贴|AI推断|llm|mock|产品功能集合|核心卖点展开|本屏|结构模式/;

function cleanCandidate(text?: string) {
  return sanitizeComplianceText(text ?? "")
    .replace(/^(?:竞品标题|好评|差评|评论|反馈|卖点)\s*[:：]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isClickReasonCandidate(text?: string) {
  const value = cleanCandidate(text);
  if (!value) return false;
  if (value.length > 28) return false;
  if (nonClickReasonPattern.test(value)) return false;
  if (/^[\d\sA-Za-z%％\-/._]+$/.test(value)) return false;
  return true;
}

function pickClickReason(asset: SellingPointAsset | undefined, decisionPath: UserDecisionPath) {
  const candidates = [
    asset?.fab?.benefit,
    asset?.userBenefit,
    asset?.benefit,
    asset?.fab?.desirePoint,
    decisionPath.purchaseTriggers[0],
    asset?.fab?.headlineAngle,
    asset?.feature,
    asset?.name
  ];
  const picked = candidates.map(cleanCandidate).find(isClickReasonCandidate);

  if (picked) return picked;

  const scene = cleanCandidate(asset?.fab?.scene || decisionPath.decisionPath[0]).slice(0, 8) || "买前";
  const desire = cleanCandidate(asset?.fab?.desirePoint || "少一点犹豫").slice(0, 10);
  return `${scene}${desire}`.slice(0, 18);
}

function inferExpressionMethod(asset: SellingPointAsset | undefined, decisionPath: UserDecisionPath): MainImageExpressionMethod {
  if (hasNumberEvidence(asset) && ["S", "A", "B"].includes(asset?.evidenceLevel ?? "")) return "number";
  if (asset?.painPoint || decisionPath.hesitationPoints.length) return "pain_point";
  if (/对比|差异|不同|普通|更/.test(asset?.advantage ?? asset?.name ?? "")) return "comparison";
  if (asset?.scene || decisionPath.purchaseTriggers.some((item) => /场景|家里|办公室|厨房|户外|通勤|晚上|夏天/.test(item))) return "scene";
  return "scene";
}

export function selectMainClickReason(input: {
  product: ProductAnalysis;
  assets: SellingPointAsset[];
  decisionPath: UserDecisionPath;
}): MainClickReason {
  const { product, assets, decisionPath } = input;
  const selected =
    assets.find((asset) => asset.priority === "P0" && asset.suitableFor.includes("main_image") && ["S", "A", "B"].includes(asset.evidenceLevel) && isClickReasonCandidate(asset.fab?.benefit || asset.userBenefit)) ??
    assets.find((asset) => asset.suitableFor.includes("main_image") && ["S", "A", "B"].includes(asset.evidenceLevel) && isClickReasonCandidate(asset.fab?.benefit || asset.userBenefit)) ??
    assets.find((asset) => asset.priority === "P0" && asset.suitableFor.includes("main_image") && ["S", "A", "B"].includes(asset.evidenceLevel)) ??
    assets.find((asset) => asset.suitableFor.includes("main_image") && ["S", "A", "B"].includes(asset.evidenceLevel)) ??
    assets.find((asset) => asset.priority === "P0") ??
    assets[0];
  const primaryClickReason = pickClickReason(selected, decisionPath);
  const expressionMethod = inferExpressionMethod(selected, decisionPath);
  const expectedUserBenefit = sanitizeComplianceText(
    (isClickReasonCandidate(selected?.fab?.benefit) ? selected?.fab?.benefit : undefined) ||
      (isClickReasonCandidate(selected?.userBenefit) ? selected?.userBenefit : undefined) ||
      decisionPath.purchaseTriggers[0] ||
      "让用户更快判断是否适合自己"
  );

  return {
    productCategory: decisionPath.productCategory || product.category,
    productType: decisionPath.productType || product.productNameGuess,
    userDecisionPath: decisionPath.decisionPath,
    primaryClickReason,
    selectedSellingPointAssetId: selected?.name ?? "未分配卖点资产",
    expressionMethod,
    userPainPoint: selected?.painPoint || decisionPath.hesitationPoints[0],
    expectedUserBenefit,
    proofOrBoundary: selected?.claimBoundary || selected?.proof || decisionPath.evidenceBoundary,
    whyThisWillTriggerClick: `把「${primaryClickReason}」放在首图，只讲一个点击理由，降低识别成本并让用户立刻判断和自己是否有关。`
  };
}
