import type { ApiMeta } from "@/lib/workbench/api-client";

const SENSITIVE_DIAGNOSTIC_KEY =
  /api.?key|authorization|bearer|provider.?config|data.?url|reference.?images?|assets?|file.?path|file.?name/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeDiagnosticText(value: string) {
  return value
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
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_DIAGNOSTIC_KEY.test(key)
        ? "[已隐藏]"
        : sanitizeDiagnosticValue(item, depth + 1)
    ])
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
    return Object.entries(value).flatMap(([key, item]) => {
      if (SENSITIVE_DIAGNOSTIC_KEY.test(key)) {
        return [`${key}：[已隐藏]`];
      }
      if (Array.isArray(item) || isRecord(item)) {
        const nested = detailMessages(item);
        return nested.map((message) => `${key}：${message}`);
      }
      return [`${key}：${sanitizeDiagnosticText(String(item))}`];
    });
  }
  return [sanitizeDiagnosticText(String(value))];
}
