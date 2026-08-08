import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductResearch } from "@/lib/types";
import {
  __resetResearchRunRegistryForTests,
  createOrValidateResearchRun,
  getResearchRunProgress,
  runResearchBatchOnce,
  runResearchFinalOnce,
  validateExistingResearchRun,
  type CompletedResearchBatch,
  type ResearchRunIdentity,
  type ResearchRunManifest,
  type StoredResearchBatchResult
} from "@/lib/skill-suite/server/research-run-registry";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const manifest: ResearchRunManifest = {
  runId: "run-01",
  inputFingerprint: "input-fingerprint-01",
  providerFingerprint: "provider-fingerprint-01",
  assetIds: ["asset-01", "asset-02"],
  notes: "仅根据甲方图片提取",
  totalBatches: 2
};

const identity: ResearchRunIdentity = {
  runId: manifest.runId,
  inputFingerprint: manifest.inputFingerprint,
  providerFingerprint: manifest.providerFingerprint
};

function batchResult(assetId: string): StoredResearchBatchResult {
  return {
    observations: [
      {
        observationId: `obs:${assetId}:1`,
        assetId,
        label: "可见特征",
        value: `${assetId}的可见产品特征`,
        evidence: `${assetId}的直接可见证据`,
        sourceType: "visual_observation",
        claimScope: "appearance",
        entityType: "product",
        confidence: 1
      }
    ]
  };
}

function finalResult(): ProductResearch {
  return {
    productName: "测试产品",
    category: "测试品类",
    brand: "未识别",
    summary: "两批观察的最终合并结果。",
    facts: [],
    visualAudit: [],
    visualKeywords: ["主体清晰"],
    risks: [],
    source: "model",
    generatedAt: "2026-08-03T00:00:00.000Z"
  };
}

describe("research run registry", () => {
  beforeEach(() => {
    __resetResearchRunRegistryForTests();
    vi.useRealTimers();
  });

  it("拒绝同一 runId 下不一致的输入或供应商指纹", () => {
    createOrValidateResearchRun(manifest);

    expect(() =>
      createOrValidateResearchRun({
        ...manifest,
        providerFingerprint: "another-provider-fingerprint"
      })
    ).toThrowError(
      expect.objectContaining({
        code: "RESEARCH_RUN_IDENTITY_MISMATCH",
        statusCode: 409
      })
    );
  });

  it("最终汇总不得在服务端记录丢失后偷偷新建空运行", () => {
    expect(() => validateExistingResearchRun(manifest)).toThrowError(
      expect.objectContaining({
        code: "RESEARCH_RUN_NOT_FOUND",
        statusCode: 404
      })
    );

    createOrValidateResearchRun(manifest);
    expect(validateExistingResearchRun(manifest)).toMatchObject({
      runId: manifest.runId,
      completedBatchIndexes: []
    });
  });

  it("对同一批次的并发请求只执行一次，成功后直接读缓存", async () => {
    createOrValidateResearchRun(manifest);
    let resolveExecution!: (value: StoredResearchBatchResult) => void;
    const execute = vi.fn(
      () =>
        new Promise<StoredResearchBatchResult>((resolve) => {
          resolveExecution = resolve;
        })
    );
    const request = {
      ...identity,
      batchIndex: 0,
      batchAssetIds: ["asset-01"],
      sanitizedSha256s: [SHA_A]
    };

    const first = runResearchBatchOnce(request, execute);
    const second = runResearchBatchOnce(request, execute);
    expect(execute).toHaveBeenCalledTimes(1);

    resolveExecution(batchResult("asset-01"));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    await runResearchBatchOnce(request, execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(getResearchRunProgress(identity).completedBatchIndexes).toEqual([0]);
  });

  it("批次失败后清除 in-flight，并拒绝更换该批 SHA", async () => {
    createOrValidateResearchRun(manifest);
    const request = {
      ...identity,
      batchIndex: 0,
      batchAssetIds: ["asset-01"],
      sanitizedSha256s: [SHA_A]
    };
    const failed = vi.fn().mockRejectedValueOnce(new Error("timeout"));
    await expect(runResearchBatchOnce(request, failed)).rejects.toThrow(
      "timeout"
    );

    const succeeded = vi.fn().mockResolvedValue(batchResult("asset-01"));
    await expect(runResearchBatchOnce(request, succeeded)).resolves.toEqual(
      batchResult("asset-01")
    );

    expect(() =>
      runResearchBatchOnce(
        { ...request, sanitizedSha256s: [SHA_B] },
        succeeded
      )
    ).toThrowError(
      expect.objectContaining({
        code: "RESEARCH_RUN_BATCH_MANIFEST_MISMATCH",
        statusCode: 409
      })
    );
  });

  it("全部批次完成后去重最终汇总并缓存最终结果", async () => {
    createOrValidateResearchRun(manifest);
    await runResearchBatchOnce(
      {
        ...identity,
        batchIndex: 0,
        batchAssetIds: ["asset-01"],
        sanitizedSha256s: [SHA_A]
      },
      async () => batchResult("asset-01")
    );
    await runResearchBatchOnce(
      {
        ...identity,
        batchIndex: 1,
        batchAssetIds: ["asset-02"],
        sanitizedSha256s: [SHA_B]
      },
      async () => batchResult("asset-02")
    );

    let resolveFinal!: (value: ProductResearch) => void;
    const execute = vi.fn(
      (_batches: readonly CompletedResearchBatch[]) =>
        new Promise<ProductResearch>((resolve) => {
          resolveFinal = resolve;
        })
    );
    const first = runResearchFinalOnce(identity, execute);
    const second = runResearchFinalOnce(identity, execute);
    expect(execute).toHaveBeenCalledTimes(1);
    const firstFinalCall = execute.mock.calls[0];
    expect(firstFinalCall).toBeDefined();
    expect(firstFinalCall?.[0].map((item) => item.batchIndex)).toEqual([0, 1]);

    resolveFinal(finalResult());
    await Promise.all([first, second]);
    await runResearchFinalOnce(identity, execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(getResearchRunProgress(identity).finalCompleted).toBe(true);
  });

  it("15分钟无访问后清理运行记录", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T00:00:00.000Z"));
    createOrValidateResearchRun(manifest);
    vi.setSystemTime(new Date("2026-08-03T00:15:00.001Z"));

    expect(() => getResearchRunProgress(identity)).toThrowError(
      expect.objectContaining({
        code: "RESEARCH_RUN_NOT_FOUND",
        statusCode: 404
      })
    );
  });
});
