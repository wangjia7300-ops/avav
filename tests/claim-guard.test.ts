import { describe, expect, it } from "vitest";
import { findClaimGuardIssues } from "@/lib/skill-suite/claim-guard";
import type {
  DetailScreen,
  EvidenceFact,
  ScreenCopy
} from "@/lib/types";

function fact(
  id: string,
  value: string,
  evidence = `甲方产品图文字“${value}”`
): EvidenceFact {
  return {
    id,
    label: value,
    value,
    evidence,
    sourceAssetIds: ["asset-01"],
    sourceType: "image_text",
    claimScope: "performance",
    entityType: "feature",
    ocrConfidence: 1,
    status: "candidate",
    commercialUse: true
  };
}

function screen(input: {
  id?: string;
  claimScope?: DetailScreen["claimScope"];
  evidenceIds?: string[];
  copy: Partial<ScreenCopy>;
}): DetailScreen {
  return {
    id: input.id ?? "screen-01",
    index: 1,
    subjectKey: `test:${input.id ?? "screen-01"}`,
    userQuestion: "这项信息对用户有什么用？",
    role: "卖点页",
    conversionTask: "展示产品卖点",
    primarySellingPoint: input.copy.headline ?? "产品卖点",
    claimScope: input.claimScope ?? "performance",
    evidenceIds: input.evidenceIds ?? ["fact-01"],
    proofMethod: "甲方产品图",
    copy: {
      headline: input.copy.headline ?? "产品卖点",
      subheadline: input.copy.subheadline ?? "基础说明",
      body: input.copy.body ?? "甲方基础资料",
      keyPoints: input.copy.keyPoints ?? ["基础卖点"]
    },
    scene: "产品场景",
    shot: "产品特写",
    composition: "9:16",
    transition: "自然过渡"
  };
}

describe("claim guard", () => {
  it("reports cleaning-result escalation without mutating copy or facts", () => {
    const facts = [fact("fact-01", "釉面光洁易清洗、日常好打理")];
    const target = screen({
      copy: {
        headline: "釉面光洁 一冲即净",
        body: "告别顽固油污，一擦即净，无需反复刷洗，简单冲洗就能洁净如新"
      }
    });
    const before = JSON.stringify({ target, facts });

    const issues = findClaimGuardIssues({ screens: [target], facts });

    expect(
      issues.filter((issue) => issue.ruleId === "cleaning-result-escalation")
    ).toHaveLength(5);
    expect(JSON.stringify({ target, facts })).toBe(before);
  });

  it("allows exact uploaded-image wording even when it is a strong claim", () => {
    const facts = [
      fact("fact-01", "一冲即净", "甲方上传产品图原文：釉面光洁，一冲即净"),
      fact(
        "fact-02",
        "可放心放入微波炉加热",
        "甲方上传产品图原文：可放心放入微波炉加热"
      ),
      fact(
        "fact-03",
        "不含铅镉等有害物质，可进微波炉等加热",
        "甲方上传产品图原文：不含铅镉等有害物质，可进微波炉等加热"
      )
    ];
    const screens = [
      screen({
        evidenceIds: ["fact-01"],
        copy: { headline: "釉面光洁 一冲即净" }
      }),
      screen({
        id: "screen-02",
        evidenceIds: ["fact-02"],
        copy: { body: "可放心放入微波炉加热" }
      }),
      screen({
        id: "screen-03",
        evidenceIds: ["fact-03"],
        copy: {
          headline: "可进微波炉等加热",
          body: "不含铅镉等有害物质"
        }
      })
    ];

    expect(findClaimGuardIssues({ screens, facts })).toEqual([]);
  });

  it("reports a one-pass complete absorption result when the source only says strong absorption", () => {
    const facts = [fact("fact-01", "加厚纤维布，超强吸水")];
    const target = screen({
      copy: {
        headline: "水渍一擦全吸干",
        subheadline: "加厚纤维布，超强吸水"
      }
    });

    expect(findClaimGuardIssues({ screens: [target], facts })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "absorption-result-escalation",
          kind: "claim-strength-escalation",
          field: "copy.headline",
          phrase: "水渍一擦全吸干"
        })
      ])
    );
  });

  it("allows the exact complete absorption wording when it comes from an authorized image", () => {
    const facts = [
      fact(
        "fact-01",
        "水渍一擦全吸干",
        "甲方上传产品图原文：水渍一擦全吸干"
      )
    ];
    const target = screen({
      copy: {
        headline: "水渍一擦全吸干"
      }
    });

    expect(
      findClaimGuardIssues({ screens: [target], facts }).filter(
        (issue) => issue.ruleId === "absorption-result-escalation"
      )
    ).toEqual([]);
  });

  it("detects mop performance and mechanism language outside their claim scopes", () => {
    const facts = [
      {
        ...fact("fact-01", "不锈钢、PP、细纤维"),
        claimScope: "material" as const,
        entityType: "material" as const
      }
    ];
    const target = screen({
      claimScope: "material",
      evidenceIds: ["fact-01"],
      copy: {
        headline: "分件用材更耐用",
        body: "双驱动旋转水篮完成清洗脱水。"
      }
    });

    const issues = findClaimGuardIssues({ screens: [target], facts }).filter(
      (issue) => issue.kind === "claim-scope-mismatch"
    );
    expect(new Set(issues.map((issue) => issue.ruleId))).toEqual(
      new Set([
        "mop-performance-scope-mismatch",
        "mop-mechanism-scope-mismatch"
      ])
    );
  });

  it("allows mop performance and mechanism wording in their matching scopes", () => {
    const facts = [
      fact("fact-01", "加厚纤维布，超强吸水"),
      {
        ...fact("fact-02", "双驱动旋转清洗脱水"),
        claimScope: "mechanism" as const
      }
    ];
    const screens = [
      screen({
        evidenceIds: ["fact-01"],
        copy: {
          headline: "水渍清理更省力",
          subheadline: "加厚纤维布，超强吸水"
        }
      }),
      screen({
        id: "screen-02",
        claimScope: "mechanism",
        evidenceIds: ["fact-02"],
        copy: {
          headline: "双驱动旋转清洗",
          body: "旋转水篮完成清洗脱水。"
        }
      })
    ];

    expect(
      findClaimGuardIssues({ screens, facts }).filter(
        (issue) => issue.kind === "claim-scope-mismatch"
      )
    ).toEqual([]);
  });

  it("reports anti-slip to spill-proof and food-contact safety escalation", () => {
    const facts = [
      fact("fact-01", "防滑碗底，贴合桌面，稳固不晃"),
      fact(
        "fact-02",
        "不含铅镉等有害物质，可进微波炉等加热"
      )
    ];
    const screens = [
      screen({
        evidenceIds: ["fact-01"],
        copy: {
          body: "碗底防滑，盛汤不用担心洒漏",
          keyPoints: ["稳放不晃防洒漏"]
        }
      }),
      screen({
        id: "screen-02",
        evidenceIds: ["fact-02"],
        copy: {
          headline: "安全实用，加热更安心",
          body: "不含铅镉等有害物质，可放心放入微波炉加热",
          keyPoints: ["无铅镉更安全"]
        }
      })
    ];

    const issues = findClaimGuardIssues({ screens, facts });
    expect(
      issues.filter((issue) => issue.ruleId === "anti-slip-to-spill-proof")
    ).toHaveLength(2);
    expect(
      issues.filter((issue) => issue.ruleId === "food-contact-safety-escalation")
    ).toHaveLength(5);
  });

  it("reports unsupported functional claims on creative screens with no evidence", () => {
    const target = screen({
      claimScope: "creative",
      evidenceIds: [],
      copy: {
        headline: "大小合适 顺手好用",
        body: "省下清洗时间，可轻松叠放并节省空间",
        keyPoints: ["适配常规橱柜层高"]
      }
    });

    const issues = findClaimGuardIssues({ screens: [target], facts: [] });
    expect(
      new Set(issues.map((issue) => issue.ruleId))
    ).toEqual(
      new Set([
        "creative-size-fit-without-evidence",
        "creative-time-saving-without-evidence",
        "creative-stacking-without-evidence"
      ])
    );
    expect(
      issues.every(
        (issue) => issue.kind === "creative-claim-without-evidence"
      )
    ).toBe(true);
  });

  it("reports internal commercial-use and evidence-count metadata in prompts", () => {
    const target = screen({ copy: { headline: "纯白浮雕陶瓷碗" } });
    const issues = findClaimGuardIssues({
      screens: [target],
      facts: [],
      executions: [
        {
          screenId: target.id,
          visualPrompt: "White ceramic bowl. Commercial use allowed.",
          englishPrompt:
            "This screen is grounded by 3 approved evidence item(s)."
        }
      ]
    });

    expect(issues).toMatchObject([
      {
        ruleId: "commercial-use-metadata-leak",
        kind: "internal-prompt-metadata",
        field: "execution.visualPrompt"
      },
      {
        ruleId: "evidence-count-metadata-leak",
        kind: "internal-prompt-metadata",
        field: "execution.englishPrompt"
      }
    ]);
  });
});
