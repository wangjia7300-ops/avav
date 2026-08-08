import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProviderConfig, DetailPlan } from "@/lib/types";
import {
  buildQACoverage,
  isQAInputComplete,
  runDeterministicQA
} from "@/lib/skill-suite/validation";
import { runQAStage } from "@/lib/skill-suite/server/qa-stage";
import { complete } from "@/lib/skill-suite/server/shared";
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

describe("QA status and coverage", () => {
  beforeEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("5屏执行只能得到 incomplete，且不会调用语义模型或生成15屏全局通过", async () => {
    const project = createSampleProject();
    const plan = {
      ...project.plan!,
      screens: project.plan!.screens.slice(0, 5)
    } as DetailPlan;
    const executions = Object.fromEntries(
      Object.entries(project.executions).slice(0, 5)
    );

    const result = await runQAStage(
      {
        stage: "qa",
        research: project.research!,
        plan,
        executions
      },
      providerConfig
    );

    expect(result.data.status).toBe("incomplete");
    expect(result.data.source).toBe("rules");
    expect(result.data.publishDecision).toBe("not_ready");
    expect(result.data.coverage.planScreens).toBe(5);
    expect(result.data.coverage.executionScreens).toBe(5);
    expect(result.data.coverage.missingExecutionIds).toHaveLength(10);
    expect(result.data.checks.semantic).toBe("not_evaluated");
    expect(result.data.notEvaluated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "semantic",
          status: "not_evaluated"
        })
      ])
    );
    expect(complete).not.toHaveBeenCalled();
    expect(
      result.data.findings.some(
        (item) =>
          item.severity === "pass" &&
          ["15屏标题唯一", "AI辅助生成标识完整", "15屏固定9:16"].includes(
            item.title
          )
      )
    ).toBe(false);
  });

  it("完整15屏在语义模型失败时保留规则报告并标记 rules_only", async () => {
    const project = createSampleProject();
    vi.mocked(complete).mockRejectedValue(new Error("model timeout"));

    const result = await runQAStage(
      {
        stage: "qa",
        research: project.research!,
        plan: project.plan!,
        executions: project.executions
      },
      providerConfig
    );

    expect(result.data.status).toBe("rules_only");
    expect(result.data.source).toBe("rules");
    expect(result.data.checks.rules).toBe("evaluated");
    expect(result.data.checks.semantic).toBe("not_evaluated");
    expect(result.data.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "语义模型质检未完成" })
      ])
    );
  });

  it("提示词规则与语义都完成时仍需真实成图复核，不能直接 ready", async () => {
    const project = createSampleProject();
    vi.mocked(complete).mockResolvedValue(
      JSON.stringify({
        findings: [],
        summary: "提示词规范检查完成。"
      })
    );

    const result = await runQAStage(
      {
        stage: "qa",
        research: project.research!,
        plan: project.plan!,
        executions: project.executions
      },
      providerConfig
    );

    expect(result.data.status).toBe("prompt_complete");
    expect(result.data.publishDecision).toBe("review_required");
    expect(result.data.checks.render).toBe("not_evaluated");
    expect(result.data.checks.pixel).toBe("not_evaluated");
  });

  it("coverage 只把screenId匹配的当前执行计入覆盖", () => {
    const project = createSampleProject();
    const executions = {
      ...project.executions,
      "screen-03": {
        ...project.executions["screen-03"],
        screenId: "screen-09"
      },
      "legacy-01": project.executions["screen-01"]
    };
    const coverage = buildQACoverage(project.plan!, executions);

    expect(coverage.executionScreens).toBe(14);
    expect(coverage.missingExecutionIds).toContain("screen-03");
    expect(coverage.unexpectedExecutionIds).toEqual(
      expect.arrayContaining(["screen-03", "legacy-01"])
    );
    expect(isQAInputComplete(coverage)).toBe(false);
  });

  it("确定性QA在执行未齐时不追加全局通过结论", () => {
    const project = createSampleProject();
    const executions = Object.fromEntries(
      Object.entries(project.executions).slice(0, 14)
    );
    const findings = runDeterministicQA(
      project.plan!,
      executions,
      project.research!.facts
    );

    expect(
      findings.some(
        (item) =>
          item.severity === "pass" &&
          ["AI辅助生成标识完整", "15屏固定9:16"].includes(item.title)
      )
    ).toBe(false);
    expect(
      findings.some((item) => item.title === "15屏质检输入不完整")
    ).toBe(true);
  });
});
