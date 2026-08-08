import { describe, expect, it } from "vitest";
import {
  allowedRepairFieldsByScreen,
  parsePlanningRepairPatchPayload,
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
  it("将单屏授权 patch 合并到服务端原屏，不向模型开放不可变字段", () => {
    const plan = createSampleProject().plan!;
    const original = plan.screens.find((screen) => screen.id === "screen-06")!;

    const repaired = parsePlanningRepairPatchPayload({
      payload: {
        screenId: "screen-06",
        changes: { "copy.headline": "规格选起来更明白" }
      },
      targetId: "screen-06",
      originalScreens: plan.screens,
      issues: [headlineIssue()]
    });

    expect(repaired.copy.headline).toBe("规格选起来更明白");
    expect(repaired.subjectKey).toBe(original.subjectKey);
    expect(repaired.userQuestion).toBe(original.userQuestion);
    expect(repaired.claimScope).toBe(original.claimScope);
    expect(repaired.evidenceIds).toEqual(original.evidenceIds);
  });

  it("拒绝空 patch、未授权字段与没有实际变化的 patch", () => {
    const plan = createSampleProject().plan!;
    const original = plan.screens.find((screen) => screen.id === "screen-06")!;
    const parse = (changes: Record<string, unknown>) =>
      parsePlanningRepairPatchPayload({
        payload: { screenId: "screen-06", changes },
        targetId: "screen-06",
        originalScreens: plan.screens,
        issues: [headlineIssue()]
      });

    expect(() => parse({})).toThrow(/空修复 patch/u);
    expect(() => parse({ subjectKey: "fact:other" })).toThrow(
      /未授权字段/u
    );
    expect(() =>
      parse({ "copy.headline": original.copy.headline })
    ).toThrow(/没有产生任何实际变化/u);
  });

  it("把 strict schema 的 null 占位视为未修改，并拒绝全 null patch", () => {
    const plan = createSampleProject().plan!;
    const original = plan.screens.find((screen) => screen.id === "screen-06")!;
    const issue: PlanRepairIssue = {
      ...headlineIssue(),
      allowedRepairFields: ["copy.headline", "copy.body"]
    };
    const parse = (changes: Record<string, unknown>) =>
      parsePlanningRepairPatchPayload({
        payload: { screenId: "screen-06", changes },
        targetId: "screen-06",
        originalScreens: plan.screens,
        issues: [issue]
      });

    const repaired = parse({
      "copy.headline": "规格选起来更明白",
      "copy.body": null
    });
    expect(repaired.copy.headline).toBe("规格选起来更明白");
    expect(repaired.copy.body).toBe(original.copy.body);
    expect(() =>
      parse({ "copy.headline": null, "copy.body": null })
    ).toThrow(/空修复 patch/u);
  });

  it("拒绝超长或带HTML控制内容的修复字段", () => {
    const plan = createSampleProject().plan!;
    const parseHeadline = (headline: string) =>
      parsePlanningRepairPatchPayload({
        payload: {
          screenId: "screen-06",
          changes: { "copy.headline": headline }
        },
        targetId: "screen-06",
        originalScreens: plan.screens,
        issues: [headlineIssue()]
      });

    expect(() => parseHeadline("超".repeat(21))).toThrow(/长度/u);
    expect(() => parseHeadline("正常标题\u0000隐藏内容")).toThrow(/控制字符/u);
    expect(() => parseHeadline("<b>规格先看清</b>")).toThrow(/HTML/u);
  });

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

  it("对没有 matching issue 的目标屏不授权任何可变字段", () => {
    expect(
      allowedRepairFieldsByScreen([headlineIssue("screen-06")], [
        "screen-07"
      ]).get("screen-07")
    ).toEqual([]);
  });

  it("拒绝修改没有 matching issue 的目标屏", () => {
    const plan = createSampleProject().plan!;
    const repaired = structuredClone(
      plan.screens.find((screen) => screen.id === "screen-07")!
    );
    repaired.copy.headline = "模型不应被允许修改此屏";

    expect(() =>
      parsePlanningRepairPayload({
        payload: { screens: [repaired] },
        targetIds: ["screen-07"],
        originalScreens: plan.screens,
        issues: [headlineIssue("screen-06")]
      })
    ).toThrow(PlanRepairContractError);
  });

  it("issues 为空时不回退修复全部屏", () => {
    const screens = createSampleProject().plan!.screens;

    expect(selectPlanRepairTargetIds([], screens)).toEqual([]);
  });

  it("issues 仅包含未知屏时不回退修复全部屏", () => {
    const screens = createSampleProject().plan!.screens;

    expect(
      selectPlanRepairTargetIds([headlineIssue("screen-99")], screens)
    ).toEqual([]);
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
