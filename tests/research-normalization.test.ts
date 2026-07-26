import { describe, expect, it } from "vitest";
import {
  buildResearchRepairIssueList,
  collectResearchStructureIssues,
  normalizeResearchDraft,
  RESEARCH_AUDIT_KEYS
} from "@/lib/skill-suite/research-normalization";

function auditDimension(title: string) {
  return {
    title,
    finding: `${title}具体发现`,
    recommendation: `${title}可执行建议`,
    retainedMetadata: `${title}-metadata`
  };
}

function validFact(index: number) {
  return {
    id: `fact-${String(index).padStart(2, "0")}`,
    label: `事实${index}`,
    value: `事实值${index}`,
    evidence: `asset-01中的可见证据${index}`,
    sourceAssetIds: ["asset-01"],
    sourceType: "visual_observation",
    claimScope: "appearance",
    entityType: "product",
    ocrConfidence: 1,
    status: "verified",
    commercialUse: true
  };
}

function realArkLikePayload() {
  return {
    productName: "浮雕纹理陶瓷碗",
    category: "餐具>陶瓷碗",
    brand: "无",
    summary: "白色浮雕纹理陶瓷碗及其图中文字卖点。",
    facts: [
      validFact(1),
      {
        ...validFact(2),
        sourceType: "image_text",
        claimScope: "performance",
        entityType: "feature",
        status: "candidate"
      },
      {
        ...validFact(3),
        label: "材质与使用性能",
        value: "采用优质陶土高温淬烧，可进微波炉加热",
        sourceType: "image_text",
        claimScope: "material,performance",
        entityType: "material,feature",
        status: "candidate"
      },
      {
        ...validFact(4),
        label: "内壁性能",
        sourceType: "image_text,visual_observation",
        claimScope: "appearance,performance",
        entityType: "feature",
        status: "candidate"
      },
      {
        ...validFact(5),
        label: "碗底防滑设计",
        sourceType: "image_text,visual_observation",
        claimScope: "feature",
        entityType: "feature",
        status: "candidate"
      },
      {
        ...validFact(6),
        sourceType: "image_text",
        claimScope: "specification",
        entityType: "specification",
        status: "candidate"
      }
    ],
    visualAudit: {
      emotion: auditDimension("情绪设计"),
      composition: auditDimension("构图"),
      typography: auditDimension("字体"),
      material: auditDimension("材质工艺"),
      sellingHierarchy: auditDimension("卖点层级"),
      visualPath: auditDimension("视觉动线"),
      algorithmFit: auditDimension("算法适配"),
      color: auditDimension("配色")
    },
    visualKeywords: ["浮雕陶瓷碗", "防滑碗底", "光滑釉面"],
    risks: [],
    source: ["asset-01", "asset-02", "asset-03", "asset-04"],
    generatedAt: "2024-05-20T14:30:00+08:00"
  };
}

function validResearchPayload() {
  const payload = realArkLikePayload();
  return {
    ...payload,
    facts: Array.from({ length: 6 }, (_, index) => validFact(index + 1)),
    source: "model"
  };
}

describe("research result normalization", () => {
  it("losslessly converts a keyed visualAudit object into the fixed eight-item array", () => {
    const raw = realArkLikePayload();
    const normalized = normalizeResearchDraft(raw) as {
      visualAudit: Array<Record<string, unknown>>;
    };

    expect(Array.isArray(normalized.visualAudit)).toBe(true);
    expect(normalized.visualAudit.map((item) => item.key)).toEqual([
      ...RESEARCH_AUDIT_KEYS
    ]);
    expect(normalized.visualAudit[0]).toMatchObject({
      key: "composition",
      title: "构图",
      retainedMetadata: "构图-metadata"
    });
    expect(raw.visualAudit).not.toBe(normalized.visualAudit);
  });

  it("reports every compound or invalid enum at its exact fact path", () => {
    const issues = collectResearchStructureIssues(realArkLikePayload(), {
      allowedAssetIds: ["asset-01", "asset-02", "asset-03", "asset-04"]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "facts[2].claimScope",
          code: "COMPOSITE_ENUM"
        }),
        expect.objectContaining({
          path: "facts[2].entityType",
          code: "COMPOSITE_ENUM"
        }),
        expect.objectContaining({
          path: "facts[3].sourceType",
          code: "COMPOSITE_ENUM"
        }),
        expect.objectContaining({
          path: "facts[3].claimScope",
          code: "COMPOSITE_ENUM"
        }),
        expect.objectContaining({
          path: "facts[4].sourceType",
          code: "COMPOSITE_ENUM"
        }),
        expect.objectContaining({
          path: "facts[4].claimScope",
          code: "INVALID_ENUM"
        }),
        expect.objectContaining({
          path: "source",
          code: "TYPE_MISMATCH"
        })
      ])
    );
    expect(issues.some((issue) => issue.path === "visualAudit")).toBe(false);
  });

  it("builds model-ready repair instructions without coercing compound enums", () => {
    const raw = realArkLikePayload();
    const instructions = buildResearchRepairIssueList(raw);
    const normalized = normalizeResearchDraft(raw) as typeof raw;

    expect(instructions.join("\n")).toContain("facts[2].claimScope");
    expect(instructions.join("\n")).toContain("拆成多条原子事实");
    expect(normalized.facts[2].claimScope).toBe("material,performance");
    expect(normalized.facts[3].sourceType).toBe(
      "image_text,visual_observation"
    );
  });

  it("reports missing fields, out-of-scope asset ids, and unsafe cross-field combinations", () => {
    const payload = realArkLikePayload();
    payload.facts[0] = {
      ...payload.facts[0],
      label: "",
      sourceAssetIds: ["asset-outside"],
      sourceType: "model_inference",
      commercialUse: true
    };
    delete (payload.facts[0] as Partial<(typeof payload.facts)[number]>)
      .evidence;

    const issues = collectResearchStructureIssues(payload, {
      allowedAssetIds: ["asset-01"]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "facts[0].label",
          code: "TYPE_MISMATCH"
        }),
        expect.objectContaining({
          path: "facts[0].evidence",
          code: "MISSING_FIELD"
        }),
        expect.objectContaining({
          path: "facts[0].sourceAssetIds[0]",
          code: "INVALID_ENUM"
        }),
        expect.objectContaining({
          path: "facts[0].commercialUse",
          code: "CROSS_FIELD_CONFLICT"
        })
      ])
    );
  });

  it("does not normalize a keyed audit when doing so would overwrite a conflicting inner key", () => {
    const raw = realArkLikePayload();
    raw.visualAudit.composition = {
      ...raw.visualAudit.composition,
      key: "color"
    } as typeof raw.visualAudit.composition;

    const normalized = normalizeResearchDraft(raw) as typeof raw;
    const issues = collectResearchStructureIssues(raw);

    expect(Array.isArray(normalized.visualAudit)).toBe(false);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "visualAudit",
          code: "TYPE_MISMATCH"
        })
      ])
    );
  });

  it("rejects a material fact that smuggles in durability or absorption performance claims", () => {
    const payload = validResearchPayload();
    payload.facts[0] = {
      ...payload.facts[0],
      label: "拖布材质与耐用性",
      value: "加厚超细纤维布，更耐用、吸水更快",
      evidence: "产品图文字写有加厚纤维布、超强吸水",
      sourceType: "image_text",
      claimScope: "material",
      entityType: "material",
      status: "candidate",
      commercialUse: true
    };

    const issues = collectResearchStructureIssues(payload, {
      allowedAssetIds: ["asset-01"]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "facts[0].claimScope",
          code: "CROSS_FIELD_CONFLICT",
          message: expect.stringContaining("拆成多条原子事实")
        })
      ])
    );
    expect(
      issues.find((issue) => issue.path === "facts[0].claimScope")?.message
    ).toContain("性能/用户效果(performance)");
  });

  it("rejects performance and mechanism semantics fused into one mop fact", () => {
    const payload = validResearchPayload();
    payload.facts[0] = {
      ...payload.facts[0],
      label: "双驱旋转更省力",
      value: "双驱动旋转清洗脱水，使用更省力",
      evidence: "产品图写有省力双驱动、轻松清洗脱水",
      sourceType: "image_text",
      claimScope: "mechanism",
      entityType: "feature",
      status: "candidate",
      commercialUse: true
    };

    const issues = collectResearchStructureIssues(payload, {
      allowedAssetIds: ["asset-01"]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "facts[0].claimScope",
          code: "CROSS_FIELD_CONFLICT",
          message: expect.stringContaining("性能/用户效果(performance)")
        })
      ])
    );
  });

  it("blocks conflicting OCR ranges until a human reviews the original image", () => {
    const payload = validResearchPayload();
    payload.facts[0] = {
      ...payload.facts[0],
      label: "拖把杆伸缩范围",
      value: "100–127cm",
      evidence: "产品尺寸图中标注100—172cm",
      sourceType: "image_text",
      claimScope: "specification",
      entityType: "specification",
      ocrConfidence: 0.96,
      status: "candidate",
      commercialUse: true
    };

    const issues = collectResearchStructureIssues(payload, {
      allowedAssetIds: ["asset-01"]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "facts[0].status",
          code: "CROSS_FIELD_CONFLICT",
          message: expect.stringContaining("100–127cm")
        }),
        expect.objectContaining({
          path: "facts[0].commercialUse",
          code: "CROSS_FIELD_CONFLICT",
          message: expect.stringContaining("100—172cm")
        })
      ])
    );

    payload.facts[0] = {
      ...payload.facts[0],
      status: "blocked",
      commercialUse: false
    };
    const blockedIssues = collectResearchStructureIssues(payload, {
      allowedAssetIds: ["asset-01"]
    });

    expect(
      blockedIssues.some(
        (issue) =>
          issue.path === "facts[0].status" ||
          issue.path === "facts[0].commercialUse"
      )
    ).toBe(false);
  });

  it("requires low-confidence OCR and unsupported model inference to remain blocked", () => {
    const payload = validResearchPayload();
    payload.facts[0] = {
      ...payload.facts[0],
      sourceType: "image_text",
      claimScope: "specification",
      entityType: "specification",
      ocrConfidence: 0.62,
      status: "candidate",
      commercialUse: true
    };
    payload.facts[1] = {
      ...payload.facts[1],
      label: "推断清洁效果",
      value: "可能提升去污效果",
      evidence: "模型根据外观推测，图片和用户原文未直接说明",
      sourceType: "model_inference",
      claimScope: "performance",
      entityType: "feature",
      status: "candidate",
      commercialUse: true
    };

    const issues = collectResearchStructureIssues(payload, {
      allowedAssetIds: ["asset-01"]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "facts[0].status",
          code: "CROSS_FIELD_CONFLICT",
          message: expect.stringContaining("0.85")
        }),
        expect.objectContaining({
          path: "facts[0].commercialUse",
          code: "CROSS_FIELD_CONFLICT"
        }),
        expect.objectContaining({
          path: "facts[1].status",
          code: "CROSS_FIELD_CONFLICT",
          message: expect.stringContaining("model_inference")
        }),
        expect.objectContaining({
          path: "facts[1].commercialUse",
          code: "CROSS_FIELD_CONFLICT",
          message: expect.stringContaining("用户原文")
        })
      ])
    );
  });
});
