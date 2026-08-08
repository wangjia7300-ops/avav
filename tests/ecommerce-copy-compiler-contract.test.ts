import { describe, expect, it } from "vitest";
import {
  buildCopyCompilerGuidance,
  buildCopySemanticBrief
} from "@/lib/skill-suite/ecommerce-copy-compiler";
import { buildScreenContracts } from "@/lib/skill-suite/screen-contracts";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

describe("ecommerce copy compiler contract", () => {
  it("turns one screen contract into three distinct user-facing semantic slots", () => {
    const project = createSampleProject();
    const facts = project.research!.facts.filter(
      (fact) => fact.status !== "blocked" && fact.commercialUse
    );
    const contract = buildScreenContracts(facts)[1];
    const brief = buildCopySemanticBrief(contract, facts);

    expect(brief).toMatchObject({
      screenId: contract.id,
      subjectKey: contract.subjectKey,
      userQuestion: contract.userQuestion,
      claimScope: contract.expectedClaimScope
    });
    expect(brief.evidenceFacts.map((fact) => fact.id)).toEqual(
      contract.requiredEvidenceIds
    );
    expect(brief.copyContract.headline).toMatchObject({
      role: "user_conclusion",
      maxCharacters: 10
    });
    expect(brief.copyContract.subheadline).toMatchObject({
      role: "fact_explanation",
      maxCharacters: 20
    });
    expect(brief.copyContract.body).toMatchObject({
      role: "life_explanation",
      maxCharacters: 45
    });
  });

  it("keeps creative screens fact-free and explicitly forbids invented effects", () => {
    const project = createSampleProject();
    const facts = project.research!.facts.filter(
      (fact) => fact.status !== "blocked" && fact.commercialUse
    );
    const contract = buildScreenContracts(facts)[0];
    const brief = buildCopySemanticBrief(contract, facts);

    expect(contract.expectedClaimScope).toBe("creative");
    expect(brief.evidenceFacts).toEqual([]);
    expect(brief.copyContract.subheadline.instruction).toContain(
      "不新增产品功效"
    );
    expect(brief.forbidden).toContain("把内部任务名写给消费者");
  });

  it("exposes one reusable guidance block instead of duplicating copy rules in prompts", () => {
    const guidance = buildCopyCompilerGuidance();

    expect(guidance).toContain("标题＝用户结论");
    expect(guidance).toContain("副标题＝事实解释");
    expect(guidance).toContain("正文＝生活说明");
    expect(guidance).toContain("不得新增");
    expect(guidance).toContain("禁止硬截断");
  });
});
