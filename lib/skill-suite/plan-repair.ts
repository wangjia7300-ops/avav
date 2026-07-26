import type { DetailScreen } from "@/lib/types";

export type PlanRepairScope = "foundation" | "screen" | "cross-screen";

export type PlanRepairField =
  | "role"
  | "conversionTask"
  | "primarySellingPoint"
  | "proofMethod"
  | "copy.headline"
  | "copy.subheadline"
  | "copy.body"
  | "copy.keyPoints"
  | "scene"
  | "shot"
  | "composition"
  | "transition";

export type PlanRepairIssue = {
  ruleCode: string;
  message: string;
  screenIds: string[];
  relatedScreenIds?: string[];
  scope: PlanRepairScope;
  path?: string;
  matchedPhrase?: string;
  expectedClaimScope?: DetailScreen["claimScope"];
  immutableEvidenceIds?: string[];
  allowedRepairFields: PlanRepairField[];
};

const MUTABLE_FIELDS: readonly PlanRepairField[] = [
  "role",
  "conversionTask",
  "primarySellingPoint",
  "proofMethod",
  "copy.headline",
  "copy.subheadline",
  "copy.body",
  "copy.keyPoints",
  "scene",
  "shot",
  "composition",
  "transition"
];

export class PlanRepairContractError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "PLAN_REPAIR_INVALID"
      | "PLAN_REPAIR_CONTRACT_MUTATION",
    public readonly details: string[] = []
  ) {
    super(message);
    this.name = "PlanRepairContractError";
  }
}

function stableUnique(values: readonly string[]) {
  return Array.from(new Set(values)).sort();
}

export function planIssueFingerprint(issues: readonly PlanRepairIssue[]) {
  return stableUnique(
    issues.map((issue) =>
      [
        issue.ruleCode,
        stableUnique(issue.screenIds).join(","),
        issue.path ?? "",
        issue.matchedPhrase ?? ""
      ].join("|")
    )
  ).join("::");
}

export function selectPlanRepairTargetIds(
  issues: readonly PlanRepairIssue[],
  screens: readonly DetailScreen[]
) {
  const knownIds = new Set(screens.map((screen) => screen.id));
  const explicit = stableUnique(
    issues.flatMap((issue) => issue.screenIds).filter((id) => knownIds.has(id))
  );
  return explicit.length > 0 ? explicit : screens.map((screen) => screen.id);
}

export function allowedRepairFieldsByScreen(
  issues: readonly PlanRepairIssue[],
  targetIds: readonly string[]
) {
  return new Map(
    targetIds.map((screenId) => {
      const matchingIssues = issues.filter((issue) =>
        issue.screenIds.includes(screenId)
      );
      const fields = stableUnique(
        matchingIssues.flatMap((issue) => issue.allowedRepairFields)
      ) as PlanRepairField[];
      return [
        screenId,
        matchingIssues.length > 0 ? fields : [...MUTABLE_FIELDS]
      ] as const;
    })
  );
}

function changedMutableFields(
  original: DetailScreen,
  repaired: DetailScreen
): PlanRepairField[] {
  const changed: PlanRepairField[] = [];
  const compare = (field: PlanRepairField, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) changed.push(field);
  };

  compare("role", original.role, repaired.role);
  compare("conversionTask", original.conversionTask, repaired.conversionTask);
  compare(
    "primarySellingPoint",
    original.primarySellingPoint,
    repaired.primarySellingPoint
  );
  compare("proofMethod", original.proofMethod, repaired.proofMethod);
  compare("copy.headline", original.copy.headline, repaired.copy.headline);
  compare(
    "copy.subheadline",
    original.copy.subheadline,
    repaired.copy.subheadline
  );
  compare("copy.body", original.copy.body, repaired.copy.body);
  compare("copy.keyPoints", original.copy.keyPoints, repaired.copy.keyPoints);
  compare("scene", original.scene, repaired.scene);
  compare("shot", original.shot, repaired.shot);
  compare("composition", original.composition, repaired.composition);
  compare("transition", original.transition, repaired.transition);
  return changed;
}

function isDetailScreen(value: unknown): value is DetailScreen {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parsePlanningRepairPayload(input: {
  payload: unknown;
  targetIds: readonly string[];
  originalScreens: readonly DetailScreen[];
  issues: readonly PlanRepairIssue[];
}) {
  if (
    !input.payload ||
    typeof input.payload !== "object" ||
    Array.isArray(input.payload) ||
    !Array.isArray((input.payload as { screens?: unknown }).screens)
  ) {
    throw new PlanRepairContractError(
      "策划修正结果缺少 screens 数组。",
      "PLAN_REPAIR_INVALID"
    );
  }

  const screens = (input.payload as { screens: unknown[] }).screens;
  if (!screens.every(isDetailScreen)) {
    throw new PlanRepairContractError(
      "策划修正包含无效屏幕对象。",
      "PLAN_REPAIR_INVALID"
    );
  }

  const targetIds = stableUnique(input.targetIds);
  const actualIds = screens.map((screen) => screen.id);
  const uniqueActualIds = stableUnique(actualIds);
  const missingIds = targetIds.filter((id) => !uniqueActualIds.includes(id));
  const extraIds = uniqueActualIds.filter((id) => !targetIds.includes(id));
  if (
    screens.length !== targetIds.length ||
    uniqueActualIds.length !== screens.length ||
    missingIds.length > 0 ||
    extraIds.length > 0
  ) {
    throw new PlanRepairContractError(
      "策划修正没有严格返回目标冲突屏。",
      "PLAN_REPAIR_INVALID",
      [
        `目标：${targetIds.join("、")}`,
        `缺失：${missingIds.join("、") || "无"}`,
        `越界：${extraIds.join("、") || "无"}`
      ]
    );
  }

  const originalById = new Map(
    input.originalScreens.map((screen) => [screen.id, screen])
  );
  const allowedById = allowedRepairFieldsByScreen(input.issues, targetIds);

  screens.forEach((screen) => {
    const original = originalById.get(screen.id);
    if (!original) {
      throw new PlanRepairContractError(
        `${screen.id} 不属于被拒策划。`,
        "PLAN_REPAIR_INVALID"
      );
    }

    const immutableChanged =
      screen.id !== original.id ||
      screen.index !== original.index ||
      screen.subjectKey !== original.subjectKey ||
      screen.userQuestion !== original.userQuestion ||
      screen.claimScope !== original.claimScope ||
      JSON.stringify(screen.evidenceIds) !==
        JSON.stringify(original.evidenceIds);
    if (immutableChanged) {
      throw new PlanRepairContractError(
        `${screen.id} 擅自修改了任务主体、claimScope 或 evidenceIds。`,
        "PLAN_REPAIR_CONTRACT_MUTATION",
        [
          "id、index、subjectKey、userQuestion、claimScope、evidenceIds 在修复阶段不可修改。"
        ]
      );
    }

    const allowed = new Set(allowedById.get(screen.id) ?? MUTABLE_FIELDS);
    const illegalChanges = changedMutableFields(original, screen).filter(
      (field) => !allowed.has(field)
    );
    if (illegalChanges.length > 0) {
      throw new PlanRepairContractError(
        `${screen.id} 修改了未授权字段。`,
        "PLAN_REPAIR_CONTRACT_MUTATION",
        illegalChanges
      );
    }
  });

  return [...screens].sort((left, right) => left.index - right.index);
}
