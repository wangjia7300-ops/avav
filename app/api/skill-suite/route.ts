import { ServiceError } from "@/lib/services/errors";
import { jsonNoStore } from "@/lib/skill-suite/server/http";
import {
  assertRequestShape,
  resolveProviderConfig,
  safeError
} from "@/lib/skill-suite/server/request";
import { runResearchStage } from "@/lib/skill-suite/server/research-stage";
import { runPlanningStage } from "@/lib/skill-suite/server/planning-stage";
import { runExecutionStage } from "@/lib/skill-suite/server/execution-stage";
import { runQAStage } from "@/lib/skill-suite/server/qa-stage";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json().catch(() => {
      throw new ServiceError("请求体必须是合法 JSON。", {
        statusCode: 400,
        code: "SKILL_SUITE_REQUEST_INVALID"
      });
    });
    assertRequestShape(rawBody);
    const body = rawBody;
    const providerConfig = await resolveProviderConfig(body.providerConfig);

    if (body.stage === "research") {
      const result = await runResearchStage(body, providerConfig);
      return jsonNoStore({ success: true, ...result });
    }

    if (body.stage === "planning") {
      const result = await runPlanningStage(body, providerConfig);
      return jsonNoStore({ success: true, ...result });
    }

    if (body.stage === "execution") {
      const result = await runExecutionStage(body, providerConfig);
      return jsonNoStore({ success: true, ...result });
    }

    if (body.stage === "qa") {
      const result = await runQAStage(body, providerConfig);
      return jsonNoStore({ success: true, ...result });
    }

    throw new ServiceError("不支持的四技能工作流阶段。", {
      statusCode: 400,
      code: "SKILL_STAGE_INVALID"
    });
  } catch (error) {
    const failure = safeError(error);
    return jsonNoStore(failure.body, failure.status);
  }
}
