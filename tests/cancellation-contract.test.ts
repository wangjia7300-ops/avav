import { beforeEach, describe, expect, it, vi } from "vitest";
import { runExecutionStage } from "@/lib/skill-suite/server/execution-stage";
import { runQAStage } from "@/lib/skill-suite/server/qa-stage";
import { complete } from "@/lib/skill-suite/server/shared";
import { ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig } from "@/lib/types";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

vi.mock("@/lib/skill-suite/server/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/skill-suite/server/shared")>();
  return {
    ...actual,
    complete: vi.fn()
  };
});

const providerConfig: AIProviderConfig = {
  providerId: "volcengine",
  apiKey: "test-only-key",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "test-only-model"
};

describe("real cancellation propagation", () => {
  beforeEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("passes the caller AbortSignal into execution model calls", async () => {
    const project = createSampleProject();
    const screen = project.plan!.screens[0];
    const { englishPrompt: _compiled, ...draft } =
      project.executions[screen.id];
    const controller = new AbortController();
    vi.mocked(complete).mockResolvedValue(
      JSON.stringify({ executions: [draft] })
    );

    await runExecutionStage(
      {
        stage: "execution",
        research: project.research!,
        plan: project.plan!,
        screens: [screen],
        mode: "E"
      },
      providerConfig,
      controller.signal
    );

    expect(complete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(complete).mock.calls[0]?.[3]).toMatchObject({
      signal: controller.signal
    });
  });

  it("does not swallow an aborted QA call as a rules-only success", async () => {
    const project = createSampleProject();
    const controller = new AbortController();
    vi.mocked(complete).mockImplementation(async () => {
      controller.abort();
      throw new ServiceError("请求已取消。", {
        statusCode: 499,
        code: "AI_REQUEST_ABORTED"
      });
    });

    await expect(
      runQAStage(
        {
          stage: "qa",
          research: project.research!,
          plan: project.plan!,
          executions: project.executions
        },
        providerConfig,
        controller.signal
      )
    ).rejects.toMatchObject({ code: "AI_REQUEST_ABORTED" });
  });
});
