import type {
  DetailScreen,
  EvidenceClaimScope,
  EvidenceFact
} from "@/lib/types";
import type {
  PlanRepairField,
  PlanRepairIssue
} from "@/lib/skill-suite/plan-repair";

export type ScreenContract = {
  id: string;
  index: number;
  subjectKey: string;
  userQuestion: string;
  stage: "opening" | "fact" | "scene" | "summary" | "closing";
  objective: string;
  expectedClaimScope: DetailScreen["claimScope"];
  requiredEvidenceIds: string[];
  userCopyIntent: string;
};

const SCENE_OBJECTIVES = [
  "日常拿取：让用户看见产品进入真实生活的一个瞬间，不新增产品功效",
  "空间搭配：只表达产品与环境的色彩、形态或陈列关系",
  "使用动作：展示一个自然动作，不把动作结果写成产品承诺",
  "细节审美：换一个镜头观察外形与可见细节，不重复前屏卖点",
  "生活节奏：用不同时间、空间和人物状态建立代入，不虚构评价",
  "选择提示：帮助用户回看已知事实，不创造尺寸适配或效果结论"
] as const;

const SCREEN_COPY_FIELDS: PlanRepairField[] = [
  "role",
  "conversionTask",
  "primarySellingPoint",
  "proofMethod",
  "copy.headline",
  "copy.subheadline",
  "copy.body",
  "copy.keyPoints"
];

const SCOPE_COPY_INTENTS: Record<EvidenceClaimScope, string> = {
  appearance:
    "标题先说用户一眼能看懂的外观感受；副标题落到具体颜色、形态或纹理；正文写用户在真实摆放、搭配或观察时能看到什么，不写设计说明书。",
  visible_text:
    "标题先回答这段文字帮用户确认什么；副标题原样说清真正看清的名称或文字；正文只补识别位置和选择意义，不补齐模糊内容、不喊口号。",
  specification:
    "标题先回答用户对大小、容量或参数的疑问，例如“大小先看清”；副标题原样保留参数；正文用一个选择或使用场景解释参数，不把参数重复三遍。",
  material:
    "标题先说材质对用户选择有什么直接意义；副标题保留甲方材质原意；正文用触摸、清洗、盛放或日常使用场景解释，不得顺带扩写新功效。",
  performance:
    "标题先说这项基础效果解决的日常顾虑；副标题原样承接甲方效果；正文写具体场景与可感知结果，表达强度不得超过图片原文。",
  mechanism:
    "标题先给用户能理解的结果；副标题说清对应结构或机制；正文用一个简单动作或因果把原理讲懂，只解释图片已经确认的内容。",
  service:
    "标题先说用户需要知道的服务结论；副标题写清范围和条件；正文说明何时、如何使用该服务，不使用空泛的安心、无忧包装词。",
  promotion:
    "标题先说用户能得到的活动结果；副标题保留价格或条件；正文写清时间、门槛和使用方式，所有数字必须与甲方资料一致。"
};

function usableFacts(facts: readonly EvidenceFact[]) {
  return facts.filter(
    (fact) => fact.status !== "blocked" && fact.commercialUse
  );
}

function screenId(index: number) {
  return `screen-${String(index).padStart(2, "0")}`;
}

function summaryFacts(facts: readonly EvidenceFact[]) {
  if (facts.length < 2) return facts.slice(0, 1);
  const first = facts[0];
  const differentScope = facts.find(
    (fact) => fact.claimScope !== first.claimScope
  );
  return differentScope ? [first, differentScope] : [first];
}

/**
 * Builds the same deterministic 15-screen contract for prompting and validation.
 * Facts occupy screens 02–13 one by one, so every authorized fact gets a clear
 * page owner instead of being cycled or copied into every prompt.
 */
export function buildScreenContracts(
  facts: readonly EvidenceFact[]
): ScreenContract[] {
  const available = usableFacts(facts);
  const contracts: ScreenContract[] = [
    {
      id: screenId(1),
      index: 1,
      subjectKey: "opening:daily-context",
      userQuestion: "它为什么值得我继续往下看？",
      stage: "opening",
      objective:
        "用户视角开场：先给一个与日常有关的选择理由，再让产品自然出现；不罗列参数和卖点",
      expectedClaimScope: "creative",
      requiredEvidenceIds: [],
      userCopyIntent:
        "像朋友开场，说用户能马上懂的一句话；标题不写品类说明、产品定位或卖点汇总。"
    }
  ];

  for (let index = 2; index <= 13; index += 1) {
    const fact = available[index - 2];
    if (fact) {
      contracts.push({
        id: screenId(index),
        index,
        subjectKey: `fact:${fact.id}`,
        userQuestion: `这项“${fact.label}”对我选择有什么用？`,
        stage: "fact",
        objective: `用“${fact.label}”回答用户的一个具体选择问题；事实底稿为“${fact.value}”`,
        expectedClaimScope: fact.claimScope,
        requiredEvidenceIds: [fact.id],
        userCopyIntent: SCOPE_COPY_INTENTS[fact.claimScope]
      });
      continue;
    }

    const sceneObjective =
      SCENE_OBJECTIVES[(index - 2 - available.length) % SCENE_OBJECTIVES.length];
    contracts.push({
      id: screenId(index),
      index,
      subjectKey: `scene:${screenId(index)}`,
      userQuestion: "把它放进真实生活，我会在什么时刻用到或看见？",
      stage: "scene",
      objective: sceneObjective,
      expectedClaimScope: "creative",
      requiredEvidenceIds: [],
      userCopyIntent:
        "标题写一个用户能代入的生活瞬间；副标题补一层场景；正文写看见、拿取、摆放或使用的自然动作，不添加产品效果。"
    });
  }

  const recapFacts = summaryFacts(available);
  const recapScopes = new Set(recapFacts.map((fact) => fact.claimScope));
  contracts.push({
    id: screenId(14),
    index: 14,
    subjectKey: `summary:${
      recapFacts.map((fact) => fact.id).join("+") || "creative"
    }`,
    userQuestion: "下单前，我最该再核对哪两件事？",
    stage: "summary",
    objective:
      recapFacts.length > 1
        ? "选择前回看：用两条不同范围的已知事实帮助用户做判断"
        : "选择前回看：只回顾一条已知事实，不补充新卖点",
    expectedClaimScope:
      recapScopes.size > 1
        ? "mixed"
        : recapFacts[0]?.claimScope ?? "creative",
    requiredEvidenceIds: recapFacts.map((fact) => fact.id),
    userCopyIntent:
      "标题像替用户做一张简短检查单；副标题列出要回看的事实；正文只帮助选择，不写“全方位、满足多样需求、品质之选”。"
  });

  contracts.push({
    id: screenId(15),
    index: 15,
    subjectKey: "closing:daily-feeling",
    userQuestion: "看完以后，我应该记住怎样的日常感受？",
    stage: "closing",
    objective:
      "生活化收尾：把产品放回真实日常，用一句有温度但克制的话结束，不新增促销、服务或效果",
    expectedClaimScope: "creative",
    requiredEvidenceIds: [],
    userCopyIntent:
      "像朋友收尾，让人记住一个日常感受；不要喊购买口号，不做卖点汇总。"
  });

  return contracts;
}

/**
 * The model may describe each screen, but it is not authoritative for task
 * identity or evidence ownership. Canonicalize those fields immediately after
 * batch generation so later copy repair can safely keep them immutable.
 */
export function applyScreenContracts(
  screens: readonly DetailScreen[],
  facts: readonly EvidenceFact[]
) {
  const contractById = new Map(
    buildScreenContracts(facts).map((contract) => [contract.id, contract])
  );

  return screens
    .map((screen) => {
      const contract = contractById.get(screen.id);
      if (!contract) return screen;
      return {
        ...screen,
        index: contract.index,
        subjectKey: contract.subjectKey,
        userQuestion: contract.userQuestion,
        claimScope: contract.expectedClaimScope,
        evidenceIds: [...contract.requiredEvidenceIds]
      };
    })
    .sort((left, right) => left.index - right.index);
}

export function collectScreenContractIssues(
  screens: readonly DetailScreen[],
  facts: readonly EvidenceFact[]
) {
  return collectStructuredScreenContractIssues(screens, facts).map(
    (issue) => issue.message
  );
}

function contractIssue(input: {
  ruleCode: string;
  message: string;
  screenIds: string[];
  contract?: ScreenContract;
  allowedRepairFields?: PlanRepairField[];
}): PlanRepairIssue {
  return {
    ruleCode: input.ruleCode,
    message: input.message,
    screenIds: input.screenIds,
    scope: "screen",
    expectedClaimScope: input.contract?.expectedClaimScope,
    immutableEvidenceIds: input.contract?.requiredEvidenceIds ?? [],
    allowedRepairFields: input.allowedRepairFields ?? []
  };
}

/**
 * Returns machine-readable contract failures. Contract identity, claim scope
 * and evidence ownership are deliberately immutable during a copy repair.
 */
export function collectStructuredScreenContractIssues(
  screens: readonly DetailScreen[],
  facts: readonly EvidenceFact[]
) {
  const issues: PlanRepairIssue[] = [];
  const contracts = buildScreenContracts(facts);
  const byId = new Map(screens.map((screen) => [screen.id, screen]));

  contracts.forEach((contract) => {
    const screen = byId.get(contract.id);
    if (!screen) {
      issues.push(
        contractIssue({
          ruleCode: "PLAN_CONTRACT_SCREEN_MISSING",
          message: `${contract.id} 缺失，无法完成15屏任务契约`,
          screenIds: [contract.id],
          contract
        })
      );
      return;
    }

    if (screen.subjectKey !== contract.subjectKey) {
      issues.push(
        contractIssue({
          ruleCode: "PLAN_CONTRACT_SUBJECT_MUTATED",
          message: `${contract.id} 任务主体必须为 ${contract.subjectKey}，实际为 ${screen.subjectKey || "空"}`,
          screenIds: [contract.id],
          contract
        })
      );
    }

    if (screen.userQuestion !== contract.userQuestion) {
      issues.push(
        contractIssue({
          ruleCode: "PLAN_CONTRACT_QUESTION_MUTATED",
          message: `${contract.id} 必须回答固定用户问题“${contract.userQuestion}”`,
          screenIds: [contract.id],
          contract
        })
      );
    }

    if (screen.claimScope !== contract.expectedClaimScope) {
      issues.push(
        contractIssue({
          ruleCode: "PLAN_CONTRACT_SCOPE_MUTATED",
          message: `${contract.id} 必须执行 ${contract.expectedClaimScope} 任务，实际为 ${screen.claimScope}`,
          screenIds: [contract.id],
          contract
        })
      );
    }

    const missingEvidence = contract.requiredEvidenceIds.filter(
      (evidenceId) => !screen.evidenceIds.includes(evidenceId)
    );
    if (missingEvidence.length) {
      issues.push(
        contractIssue({
          ruleCode: "PLAN_CONTRACT_EVIDENCE_MISSING",
          message: `${contract.id} 未完成预留事实：${missingEvidence.join("、")}`,
          screenIds: [contract.id],
          contract
        })
      );
    }

    const actualEvidenceIds = new Set(screen.evidenceIds);
    if (actualEvidenceIds.size !== screen.evidenceIds.length) {
      issues.push(
        contractIssue({
          ruleCode: "PLAN_CONTRACT_EVIDENCE_DUPLICATED",
          message: `${contract.id} 重复引用同一事实`,
          screenIds: [contract.id],
          contract
        })
      );
    }
    const unexpectedEvidence = screen.evidenceIds.filter(
      (evidenceId) => !contract.requiredEvidenceIds.includes(evidenceId)
    );
    if (unexpectedEvidence.length) {
      issues.push(
        contractIssue({
          ruleCode: "PLAN_CONTRACT_EVIDENCE_UNEXPECTED",
          message:
            contract.expectedClaimScope === "creative"
              ? `${contract.id} 是生活场景任务，不应绑定产品事实`
              : `${contract.id} 混入非本屏事实：${unexpectedEvidence.join("、")}`,
          screenIds: [contract.id],
          contract
        })
      );
    }
  });

  const covered = new Set(screens.flatMap((screen) => screen.evidenceIds));
  const contractedFactIds = new Set(
    contracts.flatMap((contract) => contract.requiredEvidenceIds)
  );
  usableFacts(facts)
    .filter((fact) => contractedFactIds.has(fact.id))
    .forEach((fact) => {
    if (!covered.has(fact.id)) {
      const owner = contracts.find((contract) =>
        contract.requiredEvidenceIds.includes(fact.id)
      );
      issues.push(
        contractIssue({
          ruleCode: "PLAN_CONTRACT_FACT_UNCOVERED",
          message: `screen-02 至 screen-14 未覆盖甲方事实 ${fact.id}（${fact.label}）`,
          screenIds: owner ? [owner.id] : screens.map((screen) => screen.id),
          contract: owner,
          allowedRepairFields: SCREEN_COPY_FIELDS
        })
      );
    }
    });

  return issues;
}
