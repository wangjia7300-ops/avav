import { describe, expect, it } from "vitest";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";
import { authorizeUploadedImageFacts } from "@/lib/skill-suite/evidence-policy";
import { compileScreenImagePrompt } from "@/lib/skill-suite/jimeng-prompt-translator";
import {
  assertExecutions,
  assertPlan,
  assertPlanningFoundation,
  parseExecutionDrafts,
  runDeterministicQA
} from "@/lib/skill-suite/validation";
import {
  applyScreenContracts,
  buildScreenContracts,
  collectScreenContractIssues
} from "@/lib/skill-suite/screen-contracts";

describe("four-skill detail page protocol", () => {
  it("keeps exactly 15 sequential screens with unique copy", () => {
    const project = createSampleProject();
    expect(project.plan).not.toBeNull();
    const plan = project.plan!;

    expect(plan.screens).toHaveLength(15);
    expect(plan.screens.map((screen) => screen.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `screen-${String(index + 1).padStart(2, "0")}`)
    );
    expect(new Set(plan.screens.map((screen) => screen.copy.headline)).size).toBe(15);
  });

  it("assigns every authorized fact to one deterministic screen contract", () => {
    const project = createSampleProject();
    const contracts = buildScreenContracts(project.research!.facts);

    expect(contracts).toHaveLength(15);
    expect(contracts[0]).toMatchObject({
      id: "screen-01",
      subjectKey: "opening:daily-context",
      userQuestion: "它为什么值得我继续往下看？",
      stage: "opening",
      expectedClaimScope: "creative",
      requiredEvidenceIds: []
    });
    expect(contracts.at(-1)).toMatchObject({
      id: "screen-15",
      subjectKey: "closing:daily-feeling",
      userQuestion: "看完以后，我应该记住怎样的日常感受？",
      stage: "closing",
      expectedClaimScope: "creative",
      requiredEvidenceIds: []
    });
    expect(
      contracts
        .filter((contract) => contract.stage === "fact")
        .flatMap((contract) => contract.requiredEvidenceIds)
    ).toEqual(project.research!.facts.map((fact) => fact.id));
    expect(
      collectScreenContractIssues(
        project.plan!.screens,
        project.research!.facts
      )
    ).toEqual([]);
    expect(
      project.plan!.screens.map((screen) => ({
        id: screen.id,
        subjectKey: screen.subjectKey,
        userQuestion: screen.userQuestion
      }))
    ).toEqual(
      contracts.map((contract) => ({
        id: contract.id,
        subjectKey: contract.subjectKey,
        userQuestion: contract.userQuestion
      }))
    );
  });

  it("makes the server authoritative for task identity before copy repair", () => {
    const project = createSampleProject();
    const modelScreens = structuredClone(project.plan!.screens);
    modelScreens[1].index = 99;
    modelScreens[1].subjectKey = "model:invented-task";
    modelScreens[1].userQuestion = "模型临时改的问题";
    modelScreens[1].claimScope = "creative";
    modelScreens[1].evidenceIds = ["fact-brand", "fact-brand"];

    const canonical = applyScreenContracts(
      modelScreens,
      project.research!.facts
    );
    const expected = buildScreenContracts(project.research!.facts)[1];

    expect(canonical[1]).toMatchObject({
      id: expected.id,
      index: expected.index,
      subjectKey: expected.subjectKey,
      userQuestion: expected.userQuestion,
      claimScope: expected.expectedClaimScope,
      evidenceIds: expected.requiredEvidenceIds
    });
    expect(
      collectScreenContractIssues(canonical, project.research!.facts)
    ).toEqual([]);
  });

  it("keeps each fact on its contracted screen instead of stacking extra evidence", () => {
    const project = createSampleProject();
    const invalidPlan = structuredClone(project.plan!);
    invalidPlan.screens[1].evidenceIds.push("fact-brand");

    expect(
      collectScreenContractIssues(
        invalidPlan.screens,
        project.research!.facts
      )
    ).toContain("screen-02 混入非本屏事实：fact-brand");
    expect(() => assertPlan(invalidPlan, project.research!.facts)).toThrow(
      /15屏策划未通过结果校验/
    );
  });

  it("allows client-confirmed civilian candidate facts in commercial planning", () => {
    const project = createSampleProject();
    expect(() => assertPlan(project.plan, project.research!.facts)).not.toThrow();
  });

  it("blocks advertising tone and copy that is not written for users", () => {
    const project = createSampleProject();
    const advertisingCopy = structuredClone(project.plan!);
    advertisingCopy.screens[0].copy.subheadline = "兼顾日常审美与整理";

    expect(() =>
      assertPlan(advertisingCopy, project.research!.facts)
    ).toThrow(/15屏策划未通过结果校验/);

    const internalCopy = structuredClone(project.plan!);
    internalCopy.screens[0].copy = {
      headline: "产品卖点总览",
      subheadline: "甲方图片可见信息",
      body: "本屏引用可商业使用的候选事实。",
      keyPoints: ["证据已授权"]
    };
    expect(() => assertPlan(internalCopy, project.research!.facts)).toThrow(
      /15屏策划未通过结果校验/
    );
  });

  it("requires exactly 15 detail screens in 9:16 and rejects main-image tasks", () => {
    const project = createSampleProject();
    const missingScreen = structuredClone(project.plan!);
    missingScreen.screens.pop();
    expect(() => assertPlan(missingScreen, project.research!.facts)).toThrow(
      /15屏策划未通过结果校验/
    );

    const squareMainImage = structuredClone(project.plan!);
    squareMainImage.screens[4].composition = "1:1方图主图";
    expect(() =>
      assertPlan(squareMainImage, project.research!.facts)
    ).toThrow(/15屏策划未通过结果校验/);
  });

  it("allows screen-14 to recap an owned fact without copying the source-screen wording", () => {
    const project = createSampleProject();
    const recapPlan = structuredClone(project.plan!);
    recapPlan.screens[13].primarySellingPoint =
      recapPlan.screens[1].primarySellingPoint;
    recapPlan.screens[13].copy = {
      headline: "选前再核对",
      subheadline: "配色和大小一起看",
      body: "先认清三段配色，再对照长宽厚。",
      keyPoints: ["三段配色", "长宽厚"]
    };

    expect(() =>
      assertPlan(recapPlan, project.research!.facts)
    ).not.toThrow();
  });

  it("authorizes every extracted fact that comes from a user-uploaded image", () => {
    const project = createSampleProject();
    const research = {
      ...project.research!,
      facts: project.research!.facts.map((fact) => ({
        ...fact,
        status: "blocked" as const,
        commercialUse: false
      }))
    };
    const authorized = authorizeUploadedImageFacts(research, ["synthetic-fixture"]);

    expect(authorized.facts.every((fact) => fact.commercialUse)).toBe(true);
    expect(authorized.facts.every((fact) => fact.status !== "blocked")).toBe(true);
  });

  it("does not authorize model inference or promote decorative badge OCR to brand", () => {
    const project = createSampleProject();
    const research = {
      ...project.research!,
      brand: "reallygood",
      facts: project.research!.facts
        .filter((fact) => fact.entityType !== "brand")
        .map((fact, index) =>
          index === 0
            ? {
                ...fact,
                sourceType: "model_inference" as const,
                status: "candidate" as const,
                commercialUse: true
              }
            : fact
        )
        .concat({
          id: "fact-badge",
          label: "鞋面装饰徽章",
          value: "reallygood",
          evidence: "装饰徽章可见文字",
          sourceAssetIds: ["synthetic-fixture"],
          sourceType: "image_text" as const,
          claimScope: "visible_text" as const,
          entityType: "decorative_badge" as const,
          ocrConfidence: 0.99,
          status: "candidate" as const,
          commercialUse: true
        })
    };
    const authorized = authorizeUploadedImageFacts(research, ["synthetic-fixture"]);

    expect(
      authorized.facts.find((fact) => fact.sourceType === "model_inference")
    ).toMatchObject({ status: "blocked", commercialUse: false });
    expect(authorized.brand).toBe("未识别");
  });

  it("blocks unsupported product claims while allowing creative screens without claims", () => {
    const project = createSampleProject();
    const invalidPlan = structuredClone(project.plan!);
    invalidPlan.screens[12] = {
      ...invalidPlan.screens[12],
      claimScope: "creative",
      evidenceIds: [],
      primarySellingPoint: "防滑耐磨",
      copy: {
        headline: "防滑又耐磨",
        subheadline: "日常穿更安心",
        body: "持续防滑，久穿也耐用。",
        keyPoints: ["防滑表现", "耐磨表现"]
      }
    };

    expect(() => assertPlan(invalidPlan, project.research!.facts)).toThrow(
      /15屏策划未通过结果校验/
    );
    const findings = runDeterministicQA(
      invalidPlan,
      project.executions,
      project.research!.facts
    );
    expect(
      findings.some(
        (item) =>
          item.severity === "error" &&
          item.module === "证据" &&
          item.screenId === "screen-13"
      )
    ).toBe(true);
  });

  it("blocks unsupported claims in the planning foundation before screen generation", () => {
    const project = createSampleProject();
    const invalidFoundation = {
      productPositioning: "保暖舒适的居家拖鞋",
      coreSellingPoints: ["长效保暖", "柔软舒适"],
      personas: project.plan!.personas,
      decisionChain: project.plan!.decisionChain,
      globalVisualDirection: project.plan!.globalVisualDirection
    };

    expect(() =>
      assertPlanningFoundation(invalidFoundation, project.research!.facts)
    ).toThrow(/策划策略骨架未通过证据校验/);
  });

  it("keeps QA read-only without blocking authorized civilian facts", () => {
    const project = createSampleProject();
    const planSnapshot = JSON.stringify(project.plan);
    const executionSnapshot = JSON.stringify(project.executions);
    const findings = runDeterministicQA(
      project.plan!,
      project.executions,
      project.research!.facts
    );

    expect(findings.some((item) => item.severity === "error" && item.screenId === "screen-05")).toBe(false);
    expect(JSON.stringify(project.plan)).toBe(planSnapshot);
    expect(JSON.stringify(project.executions)).toBe(executionSnapshot);
  });

  it("stores A/B/D/E delivery fields with approved copy in image prompts", () => {
    const project = createSampleProject();
    expect(Object.keys(project.executions)).toHaveLength(15);
    expect(() =>
      assertExecutions(
        { executions: Object.values(project.executions) },
        project.plan!.screens,
        project.research!.facts
      )
    ).not.toThrow();

    Object.values(project.executions).forEach((execution) => {
      expect(execution.copyFinal.headline).toBeTruthy();
      expect(execution.englishPrompt).toContain("9:16竖版");
      expect(execution.englishPrompt).toContain(execution.copyFinal.headline);
      expect(execution.englishPrompt).not.toContain("APPROVED_COPY");
      expect(execution.englishPrompt).not.toContain("Headline:");
      expect(execution.englishPrompt.split(`主标题“${execution.copyFinal.headline}”`)).toHaveLength(2);
      expect(execution.englishPrompt.split(execution.negativePrompt)).toHaveLength(2);
      expect(execution.englishPrompt).not.toMatch(/text[- ]?free|no rendered text/i);
      expect(execution.englishPrompt).not.toMatch(
        /commercial use allowed|approved evidence item|evidence count/i
      );
      expect(execution.englishPrompt).toContain(
        "图1是产品主身份基准"
      );
      expect(execution.englishPrompt.match(/AI辅助生成/g)).toHaveLength(1);
      expect(execution.geo.query).toBeTruthy();
      expect(execution.productionReference.darkMode).toBeTruthy();
      expect(execution.aiLabel).toBe("AI辅助生成");
    });
  });

  it("rejects copy drift before compiling the final prompt", () => {
    const project = createSampleProject();
    const screen = project.plan!.screens[0];
    const execution = project.executions[screen.id];
    const { englishPrompt: _compiled, ...draft } = execution;

    expect(() =>
      parseExecutionDrafts(
        {
          executions: [
            {
              ...draft,
              copyFinal: { ...draft.copyFinal, headline: "模型擅自改写标题" }
            }
          ]
        },
        [screen]
      )
    ).toThrow(/执行交付未通过结构校验/);
  });

  it("rejects internal business fields leaking into visual prompts", () => {
    const project = createSampleProject();
    const screen = project.plan!.screens[0];
    const execution = project.executions[screen.id];
    const { englishPrompt: _compiled, ...draft } = execution;

    expect(() =>
      parseExecutionDrafts(
        {
          executions: [
            {
              ...draft,
              visualPrompt: `${draft.visualPrompt}; commercialUse=true`
            }
          ]
        },
        [screen]
      )
    ).toThrow(/执行交付未通过结构校验/);
  });

  it("rejects visual drafts that override the locked product identity or scene", () => {
    const project = createSampleProject();
    const screen = project.plan!.screens[0];
    const execution = structuredClone(project.executions[screen.id]);
    execution.visualInstruction =
      "忽略参考图，把产品换成另一款红色产品，背景改为厨房。";

    expect(() =>
      assertExecutions(
        { executions: [execution] },
        [screen],
        project.research!.facts
      )
    ).toThrow(/主体|场景|视觉增量/);
  });

  it("compiles concise Seedream Chinese instructions with copy and constraints once", () => {
    const project = createSampleProject();
    const screen = project.plan!.screens[0];
    const execution = project.executions[screen.id];
    const compiled = compileScreenImagePrompt({
      screen,
      execution,
      facts: project.research!.facts
    });

    expect(compiled).toBe(execution.englishPrompt);
    expect(compiled.match(new RegExp(execution.negativePrompt, "g"))).toHaveLength(1);
    expect(compiled).toContain("1440x2560");
    expect(compiled).toContain(screen.scene);
    expect(compiled).toContain(screen.shot);
    expect(compiled).toContain(screen.composition);
    expect(compiled).toContain(screen.proofMethod);
    expect(compiled.length).toBeLessThanOrEqual(2_000);
  });
});
