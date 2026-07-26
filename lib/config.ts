export const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_IMAGE_COUNT = 5;
export const MAX_TOTAL_UPLOAD_IMAGE_BYTES = 24 * 1024 * 1024;

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
