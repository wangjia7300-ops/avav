import { sanitizeComplianceText } from "@/lib/services/compliance";
import type { CompetitorAnalysisResult, MarketResearch, ProductManualInfo } from "@/lib/types";

function splitLines(text?: string, limit = 80) {
  return (text ?? "")
    .split(/[\n。！？!?；;]/)
    .map((item) => sanitizeComplianceText(item).trim())
    .filter((item) => item.length >= 2)
    .slice(0, limit);
}

function unique(items: string[], limit: number) {
  return Array.from(new Set(items.map((item) => sanitizeComplianceText(item).trim()).filter(Boolean))).slice(0, limit);
}

function extractPriceRanges(lines: string[], manualPrice?: string) {
  const detected = lines
    .map((line) => line.match(/(?:¥|￥)?\s*\d+(?:\.\d+)?\s*(?:-|~|到|至)\s*(?:¥|￥)?\s*\d+(?:\.\d+)?|(?:¥|￥)\s*\d+(?:\.\d+)?/g))
    .flatMap((matches) => matches ?? []);

  return unique([manualPrice ?? "", ...detected], 4);
}

export function buildCompetitorAnalysis(
  manualProductInfo: ProductManualInfo | undefined,
  market: MarketResearch | undefined
): CompetitorAnalysisResult {
  const lines = splitLines(manualProductInfo?.competitorText);
  const titleKeywordLibrary = unique(
    [
      ...lines.filter((line) => /标题|主图|卖点|关键词|搜索|同款|爆款/.test(line)),
      ...(market?.competitorTitleStyles ?? []),
      ...(market?.copywritingSellingPoints ?? [])
    ],
    12
  );
  const mainImagePatterns = unique(
    [
      ...lines.filter((line) => /主图|首图|场景|对比|人物|白底|实拍|C4D|详情|KV/.test(line)),
      ...(market?.competitorVisualBenchmarks ?? []),
      ...(market?.visualStyles ?? [])
    ],
    10
  );
  const sellingPointPatterns = unique(
    [
      ...lines.filter((line) => /卖点|优势|痛点|评价|好评|差评|参数|功能|材质|成分/.test(line)),
      ...(market?.hotSellingPoints ?? []),
      ...(market?.featureSellingPoints ?? [])
    ],
    12
  );
  const priceRanges = extractPriceRanges(lines, manualProductInfo?.priceRange);
  const visualStyle = market?.visualStyles?.[0] ?? mainImagePatterns[0] ?? "样本有限，需补充竞品截图或文案";

  return {
    competitorCount: lines.length,
    mainImagePatterns,
    titleKeywordLibrary,
    sellingPointPatterns,
    pricePositionMap: priceRanges.length
      ? priceRanges.map((priceRange) => ({
          priceRange,
          commonSellingPoints: sellingPointPatterns.slice(0, 3),
          visualStyle
        }))
      : [],
    differentiationOpportunities: unique(
      [
        ...sellingPointPatterns.map((point) => `把「${point}」转成用户场景利益，而不是只写功能词`),
        ...mainImagePatterns.map((pattern) => `避开同质化「${pattern}」，改用更明确的点击理由`)
      ],
      8
    ),
    evidenceNote: lines.length
      ? `基于用户粘贴的 ${lines.length} 条竞品/平台材料整理，样本规模以用户输入为准。`
      : "未提供真实竞品粘贴材料；仅保留现有市场洞察中的弱参考，不伪装成真实竞品调研。"
  };
}
