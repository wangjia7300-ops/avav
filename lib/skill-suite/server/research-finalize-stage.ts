import {
  buildProductResearchFromSelection,
  buildResearchFinalizeSchema,
  parseResearchFinalizeSelection
} from "@/lib/skill-suite/research-atomic-contract";
import { buildResearchFinalizeSelectionPrompt } from "@/lib/skill-suite/research-atomic-prompts";
import { authorizeUploadedImageFacts } from "@/lib/skill-suite/evidence-policy";
import {
  getResearchRunProgress,
  runResearchFinalOnce,
  validateExistingResearchRun
} from "@/lib/skill-suite/server/research-run-registry";
import { assertResearch } from "@/lib/skill-suite/validation";
import { ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig } from "@/lib/types";
import { complete } from "./shared";
import type { ResearchFinalizeRequest } from "./request";
import { researchProviderFingerprint } from "./research-run-identity";

const FINALIZE_TIMEOUT_MS = 120_000;
const FINALIZE_MAX_TOKENS = 6_000;
const FINALIZE_COMPACT_MAX_TOKENS = 4_000;

function isTruncatedResponse(error: unknown): error is ServiceError {
  return (
    error instanceof ServiceError && error.code === "AI_RESPONSE_TRUNCATED"
  );
}

export async function runResearchFinalizeStage(
  body: ResearchFinalizeRequest,
  providerConfig: AIProviderConfig,
  signal?: AbortSignal
) {
  const providerFingerprint = researchProviderFingerprint(providerConfig);
  const identity = {
    runId: body.runId,
    inputFingerprint: body.inputFingerprint,
    providerFingerprint
  };
  validateExistingResearchRun({
    ...identity,
    assetIds: [...body.assetIds],
    notes: body.notes?.trim() ?? "",
    totalBatches: Math.ceil(body.assetIds.length / 3)
  });
  const before = getResearchRunProgress(identity);
  const cached = before.finalCompleted;
  let responseMetadata: unknown;
  let truncationRecovered = false;

  const research = await runResearchFinalOnce(identity, async (batches) => {
    const observations = batches.flatMap(
      (batch) => batch.result.observations
    );
    const observationIds = observations.map(
      (observation) => observation.observationId
    );
    const finalize = async (profile: "standard" | "compact") => {
      const text = await complete(
        providerConfig,
        [
          {
            role: "system",
            content:
              "你是电商产品图研汇总器。只能从服务端锁定的原子观察ID中选择事实，禁止生成、改写或补齐新事实。"
          },
          {
            role: "user",
            content: buildResearchFinalizeSelectionPrompt(
              {
                assetIds: body.assetIds,
                notes: body.notes?.trim() ?? "",
                observations
              },
              profile
            )
          }
        ],
        profile === "compact"
          ? FINALIZE_COMPACT_MAX_TOKENS
          : FINALIZE_MAX_TOKENS,
        {
          jsonSchema: {
            name:
              profile === "compact"
                ? "product_research_finalize_selection_compact"
                : "product_research_finalize_selection",
            schema: buildResearchFinalizeSchema(observationIds, profile),
            strict: true
          },
          timeoutMs: FINALIZE_TIMEOUT_MS,
          signal,
          onResponseMetadata: (metadata) => {
            responseMetadata = metadata;
          },
          costStage: "research",
          costOperation: "图研汇总"
        }
      );
      return parseResearchFinalizeSelection(text, observationIds, profile);
    };

    let selection;
    try {
      selection = await finalize("standard");
    } catch (error) {
      if (!isTruncatedResponse(error) || signal?.aborted) throw error;
      truncationRecovered = true;
      try {
        selection = await finalize("compact");
      } catch (retryError) {
        if (!(retryError instanceof ServiceError)) throw retryError;
        throw new ServiceError(retryError.message, {
          statusCode: retryError.statusCode,
          code: retryError.code,
          details: {
            ...(retryError.details ?? {}),
            stage: "research_finalize",
            completedBatchIds: before.completedBatchIndexes.map(
              (index) => `batch-${index + 1}`
            ),
            retryable: true,
            attempt: 2,
            maxAttempts: 2
          }
        });
      }
    }
    const selectedById = new Map(
      observations.map((observation) => [
        observation.observationId,
        observation
      ])
    );
    const selectedObservations = selection.selectedObservationIds
      .map((id) => selectedById.get(id))
      .filter((observation) => Boolean(observation));
    const visibleBrand = selectedObservations.find(
      (observation) =>
        observation?.entityType === "brand" &&
        observation.sourceType === "image_text"
    );
    const lockedSelection = {
      ...selection,
      brand: visibleBrand?.value ?? "未识别"
    };
    const assembled = buildProductResearchFromSelection(
      lockedSelection,
      observations
    );
    const authorized = authorizeUploadedImageFacts(
      assembled,
      body.assetIds
    );
    assertResearch(authorized);
    return authorized;
  });

  return {
    data: research,
    meta: {
      operation: "finalize",
      cached,
      truncationRecovered,
      completedBatchIndexes:
        getResearchRunProgress(identity).completedBatchIndexes,
      responseMetadata
    }
  };
}
