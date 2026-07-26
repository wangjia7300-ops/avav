import {
  buildExecutionPrompt,
  buildExecutionRepairPrompt,
  compileScreenImagePrompt
} from "@/lib/skill-suite/prompts";
import {
  assertExecutions,
  assertPlan,
  assertResearch,
  extractJsonObject,
  parseExecutionDrafts,
  SkillSuiteValidationError
} from "@/lib/skill-suite/validation";
import { ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig, DetailScreen } from "@/lib/types";
import { complete, ensureModelMetadata, textMessages } from "./shared";
import type { SkillSuiteRequest } from "./request";

export async function runExecutionStage(
  body: Extract<SkillSuiteRequest, { stage: "execution" }>,
  providerConfig: AIProviderConfig
) {
  assertResearch(body.research);
  assertPlan(body.plan, body.research.facts);
  if (!Array.isArray(body.screens) || body.screens.length < 1 || body.screens.length > 5) {
    throw new ServiceError("执行阶段每批只能生成1–5屏。", {
      statusCode: 400,
      code: "EXECUTION_BATCH_INVALID"
    });
  }

  const planById = new Map(body.plan.screens.map((screen) => [screen.id, screen]));
  const requested = body.screens.map((screen) => planById.get(screen.id)).filter(Boolean);
  if (requested.length !== body.screens.length) {
    throw new ServiceError("执行批次包含不属于当前策划的屏幕。", {
      statusCode: 400,
      code: "EXECUTION_SCREEN_INVALID"
    });
  }

  const prompt = buildExecutionPrompt(
    requested as DetailScreen[],
    body.research,
    body.plan,
    body.mode
  );
  const text = await complete(providerConfig, textMessages(prompt), 9000);
  let parsed = extractJsonObject<unknown>(text);
  let drafts;
  let repairCount = 0;
  while (repairCount <= 2) {
    try {
      drafts = parseExecutionDrafts(
        parsed,
        requested as DetailScreen[]
      );
      break;
    } catch (error) {
      if (
        !(error instanceof SkillSuiteValidationError) ||
        !error.code.startsWith("EXECUTION_") ||
        repairCount === 2
      ) {
        throw error;
      }
      repairCount += 1;
      const repairPrompt = buildExecutionRepairPrompt({
        screens: requested as DetailScreen[],
        research: body.research,
        plan: body.plan,
        mode: body.mode,
        rejectedResult: parsed,
        issues: error.details
      });
      const repairedText = await complete(
        providerConfig,
        textMessages(repairPrompt),
        9_000
      );
      parsed = extractJsonObject<unknown>(repairedText);
    }
  }
  if (!drafts) {
    throw new SkillSuiteValidationError(
      "执行交付修正后仍不可用。",
      "EXECUTION_REPAIR_INVALID"
    );
  }
  const executions = drafts.map((item) =>
    ensureModelMetadata({
      ...item,
      englishPrompt: compileScreenImagePrompt({
        screen: planById.get(item.screenId) as DetailScreen,
        execution: item,
        facts: body.research.facts
      })
    })
  );
  assertExecutions(
    { executions },
    requested as DetailScreen[],
    body.research.facts
  );

  return {
    data: { executions },
    meta: { repairCount, fallbackUsed: false }
  };
}
