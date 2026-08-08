import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/services/errors";
import { complete } from "@/lib/skill-suite/server/shared";
import type { AIProviderConfig } from "@/lib/types";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

vi.mock("@/lib/skill-suite/server/shared", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/skill-suite/server/shared")
    >();
  return {
    ...actual,
    complete: vi.fn()
  };
});

import { runPlanningStage } from "@/lib/skill-suite/server/planning-stage";

const providerConfig: AIProviderConfig = {
  providerId: "volcengine",
  apiKey: "test-only-key",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "test-only-model"
};

function screenId(index: number) {
  return `screen-${String(index).padStart(2, "0")}`;
}

describe("planning batch provider failures", () => {
  beforeEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("初始5个策划批次的provider调用最多同时运行3个", async () => {
    const project = createSampleProject();
    const plan = project.plan!;
    const {
      screens: _screens,
      source: _source,
      generatedAt: _generatedAt,
      ...foundation
    } = plan;
    let activeBatchCalls = 0;
    let maxConcurrentBatchCalls = 0;

    vi.mocked(complete).mockImplementation(async () => {
      if (vi.mocked(complete).mock.calls.length === 1) {
        return JSON.stringify(foundation);
      }

      activeBatchCalls += 1;
      maxConcurrentBatchCalls = Math.max(
        maxConcurrentBatchCalls,
        activeBatchCalls
      );
      // 让本轮同时启动的调用都进入provider边界后再失败。
      await Promise.resolve();
      activeBatchCalls -= 1;
      throw new ServiceError("策划批次模拟失败。", {
        statusCode: 502,
        code: "AI_PROVIDER_ERROR"
      });
    });

    await runPlanningStage(
      {
        stage: "planning",
        research: project.research!,
        brief: project.brief
      },
      providerConfig
    ).catch(() => undefined);

    expect(maxConcurrentBatchCalls).toBeGreaterThan(0);
    expect(maxConcurrentBatchCalls).toBeLessThanOrEqual(3);
  });

  it("策略骨架 provider timeout 时在策划层自动重试一次", async () => {
    const project = createSampleProject();
    const plan = project.plan!;
    const {
      screens: _screens,
      source: _source,
      generatedAt: _generatedAt,
      ...foundation
    } = plan;
    let foundationCalls = 0;

    vi.mocked(complete).mockImplementation(async (_config, messages) => {
      const request = JSON.stringify(messages);
      if (request.includes("先只生成15屏策划的策略骨架")) {
        foundationCalls += 1;
        if (foundationCalls === 1) {
          throw new ServiceError("火山方舟 Ark 响应超时。", {
            statusCode: 504,
            code: "AI_PROVIDER_TIMEOUT",
            details: {
              failureOrigin: "connection_timeout",
              retryable: true,
              attempt: 1,
              maxAttempts: 1
            }
          });
        }
        return JSON.stringify(foundation);
      }

      const batchStart = [1, 4, 7, 10, 13].find((start) =>
        request.includes(
          `只能包含目标 id：${screenId(start)}、${screenId(start + 1)}、${screenId(start + 2)}`
        )
      );
      if (batchStart === undefined) {
        throw new Error(`无法识别策划批次：${request}`);
      }
      return JSON.stringify({
        screens: plan.screens.slice(batchStart - 1, batchStart + 2)
      });
    });

    await expect(
      runPlanningStage(
        {
          stage: "planning",
          research: project.research!,
          brief: project.brief
        },
        providerConfig
      )
    ).resolves.toMatchObject({
      data: {
        screens: expect.arrayContaining([
          expect.objectContaining({ id: "screen-01" }),
          expect.objectContaining({ id: "screen-15" })
        ])
      }
    });
    expect(foundationCalls).toBe(2);
  });

  it("首3屏批次 provider timeout 时在策划层自动重试一次", async () => {
    const project = createSampleProject();
    const plan = project.plan!;
    const {
      screens: _screens,
      source: _source,
      generatedAt: _generatedAt,
      ...foundation
    } = plan;
    let firstBatchCompleteCalls = 0;

    vi.mocked(complete).mockImplementation(async (_config, messages) => {
      if (vi.mocked(complete).mock.calls.length === 1) {
        return JSON.stringify(foundation);
      }

      const request = JSON.stringify(messages);
      const batchStart = [1, 4, 7, 10, 13].find((start) =>
        request.includes(
          `只能包含目标 id：${screenId(start)}、${screenId(start + 1)}、${screenId(start + 2)}`
        )
      );
      if (batchStart === undefined) {
        throw new Error(`无法识别策划批次：${request}`);
      }
      if (batchStart === 1) {
        firstBatchCompleteCalls += 1;
        if (firstBatchCompleteCalls === 1) {
          throw new ServiceError("火山方舟 Ark 响应超时。", {
            statusCode: 504,
            code: "AI_PROVIDER_TIMEOUT",
            details: {
              stage: "planning-batch",
              failureOrigin: "sdk_timeout",
              retryable: true,
              attempt: 1,
              maxAttempts: 1
            }
          });
        }
      }

      return JSON.stringify({
        screens: plan.screens.slice(batchStart - 1, batchStart + 2)
      });
    });

    await expect(
      runPlanningStage(
        {
          stage: "planning",
          research: project.research!,
          brief: project.brief
        },
        providerConfig
      )
    ).resolves.toMatchObject({
      data: {
        screens: expect.arrayContaining([
          expect.objectContaining({ id: "screen-01" }),
          expect.objectContaining({ id: "screen-15" })
        ])
      },
      meta: {
        batchRetryCount: expect.any(Number)
      }
    });
    expect(firstBatchCompleteCalls).toBe(2);
  });

  it("批次包装保留供应商不可重试分类", async () => {
    const project = createSampleProject();
    const plan = project.plan!;
    const {
      screens: _screens,
      source: _source,
      generatedAt: _generatedAt,
      ...foundation
    } = plan;

    vi.mocked(complete).mockImplementation(async () => {
      if (vi.mocked(complete).mock.calls.length === 1) {
        return JSON.stringify(foundation);
      }
      throw new ServiceError("API Key 无效。", {
        statusCode: 401,
        code: "AI_PROVIDER_AUTH_ERROR",
        details: { retryable: false, failureOrigin: "upstream_http" }
      });
    });

    let caught: unknown;
    await runPlanningStage(
      {
        stage: "planning",
        research: project.research!,
        brief: project.brief
      },
      providerConfig
    ).catch((error) => {
      caught = error;
    });

    expect(caught).toMatchObject({
      code: "AI_PROVIDER_AUTH_ERROR",
      statusCode: 401,
      details: {
        stage: "planning-batch",
        batchId: expect.stringMatching(/^screens-/u),
        retryable: false
      }
    });
  });
});
