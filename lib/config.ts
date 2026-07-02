export const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_IMAGE_COUNT = 6;
export const MAX_TOTAL_UPLOAD_IMAGE_BYTES = 24 * 1024 * 1024;
export const MIN_UPLOAD_IMAGE_DIMENSION = 64;
export const ANALYSIS_IMAGE_MAX_EDGE = 1024;
export const ANALYSIS_IMAGE_QUALITY = 0.82;
export const MAX_ANALYSIS_IMAGE_BYTES = 500 * 1024;
export const MAX_ANALYZE_REQUEST_BYTES = 8 * 1024 * 1024;
export const ENABLE_REAL_SEARCH = false;

export function shouldUseMockData() {
  const value = process.env.NEXT_PUBLIC_USE_MOCK;

  return value === undefined ? true : value !== "false";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
