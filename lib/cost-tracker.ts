/**
 * API 调用成本追踪
 *
 * 基于模型定价和请求参数估算每次调用的费用。
 * 服务端使用进程内存存储，浏览器端使用 sessionStorage。
 * 不依赖各供应商返回的实际 token 用量。
 */

// ── 模型定价（元/百万 token） ──────────────────────────────────

type PricingEntry = {
  input: number;
  output: number;
  image?: number;
};

const MODEL_PRICING: Record<string, PricingEntry> = {
  "doubao-seed": { input: 4, output: 4, image: 0.03 },
  "doubao-vision": { input: 4, output: 4, image: 0.03 },
  "doubao-lite": { input: 0.8, output: 0.8 },
  "gpt-4.1": { input: 14, output: 56 },
  "gpt-4.1-mini": { input: 2.8, output: 11.2 },
  "gpt-4o": { input: 17.5, output: 70 },
  "gpt-4o-mini": { input: 1, output: 4 },
  "gemini-3.6": { input: 0.7, output: 2.8 },
  "gemini-2.5": { input: 7.5, output: 30 },
  "gemini-2.0": { input: 1, output: 4 },
  "claude-3.5-sonnet": { input: 21, output: 105 },
  "claude-3.5-haiku": { input: 5.6, output: 28 },
  "glm-4": { input: 0.07, output: 0.07 },
  "glm-4v": { input: 0.35, output: 0.35 },
  "ep-": { input: 4, output: 4, image: 0.03 }
};

function findPricing(model?: string): PricingEntry | null {
  if (!model) return null;
  const normalized = model.toLowerCase().replace(/[^a-z0-9.-]/g, "");
  const entries = Object.entries(MODEL_PRICING).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [key, entry] of entries) {
    if (normalized.startsWith(key)) return entry;
  }
  return null;
}

function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

// ── 类型 ───────────────────────────────────────────────────────

export type CostEntry = {
  stage: string;
  operation: string;
  model: string;
  providerId: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  imageCount: number;
  estimatedCost: number;
  timestamp: string;
};

// ── 跨环境存储 ─────────────────────────────────────────────────

const entries: CostEntry[] = [];

// ── 公开 API ───────────────────────────────────────────────────

export function logCost(params: {
  stage: string;
  operation: string;
  model?: string;
  providerId?: string;
  inputText?: string;
  outputText?: string;
  imageCount?: number;
}) {
  const pricing = findPricing(params.model);
  if (!pricing) return;

  const model = params.model ?? "unknown";
  const providerId = params.providerId ?? "unknown";
  const inputTokens = estimateTokens(params.inputText ?? "");
  const outputTokens = estimateTokens(params.outputText ?? "");
  const imageCount = params.imageCount ?? 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const imageCost = imageCount * (pricing.image ?? 0);
  const estimatedCost =
    Math.round((inputCost + outputCost + imageCost) * 1.1 * 10000) / 10000;

  const entry: CostEntry = {
    stage: params.stage,
    operation: params.operation,
    model,
    providerId,
    estimatedInputTokens: Math.round(inputTokens * 1.1),
    estimatedOutputTokens: Math.round(outputTokens * 1.1),
    imageCount,
    estimatedCost,
    timestamp: new Date().toISOString()
  };

  entries.push(entry);
  if (entries.length > 200) entries.splice(0, entries.length - 200);
}

export function getCostEntries(): CostEntry[] {
  return [...entries];
}

export function getCostSummary() {
  const all = getCostEntries();
  const byStage: Record<string, { cost: number; count: number }> = {};
  let total = 0;

  for (const entry of all) {
    total += entry.estimatedCost;
    const s = entry.stage || "other";
    if (!byStage[s]) byStage[s] = { cost: 0, count: 0 };
    byStage[s].cost += entry.estimatedCost;
    byStage[s].count += 1;
  }

  return {
    entries: all,
    totalCost: Math.round(total * 100) / 100,
    byStage,
    modelCount: new Set(all.map((e) => e.model)).size
  };
}

export function clearCostLog() {
  entries.length = 0;
}
