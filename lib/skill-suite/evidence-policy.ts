import type { ProductResearch } from "@/lib/types";
import { collectResearchStructureIssues } from "@/lib/skill-suite/research-normalization";

const MIN_COMMERCIAL_OCR_CONFIDENCE = 0.85;

const EXPLICIT_REVIEW_SIGNAL =
  /(?:存在|出现|发现|多图|图片间|前后).{0,12}(?:数值|OCR|识别|标注|内容)?.{0,8}(?:冲突|不一致|矛盾)|(?:低置信度|OCR置信度低|待人工(?:核对|复核)|无法确认(?:原文|数值))/iu;

const NEGATED_CONFLICT_SIGNAL =
  /(?:无|没有|未发现)(?:明显)?(?:冲突|不一致|矛盾)/iu;

function normalizeLabel(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s：:，,。；;、/\\|()[\]{}]+/gu, "");
}

function normalizeValue(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[–—~～至到]/gu, "-")
    .replace(/\s+/gu, "");
}

function hasExplicitReviewSignal(evidence: string) {
  return (
    !NEGATED_CONFLICT_SIGNAL.test(evidence) &&
    EXPLICIT_REVIEW_SIGNAL.test(evidence)
  );
}

function collectStructureBlockedFactIndexes(
  research: ProductResearch,
  uploaded: ReadonlySet<string>
) {
  const facts = research.facts.map((fact) => {
    const comesFromUploadedImage = fact.sourceAssetIds.some((id) =>
      uploaded.has(id)
    );
    if (!comesFromUploadedImage) return fact;

    return {
      ...fact,
      status: "candidate" as const,
      commercialUse: true
    };
  });
  const issues = collectResearchStructureIssues(
    { ...research, facts },
    { allowedAssetIds: [...uploaded] }
  );
  const blocked = new Set<number>();

  issues.forEach((issue) => {
    if (
      !/model_inference|OCR 置信度|低置信度 image_text|数值\/OCR冲突|互不一致的数值范围/iu.test(
        issue.message
      )
    ) {
      return;
    }
    const match = /^facts\[(\d+)\]\.(?:status|commercialUse)$/u.exec(
      issue.path
    );
    if (match) blocked.add(Number(match[1]));
  });

  return blocked;
}

function collectCrossImageConflictIndexes(
  research: ProductResearch,
  uploaded: ReadonlySet<string>
) {
  const groups = new Map<string, number[]>();

  research.facts.forEach((fact, index) => {
    const uploadedSources = fact.sourceAssetIds.filter((id) => uploaded.has(id));
    if (!uploadedSources.length) return;

    const isSpecificationLike =
      fact.claimScope === "specification" ||
      fact.entityType === "specification" ||
      /\d/u.test(fact.value);
    if (!isSpecificationLike) return;

    const key = [
      fact.claimScope,
      fact.entityType,
      normalizeLabel(fact.label)
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  const blocked = new Set<number>();
  groups.forEach((indexes) => {
    const values = new Set(
      indexes.map((index) => normalizeValue(research.facts[index].value))
    );
    const assets = new Set(
      indexes.flatMap((index) =>
        research.facts[index].sourceAssetIds.filter((id) => uploaded.has(id))
      )
    );
    if (values.size > 1 && assets.size > 1) {
      indexes.forEach((index) => blocked.add(index));
    }
  });

  return blocked;
}

function blockFact(fact: ProductResearch["facts"][number], reason: string) {
  return {
    ...fact,
    status: "blocked" as const,
    commercialUse: false,
    evidence: fact.evidence.includes(reason)
      ? fact.evidence
      : `${fact.evidence}；${reason}`
  };
}

export function authorizeUploadedImageFacts(
  research: ProductResearch,
  uploadedAssetIds: readonly string[]
): ProductResearch {
  const uploaded = new Set(uploadedAssetIds);
  const structureBlocked = collectStructureBlockedFactIndexes(
    research,
    uploaded
  );
  const crossImageConflicts = collectCrossImageConflictIndexes(
    research,
    uploaded
  );
  const facts = research.facts.map((fact, index) => {
    const comesFromUploadedImage = fact.sourceAssetIds.some((id) =>
      uploaded.has(id)
    );
    if (!comesFromUploadedImage) return fact;

    if (fact.sourceType === "model_inference") {
      return blockFact(
        fact,
        "该内容不是图片直接可见信息，按模型推测阻断。"
      );
    }

    if (
      fact.sourceType === "image_text" &&
      fact.ocrConfidence < MIN_COMMERCIAL_OCR_CONFIDENCE
    ) {
      return blockFact(
        fact,
        `OCR置信度低于${MIN_COMMERCIAL_OCR_CONFIDENCE}，待人工核对图片原文后再开放。`
      );
    }

    if (crossImageConflicts.has(index)) {
      return blockFact(
        fact,
        "多张上传图片中的同项规格互相矛盾，待人工核对原图后再开放。"
      );
    }

    if (
      structureBlocked.has(index) ||
      hasExplicitReviewSignal(fact.evidence)
    ) {
      return blockFact(
        fact,
        "该事实存在OCR或数值冲突，待人工核对原图后再开放。"
      );
    }

    return {
      ...fact,
      status:
        fact.status === "verified"
          ? ("verified" as const)
          : ("candidate" as const),
      commercialUse: true,
      evidence: /甲方|用户上传|产品图/.test(fact.evidence)
        ? fact.evidence
        : `${fact.evidence}；来源为甲方用户上传产品图，按一方基础资料授权使用。`
    };
  });

  const brandFact = facts.find(
    (fact) =>
      fact.entityType === "brand" &&
      fact.sourceType === "image_text" &&
      fact.ocrConfidence >= 0.85 &&
      fact.status !== "blocked" &&
      fact.commercialUse
  );

  return {
    ...research,
    brand: brandFact?.value ?? "未识别",
    facts
  };
}
