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
};

const detailTokenPattern = /^[A-Za-z0-9_.-]{1,96}$/;
const screenIdPattern = /^screen-\d{2}$/;
const suspiciousSecretPattern =
  /(?:api[_-]?key|authorization|bearer|token|secret|password|sk-[A-Za-z0-9_-]+|ark-[A-Za-z0-9_-]+)/i;

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
    ...(normalizedValue ? { normalizedValue } : {})
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
    super(message);
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
      error: fallbackMessage,
      code: "UNKNOWN_ERROR",
      ...(details ? { details } : {})
    },
    status: 500
  };
}
