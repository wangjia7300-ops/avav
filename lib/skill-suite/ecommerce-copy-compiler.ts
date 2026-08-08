import type { EvidenceFact } from "@/lib/types";
import type { ScreenContract } from "@/lib/skill-suite/screen-contracts";

type CopySemanticRole =
  | "user_conclusion"
  | "fact_explanation"
  | "life_explanation";

type CopySemanticSlot = Readonly<{
  role: CopySemanticRole;
  maxCharacters: number;
  instruction: string;
}>;

export type CopySemanticBrief = Readonly<ScreenContract & {
  screenId: string;
  pageTask: string;
  claimScope: ScreenContract["expectedClaimScope"];
  evidenceFacts: readonly Pick<
    EvidenceFact,
    "id" | "label" | "value" | "evidence" | "claimScope"
  >[];
  copyContract: Readonly<{
    headline: CopySemanticSlot;
    subheadline: CopySemanticSlot;
    body: CopySemanticSlot;
  }>;
  forbidden: readonly string[];
}>;

const COPY_COMPILER_GUIDANCE = [
  "文案必须从用户视角说人话，但标题、副标题、正文三层各司其职，不能把同一句换个说法重复三遍。",
  "标题＝用户结论：用4到10个中文字符直接回答 userQuestion 中“这跟我有什么关系”，优先写场景结果、动作感受或选择结论；不能只把品名、材质、工艺、结构、参数或“卖点总览”当标题。",
  "副标题＝事实解释：用一层具体事实回答“为什么/哪里体现”，可以原样保留甲方参数、材质和功能，但不得复述标题，也不得堆“品质、质感、实用、体验”等空泛形容词。",
  "正文＝生活说明：用1到2个完整自然句连接“具体场景或动作—甲方事实—用户得到的结果”；不要写属性清单，不要用连接词结尾。",
  "主标题不超过10个中文字符；副标题不超过20个中文字符；正文不超过45个中文字符、最多3个自然句，禁止硬截断。",
  "不用“适配、兼顾、彰显、赋能、打造、尽显、品质之选、满足多样需求、焕新体验、产品定位、核心卖点”等广告腔或内部策划词。",
  "不用“本产品采用、该产品具备、适用于某场景”等说明书句法；不要给用户贴“宝妈、主妇、女白领、男士专用”等刻板标签。",
  "消费者文案里禁止出现“甲方图片、上传图片、图片可见、候选事实、证据、商业使用、本屏、页面任务、模型、提示词、claimScope、evidenceIds”等内部生产语言。",
  "甲方图片里的原始事实、参数、材质与功能原意必须保留；允许改善语义、场景和利益表达，但不得新增图片外参数、认证、量化结论、功效、用户评价或交易承诺。",
  "表达示意（只能学习语义分工，禁止照抄到无关产品）：标题“饭后好洗不费劲”→副标题“光滑釉面，日常好打理”→正文“吃完饭轻轻清洗，碗里碗外都好打理。”"
].join("\n");

const FORBIDDEN_COPY_BEHAVIORS = [
  "把内部任务名写给消费者",
  "把同一句文案在标题、副标题和正文重复",
  "按字符截断形成残句",
  "把甲方事实扩写成未授权的新功效",
  "把参数、材质或结构直接当成用户结论"
] as const;

export function buildCopyCompilerGuidance() {
  return COPY_COMPILER_GUIDANCE;
}

export function buildCopySemanticBrief(
  contract: ScreenContract,
  facts: readonly EvidenceFact[]
): CopySemanticBrief {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const evidenceFacts = contract.requiredEvidenceIds
    .map((id) => factById.get(id))
    .filter((fact): fact is EvidenceFact => Boolean(fact))
    .map(({ id, label, value, evidence, claimScope }) => ({
      id,
      label,
      value,
      evidence,
      claimScope
    }));
  const hasEvidence = contract.requiredEvidenceIds.length > 0;

  return {
    ...contract,
    screenId: contract.id,
    pageTask: contract.objective,
    claimScope: contract.expectedClaimScope,
    requiredEvidenceIds: [...contract.requiredEvidenceIds],
    evidenceFacts,
    copyContract: {
      headline: {
        role: "user_conclusion",
        maxCharacters: 10,
        instruction:
          "先给用户结论、动作感受或选择提示，直接回答本屏 userQuestion；不写资料标签。"
      },
      subheadline: {
        role: "fact_explanation",
        maxCharacters: 20,
        instruction: hasEvidence
          ? "原意保留本屏证据中的具体事实，解释标题为什么成立；不新增事实外功效。"
          : "只补一层生活情境，不新增产品功效、参数或交易承诺。"
      },
      body: {
        role: "life_explanation",
        maxCharacters: 45,
        instruction: hasEvidence
          ? "用完整人话连接场景或动作、已授权事实和用户得到的结果；表达强度不超过甲方原文。"
          : "用完整人话描述一个自然场景或动作，不暗示新的产品功效。"
      }
    },
    forbidden: [...FORBIDDEN_COPY_BEHAVIORS]
  };
}

export function buildCopySemanticBriefs(
  contracts: readonly ScreenContract[],
  facts: readonly EvidenceFact[]
) {
  return contracts.map((contract) => buildCopySemanticBrief(contract, facts));
}
