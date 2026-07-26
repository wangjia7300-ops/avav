import type { WorkErrorInfo } from "@/lib/skill-suite/store";
import {
  detailMessages,
  isRecord,
  sanitizeApiMeta,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue
} from "@/lib/workbench/diagnostics";

export type ApiMeta = Record<string, unknown>;

type ApiResult<T> =
  | { success: true; data: T; meta?: unknown }
  | {
      success: false;
      error: string;
      code?: string;
      details?: unknown;
      meta?: unknown;
      partialData?: unknown;
    };

function metadataString(
  meta: ApiMeta | null,
  keys: readonly string[]
) {
  for (const key of keys) {
    const value = meta?.[key];
    if (typeof value === "string" && value.trim()) {
      return sanitizeDiagnosticText(value);
    }
  }
  return undefined;
}

function inferPhase(code: string | undefined) {
  if (!code) return undefined;
  if (code.includes("FOUNDATION")) return "planning-foundation";
  if (code.includes("BATCH")) return "planning-batch";
  if (code.includes("REPAIR")) return "planning-repair";
  if (code.includes("PLAN_QUALITY")) return "planning-quality";
  return undefined;
}

function collectConflictScreenIds(
  meta: ApiMeta | null,
  details: readonly string[]
) {
  const fromMeta = [
    meta?.conflictScreenIds,
    meta?.targetScreenIds,
    meta?.screenIds
  ].flatMap((value) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []
  );
  const fromDetails = details.flatMap(
    (detail) => detail.match(/screen-\d{2}/g) ?? []
  );
  return Array.from(new Set([...fromMeta, ...fromDetails])).sort();
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details: string[];
  readonly meta: ApiMeta | null;
  readonly phase?: string;
  readonly conflictScreenIds: string[];
  readonly partialData: unknown;

  constructor(input: {
    status: number;
    message: string;
    code?: string;
    details?: unknown;
    meta?: unknown;
    partialData?: unknown;
  }) {
    const message = sanitizeDiagnosticText(input.message);
    super(message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code
      ? sanitizeDiagnosticText(input.code)
      : undefined;
    this.details = detailMessages(input.details);
    const responseMeta = sanitizeApiMeta(input.meta);
    const detailMeta = isRecord(input.details)
      ? sanitizeApiMeta(input.details)
      : null;
    this.meta =
      responseMeta || detailMeta
        ? { ...(detailMeta ?? {}), ...(responseMeta ?? {}) }
        : null;
    this.phase =
      metadataString(this.meta, ["phase", "stage"]) ??
      inferPhase(this.code);
    this.conflictScreenIds = collectConflictScreenIds(
      this.meta,
      this.details
    );
    this.partialData =
      input.partialData === undefined
        ? undefined
        : sanitizeDiagnosticValue(input.partialData);
  }
}

export function toWorkError(reason: unknown): WorkErrorInfo {
  if (reason instanceof ApiError) {
    return {
      message: reason.message,
      status: reason.status,
      code: reason.code,
      details: reason.details,
      meta: reason.meta ?? undefined,
      phase: reason.phase,
      conflictScreenIds: reason.conflictScreenIds,
      partialData: reason.partialData
    };
  }

  return {
    message: sanitizeDiagnosticText(
      reason instanceof Error ? reason.message : "工作流执行失败，请重试。"
    ),
    details: [],
    conflictScreenIds: []
  };
}

export async function postJson<T>(
  url: string,
  body: unknown,
  init?: { signal?: AbortSignal }
) {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: init?.signal
  });
  const payload = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !payload?.success) {
    const failure = payload && !payload.success ? payload : null;
    throw new ApiError({
      status: response.status,
      message: failure?.error ?? "请求失败，请稍后重试。",
      code: failure?.code,
      details: failure?.details,
      meta: failure?.meta,
      partialData: failure?.partialData
    });
  }
  return {
    data: payload.data,
    meta: sanitizeApiMeta(payload.meta)
  };
}
