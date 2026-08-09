import type {
  EvidenceClaimScope,
  EvidenceEntityType,
  EvidenceSourceType,
  ProductResearch,
  VisualAuditDimension
} from "@/lib/types";
import {
  extractJsonObject,
  SkillSuiteValidationError
} from "@/lib/skill-suite/validation";

const OBSERVATION_SOURCE_TYPES = [
  "visual_observation",
  "image_text"
] as const satisfies readonly EvidenceSourceType[];

const CLAIM_SCOPES = [
  "appearance",
  "visible_text",
  "specification",
  "material",
  "performance",
  "mechanism",
  "service",
  "promotion"
] as const satisfies readonly EvidenceClaimScope[];

const ENTITY_TYPES = [
  "product",
  "brand",
  "decorative_badge",
  "specification",
  "feature",
  "material",
  "other"
] as const satisfies readonly EvidenceEntityType[];

const AUDIT_KEYS = [
  "composition",
  "sellingHierarchy",
  "color",
  "typography",
  "visualPath",
  "material",
  "algorithmFit",
  "emotion"
] as const satisfies readonly VisualAuditDimension["key"][];

const EXTRACTION_FIELDS = new Set([
  "assetId",
  "label",
  "value",
  "evidence",
  "sourceType",
  "claimScope",
  "entityType",
  "confidence"
]);

const FINALIZE_FIELDS = new Set([
  "selectedObservationIds",
  "productName",
  "category",
  "brand",
  "summary",
  "visualAudit",
  "visualKeywords",
  "risks"
]);

export type AtomicResearchObservation = {
  observationId: string;
  assetId: string;
  label: string;
  value: string;
  evidence: string;
  sourceType: (typeof OBSERVATION_SOURCE_TYPES)[number];
  claimScope: EvidenceClaimScope;
  entityType: EvidenceEntityType;
  confidence: number;
};

export type ResearchFinalizeSelection = Omit<
  ProductResearch,
  "facts" | "source" | "generatedAt"
> & {
  selectedObservationIds: string[];
};

export type AtomicResearchOutputProfile = "standard" | "compact";

type AtomicResearchExtractionLimits = {
  minItems: number;
  maxItems: number;
  labelMaxLength: number;
  valueMaxLength: number;
  evidenceMaxLength: number;
};

type ResearchFinalizeLimits = {
  selectedMaxItems: number;
  scalarMaxLength: number;
  summaryMaxLength: number;
  auditTitleMaxLength: number;
  auditFindingMaxLength: number;
  auditRecommendationMaxLength: number;
  keywordMaxItems: number;
  keywordMaxLength: number;
  riskMaxItems: number;
  riskMaxLength: number;
};

function invalidExtraction(issues: string[]): never {
  throw new SkillSuiteValidationError(
    "图研原子观察结果不完整。",
    "RESEARCH_ATOMIC_EXTRACTION_INVALID",
    issues
  );
}

function invalidSelection(issues: string[]): never {
  throw new SkillSuiteValidationError(
    "图研最终选择结果无效。",
    "RESEARCH_FINALIZE_SELECTION_INVALID",
    issues
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function hasOnlyFields(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function normalizeFingerprint(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function validateAssetIds(assetIds: readonly string[]) {
  if (
    assetIds.length === 0 ||
    assetIds.some((assetId) => !nonEmptyString(assetId, 160)) ||
    new Set(assetIds).size !== assetIds.length
  ) {
    invalidExtraction(["素材ID必须是非空、唯一的字符串。"]);
  }
}

export function getAtomicResearchExtractionLimits(
  assetIds: readonly string[],
  profile: AtomicResearchOutputProfile = "standard"
): AtomicResearchExtractionLimits {
  validateAssetIds(assetIds);
  if (profile === "compact") {
    return {
      minItems: 6,
      maxItems: 6,
      labelMaxLength: 24,
      valueMaxLength: 72,
      evidenceMaxLength: 96
    };
  }
  return {
    minItems: 6,
    maxItems: Math.max(6, assetIds.length * 4),
    labelMaxLength: 32,
    valueMaxLength: 100,
    evidenceMaxLength: 120
  };
}

function getResearchFinalizeLimits(
  profile: AtomicResearchOutputProfile
): ResearchFinalizeLimits {
  return profile === "compact"
    ? {
        selectedMaxItems: 8,
        scalarMaxLength: 64,
        summaryMaxLength: 180,
        auditTitleMaxLength: 24,
        auditFindingMaxLength: 80,
        auditRecommendationMaxLength: 80,
        keywordMaxItems: 6,
        keywordMaxLength: 24,
        riskMaxItems: 4,
        riskMaxLength: 80
      }
    : {
        selectedMaxItems: 12,
        scalarMaxLength: 80,
        summaryMaxLength: 320,
        auditTitleMaxLength: 40,
        auditFindingMaxLength: 160,
        auditRecommendationMaxLength: 160,
        keywordMaxItems: 10,
        keywordMaxLength: 40,
        riskMaxItems: 8,
        riskMaxLength: 120
      };
}

export function buildAtomicResearchExtractionSchema(
  assetIds: readonly string[],
  profile: AtomicResearchOutputProfile = "standard"
): Record<string, unknown> {
  const limits = getAtomicResearchExtractionLimits(assetIds, profile);
  return {
    type: "object",
    additionalProperties: false,
    required: ["observations"],
    properties: {
      observations: {
        type: "array",
        minItems: limits.minItems,
        maxItems: limits.maxItems,
        items: {
          type: "object",
          additionalProperties: false,
          required: [...EXTRACTION_FIELDS],
          properties: {
            assetId: { type: "string", enum: [...assetIds] },
            label: {
              type: "string",
              minLength: 1,
              maxLength: limits.labelMaxLength
            },
            value: {
              type: "string",
              minLength: 1,
              maxLength: limits.valueMaxLength
            },
            evidence: {
              type: "string",
              minLength: 1,
              maxLength: limits.evidenceMaxLength
            },
            sourceType: {
              type: "string",
              enum: [...OBSERVATION_SOURCE_TYPES]
            },
            claimScope: { type: "string", enum: [...CLAIM_SCOPES] },
            entityType: { type: "string", enum: [...ENTITY_TYPES] },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      }
    }
  };
}

export function parseAtomicResearchObservations(
  text: string,
  allowedAssetIds: readonly string[],
  profile: AtomicResearchOutputProfile = "standard"
): AtomicResearchObservation[] {
  const limits = getAtomicResearchExtractionLimits(allowedAssetIds, profile);
  const parsed = extractJsonObject<unknown>(text);
  const issues: string[] = [];
  if (!isRecord(parsed) || !hasOnlyFields(parsed, new Set(["observations"]))) {
    invalidExtraction(["顶层只允许 observations 字段。"]);
  }

  const rawObservations = Array.isArray(parsed.observations)
    ? parsed.observations
    : [];
  if (
    !Array.isArray(parsed.observations) ||
    rawObservations.length < limits.minItems ||
    rawObservations.length > limits.maxItems
  ) {
    issues.push(
      `观察数量必须为${limits.minItems}–${limits.maxItems}条并覆盖本批素材。`
    );
  }

  const allowedAssets = new Set(allowedAssetIds);
  const coveredAssets = new Set<string>();
  const perAssetOrdinal = new Map<string, number>();
  const observations: AtomicResearchObservation[] = [];

  rawObservations.forEach((raw, index) => {
    if (!isRecord(raw) || !hasOnlyFields(raw, EXTRACTION_FIELDS)) {
      issues.push(`observations[${index}] 含有非法字段或不是对象。`);
      return;
    }
    const assetId = typeof raw.assetId === "string" ? raw.assetId : "";
    const sourceType = String(raw.sourceType);
    const claimScope = String(raw.claimScope);
    const entityType = String(raw.entityType);
    const confidence = raw.confidence;
    const valid =
      allowedAssets.has(assetId) &&
      nonEmptyString(raw.label, limits.labelMaxLength) &&
      nonEmptyString(raw.value, limits.valueMaxLength) &&
      nonEmptyString(raw.evidence, limits.evidenceMaxLength) &&
      OBSERVATION_SOURCE_TYPES.includes(
        sourceType as AtomicResearchObservation["sourceType"]
      ) &&
      CLAIM_SCOPES.includes(claimScope as EvidenceClaimScope) &&
      ENTITY_TYPES.includes(entityType as EvidenceEntityType) &&
      typeof confidence === "number" &&
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 1 &&
      !(entityType === "brand" && sourceType !== "image_text");
    if (!valid) {
      issues.push(
        `observations[${index}] 的素材ID、原子文本、类型或置信度无效。`
      );
      return;
    }

    const ordinal = (perAssetOrdinal.get(assetId) ?? 0) + 1;
    perAssetOrdinal.set(assetId, ordinal);
    coveredAssets.add(assetId);
    observations.push({
      observationId: `obs:${encodeURIComponent(assetId)}:${ordinal}`,
      assetId,
      label: (raw.label as string).trim(),
      value: (raw.value as string).trim(),
      evidence: (raw.evidence as string).trim(),
      sourceType: sourceType as AtomicResearchObservation["sourceType"],
      claimScope: claimScope as EvidenceClaimScope,
      entityType: entityType as EvidenceEntityType,
      confidence
    });
  });

  const missingAssets = allowedAssetIds.filter(
    (assetId) => !coveredAssets.has(assetId)
  );
  if (missingAssets.length) {
    issues.push(`以下素材未被观察覆盖：${missingAssets.join("、")}。`);
  }
  const underCoveredAssets = allowedAssetIds.filter(
    (assetId) => (perAssetOrdinal.get(assetId) ?? 0) < 2
  );
  if (underCoveredAssets.length) {
    issues.push(
      `以下素材少于2条独立观察：${underCoveredAssets.join("、")}。`
    );
  }
  if (issues.length) invalidExtraction(issues);
  return observations;
}

function visualAuditSchema(limits: ResearchFinalizeLimits) {
  return {
    type: "array",
    minItems: 8,
    maxItems: 8,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["key", "title", "finding", "recommendation"],
      properties: {
        key: { type: "string", enum: [...AUDIT_KEYS] },
        title: {
          type: "string",
          minLength: 1,
          maxLength: limits.auditTitleMaxLength
        },
        finding: {
          type: "string",
          minLength: 1,
          maxLength: limits.auditFindingMaxLength
        },
        recommendation: {
          type: "string",
          minLength: 1,
          maxLength: limits.auditRecommendationMaxLength
        }
      }
    }
  };
}

export function buildResearchFinalizeSchema(
  observationIds: readonly string[],
  profile: AtomicResearchOutputProfile = "standard"
): Record<string, unknown> {
  if (
    observationIds.length < 6 ||
    observationIds.some((id) => !nonEmptyString(id, 240)) ||
    new Set(observationIds).size !== observationIds.length
  ) {
    invalidSelection(["可选原子观察ID必须非空且唯一，并至少有6条。"]);
  }
  const limits = getResearchFinalizeLimits(profile);
  return {
    type: "object",
    additionalProperties: false,
    required: [...FINALIZE_FIELDS],
    properties: {
      selectedObservationIds: {
        type: "array",
        minItems: 6,
        maxItems: limits.selectedMaxItems,
        uniqueItems: true,
        items: { type: "string", enum: [...observationIds] }
      },
      productName: {
        type: "string",
        minLength: 1,
        maxLength: limits.scalarMaxLength
      },
      category: {
        type: "string",
        minLength: 1,
        maxLength: limits.scalarMaxLength
      },
      brand: {
        type: "string",
        minLength: 1,
        maxLength: limits.scalarMaxLength
      },
      summary: {
        type: "string",
        minLength: 1,
        maxLength: limits.summaryMaxLength
      },
      visualAudit: visualAuditSchema(limits),
      visualKeywords: {
        type: "array",
        minItems: 3,
        maxItems: limits.keywordMaxItems,
        uniqueItems: true,
        items: {
          type: "string",
          minLength: 1,
          maxLength: limits.keywordMaxLength
        }
      },
      risks: {
        type: "array",
        maxItems: limits.riskMaxItems,
        items: {
          type: "string",
          minLength: 1,
          maxLength: limits.riskMaxLength
        }
      }
    }
  };
}

/**
 * 汇总修复 schema：仅要求 selectedObservationIds。
 * 修复时只重新选择观察，不重新生成 productName / category / summary 等。
 */
export function buildResearchFinalizeRepairSchema(
  allowedObservationIds: readonly string[],
  profile: AtomicResearchOutputProfile = "standard"
): Record<string, unknown> {
  if (
    allowedObservationIds.length < 6 ||
    allowedObservationIds.some((id) => !nonEmptyString(id, 240)) ||
    new Set(allowedObservationIds).size !== allowedObservationIds.length
  ) {
    invalidSelection(["修复可选原子观察ID必须非空且唯一，并至少有6条。"]);
  }
  const limits = getResearchFinalizeLimits(profile);
  return {
    type: "object",
    additionalProperties: false,
    required: ["selectedObservationIds"],
    properties: {
      selectedObservationIds: {
        type: "array",
        minItems: 6,
        maxItems: limits.selectedMaxItems,
        uniqueItems: true,
        items: {
          type: "string",
          minLength: 1,
          maxLength: 240
        }
      }
    }
  };
}

/**
 * 解析修复阶段的模型输出。失败抛错（由调用方捕获）。
 */
export function parseResearchFinalizeRepairSelection(
  text: string,
  allowedObservationIds: readonly string[]
): string[] {
  const parsed = extractJsonObject<unknown>(text);
  if (!isRecord(parsed)) {
    invalidSelection(["修复阶段必须返回 JSON 对象。"]);
  }
  const allowedFields = new Set(["selectedObservationIds"]);
  if (
    !hasOnlyFields(parsed, allowedFields) ||
    !("selectedObservationIds" in parsed)
  ) {
    invalidSelection(["修复阶段只能返回 selectedObservationIds。"]);
  }
  const allowed = new Set(allowedObservationIds);
  // 显式从已校验的 parsed 上读取，避免未知下标路径上的 unknown 残留。
  const rawSelected: unknown = (parsed as Record<string, unknown>)[
    "selectedObservationIds"
  ];
  const isArray = Array.isArray(rawSelected);
  const selected = isArray
    ? (rawSelected as unknown[]).filter(
        (item): item is string => typeof item === "string"
      )
    : [];
  const issues: string[] = [];
  if (
    !isArray ||
    selected.length < 6 ||
    selected.length !== rawSelected.length ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => !allowed.has(id))
  ) {
    issues.push(
      "修复阶段 selectedObservationIds 必须为6–8条且全部来自允许列表。"
    );
  }
  if (issues.length) invalidSelection(issues);
  return selected;
}

function parseAudit(
  value: unknown,
  issues: string[],
  limits: ResearchFinalizeLimits
) {
  if (!Array.isArray(value) || value.length !== 8) {
    issues.push("visualAudit 必须包含8个固定维度。");
    return [];
  }
  const allowedFields = new Set(["key", "title", "finding", "recommendation"]);
  const dimensions = value.filter((item): item is VisualAuditDimension => {
    if (!isRecord(item) || !hasOnlyFields(item, allowedFields)) return false;
    return (
      AUDIT_KEYS.includes(item.key as VisualAuditDimension["key"]) &&
      nonEmptyString(item.title, limits.auditTitleMaxLength) &&
      nonEmptyString(item.finding, limits.auditFindingMaxLength) &&
      nonEmptyString(
        item.recommendation,
        limits.auditRecommendationMaxLength
      )
    );
  });
  if (
    dimensions.length !== value.length ||
    new Set(dimensions.map((item) => item.key)).size !== AUDIT_KEYS.length
  ) {
    issues.push("visualAudit 维度缺失、重复或字段无效。");
  }
  return dimensions.map((item) => ({
    key: item.key,
    title: item.title.trim(),
    finding: item.finding.trim(),
    recommendation: item.recommendation.trim()
  }));
}

function parseStringArray(
  value: unknown,
  field: string,
  min: number,
  max: number,
  itemMax: number,
  issues: string[]
) {
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.length > max ||
    !value.every((item) => nonEmptyString(item, itemMax))
  ) {
    issues.push(`${field} 必须是${min}–${max}条非空字符串。`);
    return [];
  }
  return value.map((item) => (item as string).trim());
}

export function parseResearchFinalizeSelection(
  text: string,
  allowedObservationIds: readonly string[],
  profile: AtomicResearchOutputProfile = "standard"
): ResearchFinalizeSelection {
  const limits = getResearchFinalizeLimits(profile);
  const parsed = extractJsonObject<unknown>(text);
  const issues: string[] = [];
  if (!isRecord(parsed) || !hasOnlyFields(parsed, FINALIZE_FIELDS)) {
    invalidSelection([
      "顶层字段越界；最终模型不允许返回或改写 facts。"
    ]);
  }
  const allowed = new Set(allowedObservationIds);
  const selected = Array.isArray(parsed.selectedObservationIds)
    ? parsed.selectedObservationIds.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
  if (
    !Array.isArray(parsed.selectedObservationIds) ||
    selected.length !== parsed.selectedObservationIds.length ||
    selected.length < 6 ||
    selected.length > limits.selectedMaxItems ||
    new Set(selected).size !== selected.length
  ) {
    issues.push(
      `selectedObservationIds 必须包含6–${limits.selectedMaxItems}个不重复ID。`
    );
  }
  const unknown = selected.filter((id) => !allowed.has(id));
  if (unknown.length) {
    issues.push(`选中了未知观察ID：${unknown.join("、")}。`);
  }

  const scalarFields = [
    ["productName", limits.scalarMaxLength],
    ["category", limits.scalarMaxLength],
    ["brand", limits.scalarMaxLength],
    ["summary", limits.summaryMaxLength]
  ] as const;
  scalarFields.forEach(([field, max]) => {
    if (!nonEmptyString(parsed[field], max)) {
      issues.push(`${field} 必须是非空字符串。`);
    }
  });
  const visualAudit = parseAudit(parsed.visualAudit, issues, limits);
  const visualKeywords = parseStringArray(
    parsed.visualKeywords,
    "visualKeywords",
    3,
    limits.keywordMaxItems,
    limits.keywordMaxLength,
    issues
  );
  const risks = parseStringArray(
    parsed.risks,
    "risks",
    0,
    limits.riskMaxItems,
    limits.riskMaxLength,
    issues
  );
  if (new Set(visualKeywords).size !== visualKeywords.length) {
    issues.push("visualKeywords 不得重复。");
  }
  if (issues.length) invalidSelection(issues);

  return {
    selectedObservationIds: selected,
    productName: (parsed.productName as string).trim(),
    category: (parsed.category as string).trim(),
    brand: (parsed.brand as string).trim(),
    summary: (parsed.summary as string).trim(),
    visualAudit,
    visualKeywords,
    risks
  };
}

export function buildProductResearchFromSelection(
  selection: ResearchFinalizeSelection,
  observations: readonly AtomicResearchObservation[],
  options: { generatedAt?: string } = {}
): ProductResearch {
  const observationById = new Map(
    observations.map((observation) => [observation.observationId, observation])
  );
  if (observationById.size !== observations.length) {
    invalidSelection(["原子观察集合中存在重复observationId。"]);
  }
  const selected = selection.selectedObservationIds.map((id) =>
    observationById.get(id)
  );
  const missingIds = selection.selectedObservationIds.filter(
    (_id, index) => !selected[index]
  );
  if (missingIds.length) {
    invalidSelection([`以下观察ID不存在：${missingIds.join("、")}。`]);
  }
  const locked = selected as AtomicResearchObservation[];
  const fingerprints = locked.map((item) =>
    normalizeFingerprint(`${item.label}${item.value}`)
  );
  if (new Set(fingerprints).size !== fingerprints.length) {
    invalidSelection(["选中观察中存在重复的原子事实。"]);
  }

  const research: ProductResearch = {
    productName: selection.productName,
    category: selection.category,
    brand: selection.brand,
    summary: selection.summary,
    facts: locked.map((observation, index) => {
      const highConfidence = observation.confidence >= 0.85;
      return {
        id: `fact-${String(index + 1).padStart(2, "0")}`,
        label: observation.label,
        value: observation.value,
        evidence: observation.evidence,
        sourceAssetIds: [observation.assetId],
        sourceType: observation.sourceType,
        claimScope: observation.claimScope,
        entityType: observation.entityType,
        ocrConfidence: observation.confidence,
        status: highConfidence
          ? "verified"
          : observation.sourceType === "image_text"
            ? "blocked"
            : "candidate",
        commercialUse: highConfidence
      };
    }),
    visualAudit: selection.visualAudit,
    visualKeywords: selection.visualKeywords,
    risks: selection.risks,
    source: "model",
    generatedAt: options.generatedAt ?? new Date().toISOString()
  };
  return research;
}
