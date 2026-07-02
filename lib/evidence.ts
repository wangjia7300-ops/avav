import type {
  EvidenceLevel,
  EvidenceMap,
  InfoSource,
  MarketEvidenceField,
  MarketResearch,
  ProductEvidenceField,
  ProductAnalysis,
  SourcedInfo
} from "@/lib/types";

const sourceLabels: Record<InfoSource, string> = {
  image_fact: "图片识别",
  user_input: "用户补充",
  web_search: "真实搜索",
  llm_inference: "AI推断",
  mock: "Mock"
};

const evidenceRank: Record<EvidenceLevel, number> = {
  S: 5,
  A: 4,
  B: 3,
  C: 2,
  forbidden: 0
};

export function sourceLabel(source?: InfoSource) {
  return source ? sourceLabels[source] : "未标注";
}

export function isForbiddenInfo(info?: SourcedInfo) {
  return info?.evidenceLevel === "forbidden";
}

export function isEvidenceLevelAllowed(level: EvidenceLevel | undefined, allowed: EvidenceLevel[]) {
  if (!level) return false;
  return allowed.includes(level) && level !== "forbidden";
}

export function canUseAsCoreClaim(info?: SourcedInfo) {
  return isEvidenceLevelAllowed(info?.evidenceLevel, ["S", "A", "B"]);
}

export function buildEvidenceItems(
  items: string[] | undefined,
  source: InfoSource,
  evidenceLevel: EvidenceLevel,
  options: {
    sourceLink?: string;
    sourceNote?: string;
  } = {}
): SourcedInfo[] {
  return (items ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      source,
      evidenceLevel,
      sourceLink: options.sourceLink,
      sourceNote: options.sourceNote
    }));
}

export function createProductEvidence(
  product: ProductAnalysis,
  source: InfoSource,
  evidenceLevel: EvidenceLevel,
  sourceNote?: string
): EvidenceMap<ProductEvidenceField> {
  return {
    category: buildEvidenceItems([product.category], source, evidenceLevel, { sourceNote }),
    productNameGuess: buildEvidenceItems([product.productNameGuess], source, evidenceLevel, { sourceNote }),
    appearance: buildEvidenceItems(product.appearance, source, evidenceLevel, { sourceNote }),
    visibleFeatures: buildEvidenceItems(product.visibleFeatures, source, evidenceLevel, { sourceNote }),
    materials: buildEvidenceItems(product.materials, source, evidenceLevel, { sourceNote }),
    colors: buildEvidenceItems(product.colors, source, evidenceLevel, { sourceNote }),
    styleKeywords: buildEvidenceItems(product.styleKeywords, source, evidenceLevel, { sourceNote }),
    risks: buildEvidenceItems(product.risks, source, "C", { sourceNote }),
    brandNames: buildEvidenceItems(
      [product.brandNames?.chinese, product.brandNames?.english].filter(Boolean) as string[],
      source,
      evidenceLevel,
      { sourceNote }
    ),
    brandVisualStyle: buildEvidenceItems(product.brandVisualStyle, source, evidenceLevel, { sourceNote }),
    specifications: buildEvidenceItems(product.specifications, source, evidenceLevel, { sourceNote }),
    sellingPoints: buildEvidenceItems(product.sellingPoints, source, evidenceLevel, { sourceNote }),
    dataSellingPoints: buildEvidenceItems(product.dataSellingPoints, source, evidenceLevel, { sourceNote }),
    targetAudience: buildEvidenceItems(product.targetAudience, "llm_inference", "C", { sourceNote }),
    parameters: buildEvidenceItems(product.parameters, source, evidenceLevel, { sourceNote }),
    productDetails: buildEvidenceItems(product.productDetails, source, evidenceLevel, { sourceNote }),
    visualStyleSystem: buildEvidenceItems(
      [
        ...(product.visualStyleSystem?.overallTone ?? []),
        ...(product.visualStyleSystem?.imageTexture ?? []),
        ...(product.visualStyleSystem?.lightingLogic ?? []),
        ...(product.visualStyleSystem?.colorSystem ?? []),
        ...(product.visualStyleSystem?.typographyRules ?? []),
        ...(product.visualStyleSystem?.compositionRules ?? [])
      ],
      source,
      evidenceLevel,
      { sourceNote }
    )
  };
}

export function mergeEvidenceMaps<TField extends string>(
  base?: EvidenceMap<TField>,
  next?: EvidenceMap<TField>
): EvidenceMap<TField> | undefined {
  if (!base && !next) return undefined;
  const merged: EvidenceMap<TField> = { ...(base ?? {}) };

  for (const [key, value] of Object.entries(next ?? {}) as Array<[TField, SourcedInfo[]]>) {
    merged[key] = [...(merged[key] ?? []), ...value];
  }

  return merged;
}

export function createMarketEvidence(
  research: MarketResearch,
  source: InfoSource,
  evidenceLevel: EvidenceLevel,
  options: {
    sourceLink?: string;
    sourceNote?: string;
  } = {}
): EvidenceMap<MarketEvidenceField> {
  const fields: MarketEvidenceField[] = [
    "hotSellingPoints",
    "userPainPoints",
    "userFeedbackPros",
    "userFeedbackCons",
    "copywritingSellingPoints",
    "certificationSellingPoints",
    "featureSellingPoints",
    "dataSellingPointInsights",
    "userQuestions",
    "aiShoppingInsights",
    "targetUserProfiles",
    "functionProblemMapping",
    "targetAudienceInsights",
    "productParameterInsights",
    "productDetailInsights",
    "designStyleJudgement",
    "competitorTitleStyles",
    "visualStyles",
    "competitorVisualBenchmarks",
    "designStrategyNotes"
  ];

  return Object.fromEntries(
    fields.map((field) => [
      field,
      buildEvidenceItems(research[field] as string[] | undefined, source, evidenceLevel, options)
    ])
  ) as EvidenceMap<MarketEvidenceField>;
}

export function getEvidenceItem(
  evidence: EvidenceMap<MarketEvidenceField | ProductEvidenceField> | undefined,
  field: MarketEvidenceField | ProductEvidenceField,
  index: number
) {
  return evidence?.[field]?.[index];
}

export function filterForbiddenItems<TField extends string>(
  items: string[] | undefined,
  evidence: EvidenceMap<TField> | undefined,
  field: TField
) {
  return (items ?? []).filter((_, index) => evidence?.[field]?.[index]?.evidenceLevel !== "forbidden");
}

export function getMarketEvidenceTexts(
  research: MarketResearch | undefined,
  field: MarketEvidenceField,
  allowed: EvidenceLevel[] = ["S", "A", "B"]
) {
  const items = research?.[field] as string[] | undefined;
  const evidence = research?.evidence?.[field];

  return (items ?? []).filter((item, index) => {
    const info = evidence?.[index];
    if (!info) return false;
    return isEvidenceLevelAllowed(info.evidenceLevel, allowed) && item.trim().length > 0;
  });
}

export function formatEvidenceTag(info?: SourcedInfo) {
  if (!info) return "来源：未标注｜证据：未标注";
  return [
    `来源：${sourceLabel(info.source)}`,
    `证据：${info.evidenceLevel ?? "未标注"}`,
    info.sourceLink ? `链接：${info.sourceLink}` : "",
    info.sourceNote ? `说明：${info.sourceNote}` : ""
  ]
    .filter(Boolean)
    .join("｜");
}

export function strongestEvidenceLevel(items: SourcedInfo[] | undefined) {
  return (items ?? []).reduce<EvidenceLevel | undefined>((best, item) => {
    if (!item.evidenceLevel || item.evidenceLevel === "forbidden") return best;
    if (!best || evidenceRank[item.evidenceLevel] > evidenceRank[best]) return item.evidenceLevel;
    return best;
  }, undefined);
}
