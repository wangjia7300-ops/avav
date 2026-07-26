import type {
  DetailPlan,
  DetailPlanFoundation,
  DetailScreen,
  EvidenceClaimScope,
  EvidenceFact,
  ProductResearch,
  QAReport,
  QAFinding,
  ScreenCopy,
  ScreenExecution
} from "@/lib/types";
import {
  APPROVED_COPY_BEGIN,
  APPROVED_COPY_END,
  compileScreenImagePrompt
} from "@/lib/skill-suite/prompts";
import { checkCopyQuality } from "@/lib/skill-suite/copy-quality";
import { findClaimGuardIssues } from "@/lib/skill-suite/claim-guard";
import {
  collectScreenContractIssues,
  collectStructuredScreenContractIssues
} from "@/lib/skill-suite/screen-contracts";
import {
  collectResearchStructureIssues
} from "@/lib/skill-suite/research-normalization";
import type {
  PlanRepairField,
  PlanRepairIssue
} from "@/lib/skill-suite/plan-repair";

export class SkillSuiteValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: string[] = [],
    public readonly planIssues: PlanRepairIssue[] = [],
    public readonly meta?: Record<string, unknown>,
    public readonly partialData?: unknown
  ) {
    super(message);
    this.name = "SkillSuiteValidationError";
  }
}

const ALL_PLAN_REPAIR_FIELDS: PlanRepairField[] = [
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

const COPY_PLAN_REPAIR_FIELDS: PlanRepairField[] = [
  "primarySellingPoint",
  "copy.headline",
  "copy.subheadline",
  "copy.body",
  "copy.keyPoints"
];

function repairFieldFromPath(path: string): PlanRepairField[] {
  if (/primarySellingPoint/u.test(path)) return ["primarySellingPoint"];
  if (/copy\.headline/u.test(path)) return ["copy.headline"];
  if (/copy\.subheadline/u.test(path)) return ["copy.subheadline"];
  if (/copy\.body/u.test(path)) return ["copy.body"];
  if (/copy\.(?:keyPoints|keyPoints\.)/u.test(path)) {
    return ["copy.keyPoints"];
  }
  return [...COPY_PLAN_REPAIR_FIELDS];
}

export function extractJsonObject<T>(text: string): T {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new SkillSuiteValidationError(
      "模型没有返回可解析的 JSON，未写入任何兜底业务数据。",
      "MODEL_JSON_INVALID"
    );
  }

  // 语义是“提取 JSON 对象”：裸数组、null、标量都不是合法的业务载荷。
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SkillSuiteValidationError(
      "模型没有返回可解析的 JSON，未写入任何兜底业务数据。",
      "MODEL_JSON_INVALID"
    );
  }

  return parsed as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function stringArray(value: unknown, minimum = 0): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.every((item) => typeof item === "string" && Boolean(item.trim()))
  );
}

function normalizedCopy(value: string) {
  return value.replace(/[\s，。；、：！？,.!?:;\-—_]/g, "").toLowerCase();
}

function characterBigrams(value: string) {
  const normalized = normalizedCopy(value);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function bigramSimilarity(left: string, right: string) {
  const leftGrams = characterBigrams(left);
  const rightGrams = characterBigrams(right);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let intersection = 0;
  leftGrams.forEach((gram) => {
    if (rightGrams.has(gram)) intersection += 1;
  });
  return intersection / (leftGrams.size + rightGrams.size - intersection);
}

function longestCommonSubstringLength(left: string, right: string) {
  const normalizedLeft = normalizedCopy(left);
  const normalizedRight = normalizedCopy(right);
  const previous = new Array<number>(normalizedRight.length + 1).fill(0);
  let longest = 0;
  for (let leftIndex = 1; leftIndex <= normalizedLeft.length; leftIndex += 1) {
    const current = new Array<number>(normalizedRight.length + 1).fill(0);
    for (
      let rightIndex = 1;
      rightIndex <= normalizedRight.length;
      rightIndex += 1
    ) {
      if (
        normalizedLeft[leftIndex - 1] === normalizedRight[rightIndex - 1]
      ) {
        current[rightIndex] = previous[rightIndex - 1] + 1;
        longest = Math.max(longest, current[rightIndex]);
      }
    }
    previous.splice(0, previous.length, ...current);
  }
  return longest;
}

function sceneFamily(scene: string) {
  const families: Array<[string, string[]]> = [
    ["卧室", ["卧室", "床边", "床头", "飘窗"]],
    ["客厅", ["客厅", "沙发", "茶几"]],
    ["办公", ["书房", "办公", "书桌"]],
    ["玄关", ["玄关", "鞋柜", "入户"]],
    ["阳台", ["阳台"]],
    ["衣帽间", ["衣帽间", "衣柜"]],
    ["浴室", ["浴室", "洗手间"]],
    ["厨房", ["厨房"]]
  ];
  return families.find(([, keywords]) =>
    keywords.some((keyword) => scene.includes(keyword))
  )?.[0];
}

const FACT_CLAIM_SCOPES = new Set<EvidenceClaimScope>([
  "appearance",
  "visible_text",
  "specification",
  "material",
  "performance",
  "mechanism",
  "service",
  "promotion"
]);

const CLAIM_SCOPE_PATTERNS: Array<[EvidenceClaimScope, RegExp]> = [
  [
    "specification",
    /(?:\d+(?:\.\d+)?\s*(?:cm|mm|kg|g|ml|l|w|v|hz|mah|小时|分钟|天|年级|码|%|％|℃|°c|摄氏度))|(?:\d+(?:\.\d+)?\s*度(?:调节|旋转|摆动|送风))|(?:尺寸|容量|重量|功率|电压|频率|型号)/i
  ],
  [
    "material",
    /(?:羊毛|羊绒|纯棉|棉质|真皮|皮革|不锈钢|硅胶|陶瓷|羽绒|绒毛|毛绒|加绒|绒里|EVA|PVC|ABS|(?:面料|材质)(?:为|是|采用|使用)|内胆)/i
  ],
  [
    "performance",
    /(?:保暖|保温|锁温|保冷|温暖|暖意|暖感|暖和|御寒|暖脚|蓄热|柔软|舒适|亲肤|轻盈|防滑|防水|防泼水|耐磨|轻量|减重|缓震|支撑|抗菌|除臭|透气|隔热|防漏|密封|抗撕|耐撕|耐用|承重|护脊|减压|安全|不易|持久|持续)/i
  ],
  [
    "mechanism",
    /(?:原理|结构实现|通过.+(?:达到|实现)|发热|制冷|循环|过滤|减震结构|锁温层|导流|回弹)/i
  ],
  [
    "service",
    /(?:售后|质保|保修|退换|客服|服务承诺|包装|礼盒|配件|清单|包邮)/i
  ],
  [
    "promotion",
    /(?:到手价|直降|优惠|赠品|限时|限量|折扣|满减|活动价|原价|促销)/i
  ]
];

const NO_TEXT_PATTERN =
  /\btext[- ]?free\b|\bno rendered text\b|\bwithout (?:any )?text\b|无文字(?:底图|画面)?|不要(?:任何)?文字|后期(?:再)?排(?:版|文字)/i;

function countOccurrences(value: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = value.indexOf(needle, cursor)) >= 0) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function screenCopyFields(copy: ScreenCopy) {
  return [
    ["标题", copy.headline],
    ["副标题", copy.subheadline],
    ["正文", copy.body],
    ...copy.keyPoints.map((item, index) => [`要点${index + 1}`, item] as const)
  ] as const;
}

function copyEquals(left: ScreenCopy, right: ScreenCopy) {
  return (
    left.headline === right.headline &&
    left.subheadline === right.subheadline &&
    left.body === right.body &&
    left.keyPoints.length === right.keyPoints.length &&
    left.keyPoints.every((item, index) => item === right.keyPoints[index])
  );
}

function screenClaimText(screen: Pick<DetailScreen, "primarySellingPoint" | "copy">) {
  return [
    screen.primarySellingPoint,
    screen.copy.headline,
    screen.copy.subheadline,
    screen.copy.body,
    ...screen.copy.keyPoints
  ].join("\n");
}

function detectedClaimMatches(
  screen: Pick<DetailScreen, "primarySellingPoint" | "copy">
) {
  const text = screenClaimText(screen);
  return CLAIM_SCOPE_PATTERNS.flatMap(([scope, pattern]) => {
    const match = pattern.exec(text)?.[0];
    return match ? [{ scope, match }] : [];
  });
}

function evidenceIssuesForScreen(
  screen: DetailScreen,
  factById: ReadonlyMap<string, EvidenceFact>
) {
  const issues: string[] = [];
  const detectedMatches = detectedClaimMatches(screen);
  const detectedScopes = detectedMatches.map((item) => item.scope);

  if (screen.claimScope === "creative") {
    if (screen.evidenceIds.length) {
      issues.push("creative 屏不应伪装引用产品事实");
    }
    if (detectedScopes.length) {
      issues.push(
        `creative 屏出现未授权产品声明：${detectedMatches
          .map((item) => `${item.scope}（命中“${item.match}”）`)
          .join("、")}`
      );
    }
    return issues;
  }

  if (screen.claimScope === "mixed") {
    if (screen.evidenceIds.length < 2) {
      issues.push("mixed 屏至少需要2个 evidenceId");
      return issues;
    }
    const citedScopes = new Set<EvidenceClaimScope>();
    screen.evidenceIds.forEach((evidenceId) => {
      const fact = factById.get(evidenceId);
      if (!fact) {
        issues.push(`引用了不存在的证据 ${evidenceId}`);
        return;
      }
      if (!fact.commercialUse || fact.status === "blocked") {
        issues.push(`引用了未授权或已阻断声明 ${evidenceId}`);
      }
      citedScopes.add(fact.claimScope);
    });
    if (citedScopes.size < 2) {
      issues.push("mixed 屏引用的事实范围不足2种");
    }
    detectedMatches.forEach(({ scope, match }) => {
      if (!citedScopes.has(scope)) {
        issues.push(`mixed 屏的 ${scope} 声明“${match}”缺少同范围证据`);
      }
    });
    return issues;
  }

  if (!FACT_CLAIM_SCOPES.has(screen.claimScope)) {
    issues.push("claimScope 无效");
    return issues;
  }
  if (!screen.evidenceIds.length) {
    issues.push(`${screen.claimScope} 声明缺少 evidenceId`);
  }

  screen.evidenceIds.forEach((evidenceId) => {
    const fact = factById.get(evidenceId);
    if (!fact) {
      issues.push(`引用了不存在的证据 ${evidenceId}`);
      return;
    }
    if (!fact.commercialUse || fact.status === "blocked") {
      issues.push(`引用了未授权或已阻断声明 ${evidenceId}`);
    }
    if (fact.claimScope !== screen.claimScope) {
      issues.push(
        `${evidenceId} 的范围为 ${fact.claimScope}，不能支撑 ${screen.claimScope}`
      );
    }
  });

  const incompatibleScopes = detectedScopes.filter(
    (scope) => scope !== screen.claimScope
  );
  if (incompatibleScopes.length) {
    const incompatibleMatches = detectedMatches.filter((item) =>
      incompatibleScopes.includes(item.scope)
    );
    issues.push(
      `文案出现与 claimScope 不一致的声明：${incompatibleMatches
        .map((item) => `${item.scope}（命中“${item.match}”）`)
        .join("、")}`
    );
  }
  return issues;
}

function copyOverlapIssues(copy: ScreenCopy) {
  const fields = screenCopyFields(copy)
    .map(([label, value]) => [label, normalizedCopy(value)] as const)
    .filter(([, value]) => value.length >= 4);
  const issues: string[] = [];
  for (let left = 0; left < fields.length; left += 1) {
    for (let right = left + 1; right < fields.length; right += 1) {
      const [leftLabel, leftValue] = fields[left];
      const [rightLabel, rightValue] = fields[right];
      if (leftValue === rightValue) {
        issues.push(`${leftLabel}与${rightLabel}完全重复`);
      }
    }
  }
  return issues;
}

export function assertResearch(value: unknown): asserts value is ProductResearch {
  const structureIssues = collectResearchStructureIssues(value);
  if (structureIssues.length) {
    throw new SkillSuiteValidationError(
      "图研结果未通过生产结构校验。",
      "RESEARCH_SCHEMA_INVALID",
      structureIssues.map(
        (issue) => `${issue.path} [${issue.code}] ${issue.message}`
      )
    );
  }

  if (!isRecord(value)) {
    throw new SkillSuiteValidationError("图研结果不是对象。", "RESEARCH_SCHEMA_INVALID");
  }

  const facts = Array.isArray(value.facts) ? value.facts : [];
  const dimensions = Array.isArray(value.visualAudit) ? value.visualAudit : [];
  const allowedDimensions = new Set([
    "composition",
    "sellingHierarchy",
    "color",
    "typography",
    "visualPath",
    "material",
    "algorithmFit",
    "emotion"
  ]);
  const factIds = new Set<string>();
  const allowedSourceTypes = new Set([
    "visual_observation",
    "image_text",
    "user_input",
    "model_inference"
  ]);
  const allowedEntityTypes = new Set([
    "product",
    "brand",
    "decorative_badge",
    "specification",
    "feature",
    "material",
    "other"
  ]);

  const factFingerprints = new Set<string>();
  const factsValid =
    facts.length >= 6 &&
    facts.length <= 12 &&
    facts.every((fact) => {
      if (
        !isRecord(fact) ||
        !nonEmpty(fact.id) ||
        !nonEmpty(fact.label) ||
        !nonEmpty(fact.value) ||
        !nonEmpty(fact.evidence) ||
        !stringArray(fact.sourceAssetIds) ||
        !allowedSourceTypes.has(String(fact.sourceType)) ||
        !FACT_CLAIM_SCOPES.has(fact.claimScope as EvidenceClaimScope) ||
        !allowedEntityTypes.has(String(fact.entityType)) ||
        typeof fact.ocrConfidence !== "number" ||
        fact.ocrConfidence < 0 ||
        fact.ocrConfidence > 1 ||
        !["verified", "candidate", "blocked"].includes(String(fact.status)) ||
        typeof fact.commercialUse !== "boolean"
      ) {
        return false;
      }
      if (fact.status === "blocked" && fact.commercialUse) return false;
      if (fact.sourceType === "model_inference" && fact.commercialUse) return false;
      if (fact.entityType === "brand" && fact.sourceType !== "image_text") return false;
      if (factIds.has(fact.id)) return false;
      const fingerprint = normalizedCopy(`${fact.label}${fact.value}`);
      if (factFingerprints.has(fingerprint)) return false;
      factIds.add(fact.id);
      factFingerprints.add(fingerprint);
      return true;
    });

  const dimensionKeys = new Set<string>();
  const dimensionsValid =
    dimensions.length === 8 &&
    dimensions.every((dimension) => {
      if (
        !isRecord(dimension) ||
        !allowedDimensions.has(String(dimension.key)) ||
        !nonEmpty(dimension.title) ||
        !nonEmpty(dimension.finding) ||
        !nonEmpty(dimension.recommendation)
      ) {
        return false;
      }
      dimensionKeys.add(String(dimension.key));
      return true;
    }) &&
    dimensionKeys.size === 8;

  if (
    !nonEmpty(value.productName) ||
    !nonEmpty(value.category) ||
    !nonEmpty(value.brand) ||
    !nonEmpty(value.summary) ||
    !factsValid ||
    !dimensionsValid ||
    !stringArray(value.visualKeywords, 3) ||
    !stringArray(value.risks)
  ) {
    throw new SkillSuiteValidationError(
      "图研结果缺少产品事实、八维视觉审计或风险字段。",
      "RESEARCH_SCHEMA_INVALID"
    );
  }
}

export function assertPlanningFoundation(
  value: unknown,
  facts: readonly EvidenceFact[] = []
): asserts value is DetailPlanFoundation {
  const issues: string[] = [];
  if (
    !isRecord(value) ||
    !nonEmpty(value.productPositioning) ||
    !stringArray(value.coreSellingPoints, 2) ||
    value.coreSellingPoints.length > 6 ||
    !Array.isArray(value.personas) ||
    value.personas.length < 2 ||
    !value.personas.every(
      (persona) =>
        isRecord(persona) &&
        nonEmpty(persona.name) &&
        nonEmpty(persona.context) &&
        nonEmpty(persona.pain) &&
        nonEmpty(persona.decisionTrigger)
    ) ||
    !stringArray(value.decisionChain, 3) ||
    !nonEmpty(value.globalVisualDirection)
  ) {
    issues.push("缺少定位、卖点、人群、决策链或视觉方向");
  }

  if (isRecord(value)) {
    const foundationText = [
      value.productPositioning,
      ...(Array.isArray(value.coreSellingPoints)
        ? value.coreSellingPoints
        : []),
      ...(Array.isArray(value.decisionChain) ? value.decisionChain : [])
    ]
      .filter((item): item is string => typeof item === "string")
      .join("\n");
    const supportedScopes = new Set(
      facts
        .filter((fact) => fact.commercialUse && fact.status !== "blocked")
        .map((fact) => fact.claimScope)
    );
    CLAIM_SCOPE_PATTERNS.forEach(([scope, pattern]) => {
      const match = pattern.exec(foundationText)?.[0];
      if (match && !supportedScopes.has(scope)) {
        issues.push(
          `策略骨架出现无同范围事实支撑的 ${scope} 声明（命中“${match}”）`
        );
      }
    });
  }

  if (issues.length > 0) {
    throw new SkillSuiteValidationError(
      "策划策略骨架未通过证据校验。",
      "PLAN_FOUNDATION_INVALID",
      issues
    );
  }
}

export function assertPlan(
  value: unknown,
  facts: readonly EvidenceFact[]
): asserts value is DetailPlan {
  if (!isRecord(value)) {
    throw new SkillSuiteValidationError("策划结果不是对象。", "PLAN_SCHEMA_INVALID");
  }
  const foundationCandidate: unknown = value;
  assertPlanningFoundation(foundationCandidate, facts);

  const screens = Array.isArray(value.screens) ? value.screens : [];
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const issues: string[] = [];
  const planIssues: PlanRepairIssue[] = [];
  const ids = new Set<string>();
  const headlines = new Set<string>();

  if (screens.length !== 15) {
    issues.push(`应为15屏，实际为${screens.length}屏`);
  }

  const contractIssues = collectStructuredScreenContractIssues(
    screens.filter(
      (screen): screen is DetailScreen =>
        isRecord(screen) &&
        isRecord(screen.copy) &&
        stringArray(screen.copy.keyPoints, 1)
    ),
    facts
  );
  contractIssues.forEach((issue) => {
    issues.push(issue.message);
    planIssues.push(issue);
  });

  screens.forEach((screen, position) => {
    if (!isRecord(screen)) {
      issues.push(`第${position + 1}屏结构无效`);
      return;
    }

    const expectedIndex = position + 1;
    const expectedId = `screen-${String(expectedIndex).padStart(2, "0")}`;
    if (screen.index !== expectedIndex || screen.id !== expectedId) {
      issues.push(`第${expectedIndex}屏索引或 screenId 不连续`);
    }
    if (ids.has(String(screen.id))) issues.push(`${expectedId} 重复`);
    ids.add(String(screen.id));

    if (
      !nonEmpty(screen.role) ||
      !nonEmpty(screen.conversionTask) ||
      !nonEmpty(screen.primarySellingPoint) ||
      !(
        screen.claimScope === "creative" ||
        screen.claimScope === "mixed" ||
        FACT_CLAIM_SCOPES.has(screen.claimScope as EvidenceClaimScope)
      ) ||
      !nonEmpty(screen.proofMethod) ||
      !nonEmpty(screen.scene) ||
      !nonEmpty(screen.shot) ||
      !nonEmpty(screen.composition) ||
      !nonEmpty(screen.transition)
    ) {
      issues.push(`${expectedId} 缺少页面任务或视觉差异字段`);
      planIssues.push({
        ruleCode: "PLAN_SCREEN_FIELDS_MISSING",
        message: `${expectedId} 缺少页面任务或视觉差异字段`,
        screenIds: [expectedId],
        scope: "screen",
        path: `screens[${position}]`,
        allowedRepairFields: [...ALL_PLAN_REPAIR_FIELDS]
      });
    }

    if (
      !nonEmpty(screen.composition) ||
      !/(?:9\s*:\s*16|9\s*：\s*16)/u.test(screen.composition)
    ) {
      issues.push(`${expectedId} 必须声明9:16竖版构图`);
      planIssues.push({
        ruleCode: "PLAN_RATIO_MISSING",
        message: `${expectedId} 必须声明9:16竖版构图`,
        screenIds: [expectedId],
        scope: "screen",
        path: `screens[${position}].composition`,
        allowedRepairFields: ["composition"]
      });
    }

    const screenTaskText = [
      screen.role,
      screen.conversionTask,
      screen.primarySellingPoint,
      screen.scene,
      screen.shot,
      screen.composition
    ]
      .filter((item): item is string => typeof item === "string")
      .join("\n");
    if (
      /(?:主图|1\s*:\s*1|1\s*：\s*1|(?<!甲)方图)/u.test(screenTaskText)
    ) {
      issues.push(`${expectedId} 混入主图或方图任务；当前只允许详情页提示词`);
      planIssues.push({
        ruleCode: "PLAN_MAIN_IMAGE_TASK_FORBIDDEN",
        message: `${expectedId} 混入主图或方图任务；当前只允许详情页提示词`,
        screenIds: [expectedId],
        scope: "screen",
        path: `screens[${position}]`,
        allowedRepairFields: [
          "role",
          "conversionTask",
          "primarySellingPoint",
          "scene",
          "shot",
          "composition"
        ]
      });
    }

    if (!isRecord(screen.copy)) {
      issues.push(`${expectedId} 缺少画面文案`);
    } else {
      const headline = nonEmpty(screen.copy.headline) ? normalizedCopy(screen.copy.headline) : "";
      if (!headline || !nonEmpty(screen.copy.subheadline) || !nonEmpty(screen.copy.body)) {
        issues.push(`${expectedId} 文案字段不完整`);
        planIssues.push({
          ruleCode: "PLAN_COPY_FIELDS_MISSING",
          message: `${expectedId} 文案字段不完整`,
          screenIds: [expectedId],
          scope: "screen",
          path: `screens[${position}].copy`,
          allowedRepairFields: [...COPY_PLAN_REPAIR_FIELDS]
        });
      }
      if (headlines.has(headline)) {
        issues.push(`${expectedId} 标题重复`);
        planIssues.push({
          ruleCode: "PLAN_HEADLINE_DUPLICATED",
          message: `${expectedId} 标题重复`,
          screenIds: [expectedId],
          scope: "cross-screen",
          path: `screens[${position}].copy.headline`,
          matchedPhrase: String(screen.copy.headline ?? ""),
          allowedRepairFields: ["copy.headline"]
        });
      }
      headlines.add(headline);
      if (!stringArray(screen.copy.keyPoints, 1)) {
        issues.push(`${expectedId} 缺少要点文案`);
        planIssues.push({
          ruleCode: "PLAN_KEY_POINTS_MISSING",
          message: `${expectedId} 缺少要点文案`,
          screenIds: [expectedId],
          scope: "screen",
          path: `screens[${position}].copy.keyPoints`,
          allowedRepairFields: ["copy.keyPoints"]
        });
      } else if (
        nonEmpty(screen.copy.headline) &&
        nonEmpty(screen.copy.subheadline) &&
        nonEmpty(screen.copy.body)
      ) {
        copyOverlapIssues(screen.copy as ScreenCopy).forEach((issue) => {
          issues.push(`${expectedId} ${issue}`);
          planIssues.push({
            ruleCode: "PLAN_COPY_LAYER_OVERLAP",
            message: `${expectedId} ${issue}`,
            screenIds: [expectedId],
            scope: "screen",
            path: `screens[${position}].copy`,
            allowedRepairFields: [
              "copy.headline",
              "copy.subheadline",
              "copy.body",
              "copy.keyPoints"
            ]
          });
        });
      }
    }

    if (!stringArray(screen.evidenceIds)) {
      issues.push(`${expectedId} 证据引用格式无效`);
      return;
    }

    if (isRecord(screen.copy) && stringArray(screen.copy.keyPoints, 1)) {
      evidenceIssuesForScreen(screen as unknown as DetailScreen, factById).forEach(
        (issue) => {
          issues.push(`${expectedId} ${issue}`);
          planIssues.push({
            ruleCode: "PLAN_EVIDENCE_CLAIM_MISMATCH",
            message: `${expectedId} ${issue}`,
            screenIds: [expectedId],
            scope: "screen",
            path: `screens[${position}]`,
            expectedClaimScope: screen.claimScope as DetailScreen["claimScope"],
            immutableEvidenceIds: screen.evidenceIds as string[],
            allowedRepairFields: [...COPY_PLAN_REPAIR_FIELDS]
          });
        }
      );
    }
  });

  const typedScreens = screens.filter(
    (screen): screen is DetailScreen =>
      isRecord(screen) &&
      isRecord(screen.copy) &&
      stringArray(screen.copy.keyPoints, 1)
  );
  const copyQuality = checkCopyQuality(typedScreens);
  copyQuality.issues
    .filter((issue) => issue.severity === "error")
    .forEach((issue) => {
      const message =
        `${issue.screenId} 文案质量：${issue.message} ${issue.evidence}；${issue.suggestion}`;
      issues.push(message);
      planIssues.push({
        ruleCode: `COPY_${issue.code.toUpperCase()}`,
        message,
        screenIds: [issue.screenId],
        scope: "screen",
        path: issue.path,
        matchedPhrase: issue.evidence,
        allowedRepairFields: repairFieldFromPath(issue.path)
      });
    });
  findClaimGuardIssues({ screens: typedScreens, facts }).forEach((issue) => {
    const message =
      `${issue.screenId} 声明越权：${issue.message} 命中“${issue.phrase}”；${issue.fix}`;
    issues.push(message);
    planIssues.push({
      ruleCode: `CLAIM_${issue.ruleId.toUpperCase().replace(/-/gu, "_")}`,
      message,
      screenIds: [issue.screenId],
      scope: "screen",
      path: issue.field,
      matchedPhrase: issue.phrase,
      allowedRepairFields: repairFieldFromPath(issue.field)
    });
  });
  const creativeSceneFamilies = new Map<string, string[]>();
  typedScreens.forEach((screen) => {
    if (screen.claimScope !== "creative") return;
    const family = sceneFamily(screen.scene);
    if (!family) return;
    creativeSceneFamilies.set(family, [
      ...(creativeSceneFamilies.get(family) ?? []),
      screen.id
    ]);
  });
  creativeSceneFamilies.forEach((screenIds, family) => {
    if (screenIds.length > 1) {
      const [anchorId, ...repairIds] = screenIds;
      const message = `${screenIds.join("、")} 创意场景重复：集中使用${family}`;
      issues.push(message);
      planIssues.push({
        ruleCode: "PLAN_CREATIVE_SCENE_FAMILY_DUPLICATED",
        message,
        screenIds: repairIds,
        relatedScreenIds: [anchorId],
        scope: "cross-screen",
        path: "scene",
        matchedPhrase: family,
        allowedRepairFields: ["scene", "shot", "composition", "transition"]
      });
    }
  });

  for (let left = 0; left < typedScreens.length; left += 1) {
    for (let right = left + 1; right < typedScreens.length; right += 1) {
      const leftScreen = typedScreens[left];
      const rightScreen = typedScreens[right];
      const leftSemantic = [
        leftScreen.primarySellingPoint,
        leftScreen.copy.headline,
        leftScreen.copy.subheadline,
        leftScreen.copy.body
      ].join("");
      const rightSemantic = [
        rightScreen.primarySellingPoint,
        rightScreen.copy.headline,
        rightScreen.copy.subheadline,
        rightScreen.copy.body
      ].join("");
      const semanticSimilarity = bigramSimilarity(
        leftSemantic,
        rightSemantic
      );
      const sellingPointSimilarity = bigramSimilarity(
        leftScreen.primarySellingPoint,
        rightScreen.primarySellingPoint
      );
      const leftEvidenceSignature = [...leftScreen.evidenceIds].sort().join("|");
      const rightEvidenceSignature = [...rightScreen.evidenceIds]
        .sort()
        .join("|");
      const hasSharedEvidence = leftScreen.evidenceIds.some((evidenceId) =>
        rightScreen.evidenceIds.includes(evidenceId)
      );
      const isSummaryRecapPair =
        hasSharedEvidence &&
        (leftScreen.id === "screen-14" || rightScreen.id === "screen-14");
      const repeatedSellingPointPhrase = longestCommonSubstringLength(
        leftScreen.primarySellingPoint,
        rightScreen.primarySellingPoint
      );
      if (
        semanticSimilarity >= (isSummaryRecapPair ? 0.7 : 0.34) ||
        (!isSummaryRecapPair && sellingPointSimilarity >= 0.7) ||
        (!isSummaryRecapPair &&
          hasSharedEvidence &&
          repeatedSellingPointPhrase >= 6) ||
        (!isSummaryRecapPair &&
          leftEvidenceSignature &&
          leftEvidenceSignature === rightEvidenceSignature &&
          semanticSimilarity >= 0.3)
      ) {
        const message =
          `${leftScreen.id} 与 ${rightScreen.id} 文案语义高度相似（综合${semanticSimilarity.toFixed(2)}，卖点${sellingPointSimilarity.toFixed(2)}，连续复述${repeatedSellingPointPhrase}字）`;
        issues.push(message);
        planIssues.push({
          ruleCode: "PLAN_CROSS_SCREEN_COPY_SIMILAR",
          message,
          screenIds: [rightScreen.id],
          relatedScreenIds: [leftScreen.id],
          scope: "cross-screen",
          path: "copy",
          allowedRepairFields: [
            "primarySellingPoint",
            "proofMethod",
            "copy.headline",
            "copy.subheadline",
            "copy.body",
            "copy.keyPoints"
          ]
        });
      }

      if (
        leftScreen.claimScope === "creative" &&
        rightScreen.claimScope === "creative"
      ) {
        const leftFamily = sceneFamily(leftScreen.scene);
        const rightFamily = sceneFamily(rightScreen.scene);
        if (
          leftFamily &&
          leftFamily === rightFamily &&
          bigramSimilarity(leftScreen.scene, rightScreen.scene) >= 0.25
        ) {
          const message =
            `${leftScreen.id} 与 ${rightScreen.id} 创意场景重复（${leftFamily}）`;
          issues.push(message);
          planIssues.push({
            ruleCode: "PLAN_CROSS_SCREEN_SCENE_SIMILAR",
            message,
            screenIds: [rightScreen.id],
            relatedScreenIds: [leftScreen.id],
            scope: "cross-screen",
            path: "scene",
            matchedPhrase: leftFamily,
            allowedRepairFields: [
              "scene",
              "shot",
              "composition",
              "transition"
            ]
          });
        }
      }
    }
  }

  if (
    !nonEmpty(value.productPositioning) ||
    !stringArray(value.coreSellingPoints, 2) ||
    (value.coreSellingPoints as string[]).length > 6 ||
    !Array.isArray(value.personas) ||
    value.personas.length < 2 ||
    !stringArray(value.decisionChain, 3) ||
    !nonEmpty(value.globalVisualDirection)
  ) {
    issues.push("缺少定位、核心卖点、至少2类人群或决策链");
  }

  if (issues.length) {
    const structuredIssues =
      planIssues.length > 0
        ? planIssues
        : [
            {
              ruleCode: "PLAN_QUALITY_UNSTRUCTURED",
              message: issues.join("；"),
              screenIds: typedScreens.map((screen) => screen.id),
              scope: "foundation" as const,
              allowedRepairFields: [...ALL_PLAN_REPAIR_FIELDS]
            }
          ];
    throw new SkillSuiteValidationError(
      "15屏策划未通过结果校验。",
      "PLAN_QUALITY_INVALID",
      issues.slice(0, 48),
      structuredIssues.slice(0, 48)
    );
  }
}

export type ScreenExecutionDraft = Omit<ScreenExecution, "englishPrompt"> & {
  englishPrompt?: string;
};

function executionSchemaIssues(
  execution: Record<string, unknown>,
  screenId: string,
  requireEnglishPrompt: boolean
) {
  const issues: string[] = [];
  if (
    !isRecord(execution.copyFinal) ||
    !nonEmpty(execution.copyFinal.headline) ||
    !nonEmpty(execution.copyFinal.subheadline) ||
    !nonEmpty(execution.copyFinal.body) ||
    !stringArray(execution.copyFinal.keyPoints, 1) ||
    !nonEmpty(execution.visualInstruction) ||
    !nonEmpty(execution.visualPrompt) ||
    (requireEnglishPrompt && !nonEmpty(execution.englishPrompt)) ||
    !nonEmpty(execution.negativePrompt) ||
    !isRecord(execution.geo) ||
    !nonEmpty(execution.geo.query) ||
    !nonEmpty(execution.geo.answer) ||
    !stringArray(execution.geo.entities, 1) ||
    !isRecord(execution.productionReference) ||
    !nonEmpty(execution.productionReference.information) ||
    !nonEmpty(execution.productionReference.wireframe) ||
    !nonEmpty(execution.productionReference.typography) ||
    !nonEmpty(execution.productionReference.sceneDirection) ||
    !stringArray(execution.productionReference.palette, 3) ||
    !nonEmpty(execution.productionReference.darkMode) ||
    !nonEmpty(execution.productionReference.designNotes)
  ) {
    issues.push(`${screenId} 缺少 A / B / D / E 四类交付字段`);
  }
  if (execution.aiLabel !== "AI辅助生成") {
    issues.push(`${screenId} 缺少AI辅助生成标识`);
  }
  return issues;
}

function rawPromptIssues(
  execution: Record<string, unknown>,
  screen: DetailScreen
) {
  const issues: string[] = [];
  const rawBundle = `${String(execution.visualInstruction ?? "")}\n${String(execution.visualPrompt ?? "")}`;
  if (NO_TEXT_PATTERN.test(rawBundle)) {
    issues.push(`${screen.id} 生图指令仍要求无文字画面`);
  }
  if (!/(?:9\s*:\s*16|vertical)/i.test(String(execution.visualPrompt ?? ""))) {
    issues.push(`${screen.id} visualPrompt 未声明9:16竖版`);
  }
  if (
    /(?:(?:commercialUse|evidenceIds|claimScope|generatedAt)\s*(?:=|:))|(?:commercial\s+use\s+allowed)|(?:approved\s+evidence\s+item)|(?:evidence\s+count)/i.test(
      rawBundle
    )
  ) {
    issues.push(`${screen.id} 生图指令泄漏内部业务字段`);
  }
  screenCopyFields(screen.copy).forEach(([label, copy]) => {
    if (copy && rawBundle.includes(copy)) {
      issues.push(`${screen.id} ${label}提前混入视觉底稿，最终会重复`);
    }
  });
  return issues;
}

export function parseExecutionDrafts(
  value: unknown,
  expectedScreens: readonly DetailScreen[]
): ScreenExecutionDraft[] {
  if (!isRecord(value) || !Array.isArray(value.executions)) {
    throw new SkillSuiteValidationError("执行结果缺少 executions。", "EXECUTION_SCHEMA_INVALID");
  }

  const issues: string[] = [];
  const expected = new Map(expectedScreens.map((screen) => [screen.id, screen]));
  const received = new Set<string>();

  value.executions.forEach((execution) => {
    if (!isRecord(execution) || !nonEmpty(execution.screenId)) {
      issues.push("存在无 screenId 的执行结果");
      return;
    }
    const screen = expected.get(execution.screenId);
    if (!screen) {
      issues.push(`返回了未请求的 ${execution.screenId}`);
      return;
    }
    if (received.has(execution.screenId)) issues.push(`${execution.screenId} 重复`);
    received.add(execution.screenId);

    issues.push(...executionSchemaIssues(execution, execution.screenId, false));
    if (nonEmpty(execution.englishPrompt)) {
      issues.push(`${execution.screenId} 模型不得预编译最终 English Prompt`);
    }
    if (
      isRecord(execution.copyFinal) &&
      stringArray(execution.copyFinal.keyPoints, 1) &&
      !copyEquals(execution.copyFinal as ScreenCopy, screen.copy)
    ) {
      issues.push(`${execution.screenId} copyFinal 改写了策划定稿文案`);
    }
    issues.push(...rawPromptIssues(execution, screen));
  });

  expectedScreens.forEach((screen) => {
    if (!received.has(screen.id)) issues.push(`${screen.id} 未返回`);
  });

  if (issues.length) {
    throw new SkillSuiteValidationError(
      "执行交付未通过结构校验。",
      "EXECUTION_QUALITY_INVALID",
      issues.slice(0, 16)
    );
  }

  return value.executions as ScreenExecutionDraft[];
}

export function assertExecutions(
  value: unknown,
  expectedScreens: readonly DetailScreen[],
  facts: readonly EvidenceFact[]
): asserts value is { executions: ScreenExecution[] } {
  if (!isRecord(value) || !Array.isArray(value.executions)) {
    throw new SkillSuiteValidationError("执行结果缺少 executions。", "EXECUTION_SCHEMA_INVALID");
  }

  const issues: string[] = [];
  const expected = new Map(expectedScreens.map((screen) => [screen.id, screen]));
  const received = new Set<string>();

  value.executions.forEach((execution) => {
    if (!isRecord(execution) || !nonEmpty(execution.screenId)) {
      issues.push("存在无 screenId 的执行结果");
      return;
    }
    const screen = expected.get(execution.screenId);
    if (!screen) {
      issues.push(`返回了未请求的 ${execution.screenId}`);
      return;
    }
    if (received.has(execution.screenId)) issues.push(`${execution.screenId} 重复`);
    received.add(execution.screenId);
    issues.push(...executionSchemaIssues(execution, execution.screenId, true));

    if (
      !isRecord(execution.copyFinal) ||
      !stringArray(execution.copyFinal.keyPoints, 1)
    ) {
      return;
    }
    if (!copyEquals(execution.copyFinal as ScreenCopy, screen.copy)) {
      issues.push(`${execution.screenId} copyFinal 改写了策划定稿文案`);
    }
    issues.push(...rawPromptIssues(execution, screen));

    if (!nonEmpty(execution.englishPrompt) || !nonEmpty(execution.visualPrompt)) {
      return;
    }
    const expectedPrompt = compileScreenImagePrompt({
      screen,
      execution: execution as unknown as ScreenExecution,
      facts
    });
    if (execution.englishPrompt !== expectedPrompt) {
      issues.push(`${execution.screenId} 最终提示词不是服务端单次编译结果`);
    }
    if (
      countOccurrences(execution.englishPrompt, APPROVED_COPY_BEGIN) !== 1 ||
      countOccurrences(execution.englishPrompt, APPROVED_COPY_END) !== 1
    ) {
      issues.push(`${execution.screenId} 定稿文案编译块数量不是1`);
    }
    if (
      nonEmpty(execution.negativePrompt) &&
      execution.englishPrompt.includes(execution.negativePrompt.trim())
    ) {
      issues.push(`${execution.screenId} 负面词被重复写入正向最终提示词`);
    }
    if (
      countOccurrences(execution.englishPrompt, "AI辅助生成") !== 1
    ) {
      issues.push(`${execution.screenId} 最终提示词中的AI辅助生成标识数量不是1`);
    }
    if (
      !execution.englishPrompt.includes(
        "Use each reference image only to identify the product."
      )
    ) {
      issues.push(`${execution.screenId} 最终提示词缺少参考图污染隔离指令`);
    }
  });

  findClaimGuardIssues({
    screens: expectedScreens,
    facts,
    executions: value.executions as ScreenExecution[]
  }).forEach((issue) => {
    issues.push(
      `${issue.screenId} ${issue.message} 命中“${issue.phrase}”`
    );
  });

  expectedScreens.forEach((screen) => {
    if (!received.has(screen.id)) issues.push(`${screen.id} 未返回`);
  });

  if (issues.length) {
    throw new SkillSuiteValidationError(
      "执行交付未通过结构校验。",
      "EXECUTION_QUALITY_INVALID",
      issues.slice(0, 16)
    );
  }
}

export function assertQAReport(value: unknown): asserts value is QAReport {
  if (!isRecord(value) || !Array.isArray(value.findings) || !nonEmpty(value.summary)) {
    throw new SkillSuiteValidationError("质检报告结构无效。", "QA_SCHEMA_INVALID");
  }

  const valid = value.findings.every(
    (finding) =>
      isRecord(finding) &&
      nonEmpty(finding.id) &&
      ["error", "warning", "pass"].includes(String(finding.severity)) &&
      nonEmpty(finding.module) &&
      nonEmpty(finding.title) &&
      nonEmpty(finding.evidence) &&
      nonEmpty(finding.fix)
  );

  if (!valid) {
    throw new SkillSuiteValidationError("质检报告包含不完整问题项。", "QA_SCHEMA_INVALID");
  }
}

function finding(
  severity: QAFinding["severity"],
  module: string,
  title: string,
  evidence: string,
  fix: string,
  screenId?: string
): QAFinding {
  return {
    id: `rule-${module}-${screenId ?? "global"}-${title}`,
    severity,
    module,
    screenId,
    title,
    evidence,
    fix
  };
}

export function runDeterministicQA(
  plan: DetailPlan,
  executions: Record<string, ScreenExecution>,
  facts: readonly EvidenceFact[]
) {
  const results: QAFinding[] = [];
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const headlineMap = new Map<string, string>();
  const copyQuality = checkCopyQuality(plan.screens);
  copyQuality.issues.forEach((issue) => {
    results.push(
      finding(
        issue.severity,
        "用户文案",
        issue.message,
        `${issue.path}；${issue.evidence}`,
        issue.suggestion,
        issue.screenId
      )
    );
  });
  collectScreenContractIssues(plan.screens, facts).forEach((issue) => {
    results.push(
      finding(
        "error",
        "15屏任务",
        "页面任务与事实分配不一致",
        issue,
        "按同一份15屏任务契约重新生成冲突屏，确保每条甲方事实有且只有清晰的页面主人。"
      )
    );
  });
  findClaimGuardIssues({
    screens: plan.screens,
    facts,
    executions
  }).forEach((issue) => {
    results.push(
      finding(
        issue.severity,
        issue.kind === "internal-prompt-metadata" ? "生图提示词" : "声明强度",
        issue.message,
        `${issue.field} 命中“${issue.phrase}”`,
        issue.fix,
        issue.screenId
      )
    );
  });

  plan.screens.forEach((screen) => {
    const headlineKey = normalizedCopy(screen.copy.headline);
    const firstOwner = headlineMap.get(headlineKey);
    if (firstOwner) {
      results.push(
        finding(
          "error",
          "文案",
          "标题重复",
          `${screen.id} 与 ${firstOwner} 使用相同标题`,
          "重写本屏标题，保持转化角色和信息任务唯一。",
          screen.id
        )
      );
    } else {
      headlineMap.set(headlineKey, screen.id);
    }

    const evidenceIssues = evidenceIssuesForScreen(screen, factById);
    if (evidenceIssues.length) {
      results.push(
        finding(
          "error",
          "证据",
          "产品声明与证据范围不一致",
          evidenceIssues.join("；"),
          "甲方图片原文可以使用，但产品声明必须引用同 claimScope 的图片事实；资料不足时改为 creative 场景屏，不新增效果。",
          screen.id
        )
      );
    }

    const execution = executions[screen.id];
    if (!execution) {
      results.push(
        finding(
          "warning",
          "执行",
          "尚未生成完整交付",
          "本屏缺少 A / B / D / E 四类执行结果。",
          "生成本屏交付后重新运行质检。",
          screen.id
        )
      );
      return;
    }

    if (!copyEquals(execution.copyFinal, screen.copy)) {
      results.push(
        finding(
          "error",
          "文案",
          "执行阶段改写了策划文案",
          "copyFinal 与策划 copy 不一致。",
          "恢复策划文案原文；提示词层只能编译，不能改写。",
          screen.id
        )
      );
    }

    const rawIssues = rawPromptIssues(
      execution as unknown as Record<string, unknown>,
      screen
    );
    rawIssues.forEach((issue) => {
      results.push(
        finding(
          "error",
          "生图提示词",
          "视觉底稿污染",
          issue,
          "视觉底稿只保留场景、镜头、构图与光线；定稿文案由服务端单次编译。",
          screen.id
        )
      );
    });

    let expectedPrompt = "";
    try {
      expectedPrompt = compileScreenImagePrompt({
        screen,
        execution,
        facts
      });
    } catch (error) {
      results.push(
        finding(
          "error",
          "生图提示词",
          "最终提示词无法编译",
          error instanceof Error ? error.message : "证据或执行结构无效。",
          "修复证据引用后重新生成本屏交付。",
          screen.id
        )
      );
    }
    if (expectedPrompt && execution.englishPrompt !== expectedPrompt) {
      results.push(
        finding(
          "error",
          "生图提示词",
          "最终提示词不是单次编译结果",
          "English Prompt 与服务端根据 visualPrompt + 本屏文案编译的结果不一致。",
          "重新生成本屏交付，禁止在前端或模型层二次拼接文案。",
          screen.id
        )
      );
    }
    if (
      countOccurrences(execution.englishPrompt, APPROVED_COPY_BEGIN) !== 1 ||
      countOccurrences(execution.englishPrompt, APPROVED_COPY_END) !== 1
    ) {
      results.push(
        finding(
          "error",
          "生图提示词",
          "定稿文案编译块数量异常",
          "最终提示词必须且只能包含一个 APPROVED_COPY 编译块。",
          "使用服务端编译器重新生成，移除手工拼接。",
          screen.id
        )
      );
    }
    if (
      execution.negativePrompt.trim() &&
      execution.englishPrompt.includes(execution.negativePrompt.trim())
    ) {
      results.push(
        finding(
          "error",
          "生图提示词",
          "负面词被重复注入",
          "negativePrompt 已出现在正向 English Prompt 中，发送请求时还会再次追加。",
          "正向提示词不包含负面词，仅通过独立 negativePrompt 参数注入一次。",
          screen.id
        )
      );
    }

    if (execution.aiLabel !== "AI辅助生成") {
      results.push(
        finding(
          "error",
          "AI合规",
          "缺少AI辅助生成标识",
          "执行结果未包含规定标识。",
          "在交付元数据和导出稿中加入“AI辅助生成”。",
          screen.id
        )
      );
    }
    if (countOccurrences(execution.englishPrompt, "AI辅助生成") !== 1) {
      results.push(
        finding(
          "error",
          "AI合规",
          "最终画面指令未唯一写入AI标识",
          "最终 English Prompt 必须明确要求“AI辅助生成”恰好出现一次。",
          "重新使用服务端单次编译器，不只保存元数据字段。",
          screen.id
        )
      );
    }
    if (
      !execution.englishPrompt.includes(
        "Use each reference image only to identify the product."
      )
    ) {
      results.push(
        finding(
          "error",
          "参考图",
          "缺少参考图污染隔离",
          "最终提示词没有明确忽略源图旧文案、尺寸线、箭头、道具和旧版式。",
          "重新编译最终提示词，只继承产品身份和结构。",
          screen.id
        )
      );
    }
  });

  if (!results.some((item) => item.module === "文案" && item.severity === "error")) {
    results.push(
      finding("pass", "文案", "15屏标题唯一", "未发现完全重复标题。", "保持现状。")
    );
  }
  if (!results.some((item) => item.module === "证据" && item.severity === "error")) {
    results.push(
      finding("pass", "证据", "商业声明权限有效", "所有证据引用均指向可见事实或甲方授权的普通民用基础资料。", "保持现状。")
    );
  }
  if (!results.some((item) => item.module === "AI合规" && item.severity === "error")) {
    results.push(
      finding("pass", "AI合规", "AI辅助生成标识完整", "已检查全部执行结果。", "保持现状。")
    );
  }
  const invalidRatio = plan.screens.filter(
    (screen) =>
      !/(?:9\s*:\s*16|9\s*：\s*16)/u.test(screen.composition) ||
      (executions[screen.id] &&
        !/(?:9\s*:\s*16|1440x2560|vertical)/i.test(executions[screen.id].englishPrompt))
  );
  results.push(
    invalidRatio.length
      ? finding(
          "error",
          "移动端",
          "9:16比例声明不完整",
          `未完整声明的屏幕：${invalidRatio.map((screen) => screen.id).join("、")}`,
          "策划构图与最终生图提示词同时写明9:16和1440x2560。"
        )
      : finding(
          "pass",
          "移动端",
          "15屏固定9:16",
          "策划构图与最终生图提示词均已声明9:16。",
          "生成图片后继续检查真实像素。"
        )
  );

  return results;
}
