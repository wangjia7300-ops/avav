import { sanitizeComplianceText } from "@/lib/services/compliance";
import type {
  CompetitorAnalysisResult,
  MarketResearch,
  ProductAnalysis,
  ProductManualInfo,
  ReviewInsightResult,
  UserDecisionPath
} from "@/lib/types";

function unique(items: string[], limit: number) {
  return Array.from(new Set(items.map((item) => sanitizeComplianceText(item).trim()).filter(Boolean))).slice(0, limit);
}

function splitManual(text?: string) {
  return (text ?? "")
    .split(/[、，,;；\n]/)
    .map((item) => sanitizeComplianceText(item).trim())
    .filter(Boolean);
}

export function buildUserDecisionPath(input: {
  product: ProductAnalysis;
  market: MarketResearch;
  manualProductInfo?: ProductManualInfo;
  competitorAnalysis?: CompetitorAnalysisResult;
  reviewInsight?: ReviewInsightResult;
}): UserDecisionPath {
  const { product, market, manualProductInfo, competitorAnalysis, reviewInsight } = input;
  const productCategory = manualProductInfo?.category || product.category || product.productNameGuess || "待识别品类";
  const productType = manualProductInfo?.productName || product.productNameGuess || productCategory;
  const userSegments = unique(
    [
      ...splitManual(manualProductInfo?.targetAudience),
      ...(market.targetUserProfiles ?? []),
      ...(market.targetAudienceInsights ?? []),
      ...(product.targetAudience ?? [])
    ],
    4
  );
  const painPoints = unique(
    [
      ...(reviewInsight?.topPainPoints ?? []),
      ...(market.userPainPoints ?? []),
      ...(market.userFeedbackCons ?? [])
    ],
    6
  );
  const purchaseReasons = unique(
    [
      ...(reviewInsight?.topPurchaseReasons ?? []),
      ...(market.userFeedbackPros ?? []),
      ...(market.hotSellingPoints ?? []),
      ...(competitorAnalysis?.differentiationOpportunities ?? [])
    ],
    6
  );
  const concerns = unique([...(reviewInsight?.userConcerns ?? []), ...(market.userQuestions ?? [])], 6);

  return {
    productCategory,
    productType,
    userSegments,
    decisionPath: [
      `看到主图：先判断是不是${productCategory}，以及是否解决自己当下的小麻烦`,
      `点进详情页：寻找${purchaseReasons[0] ?? "核心购买理由"}的证据和使用场景`,
      `产生犹豫：担心${concerns[0] ?? painPoints[0] ?? "参数、效果或适配性说不清"}`,
      "继续浏览：需要看到场景、细节、对比、评价或保障来降低风险",
      "决定下单：核心利益明确，边界说清楚，购买风险可接受"
    ],
    coreQuestions: unique(
      [
        `这是不是我正在找的${productCategory}？`,
        "它能帮我少掉哪一个具体麻烦？",
        "为什么比普通同类更值得点？",
        "证据在哪里，哪些只是推断？",
        "下单前还要确认什么？"
      ],
      5
    ),
    purchaseTriggers: purchaseReasons,
    hesitationPoints: painPoints.length ? painPoints : concerns,
    evidenceBoundary: competitorAnalysis?.evidenceNote || "未提供充分外部样本时，结论以图片事实、用户补充和 AI 推断边界为准。"
  };
}
