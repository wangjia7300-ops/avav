import { describe, expect, it } from "vitest";
import {
  buildAtomicResearchExtractionSchema,
  buildProductResearchFromSelection,
  buildResearchFinalizeSchema,
  parseAtomicResearchObservations,
  parseResearchFinalizeSelection
} from "@/lib/skill-suite/research-atomic-contract";
import { assertResearch, SkillSuiteValidationError } from "@/lib/skill-suite/validation";

const auditKeys = [
  "composition",
  "sellingHierarchy",
  "color",
  "typography",
  "visualPath",
  "material",
  "algorithmFit",
  "emotion"
] as const;

function rawObservation(assetId: string, index: number) {
  return {
    assetId,
    label: `原子事实${index}`,
    value: `图片中可见的不同内容${index}`,
    evidence: `${assetId}的直接可见证据${index}`,
    sourceType: "visual_observation",
    claimScope: "appearance",
    entityType: "product",
    confidence: 0.96
  };
}

function finalizePayload(selectedObservationIds: string[]) {
  return {
    selectedObservationIds,
    productName: "测试产品",
    category: "测试品类",
    brand: "未识别",
    summary: "只基于已锁定原子观察生成的研究摘要。",
    visualAudit: auditKeys.map((key) => ({
      key,
      title: `${key}维度`,
      finding: `${key}的可见发现`,
      recommendation: `${key}的执行建议`
    })),
    visualKeywords: ["清晰", "细节", "真实"],
    risks: []
  };
}

describe("research atomic observation contract", () => {
  it("三图提取协议将合法输出限制在12条紧凑观察内", () => {
    const schema = buildAtomicResearchExtractionSchema([
      "asset-a",
      "asset-b",
      "asset-c"
    ]);
    const properties = schema.properties as Record<string, unknown>;
    const observations = properties.observations as Record<string, unknown>;
    const item = observations.items as Record<string, unknown>;
    const fields = item.properties as Record<string, Record<string, unknown>>;

    expect(observations.minItems).toBe(6);
    expect(observations.maxItems).toBe(12);
    expect(fields.label.maxLength).toBeLessThanOrEqual(32);
    expect(fields.value.maxLength).toBeLessThanOrEqual(100);
    expect(fields.evidence.maxLength).toBeLessThanOrEqual(120);
  });

  it("由程序为模型提取的观察分配可追溯ID，且Schema只允许当前批次素材", () => {
    const schema = buildAtomicResearchExtractionSchema(["asset-a", "asset-b"]);
    const properties = schema.properties as Record<string, unknown>;
    const observationSchema = properties.observations as Record<string, unknown>;
    const itemSchema = observationSchema.items as Record<string, unknown>;
    const items = itemSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(items.assetId.enum).toEqual(["asset-a", "asset-b"]);
    expect(items).not.toHaveProperty("observationId");

    const parsed = parseAtomicResearchObservations(
      JSON.stringify({
        observations: [
          rawObservation("asset-a", 1),
          rawObservation("asset-a", 2),
          rawObservation("asset-a", 3),
          rawObservation("asset-b", 4),
          rawObservation("asset-b", 5),
          rawObservation("asset-b", 6)
        ]
      }),
      ["asset-a", "asset-b"]
    );

    expect(parsed.map((item) => item.observationId)).toEqual([
      "obs:asset-a:1",
      "obs:asset-a:2",
      "obs:asset-a:3",
      "obs:asset-b:1",
      "obs:asset-b:2",
      "obs:asset-b:3"
    ]);
  });

  it("最终模型只能选择已锁定观察，不能选择未知ID或携带改写后的facts", () => {
    const allowedIds = Array.from({ length: 6 }, (_, index) => `obs:a:${index + 1}`);
    const schema = buildResearchFinalizeSchema(allowedIds);
    const properties = schema.properties as Record<string, unknown>;
    expect(properties).not.toHaveProperty("facts");
    const selectedSchema = properties.selectedObservationIds as Record<
      string,
      unknown
    >;
    const selectedItems = selectedSchema.items as Record<string, unknown>;
    expect(
      selectedItems.enum
    ).toEqual(allowedIds);

    expect(() =>
      parseResearchFinalizeSelection(
        JSON.stringify({
          ...finalizePayload([...allowedIds.slice(0, 5), "obs:unknown:1"])
        }),
        allowedIds
      )
    ).toThrowError(
      expect.objectContaining<Partial<SkillSuiteValidationError>>({
        code: "RESEARCH_FINALIZE_SELECTION_INVALID"
      })
    );

    expect(() =>
      parseResearchFinalizeSelection(
        JSON.stringify({
          ...finalizePayload(allowedIds),
          facts: [{ label: "模型企图改写事实" }]
        }),
        allowedIds
      )
    ).toThrowError(
      expect.objectContaining<Partial<SkillSuiteValidationError>>({
        code: "RESEARCH_FINALIZE_SELECTION_INVALID"
      })
    );
  });

  it("根据选中ID构造可通过生产校验的ProductResearch，事实原文不经最终模型改写", () => {
    const observations = parseAtomicResearchObservations(
      JSON.stringify({
        observations: Array.from({ length: 6 }, (_, index) =>
          rawObservation("asset-a", index + 1)
        )
      }),
      ["asset-a"]
    );
    const selection = parseResearchFinalizeSelection(
      JSON.stringify(
        finalizePayload(observations.map((item) => item.observationId))
      ),
      observations.map((item) => item.observationId)
    );

    const result = buildProductResearchFromSelection(selection, observations, {
      generatedAt: "2026-08-03T00:00:00.000Z"
    });

    expect(result.facts[0]).toMatchObject({
      id: "fact-01",
      label: observations[0].label,
      value: observations[0].value,
      evidence: observations[0].evidence,
      sourceAssetIds: [observations[0].assetId]
    });
    expect(result.source).toBe("model");
    expect(result.generatedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(() => assertResearch(result)).not.toThrow();
  });
});
