import type {
  DesignPlanGenerationResult,
  GeneratedPrompt,
  GenerationMeta,
  GenerationStepId,
  MarketResearch,
  PlanningSession,
  ProductAnalysis
} from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function compactText(value: string | undefined | null, max = 140) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function compactList(items: string[] | undefined, limit = 5) {
  return (items ?? [])
    .map((item) => compactText(item, 48))
    .filter(Boolean)
    .slice(0, limit)
    .join("、");
}

export function createPlanningSession(title = "AI电商视觉策划多轮会话"): PlanningSession {
  const createdAt = nowIso();

  return {
    id: createId("planning"),
    title,
    createdAt,
    updatedAt: createdAt,
    turns: []
  };
}

export function startPlanningTurn(
  session: PlanningSession,
  payload: {
    step: GenerationStepId;
    title: string;
    inputSummary: string;
  }
) {
  const startedAt = nowIso();
  const turnId = createId(`turn_${payload.step}`);

  return {
    turnId,
    session: {
      ...session,
      updatedAt: startedAt,
      turns: [
        ...session.turns,
        {
          id: turnId,
          step: payload.step,
          title: payload.title,
          status: "pending" as const,
          inputSummary: compactText(payload.inputSummary, 260),
          startedAt
        }
      ]
    }
  };
}

export function completePlanningTurn(
  session: PlanningSession,
  turnId: string,
  outputSummary: string,
  generationMeta?: GenerationMeta
): PlanningSession {
  const completedAt = nowIso();

  return {
    ...session,
    updatedAt: completedAt,
    turns: session.turns.map((turn) =>
      turn.id === turnId
        ? {
            ...turn,
            status: "success" as const,
            outputSummary: compactText(outputSummary, 320),
            generationMeta,
            completedAt
          }
        : turn
    )
  };
}

export function failPlanningTurn(
  session: PlanningSession,
  turnId: string | null | undefined,
  errorMessage: string
): PlanningSession {
  if (!turnId) {
    return session;
  }

  const completedAt = nowIso();

  return {
    ...session,
    updatedAt: completedAt,
    turns: session.turns.map((turn) =>
      turn.id === turnId
        ? {
            ...turn,
            status: "failed" as const,
            errorMessage: compactText(errorMessage, 240),
            completedAt
          }
        : turn
    )
  };
}

export function summarizeProductAnalysis(product: ProductAnalysis) {
  return [
    `识别品类：${compactText(product.category, 48)}`,
    `产品猜测：${compactText(product.productNameGuess, 48)}`,
    product.brandNames?.chinese || product.brandNames?.english
      ? `品牌：${compactText([product.brandNames?.chinese, product.brandNames?.english].filter(Boolean).join("/"), 48)}`
      : "",
    `外观：${compactList(product.appearance)}`,
    `可见功能：${compactList(product.visibleFeatures)}`,
    `材质/颜色：${compactList([...product.materials, ...product.colors], 6)}`
  ].filter(Boolean).join("；");
}

export function summarizeMarketResearch(market: MarketResearch) {
  return [
    `热门卖点：${compactList(market.hotSellingPoints)}`,
    `用户痛点：${compactList(market.userPainPoints)}`,
    market.userFeedbackPros?.length ? `好评点：${compactList(market.userFeedbackPros)}` : "",
    market.userFeedbackCons?.length ? `差评点：${compactList(market.userFeedbackCons)}` : "",
    market.sourceNote ? `来源说明：${compactText(market.sourceNote, 80)}` : ""
  ].filter(Boolean).join("；");
}

export function summarizeDesignPlan(result: DesignPlanGenerationResult) {
  const mainTitles = result.mainImages.map((item) => item.copywriting.headline || item.title);
  const detailTitles = result.detailPages.slice(0, 5).map((item) => item.copywriting.headline || item.title);

  return [
    `主图${result.mainImages.length}张：${compactList(mainTitles, 5)}`,
    `详情页${result.detailPages.length}屏：${compactList(detailTitles, 5)}`
  ].join("；");
}

export function summarizePrompts(prompts: GeneratedPrompt[]) {
  const mainCount = prompts.filter((item) => item.imageType === "main_image").length;
  const detailCount = prompts.filter((item) => item.imageType === "detail_page").length;

  return `已生成主图提示词${mainCount}条、详情页提示词${detailCount}条，采用底图提示词 + textLayer 文案层分离。`;
}

export function summarizePlanningSessionForAI(session: PlanningSession, maxTurns = 8) {
  const turns = session.turns
    .filter((turn) => turn.status === "success")
    .slice(-maxTurns);

  if (!turns.length) {
    return "暂无前置会话结论。";
  }

  return turns
    .map((turn, index) => {
      const source = turn.generationMeta
        ? `来源=${turn.generationMeta.sourceType}，证据=${turn.generationMeta.evidenceLevel ?? "未标注"}`
        : "来源未标注";

      return [
        `第${index + 1}轮【${turn.title}】${source}`,
        `输入：${turn.inputSummary}`,
        `结论：${turn.outputSummary ?? "已完成"}`
      ].join("\n");
    })
    .join("\n---\n");
}
