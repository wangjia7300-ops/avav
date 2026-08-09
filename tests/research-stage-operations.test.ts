import { beforeEach, describe, expect, it, vi } from "vitest";
import { complete } from "@/lib/skill-suite/server/shared";
import { ServiceError } from "@/lib/services/errors";
import { sanitizeUploadedAssets } from "@/lib/uploads/sanitize-image";
import type { AIProviderConfig } from "@/lib/types";

vi.mock("@/lib/skill-suite/server/shared", () => ({
  complete: vi.fn()
}));

vi.mock("@/lib/uploads/sanitize-image", () => ({
  sanitizeUploadedAssets: vi.fn()
}));

import { runResearchExtractStage } from "@/lib/skill-suite/server/research-extract-stage";
import { runResearchFinalizeStage } from "@/lib/skill-suite/server/research-finalize-stage";
import { __resetResearchRunRegistryForTests } from "@/lib/skill-suite/server/research-run-registry";

const providerConfig: AIProviderConfig = {
  providerId: "volcengine",
  apiKey: "test-key",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "test-model"
};

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

function asset(id: string) {
  return {
    id,
    dataUrl: `data:image/png;base64,raw-${id}`
  };
}

function extractionPayload(assetIds: readonly string[]) {
  return JSON.stringify({
    observations: Array.from({ length: 6 }, (_, index) => {
      const assetId = assetIds[index % assetIds.length];
      return {
        assetId,
        label: `可见原子事实${index + 1}`,
        value: `${assetId}中可见的不同产品特征${index + 1}`,
        evidence: `${assetId}的直接可见证据${index + 1}`,
        sourceType: "visual_observation",
        claimScope: "appearance",
        entityType: "product",
        confidence: 0.98
      };
    })
  });
}

function observationIds(assetIds: readonly string[]) {
  const ordinals = new Map<string, number>();
  return Array.from({ length: 6 }, (_, index) => {
    const id = assetIds[index % assetIds.length];
    const ordinal = (ordinals.get(id) ?? 0) + 1;
    ordinals.set(id, ordinal);
    return `obs:${id}:${ordinal}`;
  });
}

function finalizePayload(selectedObservationIds: readonly string[]) {
  return {
    selectedObservationIds,
    productName: "集成测试产品",
    category: "测试品类",
    brand: "未识别",
    summary: "只基于服务端锁定原子观察生成的图研摘要。",
    visualAudit: auditKeys.map((key) => ({
      key,
      title: `${key}维度`,
      finding: `${key}的可见发现`,
      recommendation: `${key}的可执行建议`
    })),
    visualKeywords: ["产品清晰", "多角度", "真实细节"],
    risks: []
  };
}

function imageCount(messages: Parameters<typeof complete>[1]) {
  return messages.reduce((total, message) => {
    if (!Array.isArray(message.content)) return total;
    return (
      total +
      message.content.filter((part) => part.type === "image_url").length
    );
  }, 0);
}

function extractRequest(assetIds: readonly string[]) {
  return {
    stage: "research" as const,
    operation: "extract" as const,
    runId: "research-run-integration-01",
    inputFingerprint: "research-input-fingerprint-01",
    batchIndex: 0,
    totalBatches: 1,
    allAssetIds: [...assetIds],
    assets: assetIds.map(asset),
    notes: "只根据甲方产品图提取"
  };
}

function finalizeRequest(assetIds: readonly string[]) {
  return {
    stage: "research" as const,
    operation: "finalize" as const,
    runId: "research-run-integration-01",
    inputFingerprint: "research-input-fingerprint-01",
    assetIds: [...assetIds],
    notes: "只根据甲方产品图提取"
  };
}

describe("research extract/finalize service operations", () => {
  beforeEach(() => {
    __resetResearchRunRegistryForTests();
    vi.mocked(complete).mockReset();
    vi.mocked(sanitizeUploadedAssets).mockReset();
    vi.mocked(sanitizeUploadedAssets).mockImplementation(async (assets) =>
      assets.map((item, index) => ({
        id: item.id,
        dataUrl: `data:image/webp;base64,sanitized-${item.id}`,
        mimeType: "image/webp" as const,
        bytes: 128 + index,
        width: 768,
        height: 768,
        sha256: `${(index + 1).toString(16)}`.repeat(64),
        encoding: "quality_86" as const
      }))
    );
  });

  it("extract每批最多发送3张清洗图，并给紧凑协议足够输出预算", async () => {
    const assetIds = ["asset-01", "asset-02", "asset-03"];
    vi.mocked(complete).mockResolvedValueOnce(extractionPayload(assetIds));

    const result = await runResearchExtractStage(
      extractRequest(assetIds),
      providerConfig
    );

    expect(result.data.accepted).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    const [, messages, maxTokens] = vi.mocked(complete).mock.calls[0];
    const options = vi.mocked(complete).mock.calls[0][3]!;
    expect(imageCount(messages)).toBe(3);
    expect(maxTokens).toBeGreaterThanOrEqual(4_800);
    expect(options.timeoutMs).toBe(90_000);

    await expect(
      runResearchExtractStage(
        {
          ...extractRequest([
            "asset-11",
            "asset-12",
            "asset-13",
            "asset-14"
          ]),
          totalBatches: 2
        },
        providerConfig
      )
    ).rejects.toMatchObject({
      code: "RESEARCH_EXTRACT_ASSET_COUNT_INVALID",
      statusCode: 400
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("单个提取批次首次被长度截断时会自动紧凑重试，且不会重做已成功批次", async () => {
    const allAssetIds = [
      "asset-01",
      "asset-02",
      "asset-03",
      "asset-04",
      "asset-05",
      "asset-06"
    ];
    const firstBatchAssetIds = allAssetIds.slice(0, 3);
    const secondBatchAssetIds = allAssetIds.slice(3);
    const batchRequest = (batchIndex: number, assetIds: string[]) => ({
      ...extractRequest(allAssetIds),
      batchIndex,
      totalBatches: 2,
      allAssetIds,
      assets: assetIds.map(asset)
    });

    vi.mocked(complete)
      .mockResolvedValueOnce(extractionPayload(firstBatchAssetIds))
      .mockRejectedValueOnce(
        new ServiceError("AI 输出达到长度上限，响应已被截断。", {
          statusCode: 502,
          code: "AI_RESPONSE_TRUNCATED"
        })
      )
      .mockResolvedValueOnce(extractionPayload(secondBatchAssetIds));

    const firstBatch = await runResearchExtractStage(
      batchRequest(0, firstBatchAssetIds),
      providerConfig
    );
    const recoveredSecondBatch = await runResearchExtractStage(
      batchRequest(1, secondBatchAssetIds),
      providerConfig
    );
    const cachedFirstBatch = await runResearchExtractStage(
      batchRequest(0, firstBatchAssetIds),
      providerConfig
    );

    expect(firstBatch.data.completedBatchIndexes).toEqual([0]);
    expect(recoveredSecondBatch.data.completedBatchIndexes).toEqual([0, 1]);
    expect(cachedFirstBatch.data.cached).toBe(true);
    expect(cachedFirstBatch.data.completedBatchIndexes).toEqual([0, 1]);
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("finalize不再携带图片，facts只能由已选observationId组装，成功结果可直接命中缓存", async () => {
    const assetIds = ["asset-01", "asset-02", "asset-03"];
    const selectedObservationIds = observationIds(assetIds);
    vi.mocked(complete)
      .mockResolvedValueOnce(extractionPayload(assetIds))
      .mockResolvedValueOnce(
        JSON.stringify(finalizePayload(selectedObservationIds))
      );

    await runResearchExtractStage(extractRequest(assetIds), providerConfig);
    const first = await runResearchFinalizeStage(
      finalizeRequest(assetIds),
      providerConfig
    );
    const second = await runResearchFinalizeStage(
      finalizeRequest(assetIds),
      providerConfig
    );

    expect(complete).toHaveBeenCalledTimes(2);
    const [, messages] = vi.mocked(complete).mock.calls[1];
    const options = vi.mocked(complete).mock.calls[1][3]!;
    expect(imageCount(messages)).toBe(0);
    const schema = options.jsonSchema?.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    expect(properties).not.toHaveProperty("facts");
    const selection = properties.selectedObservationIds as Record<
      string,
      unknown
    >;
    expect((selection.items as Record<string, unknown>).enum).toEqual(
      selectedObservationIds
    );
    expect(first.data.facts.map((fact) => fact.value)).toEqual(
      Array.from({ length: 6 }, (_, index) => {
        const id = assetIds[index % assetIds.length];
        return `${id}中可见的不同产品特征${index + 1}`;
      })
    );
    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(second.data).toEqual(first.data);
  });

  it("finalize首次被长度截断时会自动紧凑重试，不重做已锁定的图片提取", async () => {
    const assetIds = ["asset-01", "asset-02", "asset-03"];
    const selectedObservationIds = observationIds(assetIds);
    vi.mocked(complete)
      .mockResolvedValueOnce(extractionPayload(assetIds))
      .mockRejectedValueOnce(
        new ServiceError("AI 输出达到长度上限，响应已被截断。", {
          statusCode: 502,
          code: "AI_RESPONSE_TRUNCATED"
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify(finalizePayload(selectedObservationIds))
      );

    await runResearchExtractStage(extractRequest(assetIds), providerConfig);
    const recovered = await runResearchFinalizeStage(
      finalizeRequest(assetIds),
      providerConfig
    );

    expect(recovered.data.facts).toHaveLength(6);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(imageCount(vi.mocked(complete).mock.calls[1][1])).toBe(0);
    expect(imageCount(vi.mocked(complete).mock.calls[2][1])).toBe(0);
  });

  it("finalize拒绝模型越权携带改写后的facts", async () => {
    const assetIds = ["asset-01", "asset-02", "asset-03"];
    const selectedObservationIds = observationIds(assetIds);
    vi.mocked(complete)
      .mockResolvedValueOnce(extractionPayload(assetIds))
      .mockResolvedValueOnce(
        JSON.stringify({
          ...finalizePayload(selectedObservationIds),
          facts: [{ value: "模型自行补齐的未授权功效" }]
        })
      );

    await runResearchExtractStage(extractRequest(assetIds), providerConfig);

    await expect(
      runResearchFinalizeStage(finalizeRequest(assetIds), providerConfig)
    ).rejects.toMatchObject({
      code: "RESEARCH_FINALIZE_SELECTION_INVALID"
    });
  });

  it("finalize首轮产生跨范围冲突时会自动修复：列出冲突观察 + 重新选择，并通过", async () => {
    const assetIds = ["asset-01", "asset-02", "asset-03"];
    // 8 条观察：前 6 条合规，后 2 条带"塑料"材质信号触发 CROSS_FIELD_CONFLICT。
    const fusedIndexes = [6, 7];
    // 显式构造 8 个观察ID，与 8 条提取观察一一对应
    const allObsIds = [
      "obs:asset-01:1",
      "obs:asset-02:1",
      "obs:asset-03:1",
      "obs:asset-01:2",
      "obs:asset-02:2",
      "obs:asset-03:2",
      "obs:asset-01:3",
      "obs:asset-02:3"
    ];
    const safeIds = allObsIds.slice(0, 6);

    function fusedPayload() {
      return {
        selectedObservationIds: allObsIds,
        productName: "跨范围冲突测试",
        category: "收纳容器",
        brand: "未识别",
        summary: "首轮跨范围冲突，需要修复。",
        visualAudit: auditKeys.map((key) => ({
          key,
          title: `${key}维度`,
          finding: `${key}的发现`,
          recommendation: `${key}的建议`
        })),
        visualKeywords: ["测试", "修复", "跨范围"],
        risks: []
      };
    }

    const fusedExtraction = JSON.stringify({
      observations: Array.from({ length: 8 }, (_, index) => {
        const assetId = assetIds[index % assetIds.length];
        const isFused = fusedIndexes.includes(index);
        return {
          assetId,
          label: `事实${index + 1}`,
          value: isFused
            ? `${assetId}的塑料外观描述`
            : `${assetId}的可见特征${index + 1}`,
          evidence: `${assetId}的直接证据${index + 1}`,
          sourceType: "visual_observation",
          claimScope: "appearance",
          entityType: "product",
          confidence: 0.95
        };
      })
    });

    // 修复阶段：剔除冲突的 2 条，返回剩余 6 条合规观察
    const repairSelection = { selectedObservationIds: safeIds };

    vi.mocked(complete)
      .mockResolvedValueOnce(fusedExtraction)
      .mockResolvedValueOnce(JSON.stringify(fusedPayload()))
      .mockResolvedValueOnce(JSON.stringify(repairSelection));

    await runResearchExtractStage(extractRequest(assetIds), providerConfig);
    const result = await runResearchFinalizeStage(
      finalizeRequest(assetIds),
      providerConfig
    );

    // 第一次：提取；第二次：失败汇总；第三次：修复。
    expect(complete).toHaveBeenCalledTimes(3);

    // 验证修复后的 research 只包含合规的观察
    expect(result.data.facts.length).toBe(6);
    const allValues = result.data.facts.map((fact) => fact.value);
    fusedIndexes.forEach((i) => {
      const assetId = assetIds[i % assetIds.length];
      const fusedValue = `${assetId}的塑料外观描述`;
      expect(allValues).not.toContain(fusedValue);
    });
  });

  it("finalize修复预算耗尽后抛出RESEARCH_REPAIR_NOT_CONVERGING", async () => {
    const assetIds = ["asset-01", "asset-02", "asset-03"];
    // 6 条观察，全部带"塑料"材质信号，跨范围冲突无法通过排除解决
    const fusedExtraction = JSON.stringify({
      observations: Array.from({ length: 6 }, (_, index) => {
        const assetId = assetIds[index % assetIds.length];
        return {
          assetId,
          label: `事实${index + 1}`,
          value: `${assetId}的塑料外观描述${index + 1}`,
          evidence: `${assetId}的材质证据${index + 1}`,
          sourceType: "visual_observation",
          claimScope: "appearance",
          entityType: "product",
          confidence: 0.95
        };
      })
    });

    const allObsIds = observationIds(assetIds);
    const fusedPayload = (selected: readonly string[]): string =>
      JSON.stringify({
        selectedObservationIds: selected,
        productName: "全跨范围冲突",
        category: "测试",
        brand: "未识别",
        summary: "全部都是跨范围冲突。",
        visualAudit: auditKeys.map((key) => ({
          key,
          title: `${key}维度`,
          finding: `${key}的发现`,
          recommendation: `${key}的建议`
        })),
        visualKeywords: ["测试", "修复", "冲突"],
        risks: []
      });

    vi.mocked(complete)
      .mockResolvedValueOnce(fusedExtraction)
      .mockResolvedValueOnce(fusedPayload(allObsIds))
      .mockResolvedValueOnce(fusedPayload(allObsIds))
      .mockResolvedValueOnce(fusedPayload(allObsIds));

    await runResearchExtractStage(extractRequest(assetIds), providerConfig);

    await expect(
      runResearchFinalizeStage(finalizeRequest(assetIds), providerConfig)
    ).rejects.toMatchObject({
      code: "RESEARCH_REPAIR_NOT_CONVERGING"
    });
  });
});
