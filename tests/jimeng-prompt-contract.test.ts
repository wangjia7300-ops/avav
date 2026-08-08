import { describe, expect, it } from "vitest";
import { compileScreenImagePrompt } from "@/lib/skill-suite/jimeng-prompt-translator";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

function occurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}

describe("Jimeng / Seedream prompt compiler", () => {
  it("uses concise Chinese natural language, explicit multi-image roles and quoted copy", () => {
    const project = createSampleProject();
    const screen = project.plan!.screens[0];
    const execution = project.executions[screen.id];
    const prompt = compileScreenImagePrompt({
      screen,
      execution,
      facts: project.research!.facts
    });

    expect(prompt).toContain("图1是产品主身份基准");
    expect(prompt).toContain("其余图片只补充侧面、背面和细节");
    expect(prompt).toContain("9:16竖版");
    expect(prompt).toContain("1440x2560");
    expect(prompt).toContain(screen.scene);
    expect(prompt).toContain(screen.shot);
    expect(prompt).toContain(screen.composition);
    expect(prompt).toContain(screen.proofMethod);
    expect(prompt).toContain(`主标题“${execution.copyFinal.headline}”`);
    expect(prompt).toContain(`副标题“${execution.copyFinal.subheadline}”`);
    expect(prompt).toContain(`正文“${execution.copyFinal.body}”`);
    execution.copyFinal.keyPoints.forEach((point, index) => {
      expect(
        occurrences(prompt, `要点${index + 1}“${point}”`)
      ).toBe(1);
    });
    expect(occurrences(prompt, execution.negativePrompt)).toBe(1);
    expect(occurrences(prompt, "AI辅助生成")).toBe(1);
    expect(prompt).not.toMatch(
      /APPROVED_COPY|Headline:|Subheadline:|Key points:|commercialUse|evidenceIds|claimScope/
    );
    expect(prompt).not.toMatch(/text[- ]?free|no rendered text/i);
    expect(prompt.length).toBeLessThanOrEqual(2_000);
  });
});
