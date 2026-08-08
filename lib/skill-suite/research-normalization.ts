const RESEARCH_AUDIT_KEYS = [
  "composition",
  "sellingHierarchy",
  "color",
  "typography",
  "visualPath",
  "material",
  "algorithmFit",
  "emotion"
] as const;

const SOURCE_TYPES = [
  "visual_observation",
  "image_text",
  "user_input",
  "model_inference"
] as const;

const CLAIM_SCOPES = [
  "appearance",
  "visible_text",
  "specification",
  "material",
  "performance",
  "mechanism",
  "service",
  "promotion"
] as const;

const ENTITY_TYPES = [
  "product",
  "brand",
  "decorative_badge",
  "specification",
  "feature",
  "material",
  "other"
] as const;

const FACT_STATUSES = ["verified", "candidate", "blocked"] as const;
const RESEARCH_SOURCES = ["model", "sample"] as const;
const MIN_COMMERCIAL_OCR_CONFIDENCE = 0.85;

type AtomicClaimScope = (typeof CLAIM_SCOPES)[number];

type ScopeSignalRule = {
  scope: AtomicClaimScope;
  pattern: RegExp;
  label: string;
};

/**
 * These signals intentionally cover claims that commonly arrive fused into a
 * single ecommerce sentence. They are not used to invent a scope; they only
 * prevent a fact declared as one scope from smuggling in another scope.
 */
const CLAIM_SCOPE_SIGNAL_RULES: readonly ScopeSignalRule[] = [
  {
    scope: "material",
    pattern:
      /(?:不锈钢|聚丙烯|(?:^|[^A-Za-z])PP(?:$|[^A-Za-z])|超?细纤维|纤维布|面料|材质|塑料|棉纱)/iu,
    label: "材质"
  },
  {
    scope: "performance",
    pattern:
      /(?:更?耐用|耐磨|抗撕|防撕|吸水|锁水|省力|省时|不费力|轻松(?:清洁|洗脱|甩干)?|去污|洁净|不留水渍|全吸干|干得快|干湿两用|清洁力)/iu,
    label: "性能/用户效果"
  },
  {
    scope: "mechanism",
    // 长备选项必须排在短备选项之前：JS 正则按序短路，
    // 否则“双驱旋转”会被拆成「双驱」命中，字段级反馈丢失完整命中词。
    pattern:
      /(?:双驱旋转|双驱(?:动)?|清洗脱水一体|洗脱一体|离心(?:甩干|脱水)?|旋转(?:清洗|脱水|甩干)?|洗衣机式(?:水篮|脱水篮)|水篮结构|脱水篮)/iu,
    label: "工作机制"
  }
];

type NumericRange = {
  key: string;
  display: string;
};

const RANGE_PATTERN =
  /(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|米)?\s*(?:-|–|—|~|～|至|到)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|米)/giu;

function unitToMillimeters(value: number, unit: string) {
  switch (unit.toLowerCase()) {
    case "m":
    case "米":
      return value * 1000;
    case "cm":
    case "厘米":
      return value * 10;
    default:
      return value;
  }
}

function stableNumber(value: number) {
  return Math.round(value * 1000) / 1000;
}

function extractNumericRanges(text: string): NumericRange[] {
  const ranges: NumericRange[] = [];
  for (const match of text.matchAll(RANGE_PATTERN)) {
    const first = Number(match[1]);
    const second = Number(match[3]);
    const firstUnit = match[2] || match[4];
    const secondUnit = match[4];
    if (
      !Number.isFinite(first) ||
      !Number.isFinite(second) ||
      !firstUnit ||
      !secondUnit
    ) {
      continue;
    }

    const firstMm = unitToMillimeters(first, firstUnit);
    const secondMm = unitToMillimeters(second, secondUnit);
    const low = stableNumber(Math.min(firstMm, secondMm));
    const high = stableNumber(Math.max(firstMm, secondMm));
    ranges.push({
      key: `${low}-${high}mm`,
      display: match[0].replace(/\s+/g, "")
    });
  }
  return ranges;
}

const SCOPE_CONFLICT_FIELDS = ["label", "value", "evidence"] as const;

type ScopeConflictHit = {
  field: (typeof SCOPE_CONFLICT_FIELDS)[number];
  rule: ScopeSignalRule;
  matches: string[];
};

function globalPattern(pattern: RegExp) {
  return new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  );
}

/**
 * 字段级跨范围命中：不只说“混入了机制”，还要指出是 label/value/evidence
 * 哪个字段、命中了哪些词、属于哪个范围——修复模型才能真正“定点”。
 */
function collectScopeConflictHits(fact: UnknownRecord): ScopeConflictHit[] | null {
  if (
    !isNonEmptyString(fact.claimScope) ||
    !CLAIM_SCOPES.includes(fact.claimScope as AtomicClaimScope)
  ) {
    return null;
  }

  const hits: ScopeConflictHit[] = [];
  for (const field of SCOPE_CONFLICT_FIELDS) {
    const text = fact[field];
    if (!isNonEmptyString(text)) continue;
    for (const rule of CLAIM_SCOPE_SIGNAL_RULES) {
      if (rule.scope === fact.claimScope) continue;
      const matches = Array.from(
        new Set(
          [...text.matchAll(globalPattern(rule.pattern))]
            .map((match) => match[0].trim())
            .filter(Boolean)
        )
      );
      if (matches.length) {
        hits.push({ field, rule, matches });
      }
    }
  }
  return hits.length ? hits : null;
}

function collectNumericRangeConflict(fact: UnknownRecord) {
  const rangesByKey = new Map<string, NumericRange>();
  [fact.label, fact.value, fact.evidence]
    .filter(isNonEmptyString)
    .flatMap(extractNumericRanges)
    .forEach((range) => rangesByKey.set(range.key, range));
  return [...rangesByKey.values()];
}

type ResearchStructureIssueCode =
  | "ROOT_NOT_OBJECT"
  | "MISSING_FIELD"
  | "TYPE_MISMATCH"
  | "INVALID_ENUM"
  | "COMPOSITE_ENUM"
  | "OUT_OF_RANGE"
  | "INVALID_COUNT"
  | "DUPLICATE_VALUE"
  | "UNKNOWN_KEY"
  | "CROSS_FIELD_CONFLICT";

export type ResearchStructureIssue = {
  path: string;
  code: ResearchStructureIssueCode;
  message: string;
};

export type ResearchStructureOptions = {
  allowedAssetIds?: readonly string[];
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function describeValue(value: unknown) {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return `“${compact.length > 80 ? `${compact.slice(0, 77)}…` : compact}”`;
  }
  if (Array.isArray(value)) return `数组(${value.length}项)`;
  if (value === null) return "null";
  if (value === undefined) return "缺失";
  if (typeof value === "object") return "对象";
  return String(value);
}

function hasCompositeEnum(value: string) {
  return /[,，、|/]/.test(value);
}

function addRequiredStringIssue(
  issues: ResearchStructureIssue[],
  record: UnknownRecord,
  field: string,
  path = field
) {
  if (!(field in record)) {
    issues.push({
      path,
      code: "MISSING_FIELD",
      message: `${path} 缺失，必须返回非空字符串。`
    });
    return;
  }
  if (!isNonEmptyString(record[field])) {
    issues.push({
      path,
      code: "TYPE_MISMATCH",
      message: `${path} 必须是非空字符串，当前为 ${describeValue(record[field])}。`
    });
  }
}

function addScalarEnumIssue(
  issues: ResearchStructureIssue[],
  value: unknown,
  path: string,
  allowedValues: readonly string[]
) {
  if (!isNonEmptyString(value)) {
    issues.push({
      path,
      code: value === undefined ? "MISSING_FIELD" : "TYPE_MISMATCH",
      message: `${path} 必须是单个枚举字符串，可选值：${allowedValues.join(" / ")}；当前为 ${describeValue(value)}。`
    });
    return;
  }

  if (hasCompositeEnum(value)) {
    issues.push({
      path,
      code: "COMPOSITE_ENUM",
      message: `${path} 不得组合多个枚举值，当前为 ${describeValue(value)}。请按语义拆成多条原子事实，每条只保留一个值；不得静默取第一个。`
    });
    return;
  }

  if (!allowedValues.includes(value)) {
    issues.push({
      path,
      code: "INVALID_ENUM",
      message: `${path} 的值 ${describeValue(value)} 不在允许范围内：${allowedValues.join(" / ")}。`
    });
  }
}

function canLosslesslyNormalizeKeyedAudit(value: UnknownRecord) {
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== RESEARCH_AUDIT_KEYS.length ||
    actualKeys.some(
      (key) => !RESEARCH_AUDIT_KEYS.includes(key as (typeof RESEARCH_AUDIT_KEYS)[number])
    )
  ) {
    return false;
  }

  return RESEARCH_AUDIT_KEYS.every((key) => {
    const dimension = value[key];
    if (!isRecord(dimension)) return false;
    return !("key" in dimension) || dimension.key === key;
  });
}

/**
 * Performs representation-only normalization.
 *
 * A keyed visualAudit object is converted to the canonical ordered array only
 * when all eight keys are present and no property would be discarded or
 * overwritten. Semantic fields, including compound enum strings, are never
 * coerced here.
 */
export function normalizeResearchDraft(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.visualAudit)) return value;
  const visualAudit = value.visualAudit;
  if (!canLosslesslyNormalizeKeyedAudit(visualAudit)) return value;

  return {
    ...value,
    visualAudit: RESEARCH_AUDIT_KEYS.map((key) => ({
      ...(visualAudit[key] as UnknownRecord),
      key
    }))
  };
}

function collectFactIssues(
  facts: unknown,
  issues: ResearchStructureIssue[],
  options: ResearchStructureOptions
) {
  if (!Array.isArray(facts)) {
    issues.push({
      path: "facts",
      code: facts === undefined ? "MISSING_FIELD" : "TYPE_MISMATCH",
      message: `facts 必须是6到12项的数组，当前为 ${describeValue(facts)}。`
    });
    return;
  }

  if (facts.length < 6 || facts.length > 12) {
    issues.push({
      path: "facts",
      code: "INVALID_COUNT",
      message: `facts 必须包含6到12条原子事实，当前为${facts.length}条。`
    });
  }

  const seenIds = new Set<string>();
  const allowedAssetIds = options.allowedAssetIds
    ? new Set(options.allowedAssetIds)
    : null;

  facts.forEach((fact, index) => {
    const basePath = `facts[${index}]`;
    if (!isRecord(fact)) {
      issues.push({
        path: basePath,
        code: "TYPE_MISMATCH",
        message: `${basePath} 必须是对象，当前为 ${describeValue(fact)}。`
      });
      return;
    }

    ["id", "label", "value", "evidence"].forEach((field) =>
      addRequiredStringIssue(issues, fact, field, `${basePath}.${field}`)
    );

    if (isNonEmptyString(fact.id)) {
      if (seenIds.has(fact.id)) {
        issues.push({
          path: `${basePath}.id`,
          code: "DUPLICATE_VALUE",
          message: `${basePath}.id 与其他事实重复：${describeValue(fact.id)}。`
        });
      }
      seenIds.add(fact.id);
    }

    if (!Array.isArray(fact.sourceAssetIds) || fact.sourceAssetIds.length === 0) {
      issues.push({
        path: `${basePath}.sourceAssetIds`,
        code:
          fact.sourceAssetIds === undefined ? "MISSING_FIELD" : "TYPE_MISMATCH",
        message: `${basePath}.sourceAssetIds 必须是至少含1个素材ID的数组，当前为 ${describeValue(fact.sourceAssetIds)}。`
      });
    } else {
      fact.sourceAssetIds.forEach((assetId, assetIndex) => {
        const assetPath = `${basePath}.sourceAssetIds[${assetIndex}]`;
        if (!isNonEmptyString(assetId)) {
          issues.push({
            path: assetPath,
            code: "TYPE_MISMATCH",
            message: `${assetPath} 必须是非空字符串，当前为 ${describeValue(assetId)}。`
          });
        } else if (allowedAssetIds && !allowedAssetIds.has(assetId)) {
          issues.push({
            path: assetPath,
            code: "INVALID_ENUM",
            message: `${assetPath} 引用了本次上传范围外的素材 ${describeValue(assetId)}。`
          });
        }
      });
    }

    addScalarEnumIssue(
      issues,
      fact.sourceType,
      `${basePath}.sourceType`,
      SOURCE_TYPES
    );
    addScalarEnumIssue(
      issues,
      fact.claimScope,
      `${basePath}.claimScope`,
      CLAIM_SCOPES
    );
    addScalarEnumIssue(
      issues,
      fact.entityType,
      `${basePath}.entityType`,
      ENTITY_TYPES
    );
    addScalarEnumIssue(
      issues,
      fact.status,
      `${basePath}.status`,
      FACT_STATUSES
    );

    const scopeConflictHits = collectScopeConflictHits(fact);
    if (scopeConflictHits) {
      const hitDetails = scopeConflictHits
        .map(
          (hit) =>
            `${basePath}.${hit.field} 命中「${hit.matches.join("、")}」→ 属于 ${hit.rule.label}(${hit.rule.scope})`
        )
        .join("；");
      issues.push({
        path: `${basePath}.claimScope`,
        code: "CROSS_FIELD_CONFLICT",
        message:
          `${basePath} 声明为 ${describeValue(fact.claimScope)}，但存在跨范围语义：${hitDetails}。` +
          "请拆成多条原子事实：删除本条复合记录，每个范围新建一条事实，" +
          "label/value/evidence 每个字段都只保留本范围语义；" +
          "不得只修改 claimScope，不得把材质、性能或工作机制合并后复用同一证据，" +
          "也不得把完整原句复制到拆出的每条 evidence。"
      });
    }

    if (
      typeof fact.ocrConfidence !== "number" ||
      !Number.isFinite(fact.ocrConfidence)
    ) {
      issues.push({
        path: `${basePath}.ocrConfidence`,
        code:
          fact.ocrConfidence === undefined ? "MISSING_FIELD" : "TYPE_MISMATCH",
        message: `${basePath}.ocrConfidence 必须是0到1的数字，当前为 ${describeValue(fact.ocrConfidence)}。`
      });
    } else if (fact.ocrConfidence < 0 || fact.ocrConfidence > 1) {
      issues.push({
        path: `${basePath}.ocrConfidence`,
        code: "OUT_OF_RANGE",
        message: `${basePath}.ocrConfidence 必须在0到1之间，当前为 ${fact.ocrConfidence}。`
      });
    }

    if (typeof fact.commercialUse !== "boolean") {
      issues.push({
        path: `${basePath}.commercialUse`,
        code:
          fact.commercialUse === undefined ? "MISSING_FIELD" : "TYPE_MISMATCH",
        message: `${basePath}.commercialUse 必须是布尔值，当前为 ${describeValue(fact.commercialUse)}。`
      });
    }

    const numericRangeConflicts = collectNumericRangeConflict(fact);
    if (numericRangeConflicts.length > 1) {
      const ranges = numericRangeConflicts
        .map((range) => range.display)
        .join("、");
      if (fact.status !== "blocked") {
        issues.push({
          path: `${basePath}.status`,
          code: "CROSS_FIELD_CONFLICT",
          message:
            `${basePath} 的 label/value/evidence 出现互不一致的数值范围（${ranges}）。` +
            "禁止静默选择其中一个；当前兼容的待复核表达必须是 status=blocked，待人工核对原图。"
        });
      }
      if (fact.commercialUse !== false) {
        issues.push({
          path: `${basePath}.commercialUse`,
          code: "CROSS_FIELD_CONFLICT",
          message:
            `${basePath} 存在数值/OCR冲突（${ranges}），commercialUse 必须为 false，` +
            "不得把任一冲突数值传入策划文案。"
        });
      }
    }

    if (
      fact.sourceType === "image_text" &&
      typeof fact.ocrConfidence === "number" &&
      Number.isFinite(fact.ocrConfidence) &&
      fact.ocrConfidence < MIN_COMMERCIAL_OCR_CONFIDENCE
    ) {
      if (fact.status !== "blocked") {
        issues.push({
          path: `${basePath}.status`,
          code: "CROSS_FIELD_CONFLICT",
          message:
            `${basePath} 的 OCR 置信度 ${fact.ocrConfidence} 低于 ${MIN_COMMERCIAL_OCR_CONFIDENCE}。` +
            "当前兼容的待复核表达必须是 status=blocked；不得以 candidate/verified 进入策划。"
        });
      }
      if (fact.commercialUse !== false) {
        issues.push({
          path: `${basePath}.commercialUse`,
          code: "CROSS_FIELD_CONFLICT",
          message:
            `${basePath} 是低置信度 image_text，commercialUse 必须为 false，` +
            "待人工核对图片原文后才能开放。"
        });
      }
    }

    if (fact.status === "blocked" && fact.commercialUse === true) {
      issues.push({
        path: `${basePath}.commercialUse`,
        code: "CROSS_FIELD_CONFLICT",
        message: `${basePath} 已标为 blocked，commercialUse 不能为 true。`
      });
    }
    if (fact.sourceType === "model_inference") {
      if (fact.status !== "blocked") {
        issues.push({
          path: `${basePath}.status`,
          code: "CROSS_FIELD_CONFLICT",
          message:
            `${basePath} 来自 model_inference，表示没有图片直接事实或用户原文支撑。` +
            "若存在直接依据，请改为对应 sourceType；否则必须标为 blocked。"
        });
      }
      if (fact.commercialUse === true) {
        issues.push({
          path: `${basePath}.commercialUse`,
          code: "CROSS_FIELD_CONFLICT",
          message:
            `${basePath} 来自 model_inference，缺少图片直接事实或用户原文支撑，` +
            "commercialUse 不能为 true。"
        });
      }
    }
    if (fact.entityType === "brand" && fact.sourceType !== "image_text") {
      issues.push({
        path: `${basePath}.entityType`,
        code: "CROSS_FIELD_CONFLICT",
        message: `${basePath} 标为 brand 时，sourceType 必须是 image_text。`
      });
    }
  });
}

function collectAuditIssues(
  audit: unknown,
  issues: ResearchStructureIssue[]
) {
  if (!Array.isArray(audit)) {
    if (isRecord(audit)) {
      const keys = Object.keys(audit);
      const missing = RESEARCH_AUDIT_KEYS.filter((key) => !(key in audit));
      const unknown = keys.filter(
        (key) =>
          !RESEARCH_AUDIT_KEYS.includes(
            key as (typeof RESEARCH_AUDIT_KEYS)[number]
          )
      );
      if (missing.length) {
        issues.push({
          path: "visualAudit",
          code: "MISSING_FIELD",
          message: `visualAudit keyed object 缺少维度：${missing.join("、")}。`
        });
      }
      if (unknown.length) {
        issues.push({
          path: "visualAudit",
          code: "UNKNOWN_KEY",
          message: `visualAudit keyed object 含未知维度：${unknown.join("、")}。`
        });
      }
      if (!missing.length && !unknown.length) {
        issues.push({
          path: "visualAudit",
          code: "TYPE_MISMATCH",
          message:
            "visualAudit keyed object 未能无损转换：请检查各维度是否为对象，以及内部 key 是否与外层键一致。"
        });
      }
      return;
    }

    issues.push({
      path: "visualAudit",
      code: audit === undefined ? "MISSING_FIELD" : "TYPE_MISMATCH",
      message: `visualAudit 必须是正好8项的数组，当前为 ${describeValue(audit)}。`
    });
    return;
  }

  if (audit.length !== RESEARCH_AUDIT_KEYS.length) {
    issues.push({
      path: "visualAudit",
      code: "INVALID_COUNT",
      message: `visualAudit 必须正好8项，当前为${audit.length}项。`
    });
  }

  const seenKeys = new Set<string>();
  audit.forEach((dimension, index) => {
    const basePath = `visualAudit[${index}]`;
    if (!isRecord(dimension)) {
      issues.push({
        path: basePath,
        code: "TYPE_MISMATCH",
        message: `${basePath} 必须是对象，当前为 ${describeValue(dimension)}。`
      });
      return;
    }

    addScalarEnumIssue(
      issues,
      dimension.key,
      `${basePath}.key`,
      RESEARCH_AUDIT_KEYS
    );
    if (isNonEmptyString(dimension.key)) {
      if (seenKeys.has(dimension.key)) {
        issues.push({
          path: `${basePath}.key`,
          code: "DUPLICATE_VALUE",
          message: `${basePath}.key 重复：${describeValue(dimension.key)}。`
        });
      }
      seenKeys.add(dimension.key);
    }

    ["title", "finding", "recommendation"].forEach((field) =>
      addRequiredStringIssue(issues, dimension, field, `${basePath}.${field}`)
    );
  });

  const missingKeys = RESEARCH_AUDIT_KEYS.filter((key) => !seenKeys.has(key));
  if (missingKeys.length) {
    issues.push({
      path: "visualAudit",
      code: "MISSING_FIELD",
      message: `visualAudit 缺少维度：${missingKeys.join("、")}。`
    });
  }
}

export function collectResearchStructureIssues(
  value: unknown,
  options: ResearchStructureOptions = {}
): ResearchStructureIssue[] {
  const normalized = normalizeResearchDraft(value);
  const issues: ResearchStructureIssue[] = [];

  if (!isRecord(normalized)) {
    return [
      {
        path: "$",
        code: "ROOT_NOT_OBJECT",
        message: `图研结果根节点必须是对象，当前为 ${describeValue(normalized)}。`
      }
    ];
  }

  ["productName", "category", "brand", "summary"].forEach((field) =>
    addRequiredStringIssue(issues, normalized, field)
  );

  collectFactIssues(normalized.facts, issues, options);
  collectAuditIssues(normalized.visualAudit, issues);

  if (
    !Array.isArray(normalized.visualKeywords) ||
    normalized.visualKeywords.length < 3 ||
    !normalized.visualKeywords.every(isNonEmptyString)
  ) {
    issues.push({
      path: "visualKeywords",
      code:
        normalized.visualKeywords === undefined
          ? "MISSING_FIELD"
          : "TYPE_MISMATCH",
      message: `visualKeywords 必须是至少3项的非空字符串数组，当前为 ${describeValue(normalized.visualKeywords)}。`
    });
  }

  if (
    !Array.isArray(normalized.risks) ||
    !normalized.risks.every(isNonEmptyString)
  ) {
    issues.push({
      path: "risks",
      code: normalized.risks === undefined ? "MISSING_FIELD" : "TYPE_MISMATCH",
      message: `risks 必须是字符串数组（允许空数组），当前为 ${describeValue(normalized.risks)}。`
    });
  }

  addScalarEnumIssue(
    issues,
    normalized.source,
    "source",
    RESEARCH_SOURCES
  );

  if (!isNonEmptyString(normalized.generatedAt)) {
    issues.push({
      path: "generatedAt",
      code:
        normalized.generatedAt === undefined
          ? "MISSING_FIELD"
          : "TYPE_MISMATCH",
      message: `generatedAt 必须是ISO时间字符串，当前为 ${describeValue(normalized.generatedAt)}。`
    });
  } else if (Number.isNaN(Date.parse(normalized.generatedAt))) {
    issues.push({
      path: "generatedAt",
      code: "TYPE_MISMATCH",
      message: `generatedAt 不是有效时间：${describeValue(normalized.generatedAt)}。`
    });
  }

  return issues;
}

export function buildResearchRepairIssueList(
  value: unknown,
  options: ResearchStructureOptions = {}
) {
  return collectResearchStructureIssues(value, options).map(
    (issue, index) =>
      `${index + 1}. [${issue.code}] ${issue.path}：${issue.message}`
  );
}

export { RESEARCH_AUDIT_KEYS };
