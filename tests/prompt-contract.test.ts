import { describe, expect, it } from "vitest";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";
import {
  buildPlanningRepairPrompt,
  buildPlanningScreenBatchPrompt
} from "@/lib/skill-suite/prompts";

describe("planning prompt contract", () => {
  it("gives every copy layer a distinct user-facing semantic job", () => {
    const project = createSampleProject();
    const { screens: _screens, source: _source, generatedAt: _generatedAt, ...foundation } =
      project.plan!;
    const prompt = buildPlanningScreenBatchPrompt({
      research: project.research!,
      brief: project.brief,
      foundation,
      indexes: [1, 2, 3]
    });

    expect(prompt).toContain("标题＝用户结论");
    expect(prompt).toContain("副标题＝事实解释");
    expect(prompt).toContain("正文＝生活说明");
    expect(prompt).toContain("三层各司其职");
    expect(prompt).toContain("甲方图片、上传图片、图片可见");
    expect(prompt).toContain("screen-01");
    expect(prompt).toContain("screen-02");
    expect(prompt).toContain("screen-03");
    expect(prompt).toContain("灰白、测试蓝与深灰撞色");
  });

  it("repairs only conflict screens while preserving the same semantic roles", () => {
    const project = createSampleProject();
    const prompt = buildPlanningRepairPrompt({
      research: project.research!,
      brief: project.brief,
      rejectedPlan: project.plan!,
      issues: [
        {
          ruleCode: "COPY_HEADLINE_NOT_USER_FACING",
          message: "screen-06 文案质量：主标题没有先回答用户为什么要关心",
          screenIds: ["screen-06"],
          scope: "screen",
          path: "screens[5].copy.headline",
          allowedRepairFields: ["copy.headline"]
        }
      ],
      targetIds: ["screen-06"]
    });

    expect(prompt).toContain("只修复一个冲突屏");
    expect(prompt).toContain("只返回一个差异 patch");
    expect(prompt).toContain('"screenId":"screen-06","changes"');
    expect(prompt).not.toContain('"screenId":"screen-01","changes"');
    expect(prompt).toContain("screen-06");
    expect(prompt).toContain("标题给用户结论");
    expect(prompt).toContain("副标题给事实解释");
    expect(prompt).toContain("正文给场景/动作和结果");
    expect(prompt).toContain("不得出现甲方图片");
    expect(prompt).toContain("subjectKey");
    expect(prompt).toContain("字段授权表");
    expect(prompt).not.toContain("把本屏改成 creative");
    expect(prompt).not.toContain("必须改为对应 claimScope");
  });
});
