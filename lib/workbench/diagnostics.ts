import type { ApiMeta } from "@/lib/workbench/api-client";

const SENSITIVE_DIAGNOSTIC_KEY =
  /api.?key|authorization|bearer|provider.?config|data.?url|reference.?images?|assets?|file.?path|file.?name/i;
const REQUEST_ID_ASSIGNMENT_PATTERN =
  /\b((?:x[\s_-]?)?request[\s_-]?id)\b(\s*[:=]\s*)["']?[^"',，。；;\s}]+["']?/gi;

function shouldDropRequestIdKey(key: string, value: unknown) {
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (normalized === "hasupstreamrequestid" && typeof value === "boolean") {
    return false;
  }
  return normalized.endsWith("requestid");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeDiagnosticText(value: string) {
  return value
    .replace(
      REQUEST_ID_ASSIGNMENT_PATTERN,
      (_match, label: string, separator: string) =>
        `${label}${separator}[已隐藏]`
    )
    .replace(
      /(["']?api[_-]?key["']?\s*[:=]\s*["']?)[^"',}\s]+/gi,
      "$1[已隐藏]"
    )
    .replace(/\bBearer\s+[^\s"',，。；;]+/gi, "Bearer [已隐藏]")
    .replace(/\b(?:ark|sk)-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, "[API_KEY已隐藏]")
    .replace(/data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi, "[图片数据已隐藏]")
    .replace(/file:\/\/\/[^\n\r；;]+/gi, "[本机路径已隐藏]")
    .replace(/\/(?:Users|Volumes)\/[^\n\r；;]+/g, "[本机路径已隐藏]")
    .replace(/[A-Za-z]:\\[^\n\r；;]+/g, "[本机路径已隐藏]");
}

export function sanitizeDiagnosticValue(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 6) return "[已省略]";
  if (value === undefined) return undefined;
  if (typeof value === "string") return sanitizeDiagnosticText(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }
  if (!isRecord(value)) return String(value);

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      shouldDropRequestIdKey(key, item)
        ? []
        : [
            [
              key,
              SENSITIVE_DIAGNOSTIC_KEY.test(key)
                ? "[已隐藏]"
                : sanitizeDiagnosticValue(item, depth + 1)
            ]
          ]
    )
  );
}

export function sanitizeApiMeta(value: unknown): ApiMeta | null {
  const sanitized = sanitizeDiagnosticValue(value);
  return isRecord(sanitized) ? sanitized : null;
}

export function detailMessages(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => detailMessages(item));
  }
  if (isRecord(value)) {
    // 对象型 details 是重试、耗时、阶段等机器控制信息，
    // 由 ApiError.meta 以白名单方式解析，不作为“校验明细”逐项暴露。
    // 仅后端明确返回的自然语言数组才能进入明细区。
    return [];
  }
  return [sanitizeDiagnosticText(String(value))];
}
