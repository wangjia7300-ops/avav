type ProviderFailureOrigin =
  | "sdk_timeout"
  | "connection_timeout"
  | "upstream_http"
  | "stream_event"
  | "network"
  | "stage_budget"
  | "unknown";

export type SafeApiErrorDetails = {
  stage?: string;
  code?: string;
  batchId?: string;
  completedBatchIds?: string[];
  elapsedMs?: number;
  retryable?: boolean;
  field?: string;
  screenIds?: string[];
  normalizedValue?: string;
  failureOrigin?: ProviderFailureOrigin;
  attempt?: number;
  maxAttempts?: number;
  upstreamStatus?: number;
  hasUpstreamRequestId?: boolean;
};

const detailTokenPattern = /^[A-Za-z0-9_.-]{1,96}$/;
const screenIdPattern = /^screen-\d{2}$/;
const suspiciousSecretPattern =
  /(?:api[_-]?key|authorization|bearer|token|secret|password|sk-[A-Za-z0-9_-]+|ark-[A-Za-z0-9_-]+)/i;
const requestIdAssignmentPattern =
  /\b((?:x[\s_-]?)?request[\s_-]?id)\b(\s*[:=]\s*)["']?[^"',，。；;\s}]+["']?/gi;

function safePublicErrorMessage(value: string) {
  return value
    .replace(
      requestIdAssignmentPattern,
      (_match, label: string, separator: string) =>
        `${label}${separator}[已隐藏]`
    )
    .replace(
      /(["']?api[_-]?key["']?\s*[:=]\s*["']?)[^"',}，。；;\s]+/gi,
      "$1[已隐藏]"
    )
    .replace(/\bBearer\s+[^\s"',，。；;]+/gi, "Bearer [已隐藏]")
    .replace(
      /\b(?:ark|sk)-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g,
      "[API_KEY已隐藏]"
    )
    .replace(
      /data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi,
      "[图片数据已隐藏]"
    )
    .replace(/file:\/\/\/[^\n\r；;]+/gi, "[本机路径已隐藏]")
    .replace(/\/(?:Users|Volumes)\/[^\n\r；;]+/g, "[本机路径已隐藏]")
    .replace(/[A-Za-z]:\\[^\n\r；;]+/g, "[本机路径已隐藏]");
}

function safeDetailToken(value: unknown) {
  return typeof value === "string" && detailTokenPattern.test(value)
    ? value
    : undefined;
}

function safeNormalizedValue(value: unknown) {
  if (typeof value !== "string") return undefined;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (
    !normalized ||
    normalized.length > 160 ||
    suspiciousSecretPattern.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

export function sanitizeApiErrorDetails(
  value: unknown
): SafeApiErrorDetails | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const stage = safeDetailToken(candidate.stage);
  const code = safeDetailToken(candidate.code);
  const batchId = safeDetailToken(candidate.batchId);
  const field = safeDetailToken(candidate.field);
  const completedBatchIds = Array.isArray(candidate.completedBatchIds)
    ? Array.from(
        new Set(
          candidate.completedBatchIds
            .map(safeDetailToken)
            .filter((item): item is string => Boolean(item))
        )
      ).slice(0, 12)
    : undefined;
  const elapsedMs =
    typeof candidate.elapsedMs === "number" &&
    Number.isFinite(candidate.elapsedMs) &&
    candidate.elapsedMs >= 0
      ? Math.min(Math.round(candidate.elapsedMs), 24 * 60 * 60 * 1_000)
      : undefined;
  const retryable =
    typeof candidate.retryable === "boolean"
      ? candidate.retryable
      : undefined;
  const failureOrigin = [
    "sdk_timeout",
    "connection_timeout",
    "upstream_http",
    "stream_event",
    "network",
    "stage_budget",
    "unknown"
  ].includes(String(candidate.failureOrigin))
    ? (candidate.failureOrigin as ProviderFailureOrigin)
    : undefined;
  const candidateAttempt =
    Number.isInteger(candidate.attempt) &&
    Number(candidate.attempt) >= 1 &&
    Number(candidate.attempt) <= 3
      ? Number(candidate.attempt)
      : undefined;
  const candidateMaxAttempts =
    Number.isInteger(candidate.maxAttempts) &&
    Number(candidate.maxAttempts) >= 1 &&
    Number(candidate.maxAttempts) <= 3
      ? Number(candidate.maxAttempts)
      : undefined;
  const hasConsistentAttemptPair =
    candidateAttempt !== undefined &&
    candidateMaxAttempts !== undefined &&
    candidateAttempt <= candidateMaxAttempts;
  const attempt = hasConsistentAttemptPair
    ? candidateAttempt
    : undefined;
  const maxAttempts = hasConsistentAttemptPair
    ? candidateMaxAttempts
    : undefined;
  const upstreamStatus =
    failureOrigin === "upstream_http" &&
    Number.isInteger(candidate.upstreamStatus) &&
    Number(candidate.upstreamStatus) >= 400 &&
    Number(candidate.upstreamStatus) <= 599
      ? Number(candidate.upstreamStatus)
      : undefined;
  const hasUpstreamRequestId =
    typeof candidate.hasUpstreamRequestId === "boolean"
      ? candidate.hasUpstreamRequestId
      : undefined;
  const normalizedValue = safeNormalizedValue(candidate.normalizedValue);
  const screenIds = Array.isArray(candidate.screenIds)
    ? Array.from(
        new Set(
          candidate.screenIds.filter(
            (screenId): screenId is string =>
              typeof screenId === "string" && screenIdPattern.test(screenId)
          )
        )
      ).slice(0, 15)
    : undefined;
  const details = {
    ...(stage ? { stage } : {}),
    ...(code ? { code } : {}),
    ...(batchId ? { batchId } : {}),
    ...(completedBatchIds?.length ? { completedBatchIds } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(field ? { field } : {}),
    ...(screenIds?.length ? { screenIds } : {}),
    ...(normalizedValue ? { normalizedValue } : {}),
    ...(failureOrigin ? { failureOrigin } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
    ...(hasUpstreamRequestId !== undefined
      ? { hasUpstreamRequestId }
      : {})
  };

  return Object.keys(details).length ? details : undefined;
}

export class ServiceError extends Error {
  statusCode: number;
  code: string;
  details?: SafeApiErrorDetails;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      code?: string;
      details?: SafeApiErrorDetails;
    }
  ) {
    super(safePublicErrorMessage(message));
    this.name = "ServiceError";
    this.statusCode = options?.statusCode ?? 500;
    this.code = options?.code ?? "SERVICE_ERROR";
    this.details = sanitizeApiErrorDetails(options?.details);
  }
}

export function serializeApiError(
  error: unknown,
  fallbackMessage: string,
  contextDetails?: SafeApiErrorDetails
) {
  if (error instanceof ServiceError) {
    const details = sanitizeApiErrorDetails({
      ...contextDetails,
      ...error.details,
      code: error.code
    });

    return {
      body: {
        success: false,
        error: error.message,
        code: error.code,
        ...(details ? { details } : {})
      },
      status: error.statusCode
    };
  }

  const details = sanitizeApiErrorDetails({
    ...contextDetails,
    code: "UNKNOWN_ERROR"
  });

  return {
    body: {
      success: false,
      // Unknown exceptions may contain provider payloads, request headers or
      // other unreviewed text. Only curated ServiceError messages may cross the
      // API boundary.
      error: safePublicErrorMessage(fallbackMessage),
      code: "UNKNOWN_ERROR",
      ...(details ? { details } : {})
    },
    status: 500
  };
}
