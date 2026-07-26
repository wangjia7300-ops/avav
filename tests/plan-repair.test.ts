import { describe, expect, it } from "vitest";
import {
  parsePlanningRepairPayload,
  planIssueFingerprint,
  PlanRepairContractError,
  selectPlanRepairTargetIds,
  type PlanRepairIssue
} from "@/lib/skill-suite/plan-repair";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

function headlineIssue(screenId = "screen-06"): PlanRepairIssue {
  return {
    ruleCode: "COPY_HEADLINE_NOT_USER_FACING",
    message: `${screenId} 标题没有回答用户问题`,
    screenIds: [screenId],
    scope: "screen",
    path: "copy.headline",
    allowedRepairFields: ["copy.headline"]
  };
}

describe("planning repair contract", () => {
  it("accepts an exact target subset and an authorized field change", () => {
    const plan = createSampleProject().plan!;
    const original = plan.screens.find((screen) => screen.id === "screen-06")!;
    const repaired = structuredClone(original);
    repaired.copy.headline = "规格选起来更明白";

    expect(
      parsePlanningRepairPayload({
        payload: { screens: [repaired] },
        targetIds: ["screen-06"],
        originalScreens: plan.screens,
        issues: [headlineIssue()]
      })
    ).toEqual([repaired]);
  });

  it("rejects changing the immutable subject or user question", () => {
    const plan = createSampleProject().plan!;
    const repaired = structuredClone(
      plan.screens.find((screen) => screen.id === "screen-06")!
    );
    repaired.subjectKey = "fact:another-selling-point";
    repaired.userQuestion = "能不能换一个卖点？";

    expect(() =>
      parsePlanningRepairPayload({
        payload: { screens: [repaired] },
        targetIds: ["screen-06"],
        originalScreens: plan.screens,
        issues: [headlineIssue()]
      })
    ).toThrow(PlanRepairContractError);
  });

  it("rejects extra screens and changes outside the authorized fields", () => {
    const plan = createSampleProject().plan!;
    const target = structuredClone(
      plan.screens.find((screen) => screen.id === "screen-06")!
    );
    target.copy.headline = "规格选起来更明白";
    target.copy.body = "模型还擅自改了没有授权的正文。";
    const extra = structuredClone(
      plan.screens.find((screen) => screen.id === "screen-07")!
    );

    expect(() =>
      parsePlanningRepairPayload({
        payload: { screens: [target, extra] },
        targetIds: ["screen-06"],
        originalScreens: plan.screens,
        issues: [headlineIssue()]
      })
    ).toThrow(/没有严格返回目标冲突屏/u);

    expect(() =>
      parsePlanningRepairPayload({
        payload: { screens: [target] },
        targetIds: ["screen-06"],
        originalScreens: plan.screens,
        issues: [headlineIssue()]
      })
    ).toThrow(/修改了未授权字段/u);
  });

  it("fingerprints issue sets stably and targets only the later conflict screen", () => {
    const plan = createSampleProject().plan!;
    const crossIssue: PlanRepairIssue = {
      ruleCode: "PLAN_CROSS_SCREEN_COPY_SIMILAR",
      message: "screen-02 与 screen-08 文案相似",
      screenIds: ["screen-08"],
      relatedScreenIds: ["screen-02"],
      scope: "cross-screen",
      allowedRepairFields: ["copy.headline", "copy.subheadline", "copy.body"]
    };

    expect(
      planIssueFingerprint([headlineIssue(), crossIssue])
    ).toBe(planIssueFingerprint([crossIssue, headlineIssue()]));
    expect(selectPlanRepairTargetIds([crossIssue], plan.screens)).toEqual([
      "screen-08"
    ]);
  });
});
