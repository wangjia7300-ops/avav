import { sanitizeComplianceText } from "@/lib/services/compliance";
import type { MarketResearch, ProductManualInfo, ReviewInsightResult } from "@/lib/types";

function splitInsightLines(text?: string, limit = 20) {
  return (text ?? "")
    .split(/[\n。！？!?；;]/)
    .map((item) =>
      sanitizeComplianceText(item)
        .replace(/^(?:好评|差评|中评|评论|反馈|用户反馈|买家说|用户说)\s*[:：]\s*/, "")
        .trim()
    )
    .filter((item) => item.length >= 2)
    .slice(0, limit);
}

function unique(items: string[], limit: number) {
  return Array.from(new Set(items.map((item) => sanitizeComplianceText(item).trim()).filter(Boolean))).slice(0, limit);
}

function pickByKeywords(lines: string[], keywords: RegExp, fallback: string[], limit: number) {
  const picked = lines.filter((line) => keywords.test(line));
  return unique([...picked, ...fallback], limit);
}

export function buildReviewInsight(
  manualProductInfo: ProductManualInfo | undefined,
  market: MarketResearch | undefined
): ReviewInsightResult {
  const rawLines = splitInsightLines(manualProductInfo?.reviewText, 120);
  const marketPros = market?.userFeedbackPros ?? [];
  const marketCons = market?.userFeedbackCons ?? market?.userPainPoints ?? [];
  const marketScenarios = market?.targetUserProfiles ?? market?.targetAudienceInsights ?? [];

  const topPurchaseReasons = pickByKeywords(
    rawLines,
    /好用|方便|喜欢|满意|回购|值得|舒服|顺手|清楚|省事|安心|颜值|质感/,
    [...marketPros, ...(market?.hotSellingPoints ?? [])],
    5
  );
  const topPainPoints = pickByKeywords(
    rawLines.filter((line) => !topPurchaseReasons.includes(line) && !/不占|不重|不大|不小|不麻烦|不费事/.test(line)),
    /差|慢|贵|麻烦|担心|怕|难|吵|退|坏|漏|刺|干|闷|不适合|不好|不够|不能|不会|不是/,
    marketCons,
    10
  );
  const userConcerns = pickByKeywords(
    rawLines,
    /担心|怕|会不会|是不是|能不能|是否|退|售后|真假|安全|适合|过敏|噪音|功率/,
    market?.userQuestions ?? [],
    8
  );
  const usageScenarios = pickByKeywords(
    rawLines,
    /家里|办公室|宿舍|厨房|客厅|卧室|通勤|出差|旅行|上班|晚上|夏天|冬天|孩子|老人/,
    marketScenarios,
    8
  );

  return {
    reviewCount: rawLines.length,
    topPurchaseReasons,
    topPainPoints,
    userConcerns,
    usageScenarios,
    positiveKeywords: unique(topPurchaseReasons.flatMap((line) => line.split(/[、，,\s]/)), 12),
    negativeKeywords: unique(topPainPoints.flatMap((line) => line.split(/[、，,\s]/)), 12),
    sellingPointWordCloud: unique([...(market?.hotSellingPoints ?? []), ...topPurchaseReasons], 12),
    reviewWordCloud: unique([...topPurchaseReasons, ...topPainPoints, ...userConcerns], 16),
    conversionOpportunities: unique(
      [
        ...topPainPoints.map((pain) => `围绕「${pain}」给出解决画面和边界说明`),
        ...userConcerns.map((concern) => `用真实细节回应「${concern}」`)
      ],
      8
    )
  };
}
