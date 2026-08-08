import { ServiceError } from "@/lib/services/errors";
import {
  API_BODY_LIMITS,
  assertLocalApiRequest,
  readJsonRequestBody
} from "@/lib/security/request-guard";
import { jsonNoStore } from "@/lib/skill-suite/server/http";
import {
  assertRequestShape,
  resolveProviderConfig,
  safeError
} from "@/lib/skill-suite/server/request";
import { runResearchExtractStage } from "@/lib/skill-suite/server/research-extract-stage";
import { runResearchFinalizeStage } from "@/lib/skill-suite/server/research-finalize-stage";
import { runPlanningStage } from "@/lib/skill-suite/server/planning-stage";
import { runExecutionStage } from "@/lib/skill-suite/server/execution-stage";
import { runQAStage } from "@/lib/skill-suite/server/qa-stage";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    assertLocalApiRequest(request, {
      method: "POST",
      requireJson: true,
      maxContentLength: API_BODY_LIMITS.skillSuite
    });
    const rawBody = await readJsonRequestBody(
      request,
      API_BODY_LIMITS.skillSuite
    );
    assertRequestShape(rawBody);
    const body = rawBody;
    const providerConfig = await resolveProviderConfig(body.providerConfig);

    if (body.stage === "research") {
      if (body.operation === "extract") {
        const result = await runResearchExtractStage(
          body,
          providerConfig,
          request.signal
        );
        return jsonNoStore({ success: true, ...result });
      }
      if (body.operation === "finalize") {
        const result = await runResearchFinalizeStage(
          body,
          providerConfig,
          request.signal
        );
        return jsonNoStore({ success: true, ...result });
      }
      throw new ServiceError("图研请求必须指定 extract 或 finalize 操作。", {
        statusCode: 400,
        code: "SKILL_RESEARCH_OPERATION_INVALID"
      });
    }

    if (body.stage === "planning") {
      const result = await runPlanningStage(body, providerConfig, request.signal);
      return jsonNoStore({ success: true, ...result });
    }

    if (body.stage === "execution") {
      const result = await runExecutionStage(body, providerConfig, request.signal);
      return jsonNoStore({ success: true, ...result });
    }

    if (body.stage === "qa") {
      const result = await runQAStage(body, providerConfig, request.signal);
      return jsonNoStore({ success: true, ...result });
    }

    throw new ServiceError("不支持的生产工作流阶段。", {
      statusCode: 400,
      code: "SKILL_STAGE_INVALID"
    });
  } catch (error) {
    const failure = safeError(error);
    return jsonNoStore(failure.body, failure.status);
  }
}
