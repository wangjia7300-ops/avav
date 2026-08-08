import { describe, expect, it, vi } from "vitest";
import {
  runResearchPipeline,
  type ResearchExtractPayload,
  type ResearchFinalizePayload,
  type ResearchPipelineCheckpoint
} from "@/lib/workbench/research-pipeline";
import { parseResearchFinalizeSelection } from "@/lib/skill-suite/research-atomic-contract";
import type { AIProviderConfig, ProjectAsset } from "@/lib/types";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

const providerConfig: AIProviderConfig = {
  providerId: "volcengine",
  apiKey: "test-only-key",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "test-model"
};

function assets(count: number): ProjectAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `asset-${String(index + 1).padStart(2, "0")}`,
    name: `angle-${index + 1}.png`,
    dataUrl: `data:image/png;base64,dGVzdC0${index + 1}=`,
    size: 8
  }));
}

function successfulFinalizeResponse() {
  return {
    data: createSampleProject().research!,
    meta: { operation: "finalize" }
  };
}

function batchIndexes<T extends { batchIndex: number }>(
  calls: ReadonlyArray<readonly [T, ...unknown[]]>
) {
  return calls.map(([payload]) => payload.batchIndex);
}

describe("client research batching and checkpoint resume", () => {
  it.each(Array.from({ length: 9 }, (_, index) => index + 1))(
    "%i张图片始终按最多3张提取，全部小批完成后才发起零图片汇总",
    async (assetCount) => {
      const inputAssets = assets(assetCount);
      const checkpoints: ResearchPipelineCheckpoint[] = [];
      const postExtract = vi.fn(
        async (_payload: ResearchExtractPayload) => ({
          data: { accepted: true },
          meta: { operation: "extract" }
        })
      );
      const postFinalize = vi.fn(
        async (_payload: ResearchFinalizePayload) =>
          successfulFinalizeResponse()
      );

      const result = await runResearchPipeline(
        {
          runId: `research-matrix-${assetCount}`,
          assets: inputAssets,
          notes: "综合多角度图片，只采用甲方图片内可见资料。",
          providerConfig
        },
        {
          postExtract,
          postFinalize,
          onCheckpoint: (checkpoint) => {
            checkpoints.push(structuredClone(checkpoint));
          }
        }
      );

      const extractPayloads = postExtract.mock.calls.map(([payload]) => payload);
      expect(extractPayloads).toHaveLength(Math.ceil(assetCount / 3));
      expect(
        extractPayloads.every(
          (payload) =>
            Array.isArray(payload.assets) &&
            payload.assets.length >= 1 &&
            payload.assets.length <= 3
        )
      ).toBe(true);
      expect(
        extractPayloads.flatMap((payload) =>
          payload.assets.map((asset) => asset.id)
        )
      ).toEqual(inputAssets.map((asset) => asset.id));
      expect(batchIndexes(postExtract.mock.calls)).toEqual(
        Array.from(
          { length: Math.ceil(assetCount / 3) },
          (_, batchIndex) => batchIndex
        )
      );

      expect(postFinalize).toHaveBeenCalledTimes(1);
      const finalizePayload = postFinalize.mock.calls[0]![0];
      expect(finalizePayload).not.toHaveProperty("assets");
      expect(finalizePayload).not.toHaveProperty("dataUrl");
      expect(JSON.stringify(finalizePayload)).not.toContain("data:image/");
      expect(finalizePayload.assetIds).toEqual(
        inputAssets.map((asset) => asset.id)
      );
      expect(checkpoints.at(-1)?.completedBatchIndexes).toEqual(
        Array.from(
          { length: Math.ceil(assetCount / 3) },
          (_, batchIndex) => batchIndex
        )
      );
      expect(result.data.productName).toBe(
        createSampleProject().research!.productName
      );
    }
  );

  it("第二批失败后不启动第三批；传回 checkpoint 重试时不重复首批", async () => {
    const inputAssets = assets(9);
    const runId = "research-resume-after-batch-2";
    let failedOnce = false;
    let savedCheckpoint: ResearchPipelineCheckpoint | undefined;
    const firstAttemptExtract = vi.fn(
      async (payload: { batchIndex: number }) => {
        if (payload.batchIndex === 1 && !failedOnce) {
          failedOnce = true;
          throw new Error("deterministic batch-2 timeout");
        }
        return { data: { accepted: true } };
      }
    );
    const firstAttemptFinalize = vi.fn(
      async (_payload: ResearchFinalizePayload) =>
        successfulFinalizeResponse()
    );

    await expect(
      runResearchPipeline(
        {
          runId,
          assets: inputAssets,
          notes: "九图断点续跑测试",
          providerConfig
        },
        {
          postExtract: firstAttemptExtract,
          postFinalize: firstAttemptFinalize,
          onCheckpoint: (checkpoint) => {
            savedCheckpoint = structuredClone(checkpoint);
          }
        }
      )
    ).rejects.toThrow("deterministic batch-2 timeout");

    expect(batchIndexes(firstAttemptExtract.mock.calls)).toEqual([0, 1]);
    expect(firstAttemptFinalize).not.toHaveBeenCalled();
    expect(savedCheckpoint).toMatchObject({
      runId,
      completedBatchIndexes: [0]
    });
    expect(savedCheckpoint?.inputFingerprint).toEqual(expect.any(String));
    expect(savedCheckpoint?.inputFingerprint.length).toBeGreaterThan(0);

    const retryExtract = vi.fn(
      async (_payload: ResearchExtractPayload) => ({
        data: { accepted: true }
      })
    );
    const retryFinalize = vi.fn(
      async (_payload: ResearchFinalizePayload) =>
        successfulFinalizeResponse()
    );
    const retryCheckpoints: typeof savedCheckpoint[] = [];
    const result = await runResearchPipeline(
      {
        runId,
        assets: inputAssets,
        notes: "九图断点续跑测试",
        providerConfig,
        checkpoint: savedCheckpoint
      },
      {
        postExtract: retryExtract,
        postFinalize: retryFinalize,
        onCheckpoint: (checkpoint) => {
          retryCheckpoints.push(structuredClone(checkpoint));
        }
      }
    );

    expect(batchIndexes(retryExtract.mock.calls)).toEqual([1, 2]);
    expect(retryExtract.mock.calls.some(([payload]) => payload.batchIndex === 0)).toBe(
      false
    );
    expect(retryFinalize).toHaveBeenCalledTimes(1);
    expect(retryCheckpoints.at(-1)?.completedBatchIndexes).toEqual([0, 1, 2]);
    expect(result.data).toEqual(createSampleProject().research);
  });

  it("首批发出前就保存 runId，响应丢失后可以用同一运行幂等重试", async () => {
    const inputAssets = assets(3);
    const runId = "research-initial-checkpoint";
    let initialCheckpoint: ResearchPipelineCheckpoint | undefined;

    await expect(
      runResearchPipeline(
        {
          runId,
          assets: inputAssets,
          notes: "首批响应丢失模拟",
          providerConfig
        },
        {
          postExtract: async () => {
            throw new Error("服务端可能已完成，但客户端未收到响应");
          },
          postFinalize: async () => successfulFinalizeResponse(),
          onCheckpoint: (checkpoint) => {
            initialCheckpoint = structuredClone(checkpoint);
          }
        }
      )
    ).rejects.toThrow("客户端未收到响应");

    expect(initialCheckpoint).toEqual({
      runId,
      inputFingerprint: expect.any(String),
      completedBatchIndexes: []
    });
  });
});

describe("research finalize observation boundary", () => {
  it("拒绝 final 选择 registry 中不存在的 observationId", () => {
    const allowedObservationIds = Array.from(
      { length: 6 },
      (_, index) => `obs:asset-01:${index + 1}`
    );
    const auditKeys = [
      "composition",
      "sellingHierarchy",
      "color",
      "typography",
      "visualPath",
      "material",
      "algorithmFit",
      "emotion"
    ];
    const modelSelection = JSON.stringify({
      selectedObservationIds: [
        ...allowedObservationIds,
        "obs:unknown-customer-image:1"
      ],
      productName: "测试产品",
      category: "测试品类",
      brand: "未识别",
      summary: "只应从服务端已登记的原子观察中选择事实。",
      visualAudit: auditKeys.map((key) => ({
        key,
        title: `${key}维度`,
        finding: `${key}可见发现`,
        recommendation: `${key}执行建议`
      })),
      visualKeywords: ["主体清晰", "多角度", "信息层级"],
      risks: []
    });

    expect(() =>
      parseResearchFinalizeSelection(modelSelection, allowedObservationIds)
    ).toThrowError(
      expect.objectContaining({
        code: "RESEARCH_FINALIZE_SELECTION_INVALID",
        details: expect.arrayContaining([
          expect.stringContaining("obs:unknown-customer-image:1")
        ])
      })
    );
  });
});
