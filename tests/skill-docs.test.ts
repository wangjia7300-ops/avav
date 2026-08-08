import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const SKILL_ROOT = new URL("../.agents/skills/", import.meta.url);

async function readSkill(path: string) {
  return readFile(new URL(path, SKILL_ROOT), "utf8");
}

describe("internal semantic skills", () => {
  it.each([
    ["ecommerce-copy-compiler", "$ecommerce-copy-compiler"],
    ["jimeng-prompt-translator", "$jimeng-prompt-translator"]
  ])("%s has complete metadata and no scaffold TODOs", async (name, token) => {
    const [skill, metadata] = await Promise.all([
      readSkill(`${name}/SKILL.md`),
      readSkill(`${name}/agents/openai.yaml`)
    ]);

    expect(skill).toMatch(new RegExp(`^---\\nname: ${name}\\n`));
    expect(skill).not.toContain("[TODO");
    expect(metadata).toContain(`Use ${token}`);
    expect(metadata).toContain("allow_implicit_invocation: true");
  });

  it("wires the copy compiler into planning and the Jimeng translator into execution and QA", async () => {
    const [planning, execution, qa] = await Promise.all([
      readSkill("detail-page-planning/SKILL.md"),
      readSkill("detail-page-execution/SKILL.md"),
      readSkill("detail-page-qa/SKILL.md")
    ]);

    expect(planning).toContain("$ecommerce-copy-compiler");
    expect(execution).toContain("$jimeng-prompt-translator");
    expect(qa).toContain("模块十五：文案与转译语义一致性");
  });
});
