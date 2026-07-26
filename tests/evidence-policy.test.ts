import { describe, expect, it } from "vitest";
import type { EvidenceFact, ProductResearch } from "@/lib/types";
import { authorizeUploadedImageFacts } from "@/lib/skill-suite/evidence-policy";

function fact(
  overrides: Partial<EvidenceFact> & Pick<EvidenceFact, "id">
): EvidenceFact {
  return {
    label: "产品规格",
    value: "42cm",
    evidence: "甲方上传产品图中清晰标注42cm。",
    sourceAssetIds: ["asset-01"],
    sourceType: "image_text",
    claimScope: "specification",
    entityType: "specification",
    ocrConfidence: 0.98,
    status: "blocked",
    commercialUse: false,
    ...overrides
  };
}

function research(facts: EvidenceFact[]): ProductResearch {
  return {
    productName: "测试产品",
    category: "家居用品",
    brand: "未识别",
    summary: "测试摘要",
    facts,
    visualAudit: [
      {
        key: "composition",
        title: "构图",
        finding: "主体居中",
        recommendation: "保持主体清楚"
      },
      {
        key: "sellingHierarchy",
        title: "卖点层级",
        finding: "规格清楚",
        recommendation: "先展示规格"
      },
      {
        key: "color",
        title: "配色",
        finding: "配色清爽",
        recommendation: "延续原图配色"
      },
      {
        key: "typography",
        title: "字体",
        finding: "文字清楚",
        recommendation: "保持易读"
      },
      {
        key: "visualPath",
        title: "视觉动线",
        finding: "从上到下",
        recommendation: "保持顺序"
      },
      {
        key: "material",
        title: "材质",
        finding: "细节可见",
        recommendation: "使用近景"
      },
      {
        key: "algorithmFit",
        title: "算法适配",
        finding: "主体突出",
        recommendation: "减少干扰"
      },
      {
        key: "emotion",
        title: "情绪",
        finding: "日常自然",
        recommendation: "使用生活场景"
      }
    ],
    visualKeywords: ["清晰", "自然", "日常"],
    risks: [],
    source: "model",
    generatedAt: "2026-07-26T00:00:00.000Z"
  };
}

describe("uploaded image evidence authorization", () => {
  it("opens clear client-supplied basic facts even when the model was conservative", () => {
    const authorized = authorizeUploadedImageFacts(
      research([fact({ id: "fact-clear" })]),
      ["asset-01"]
    );

    expect(authorized.facts[0]).toMatchObject({
      status: "candidate",
      commercialUse: true
    });
  });

  it("does not reopen low-confidence OCR or model inference", () => {
    const authorized = authorizeUploadedImageFacts(
      research([
        fact({
          id: "fact-low-ocr",
          ocrConfidence: 0.62
        }),
        fact({
          id: "fact-inference",
          sourceType: "model_inference",
          claimScope: "performance",
          entityType: "feature",
          value: "可能更省力",
          evidence: "模型根据外观推测，图片没有直接说明。",
          ocrConfidence: 1
        })
      ]),
      ["asset-01"]
    );

    expect(authorized.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "fact-low-ocr",
          status: "blocked",
          commercialUse: false
        }),
        expect.objectContaining({
          id: "fact-inference",
          status: "blocked",
          commercialUse: false
        })
      ])
    );
  });

  it("does not reopen a fact with conflicting OCR ranges inside its evidence", () => {
    const authorized = authorizeUploadedImageFacts(
      research([
        fact({
          id: "fact-range-conflict",
          label: "拖把杆伸缩范围",
          value: "100–127cm",
          evidence: "另一处产品尺寸图标注100—172cm。"
        })
      ]),
      ["asset-01"]
    );

    expect(authorized.facts[0]).toMatchObject({
      status: "blocked",
      commercialUse: false
    });
    expect(authorized.facts[0].evidence).toContain("数值冲突");
  });

  it("honors an explicit cross-image review marker carried by current evidence text", () => {
    const authorized = authorizeUploadedImageFacts(
      research([
        fact({
          id: "fact-explicit-conflict",
          evidence: "多图标注内容不一致，待人工核对原图。"
        })
      ]),
      ["asset-01"]
    );

    expect(authorized.facts[0]).toMatchObject({
      status: "blocked",
      commercialUse: false
    });
  });

  it("keeps contradictory multi-image specifications blocked while opening an unrelated clear fact", () => {
    const authorized = authorizeUploadedImageFacts(
      research([
        fact({
          id: "fact-range-a",
          label: "拖把杆伸缩范围",
          value: "100–127cm",
          sourceAssetIds: ["asset-01"]
        }),
        fact({
          id: "fact-range-b",
          label: "拖把杆伸缩范围",
          value: "100–172cm",
          sourceAssetIds: ["asset-02"]
        }),
        fact({
          id: "fact-size-clear",
          label: "拖把桶高度",
          value: "23.5cm",
          sourceAssetIds: ["asset-02"]
        })
      ]),
      ["asset-01", "asset-02"]
    );

    expect(
      authorized.facts.filter((item) => item.id.startsWith("fact-range-"))
    ).toEqual([
      expect.objectContaining({ status: "blocked", commercialUse: false }),
      expect.objectContaining({ status: "blocked", commercialUse: false })
    ]);
    expect(
      authorized.facts.find((item) => item.id === "fact-size-clear")
    ).toMatchObject({ status: "candidate", commercialUse: true });
  });
});
