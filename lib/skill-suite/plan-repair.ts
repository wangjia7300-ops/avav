import type { DetailScreen } from "@/lib/types";

type PlanRepairScope = "foundation" | "screen" | "cross-screen";

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
  return explicit;
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
        matchingIssues.length > 0 ? fields : []
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function repairFieldMaxLength(field: PlanRepairField) {
  switch (field) {
    case "copy.headline":
      return 20;
    case "copy.subheadline":
      return 40;
    case "copy.body":
      return 100;
    case "role":
      return 30;
    case "conversionTask":
    case "primarySellingPoint":
    case "shot":
      return 80;
    case "proofMethod":
    case "scene":
    case "transition":
      return 160;
    case "composition":
      return 240;
    case "copy.keyPoints":
      return 30;
  }
}

function assertSafeRepairText(
  field: PlanRepairField,
  value: string,
  maxLength = repairFieldMaxLength(field)
) {
  if (Array.from(value).length > maxLength) {
    throw new PlanRepairContractError(
      `${field} 长度超过${maxLength}个字符。`,
      "PLAN_REPAIR_INVALID"
    );
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new PlanRepairContractError(
      `${field} 含不可见控制字符。`,
      "PLAN_REPAIR_INVALID"
    );
  }
  if (/<\/?[a-z][^>]*>/iu.test(value)) {
    throw new PlanRepairContractError(
      `${field} 不得包含 HTML。`,
      "PLAN_REPAIR_INVALID"
    );
  }
}

export function buildPlanningRepairPatchSchema(
  targetId: string,
  allowedFields: readonly PlanRepairField[]
) {
  // OpenAI-compatible strict schemas require every declared property to be
  // listed in `required`. Nullable placeholders let the model leave an
  // authorized field unchanged without weakening additionalProperties=false.
  const sortedAllowedFields = stableUnique(allowedFields) as PlanRepairField[];
  const fieldSchemas = Object.fromEntries(
    sortedAllowedFields.map((field) => [
      field,
      field === "copy.keyPoints"
        ? {
            anyOf: [
              {
                type: "array",
                minItems: 1,
                maxItems: 3,
                items: { type: "string", minLength: 1, maxLength: 30 }
              },
              { type: "null" }
            ]
          }
        : {
            anyOf: [
              {
                type: "string",
                minLength: 1,
                maxLength: repairFieldMaxLength(field)
              },
              { type: "null" }
            ]
          }
    ])
  );

  return {
    type: "object",
    additionalProperties: false,
    required: ["screenId", "changes"],
    properties: {
      screenId: { type: "string", const: targetId },
      changes: {
        type: "object",
        additionalProperties: false,
        required: sortedAllowedFields,
        properties: fieldSchemas
      }
    }
  };
}

function applyRepairField(
  screen: DetailScreen,
  field: PlanRepairField,
  value: unknown
) {
  if (field === "copy.keyPoints") {
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.length > 3 ||
      !value.every(isNonEmptyString)
    ) {
      throw new PlanRepairContractError(
        `${field} 必须是1到3条非空短要点。`,
        "PLAN_REPAIR_INVALID"
      );
    }
    value.forEach((item) =>
      assertSafeRepairText("copy.keyPoints", item, 30)
    );
    screen.copy.keyPoints = [...value];
    return;
  }

  if (!isNonEmptyString(value)) {
    throw new PlanRepairContractError(
      `${field} 必须是非空文本。`,
      "PLAN_REPAIR_INVALID"
    );
  }
  assertSafeRepairText(field, value);

  switch (field) {
    case "role":
      screen.role = value;
      break;
    case "conversionTask":
      screen.conversionTask = value;
      break;
    case "primarySellingPoint":
      screen.primarySellingPoint = value;
      break;
    case "proofMethod":
      screen.proofMethod = value;
      break;
    case "copy.headline":
      screen.copy.headline = value;
      break;
    case "copy.subheadline":
      screen.copy.subheadline = value;
      break;
    case "copy.body":
      screen.copy.body = value;
      break;
    case "scene":
      screen.scene = value;
      break;
    case "shot":
      screen.shot = value;
      break;
    case "composition":
      screen.composition = value;
      break;
    case "transition":
      screen.transition = value;
      break;
  }
}

/**
 * 单屏修复只接受授权字段 patch。模型不再回传 id 以外的任务
 * 主体、证据或 claimScope，因此这些不可变字段从数据结构上
 * 就不存在被误改的通道。
 */
export function parsePlanningRepairPatchPayload(input: {
  payload: unknown;
  targetId: string;
  originalScreens: readonly DetailScreen[];
  issues: readonly PlanRepairIssue[];
}) {
  if (!isRecord(input.payload)) {
    throw new PlanRepairContractError(
      "策划修复 patch 必须是 JSON 对象。",
      "PLAN_REPAIR_INVALID"
    );
  }
  const rootKeys = Object.keys(input.payload);
  const illegalRootKeys = rootKeys.filter(
    (key) => key !== "screenId" && key !== "changes"
  );
  if (
    input.payload.screenId !== input.targetId ||
    illegalRootKeys.length > 0 ||
    !isRecord(input.payload.changes)
  ) {
    throw new PlanRepairContractError(
      "策划修复 patch 越界、串屏或结构无效。",
      "PLAN_REPAIR_INVALID",
      [
        `目标：${input.targetId}`,
        `实际：${String(input.payload.screenId ?? "空")}`,
        `越界根字段：${illegalRootKeys.join("、") || "无"}`
      ]
    );
  }

  const original = input.originalScreens.find(
    (screen) => screen.id === input.targetId
  );
  if (!original) {
    throw new PlanRepairContractError(
      `${input.targetId} 不属于被拒策划。`,
      "PLAN_REPAIR_INVALID"
    );
  }
  const allowed = new Set(
    allowedRepairFieldsByScreen(input.issues, [input.targetId]).get(
      input.targetId
    ) ?? []
  );
  if (allowed.size === 0) {
    throw new PlanRepairContractError(
      `${input.targetId} 没有可执行的字段修复授权。`,
      "PLAN_REPAIR_INVALID"
    );
  }

  const rawChangeEntries = Object.entries(input.payload.changes);
  if (rawChangeEntries.length === 0) {
    throw new PlanRepairContractError(
      `${input.targetId} 返回了空修复 patch。`,
      "PLAN_REPAIR_INVALID"
    );
  }
  const illegalFields = rawChangeEntries
    .map(([field]) => field)
    .filter((field) => !allowed.has(field as PlanRepairField));
  if (illegalFields.length > 0) {
    throw new PlanRepairContractError(
      `${input.targetId} 修改了未授权字段。`,
      "PLAN_REPAIR_CONTRACT_MUTATION",
      illegalFields
    );
  }

  // Strict-schema callers return every authorized key. `null` means that key
  // is intentionally unchanged; at least one non-null change is still
  // required. Legacy/non-schema providers may omit untouched keys.
  const changeEntries = rawChangeEntries.filter(([, value]) => value !== null);
  if (changeEntries.length === 0) {
    throw new PlanRepairContractError(
      `${input.targetId} 返回了空修复 patch。`,
      "PLAN_REPAIR_INVALID"
    );
  }

  const repaired: DetailScreen = {
    ...original,
    copy: {
      ...original.copy,
      keyPoints: [...original.copy.keyPoints]
    }
  };
  changeEntries.forEach(([field, value]) => {
    applyRepairField(repaired, field as PlanRepairField, value);
  });
  if (changedMutableFields(original, repaired).length === 0) {
    throw new PlanRepairContractError(
      `${input.targetId} 的修复 patch 没有产生任何实际变化。`,
      "PLAN_REPAIR_INVALID"
    );
  }

  return repaired;
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

    const allowed = new Set(allowedById.get(screen.id) ?? []);
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
