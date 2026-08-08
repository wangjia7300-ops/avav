import { describe, expect, it } from "vitest";
import { buildQAPrompt } from "@/lib/skill-suite/prompts";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

describe("semantic QA contract", () => {
  it("reviews copy roles and Jimeng translation consistency as a dedicated module", () => {
    const project = createSampleProject();
    const prompt = buildQAPrompt({
      research: project.research!,
      plan: project.plan!,
      executions: project.executions,
      deterministicFindings: []
    });

    expect(prompt).toContain("15个模块");
    expect(prompt).toContain("文案与转译语义一致性");
    expect(prompt).toContain("标题是否直接回答 userQuestion");
    expect(prompt).toContain("副标题是否锚定本屏事实");
    expect(prompt).toContain("主体、场景、镜头、构图");
  });
});
