import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@/lib/skill-suite/defaults";
import { useSkillSuiteStore } from "@/lib/skill-suite/store";
import { ApiError, postJson, toWorkError } from "@/lib/workbench/api-client";
import { sanitizeDiagnosticText } from "@/lib/workbench/diagnostics";
import type {
  DetailPlan,
  ProductResearch,
  QAReport,
  ScreenExecution
} from "@/lib/types";

describe("workbench API observability", () => {
  beforeEach(() => {
    useSkillSuiteStore.getState().resetProject();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useSkillSuiteStore.getState().resetProject();
  });

  it("preserves successful response metadata while redacting sensitive fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { ok: true },
            meta: {
              generationMode: "foundation-plus-5x3",
              repairCount: 2,
              fallbackUsed: false,
              apiKey: "ark-secret-value"
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    );

    const result = await postJson<{ ok: boolean }>("/api/test", {
      stage: "planning"
    });

    expect(result.data).toEqual({ ok: true });
    expect(result.meta).toEqual({
      generationMode: "foundation-plus-5x3",
      repairCount: 2,
      fallbackUsed: false,
      apiKey: "[已隐藏]"
    });
  });

  it("keeps the complete structured failure without exposing secrets or local paths", async () => {
    const details = [
      "screen-03 标题重复",
      "screen-07 与 screen-09 文案语义高度相似",
      "screen-10 缺少9:16",
      "screen-11 证据引用无效",
      "screen-12 正文不完整",
      "调试文件 /Users/private/customer/project.json"
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: "15屏策划未通过结果校验。",
            code: "PLAN_QUALITY_INVALID",
            details,
            meta: {
              phase: "planning-quality",
              conflictScreenIds: ["screen-03", "screen-07", "screen-09"],
              authorization: "Bearer secret-token"
            },
            partialData: {
              publishable: false,
              apiKey: "ark-secret-value",
              plan: { screens: [{ id: "screen-01" }] }
            }
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    );

    let caught: unknown;
    try {
      await postJson("/api/test", { stage: "planning" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe("PLAN_QUALITY_INVALID");
    expect(apiError.details).toHaveLength(details.length);
    expect(apiError.phase).toBe("planning-quality");
    expect(apiError.conflictScreenIds).toEqual([
      "screen-03",
      "screen-07",
      "screen-09",
      "screen-10",
      "screen-11",
      "screen-12"
    ]);
    expect(apiError.partialData).toMatchObject({
      publishable: false,
      apiKey: "[已隐藏]"
    });
    expect(JSON.stringify(apiError)).not.toContain("secret-token");
    expect(JSON.stringify(apiError)).not.toContain("ark-secret-value");
    expect(apiError.details.join("\n")).not.toContain("/Users/");
  });

  it("derives phase information from object-shaped service details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: "第7–9屏策划批次未完成，请重试当前阶段。",
            code: "PLAN_BATCH_INVALID",
            details: {
              stage: "planning-batch",
              batchId: "screens-7-9",
              retryable: true
            }
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    );

    await expect(
      postJson("/api/test", { stage: "planning" })
    ).rejects.toMatchObject({
      status: 422,
      code: "PLAN_BATCH_INVALID",
      phase: "planning-batch",
      details: [
        "stage：planning-batch",
        "batchId：screens-7-9",
        "retryable：true"
      ]
    });
  });

  it("normalizes local errors into a safe workbench error", () => {
    const error = toWorkError(
      new Error(
        '读取失败：apiKey="ark-private-secret" /Volumes/customer/source.png'
      )
    );

    expect(error.details).toEqual([]);
    expect(error.conflictScreenIds).toEqual([]);
    expect(error.message).not.toContain("ark-private-secret");
    expect(error.message).not.toContain("/Volumes/");
    expect(sanitizeDiagnosticText(error.message)).toBe(error.message);
  });
});

describe("planning result isolation", () => {
  beforeEach(() => {
    useSkillSuiteStore.getState().resetProject();
  });

  afterEach(() => {
    useSkillSuiteStore.getState().resetProject();
  });

  it("clears the old plan and every downstream result before a new planning run", () => {
    const previous = createEmptyProject();
    const previousResearch = {
      productName: "仅用于状态测试"
    } as ProductResearch;
    previous.research = previousResearch;
    previous.plan = { productPositioning: "旧策划" } as DetailPlan;
    previous.executions = {
      "screen-01": { screenId: "screen-01" } as ScreenExecution
    };
    previous.qa = { summary: "旧质检" } as QAReport;
    useSkillSuiteStore.setState({
      project: previous,
      stage: "execution",
      selectedScreenId: "screen-08",
      workStatus: "success",
      workLabel: "旧策划已完成",
      error: null
    });

    useSkillSuiteStore.getState().beginPlanning();
    let state = useSkillSuiteStore.getState();

    expect(state.project.research).toBe(previousResearch);
    expect(state.project.plan).toBeNull();
    expect(state.project.executions).toEqual({});
    expect(state.project.qa).toBeNull();
    expect(state.stage).toBe("planning");
    expect(state.selectedScreenId).toBe("screen-01");
    expect(state.workStatus).toBe("running");
    expect(state.workLabel).toBe("正在生成15屏策划");

    state.setWork("error", "", {
      message: "15屏策划未通过结果校验。",
      status: 422,
      code: "PLAN_QUALITY_INVALID",
      details: ["screen-07 标题重复"],
      phase: "planning-quality",
      conflictScreenIds: ["screen-07"]
    });
    state = useSkillSuiteStore.getState();

    expect(state.project.plan).toBeNull();
    expect(state.project.executions).toEqual({});
    expect(state.project.qa).toBeNull();
    expect(state.error?.code).toBe("PLAN_QUALITY_INVALID");
  });
});
