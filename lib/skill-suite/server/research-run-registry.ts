import type { AtomicResearchObservation } from "@/lib/skill-suite/research-atomic-contract";
import { ServiceError } from "@/lib/services/errors";
import type { ProductResearch } from "@/lib/types";

const RESEARCH_RUN_TTL_MS = 15 * 60 * 1_000;

export type ResearchRunManifest = {
  runId: string;
  inputFingerprint: string;
  providerFingerprint: string;
  assetIds: string[];
  notes: string;
  totalBatches: number;
};

export type ResearchRunIdentity = Pick<
  ResearchRunManifest,
  "runId" | "inputFingerprint" | "providerFingerprint"
>;

export type ResearchBatchRequest = ResearchRunIdentity & {
  batchIndex: number;
  batchAssetIds: string[];
  sanitizedSha256s: string[];
};

export type StoredResearchBatchResult = {
  observations: AtomicResearchObservation[];
};

export type CompletedResearchBatch = {
  batchIndex: number;
  batchAssetIds: string[];
  sanitizedSha256s: string[];
  result: StoredResearchBatchResult;
};

export type ResearchRunProgress = {
  runId: string;
  totalBatches: number;
  completedBatchIndexes: number[];
  finalCompleted: boolean;
  expiresAt: number;
};

type StoredBatchManifest = Pick<
  ResearchBatchRequest,
  "batchAssetIds" | "sanitizedSha256s"
>;

type ResearchRunRecord = {
  manifest: ResearchRunManifest;
  expiresAt: number;
  batchManifests: Map<number, StoredBatchManifest>;
  batchResults: Map<number, StoredResearchBatchResult>;
  batchInFlight: Map<number, Promise<StoredResearchBatchResult>>;
  finalResult?: ProductResearch;
  finalInFlight?: Promise<ProductResearch>;
};

type ResearchRunRegistryState = {
  runs: Map<string, ResearchRunRecord>;
};

const globalRegistry = globalThis as typeof globalThis & {
  __detailPageResearchRunRegistryV1__?: ResearchRunRegistryState;
};

const registry =
  globalRegistry.__detailPageResearchRunRegistryV1__ ??
  (globalRegistry.__detailPageResearchRunRegistryV1__ = {
    runs: new Map<string, ResearchRunRecord>()
  });

function registryError(
  message: string,
  code: string,
  statusCode: number
): ServiceError {
  return new ServiceError(message, { code, statusCode });
}

function assertSafeToken(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 256
  ) {
    throw registryError(
      `${label}不合法。`,
      "RESEARCH_RUN_MANIFEST_INVALID",
      400
    );
  }
}

function assertManifestInput(manifest: ResearchRunManifest) {
  assertSafeToken(manifest.runId, "runId");
  assertSafeToken(manifest.inputFingerprint, "inputFingerprint");
  assertSafeToken(manifest.providerFingerprint, "providerFingerprint");
  if (/^(?:ark|sk)-|^bearer\s/i.test(manifest.providerFingerprint)) {
    throw registryError(
      "providerFingerprint 必须是不可逆指纹，不能传入 API Key。",
      "RESEARCH_RUN_PROVIDER_FINGERPRINT_INVALID",
      400
    );
  }
  if (
    !Array.isArray(manifest.assetIds) ||
    manifest.assetIds.length === 0 ||
    manifest.assetIds.length > 64 ||
    new Set(manifest.assetIds).size !== manifest.assetIds.length ||
    manifest.assetIds.some(
      (assetId) =>
        typeof assetId !== "string" ||
        assetId.trim().length === 0 ||
        assetId.length > 256
    )
  ) {
    throw registryError(
      "assetIds 必须是非空且不重复的素材 ID 列表。",
      "RESEARCH_RUN_MANIFEST_INVALID",
      400
    );
  }
  if (typeof manifest.notes !== "string" || manifest.notes.length > 20_000) {
    throw registryError(
      "notes 不合法。",
      "RESEARCH_RUN_MANIFEST_INVALID",
      400
    );
  }
  if (
    !Number.isInteger(manifest.totalBatches) ||
    manifest.totalBatches < 1 ||
    manifest.totalBatches > manifest.assetIds.length
  ) {
    throw registryError(
      "totalBatches 必须与素材数量匹配。",
      "RESEARCH_RUN_MANIFEST_INVALID",
      400
    );
  }
}

function copyManifest(manifest: ResearchRunManifest): ResearchRunManifest {
  return {
    runId: manifest.runId,
    inputFingerprint: manifest.inputFingerprint,
    providerFingerprint: manifest.providerFingerprint,
    assetIds: [...manifest.assetIds],
    notes: manifest.notes,
    totalBatches: manifest.totalBatches
  };
}

function copyBatchResult(
  result: StoredResearchBatchResult
): StoredResearchBatchResult {
  return {
    observations: result.observations.map((observation) => ({
      observationId: observation.observationId,
      assetId: observation.assetId,
      label: observation.label,
      value: observation.value,
      evidence: observation.evidence,
      sourceType: observation.sourceType,
      claimScope: observation.claimScope,
      entityType: observation.entityType,
      confidence: observation.confidence
    }))
  };
}

function copyFinalResult(result: ProductResearch): ProductResearch {
  return {
    productName: result.productName,
    category: result.category,
    brand: result.brand,
    summary: result.summary,
    facts: result.facts.map((fact) => ({
      id: fact.id,
      label: fact.label,
      value: fact.value,
      evidence: fact.evidence,
      sourceAssetIds: [...fact.sourceAssetIds],
      sourceType: fact.sourceType,
      claimScope: fact.claimScope,
      entityType: fact.entityType,
      ocrConfidence: fact.ocrConfidence,
      status: fact.status,
      commercialUse: fact.commercialUse
    })),
    visualAudit: result.visualAudit.map((dimension) => ({
      key: dimension.key,
      title: dimension.title,
      finding: dimension.finding,
      recommendation: dimension.recommendation
    })),
    visualKeywords: [...result.visualKeywords],
    risks: [...result.risks],
    source: result.source,
    generatedAt: result.generatedAt
  };
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameIdentity(
  manifest: ResearchRunManifest,
  identity: ResearchRunIdentity
) {
  return (
    manifest.runId === identity.runId &&
    manifest.inputFingerprint === identity.inputFingerprint &&
    manifest.providerFingerprint === identity.providerFingerprint
  );
}

function sameManifest(
  left: ResearchRunManifest,
  right: ResearchRunManifest
) {
  return (
    sameIdentity(left, right) &&
    sameStrings(left.assetIds, right.assetIds) &&
    left.notes === right.notes &&
    left.totalBatches === right.totalBatches
  );
}

function touch(record: ResearchRunRecord, now = Date.now()) {
  record.expiresAt = now + RESEARCH_RUN_TTL_MS;
}

function pruneExpiredResearchRuns(now = Date.now()) {
  for (const [runId, record] of registry.runs) {
    if (record.expiresAt <= now) registry.runs.delete(runId);
  }
}

function requireRun(identity: ResearchRunIdentity): ResearchRunRecord {
  pruneExpiredResearchRuns();
  const record = registry.runs.get(identity.runId);
  if (!record) {
    throw registryError(
      "图研运行记录不存在或已过期，请重新开始图研。",
      "RESEARCH_RUN_NOT_FOUND",
      404
    );
  }
  if (!sameIdentity(record.manifest, identity)) {
    throw registryError(
      "同一 runId 的输入或供应商指纹已变更，禁止复用旧结果。",
      "RESEARCH_RUN_IDENTITY_MISMATCH",
      409
    );
  }
  touch(record);
  return record;
}

function progressOf(record: ResearchRunRecord): ResearchRunProgress {
  return {
    runId: record.manifest.runId,
    totalBatches: record.manifest.totalBatches,
    completedBatchIndexes: [...record.batchResults.keys()].sort(
      (left, right) => left - right
    ),
    finalCompleted: Boolean(record.finalResult),
    expiresAt: record.expiresAt
  };
}

export function createOrValidateResearchRun(
  manifest: ResearchRunManifest
): ResearchRunProgress {
  assertManifestInput(manifest);
  pruneExpiredResearchRuns();
  const existing = registry.runs.get(manifest.runId);
  if (existing) {
    if (!sameIdentity(existing.manifest, manifest)) {
      throw registryError(
        "同一 runId 的输入或供应商指纹已变更，禁止复用旧结果。",
        "RESEARCH_RUN_IDENTITY_MISMATCH",
        409
      );
    }
    if (!sameManifest(existing.manifest, manifest)) {
      throw registryError(
        "同一图研运行的素材清单、补充说明或批次数已变更。",
        "RESEARCH_RUN_MANIFEST_MISMATCH",
        409
      );
    }
    touch(existing);
    return progressOf(existing);
  }

  const record: ResearchRunRecord = {
    manifest: copyManifest(manifest),
    expiresAt: Date.now() + RESEARCH_RUN_TTL_MS,
    batchManifests: new Map(),
    batchResults: new Map(),
    batchInFlight: new Map()
  };
  registry.runs.set(record.manifest.runId, record);
  return progressOf(record);
}

/**
 * 最终汇总只能连接由提取阶段已建立的运行。
 * 服务端重启或 TTL 到期后必须明确告知客户端从头开始，
 * 否则客户端的已完成 checkpoint 会与一个新建空运行永久僵持。
 */
export function validateExistingResearchRun(
  manifest: ResearchRunManifest
): ResearchRunProgress {
  assertManifestInput(manifest);
  const record = requireRun(manifest);
  if (!sameManifest(record.manifest, manifest)) {
    throw registryError(
      "同一图研运行的素材清单、补充说明或批次数已变更。",
      "RESEARCH_RUN_MANIFEST_MISMATCH",
      409
    );
  }
  return progressOf(record);
}

function validateBatchRequest(
  record: ResearchRunRecord,
  request: ResearchBatchRequest
): StoredBatchManifest {
  if (
    !Number.isInteger(request.batchIndex) ||
    request.batchIndex < 0 ||
    request.batchIndex >= record.manifest.totalBatches
  ) {
    throw registryError(
      "batchIndex 超出当前图研运行范围。",
      "RESEARCH_RUN_BATCH_INDEX_INVALID",
      400
    );
  }
  if (
    !Array.isArray(request.batchAssetIds) ||
    request.batchAssetIds.length === 0 ||
    new Set(request.batchAssetIds).size !== request.batchAssetIds.length ||
    request.batchAssetIds.some(
      (assetId) => !record.manifest.assetIds.includes(assetId)
    ) ||
    !Array.isArray(request.sanitizedSha256s) ||
    request.sanitizedSha256s.length !== request.batchAssetIds.length ||
    request.sanitizedSha256s.some(
      (sha256) =>
        typeof sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sha256)
    )
  ) {
    throw registryError(
      "批次素材清单或清洗图片 SHA-256 不合法。",
      "RESEARCH_RUN_BATCH_MANIFEST_INVALID",
      400
    );
  }

  const candidate = {
    batchAssetIds: [...request.batchAssetIds],
    sanitizedSha256s: request.sanitizedSha256s.map((sha256) =>
      sha256.toLowerCase()
    )
  };
  const existing = record.batchManifests.get(request.batchIndex);
  if (
    existing &&
    (!sameStrings(existing.batchAssetIds, candidate.batchAssetIds) ||
      !sameStrings(existing.sanitizedSha256s, candidate.sanitizedSha256s))
  ) {
    throw registryError(
      "同一批次的素材或清洗图片 SHA-256 已变更。",
      "RESEARCH_RUN_BATCH_MANIFEST_MISMATCH",
      409
    );
  }

  for (const [batchIndex, batchManifest] of record.batchManifests) {
    if (
      batchIndex !== request.batchIndex &&
      batchManifest.batchAssetIds.some((assetId) =>
        candidate.batchAssetIds.includes(assetId)
      )
    ) {
      throw registryError(
        "同一素材不能同时属于多个图研批次。",
        "RESEARCH_RUN_BATCH_MANIFEST_MISMATCH",
        409
      );
    }
  }

  if (!existing) record.batchManifests.set(request.batchIndex, candidate);
  return existing ?? candidate;
}

export function runResearchBatchOnce(
  request: ResearchBatchRequest,
  execute: () => Promise<StoredResearchBatchResult>
): Promise<StoredResearchBatchResult> {
  const record = requireRun(request);
  validateBatchRequest(record, request);

  const cached = record.batchResults.get(request.batchIndex);
  if (cached) return Promise.resolve(copyBatchResult(cached));
  const inFlight = record.batchInFlight.get(request.batchIndex);
  if (inFlight) return inFlight;

  let execution: Promise<StoredResearchBatchResult>;
  try {
    execution = Promise.resolve(execute());
  } catch (error) {
    execution = Promise.reject(error);
  }

  const task = execution
    .then((result) => {
      const safeResult = copyBatchResult(result);
      if (registry.runs.get(request.runId) === record) {
        record.batchResults.set(request.batchIndex, safeResult);
        touch(record);
      }
      return copyBatchResult(safeResult);
    })
    .finally(() => {
      if (record.batchInFlight.get(request.batchIndex) === task) {
        record.batchInFlight.delete(request.batchIndex);
      }
    });
  record.batchInFlight.set(request.batchIndex, task);
  return task;
}

function completedBatches(record: ResearchRunRecord): CompletedResearchBatch[] {
  return [...record.batchResults.entries()]
    .sort(([left], [right]) => left - right)
    .map(([batchIndex, result]) => {
      const batchManifest = record.batchManifests.get(batchIndex);
      if (!batchManifest) {
        throw registryError(
          "图研批次缓存缺少素材清单。",
          "RESEARCH_RUN_BATCH_MANIFEST_MISSING",
          409
        );
      }
      return {
        batchIndex,
        batchAssetIds: [...batchManifest.batchAssetIds],
        sanitizedSha256s: [...batchManifest.sanitizedSha256s],
        result: copyBatchResult(result)
      };
    });
}

function assertCompleteBatchCoverage(
  record: ResearchRunRecord,
  batches: readonly CompletedResearchBatch[]
) {
  if (batches.length !== record.manifest.totalBatches) {
    throw registryError(
      "尚有图研批次未完成，暂不能生成最终结果。",
      "RESEARCH_RUN_BATCHES_INCOMPLETE",
      409
    );
  }
  const flattenedAssetIds = batches.flatMap((batch) => batch.batchAssetIds);
  if (!sameStrings(flattenedAssetIds, record.manifest.assetIds)) {
    throw registryError(
      "已完成批次与运行素材顺序不一致，禁止汇总。",
      "RESEARCH_RUN_BATCH_COVERAGE_MISMATCH",
      409
    );
  }
}

export function runResearchFinalOnce(
  identity: ResearchRunIdentity,
  execute: (
    batches: readonly CompletedResearchBatch[]
  ) => Promise<ProductResearch>
): Promise<ProductResearch> {
  const record = requireRun(identity);
  if (record.finalResult) {
    return Promise.resolve(copyFinalResult(record.finalResult));
  }
  if (record.finalInFlight) return record.finalInFlight;

  const batches = completedBatches(record);
  assertCompleteBatchCoverage(record, batches);
  let execution: Promise<ProductResearch>;
  try {
    execution = Promise.resolve(execute(batches));
  } catch (error) {
    execution = Promise.reject(error);
  }

  const task = execution
    .then((result) => {
      const safeResult = copyFinalResult(result);
      if (registry.runs.get(identity.runId) === record) {
        record.finalResult = safeResult;
        touch(record);
      }
      return copyFinalResult(safeResult);
    })
    .finally(() => {
      if (record.finalInFlight === task) record.finalInFlight = undefined;
    });
  record.finalInFlight = task;
  return task;
}

export function getResearchRunProgress(
  identity: ResearchRunIdentity
): ResearchRunProgress {
  return progressOf(requireRun(identity));
}

export function __resetResearchRunRegistryForTests() {
  registry.runs.clear();
}
