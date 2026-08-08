import type {
  AIProviderConfig,
  ProductResearch,
  ProjectAsset
} from "@/lib/types";

const RESEARCH_BATCH_SIZE = 3;

export type ResearchPipelineCheckpoint = {
  runId: string;
  inputFingerprint: string;
  completedBatchIndexes: number[];
};

export type ResearchExtractPayload = {
  stage: "research";
  operation: "extract";
  providerConfig: AIProviderConfig | null;
  runId: string;
  inputFingerprint: string;
  batchIndex: number;
  totalBatches: number;
  allAssetIds: string[];
  assets: Array<{ id: string; dataUrl: string }>;
  notes: string;
};

export type ResearchFinalizePayload = {
  stage: "research";
  operation: "finalize";
  providerConfig: AIProviderConfig | null;
  runId: string;
  inputFingerprint: string;
  assetIds: string[];
  notes: string;
};

type ApiResponse<T> = {
  data: T;
  meta?: Record<string, unknown> | null;
};

type ResearchPipelineInput = {
  runId: string;
  assets: ProjectAsset[];
  notes: string;
  providerConfig: AIProviderConfig | null;
  checkpoint?: ResearchPipelineCheckpoint;
  signal?: AbortSignal;
};

type ResearchPipelineDependencies = {
  postExtract: (
    payload: ResearchExtractPayload,
    signal?: AbortSignal
  ) => Promise<unknown>;
  postFinalize: (
    payload: ResearchFinalizePayload,
    signal?: AbortSignal
  ) => Promise<ApiResponse<ProductResearch>>;
  onCheckpoint?: (checkpoint: ResearchPipelineCheckpoint) => void;
  onProgress?: (input: {
    phase: "extract" | "finalize";
    completedBatches: number;
    totalBatches: number;
  }) => void;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function fallbackFingerprint(value: string) {
  // 只在 Web Crypto 不存在的老旧测试环境使用。该值不用于认证，
  // 只用于判断当前浏览会话中的图片/说明/模型是否已变化。
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}-${value.length}`;
}

export async function fingerprintResearchInput(input: {
  assets: readonly Pick<ProjectAsset, "id" | "dataUrl">[];
  notes: string;
  providerConfig: AIProviderConfig | null;
}) {
  const value = JSON.stringify({
    assets: input.assets.map((asset) => [asset.id, asset.dataUrl]),
    notes: input.notes,
    provider: input.providerConfig
      ? [
          input.providerConfig.providerId,
          input.providerConfig.baseURL,
          input.providerConfig.model,
          input.providerConfig.apiKey
        ]
      : ["server-default"]
  });
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackFingerprint(value);
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function normalizeCompletedIndexes(
  checkpoint: ResearchPipelineCheckpoint | undefined,
  runId: string,
  inputFingerprint: string,
  totalBatches: number
) {
  if (
    !checkpoint ||
    checkpoint.runId !== runId ||
    checkpoint.inputFingerprint !== inputFingerprint
  ) {
    return [];
  }
  return Array.from(
    new Set(
      checkpoint.completedBatchIndexes.filter(
        (index) =>
          Number.isInteger(index) && index >= 0 && index < totalBatches
      )
    )
  ).sort((left, right) => left - right);
}

export async function runResearchPipeline(
  input: ResearchPipelineInput,
  dependencies: ResearchPipelineDependencies
) {
  if (!input.assets.length) {
    throw new Error("请至少选择一张产品图参与分析。");
  }
  throwIfAborted(input.signal);

  const inputFingerprint = await fingerprintResearchInput(input);
  const totalBatches = Math.ceil(input.assets.length / RESEARCH_BATCH_SIZE);
  const allAssetIds = input.assets.map((asset) => asset.id);
  const completed = new Set(
    normalizeCompletedIndexes(
      input.checkpoint,
      input.runId,
      inputFingerprint,
      totalBatches
    )
  );

  const checkpoint = () => ({
    runId: input.runId,
    inputFingerprint,
    completedBatchIndexes: Array.from(completed).sort(
      (left, right) => left - right
    )
  });

  // 在首个网络请求之前就交付空断点，以固定 runId。
  // 如果服务端已成功缓存批次，但响应在返回时丢失，
  // 重试仍会发往同一运行并命中幂等缓存。
  dependencies.onCheckpoint?.(checkpoint());

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    if (completed.has(batchIndex)) continue;
    throwIfAborted(input.signal);
    dependencies.onProgress?.({
      phase: "extract",
      completedBatches: completed.size,
      totalBatches
    });
    const batchAssets = input.assets.slice(
      batchIndex * RESEARCH_BATCH_SIZE,
      (batchIndex + 1) * RESEARCH_BATCH_SIZE
    );
    await dependencies.postExtract(
      {
        stage: "research",
        operation: "extract",
        providerConfig: input.providerConfig,
        runId: input.runId,
        inputFingerprint,
        batchIndex,
        totalBatches,
        allAssetIds,
        assets: batchAssets.map((asset) => ({
          id: asset.id,
          dataUrl: asset.dataUrl
        })),
        notes: input.notes
      },
      input.signal
    );
    throwIfAborted(input.signal);
    completed.add(batchIndex);
    dependencies.onCheckpoint?.(checkpoint());
  }

  dependencies.onProgress?.({
    phase: "finalize",
    completedBatches: completed.size,
    totalBatches
  });
  throwIfAborted(input.signal);
  const response = await dependencies.postFinalize(
    {
      stage: "research",
      operation: "finalize",
      providerConfig: input.providerConfig,
      runId: input.runId,
      inputFingerprint,
      assetIds: allAssetIds,
      notes: input.notes
    },
    input.signal
  );
  throwIfAborted(input.signal);

  return {
    ...response,
    checkpoint: checkpoint()
  };
}
