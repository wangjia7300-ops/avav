import { beforeEach, describe, expect, it, vi } from "vitest";
import { complete } from "@/lib/skill-suite/server/shared";
import { applyScreenContracts } from "@/lib/skill-suite/screen-contracts";
import { ServiceError } from "@/lib/services/errors";
import { safeError } from "@/lib/skill-suite/server/request";
import type { AIProviderConfig } from "@/lib/types";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

const validationState = vi.hoisted(() => ({
  planChecks: 0,
  alwaysRejectPlan: false,
  groupedIssueMode: false,
  rejectedRepairHeadline: "",
  postRepairRuleCode: "",
  groupedRepairHeadlines: {
    "screen-04": "screen-04 已解除组合冲突",
    "screen-10": "screen-10 已解除组合冲突"
  },
  targetIds: [
    "screen-04",
    "screen-10",
    "screen-11",
    "screen-13",
    "screen-14",
    "screen-15"
  ]
}));

vi.mock("@/lib/skill-suite/server/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/skill-suite/server/shared")>();
  return { ...actual, complete: vi.fn() };
});

vi.mock("@/lib/skill-suite/validation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/skill-suite/validation")>();
  return {
    ...actual,
    assertPlan: vi.fn((candidatePlan: { screens?: Array<{ id?: string; copy?: { headline?: string } }> }) => {
      validationState.planChecks += 1;
      if (validationState.groupedIssueMode) {
        const remainingIds = ["screen-04", "screen-10"].filter(
          (screenId) =>
            candidatePlan.screens?.find((screen) => screen.id === screenId)
              ?.copy?.headline !==
            validationState.groupedRepairHeadlines[
              screenId as keyof typeof validationState.groupedRepairHeadlines
            ]
        );
        if (remainingIds.length === 0) return;
        throw new actual.SkillSuiteValidationError(
          "组合屏文案仍存在跨屏冲突。",
          "PLAN_QUALITY_INVALID",
          [`残余冲突：${remainingIds.join("、")}`],
          [
            {
              ruleCode: "PLAN_CROSS_SCREEN_COPY_SIMILAR",
              message: "组合屏标题仍然相似",
              screenIds: remainingIds,
              scope: "cross-screen" as const,
              path: "copy.headline",
              allowedRepairFields: ["copy.headline" as const]
            }
          ]
        );
      }
      if (validationState.planChecks !== 1) {
        const rejectedScreen = candidatePlan.screens?.find(
          (screen) => screen.id === "screen-01"
        );
        if (
          validationState.rejectedRepairHeadline &&
          rejectedScreen?.copy?.headline ===
            validationState.rejectedRepairHeadline
        ) {
          throw new actual.SkillSuiteValidationError(
            "单屏修复后仍未通过确定性结果校验。",
            "PLAN_QUALITY_INVALID",
            ["screen-01 修复后仍存在文案问题"],
            [
              {
                ruleCode:
                  validationState.postRepairRuleCode ||
                  "COPY_HEADLINE_NOT_USER_FACING",
                message: "screen-01 修复后仍存在文案问题",
                screenIds: ["screen-01"],
                scope: "screen" as const,
                path: "copy.headline",
                allowedRepairFields: ["copy.headline" as const]
              }
            ]
          );
        }
        if (!validationState.alwaysRejectPlan) return;
      }
      const screenIds = validationState.targetIds;
      throw new actual.SkillSuiteValidationError(
        "15屏策划未通过结果校验。",
        "PLAN_QUALITY_INVALID",
        screenIds.map((id) => `${id} 文案任务冲突`),
        screenIds.map((id) => ({
          ruleCode: "PLAN_CROSS_SCREEN_COPY_SIMILAR",
          message: `${id} 文案任务冲突`,
          screenIds: [id],
          scope: "cross-screen" as const,
          path: "copy",
          allowedRepairFields: [
            "copy.headline" as const,
            "copy.subheadline" as const,
            "copy.body" as const
          ]
        }))
      );
    })
  };
});

import { runPlanningStage } from "@/lib/skill-suite/server/planning-stage";

const providerConfig: AIProviderConfig = {
  providerId: "volcengine",
  apiKey: "test-only-key",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "test-only-model"
};

describe("planning repair retry feedback", () => {
  beforeEach(() => {
    validationState.planChecks = 0;
    validationState.alwaysRejectPlan = false;
    validationState.groupedIssueMode = false;
    validationState.rejectedRepairHeadline = "";
    validationState.postRepairRuleCode = "";
    validationState.targetIds = [
      "screen-04",
      "screen-10",
      "screen-11",
      "screen-13",
      "screen-14",
      "screen-15"
    ];
    vi.mocked(complete).mockReset();
  });

  it("accepts one member of a grouped issue when the same issue remains only on the other screen", async () => {
    const project = createSampleProject();
    const plan = project.plan!;
    validationState.groupedIssueMode = true;
    validationState.targetIds = ["screen-04", "screen-10"];
    const {
      screens: _screens,
      source: _source,
      generatedAt: _generatedAt,
      ...foundation
    } = plan;
    let generationCallCount = 0;

    vi.mocked(complete).mockImplementation(async (_config, messages) => {
      generationCallCount += 1;
      if (generationCallCount === 1) return JSON.stringify(foundation);
      if (generationCallCount >= 2 && generationCallCount <= 6) {
        const start = (generationCallCount - 2) * 3;
        return JSON.stringify({
          screens: plan.screens.slice(start, start + 3)
        });
      }

      const request = JSON.stringify(messages);
      const targetId = request.match(
        /目标ID（必须完全一致）：(screen-\d{2})/
      )?.[1] as "screen-04" | "screen-10" | undefined;
      if (!targetId || !(targetId in validationState.groupedRepairHeadlines)) {
        throw new Error(`无法识别组合问题修复目标：${request}`);
      }
      return JSON.stringify({
        screenId: targetId,
        changes: {
          "copy.headline":
            validationState.groupedRepairHeadlines[targetId]
        }
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
          expect.objectContaining({
            id: "screen-04",
            copy: expect.objectContaining({
              headline:
                validationState.groupedRepairHeadlines["screen-04"]
            })
          }),
          expect.objectContaining({
            id: "screen-10",
            copy: expect.objectContaining({
              headline:
                validationState.groupedRepairHeadlines["screen-10"]
            })
          })
        ])
      },
      meta: {
        conflictScreenIds: [],
        publishable: true
      }
    });
  });

  it("策划阶段总 complete 调用硬上限18次，并计入基础、基础修复、5批生成和单屏修复", async () => {
    const project = createSampleProject();
    const plan = project.plan!;
    validationState.targetIds = plan.screens.map((screen) => screen.id);
    const {
      screens: _screens,
      source: _source,
      generatedAt: _generatedAt,
      ...foundation
    } = plan;
    const invalidFoundation = {
      ...foundation,
      personas: []
    };
    let totalCompleteCalls = 0;
    let foundationRepairCalls = 0;
    let batchCalls = 0;
    let repairCallCount = 0;
    const attemptsById = new Map<string, number>();

    vi.mocked(complete).mockImplementation(async (_config, messages) => {
      totalCompleteCalls += 1;
      if (totalCompleteCalls === 1) return JSON.stringify(invalidFoundation);
      if (totalCompleteCalls === 2) {
        foundationRepairCalls += 1;
        return JSON.stringify(foundation);
      }
      if (totalCompleteCalls >= 3 && totalCompleteCalls <= 7) {
        batchCalls += 1;
        const start = (totalCompleteCalls - 3) * 3;
        return JSON.stringify({
          screens: plan.screens.slice(start, start + 3)
        });
      }

      const request = JSON.stringify(messages);
      const targetId = request.match(
        /目标ID（必须完全一致）：(screen-\d{2})/
      )?.[1];
      if (!targetId) {
        throw new Error(`无法识别单屏修复目标：${request}`);
      }
      repairCallCount += 1;
      const attempt = (attemptsById.get(targetId) ?? 0) + 1;
      attemptsById.set(targetId, attempt);
      if (attempt === 1) {
        return JSON.stringify({ screenId: targetId, changes: {} });
      }
      return JSON.stringify({
        screenId: targetId,
        changes: {
          "copy.headline": `第${attempt}轮修复${targetId}`
        }
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

    const error = caught as {
      code?: string;
      meta?: {
        phase?: string;
        repairCallCount?: number;
        conflictScreenIds?: string[];
      };
      partialData?: {
        publishable?: boolean;
        plan?: { screens?: typeof plan.screens };
      };
    };
    expect(totalCompleteCalls).toBe(18);
    expect(foundationRepairCalls).toBe(1);
    expect(batchCalls).toBe(5);
    expect(repairCallCount).toBe(11);
    expect(error.code).toBe("PLAN_REPAIR_CALL_LIMIT_EXCEEDED");
    expect(error.meta).toMatchObject({ phase: "planning-repair-limit" });
    expect(error.partialData?.publishable).toBe(false);
    expect(error.partialData?.plan?.screens).toHaveLength(15);
  });

  it.each([
    {
      caseName: "the same deterministic copy issue remains",
      postRepairRuleCode: "PLAN_CROSS_SCREEN_COPY_SIMILAR"
    },
    {
      caseName: "a new deterministic copy issue appears",
      postRepairRuleCode: "COPY_HEADLINE_NOT_USER_FACING"
    }
  ])(
    "keeps a contract-valid patch pending when $caseName and another screen in the wave times out",
    async ({ postRepairRuleCode }) => {
      const project = createSampleProject();
      const plan = project.plan!;
      const originalScreen01 = applyScreenContracts(
        plan.screens,
        project.research!.facts
      ).find((screen) => screen.id === "screen-01")!;
      validationState.targetIds = ["screen-01", "screen-09"];
      validationState.rejectedRepairHeadline =
        "这句虽然结构合法但仍不符合用户表达";
      validationState.postRepairRuleCode = postRepairRuleCode;
      const {
        screens: _screens,
        source: _source,
        generatedAt: _generatedAt,
        ...foundation
      } = plan;
      let generationCallCount = 0;

      vi.mocked(complete).mockImplementation(async (_config, messages) => {
        generationCallCount += 1;
        if (generationCallCount === 1) return JSON.stringify(foundation);
        if (generationCallCount >= 2 && generationCallCount <= 6) {
          const start = (generationCallCount - 2) * 3;
          return JSON.stringify({
            screens: plan.screens.slice(start, start + 3)
          });
        }

        const request = JSON.stringify(messages);
        const targetId = request.match(
          /目标ID（必须完全一致）：(screen-\d{2})/
        )?.[1];
        if (targetId === "screen-01") {
          return JSON.stringify({
            screenId: targetId,
            changes: {
              "copy.headline": validationState.rejectedRepairHeadline
            }
          });
        }
        if (targetId === "screen-09") {
          throw new ServiceError("火山方舟 Ark 响应超时。", {
            statusCode: 504,
            code: "AI_PROVIDER_TIMEOUT",
            details: {
              stage: "planning-repair",
              retryable: true,
              failureOrigin: "sdk_timeout",
              attempt: 1,
              maxAttempts: 1
            }
          });
        }
        throw new Error(`无法识别单屏修复目标：${request}`);
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

      const error = caught as {
        code?: string;
        meta?: {
          conflictScreenIds?: string[];
          acceptedRepairScreenIds?: string[];
        };
        partialData?: {
          publishable?: boolean;
          plan?: { screens?: typeof plan.screens };
        };
      };
      expect(error.code).toBe("AI_PROVIDER_TIMEOUT");
      expect(error.meta?.conflictScreenIds).toEqual([
        "screen-01",
        "screen-09"
      ]);
      expect(error.meta?.acceptedRepairScreenIds).toEqual([]);
      expect(error.partialData?.publishable).toBe(false);
      expect(error.partialData?.plan?.screens).toHaveLength(15);
      expect(
        error.partialData?.plan?.screens?.find(
          (screen) => screen.id === "screen-01"
        )?.copy.headline
      ).toBe(originalScreen01.copy.headline);
    }
  );

  it("repairs conflicting screens independently and retries only the malformed screen", async () => {
    const project = createSampleProject();
    const plan = project.plan!;
    const targetIds = [
      "screen-04",
      "screen-10",
      "screen-11",
      "screen-13",
      "screen-14",
      "screen-15"
    ];
    const { screens: _screens, source: _source, generatedAt: _generatedAt, ...foundation } =
      plan;
    let callIndex = 0;
    const repairRequests: string[] = [];
    const attemptsById = new Map<string, number>();
    const repairSchemasById = new Map<string, unknown>();

    vi.mocked(complete).mockImplementation(async (_config, messages, _maxTokens, options) => {
      callIndex += 1;
      if (callIndex === 1) return JSON.stringify(foundation);
      if (callIndex >= 2 && callIndex <= 6) {
        const start = (callIndex - 2) * 3;
        return JSON.stringify({ screens: plan.screens.slice(start, start + 3) });
      }

      const repairRequest = JSON.stringify(messages);
      repairRequests.push(repairRequest);
      const targetId = repairRequest.match(
        /目标ID（必须完全一致）：(screen-\d{2})/
      )?.[1];
      if (!targetId || !targetIds.includes(targetId)) {
        throw new Error(`无法识别单屏修复目标：${repairRequest}`);
      }
      repairSchemasById.set(targetId, options?.jsonSchema);
      const attempt = (attemptsById.get(targetId) ?? 0) + 1;
      attemptsById.set(targetId, attempt);
      if (targetId === "screen-04" && attempt === 1) {
        return JSON.stringify({ screenId: targetId, changes: {} });
      }
      return JSON.stringify({
        screenId: targetId,
        changes: { "copy.headline": `已修正${targetId}` }
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
          expect.objectContaining({ id: "screen-15" })
        ])
      },
      meta: { publishable: true }
    });

    expect(attemptsById.get("screen-04")).toBe(2);
    targetIds.slice(1).forEach((targetId) => {
      expect(attemptsById.get(targetId)).toBe(1);
    });
    const screen04Requests = repairRequests.filter((request) =>
      request.includes("目标ID（必须完全一致）：screen-04")
    );
    expect(screen04Requests).toHaveLength(2);
    const retryMessages = JSON.parse(screen04Requests[1]) as Array<{
      content: string;
    }>;
    const retryContent = retryMessages.at(-1)?.content ?? "";
    expect(retryContent).toContain("空修复 patch");
    expect(retryContent).toContain(
      '"screenId":"screen-xx","changes":{...}'
    );
    expect(repairSchemasById.get("screen-04")).toMatchObject({
      name: "planning_repair_screen_04_patch",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          screenId: { const: "screen-04" },
          changes: {
            type: "object",
            additionalProperties: false,
            required: [
              "copy.body",
              "copy.headline",
              "copy.subheadline"
            ],
            properties: {
              "copy.headline": {
                anyOf: expect.arrayContaining([{ type: "null" }])
              },
              "copy.subheadline": {
                anyOf: expect.arrayContaining([{ type: "null" }])
              },
              "copy.body": {
                anyOf: expect.arrayContaining([{ type: "null" }])
              }
            }
          }
        }
      }
    });
    expect(
      (
        repairSchemasById.get("screen-04") as {
          schema?: {
            properties?: { changes?: { properties?: Record<string, unknown> } };
          };
        }
      ).schema?.properties?.changes?.properties
    ).not.toHaveProperty("subjectKey");
    expect(
      (
        repairSchemasById.get("screen-04") as {
          schema?: { properties?: { changes?: Record<string, unknown> } };
        }
      ).schema?.properties?.changes
    ).not.toHaveProperty("minProperties");
  });

  it("continues from an unpublished repair draft instead of regenerating foundation and all batches", async () => {
    const project = createSampleProject();
    const plan = project.plan!;
    validationState.targetIds = ["screen-07", "screen-10"];
    const repairRequests: string[] = [];

    vi.mocked(complete).mockImplementation(async (_config, messages) => {
      const repairRequest = JSON.stringify(messages);
      repairRequests.push(repairRequest);
      const targetId = repairRequest.match(
        /目标ID（必须完全一致）：(screen-\d{2})/
      )?.[1];
      if (!targetId || !validationState.targetIds.includes(targetId)) {
        throw new Error(`续修不应重新生成基础或批次：${repairRequest}`);
      }
      return JSON.stringify({
        screenId: targetId,
        changes: { "copy.headline": `续修完成${targetId}` }
      });
    });

    await expect(
      runPlanningStage(
        {
          stage: "planning",
          research: project.research!,
          brief: project.brief,
          draftPlan: plan
        },
        providerConfig
      )
    ).resolves.toMatchObject({
      data: {
        screens: expect.arrayContaining([
          expect.objectContaining({
            id: "screen-07",
            copy: expect.objectContaining({ headline: "续修完成screen-07" })
          }),
          expect.objectContaining({
            id: "screen-10",
            copy: expect.objectContaining({ headline: "续修完成screen-10" })
          })
        ])
      },
      meta: {
        publishable: true
      }
    });

    expect(repairRequests).toHaveLength(2);
    expect(repairRequests.join("\n")).not.toContain("策略骨架");
  });

  it.each([
    {
      providerCode: "AI_PROVIDER_TIMEOUT",
      statusCode: 504,
      providerMessage: "火山方舟 Ark 响应超时。",
      failureOrigin: "sdk_timeout" as const,
      retryable: true
    },
    {
      providerCode: "AI_RESPONSE_TRUNCATED",
      statusCode: 502,
      providerMessage: "AI 输出达到长度上限，响应已被截断。",
      failureOrigin: "stream_event" as const,
      retryable: true
    },
    {
      providerCode: "AI_PROVIDER_AUTH_FAILED",
      statusCode: 401,
      providerMessage: "火山方舟 Ark API 鉴权失败。",
      failureOrigin: "upstream_http" as const,
      retryable: false
    }
  ])(
    "preserves the provider cause and verified repair progress when the retry ends with $providerCode",
    async ({
      providerCode,
      statusCode,
      providerMessage,
      failureOrigin,
      retryable
    }) => {
      const project = createSampleProject();
      const plan = project.plan!;
      validationState.targetIds = [
        "screen-01",
        "screen-09",
        "screen-10",
        "screen-11",
        "screen-13",
        "screen-15"
      ];
      const contractedScreens = applyScreenContracts(
        plan.screens,
        project.research!.facts
      );
      const firstVerifiedRepair = {
        ...contractedScreens.find((screen) => screen.id === "screen-01")!,
        copy: {
          ...contractedScreens.find((screen) => screen.id === "screen-01")!
            .copy,
          headline: "先解决用户最关心的问题"
        }
      };
      const { screens: _screens, source: _source, generatedAt: _generatedAt, ...foundation } =
        plan;
      let callIndex = 0;

      vi.mocked(complete).mockImplementation(async () => {
        callIndex += 1;
        if (callIndex === 1) return JSON.stringify(foundation);
        if (callIndex >= 2 && callIndex <= 6) {
          const start = (callIndex - 2) * 3;
          return JSON.stringify({ screens: plan.screens.slice(start, start + 3) });
        }
        if (callIndex === 7) {
          return JSON.stringify({
            screenId: "screen-01",
            changes: {
              "copy.headline": firstVerifiedRepair.copy.headline
            }
          });
        }
        throw new ServiceError(providerMessage, {
          statusCode,
          code: providerCode,
          details: {
            stage: "planning-repair",
            ...(retryable ? { retryable: true } : {}),
            failureOrigin,
            attempt: 1,
            maxAttempts: 1
          }
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

      const error = caught as {
        code?: string;
        statusCode?: number;
        details?: string[];
        meta?: {
          phase?: string;
          conflictScreenIds?: string[];
          retryable?: boolean;
        };
        partialData?: {
          publishable?: boolean;
          plan?: { screens?: typeof contractedScreens };
        };
      };
      expect(error.code).toBe(providerCode);
      expect(error.statusCode).toBe(statusCode);
      expect(safeError(caught).status).toBe(statusCode);
      expect(error.details).toEqual(
        expect.arrayContaining([expect.stringContaining(providerMessage)])
      );
      expect(error.meta).toMatchObject({
        phase: "planning-repair-provider",
        retryable,
        conflictScreenIds: validationState.targetIds.filter(
          (id) => id !== "screen-01"
        )
      });
      expect(error.partialData?.publishable).toBe(false);
      expect(error.partialData?.plan?.screens).toHaveLength(15);
      expect(
        error.partialData?.plan?.screens?.find(
          (screen) => screen.id === "screen-01"
        )?.copy.headline
      ).toBe(firstVerifiedRepair.copy.headline);
      expect(
        error.partialData?.plan?.screens?.some(
          (screen) => screen.id === "screen-15"
        )
      ).toBe(true);
      // 一波最多并发3屏：screen-01 通过后，同波其余2屏透传
      // provider 错误；后续波次不再启动。
      expect(callIndex).toBe(9);
    }
  );
});
