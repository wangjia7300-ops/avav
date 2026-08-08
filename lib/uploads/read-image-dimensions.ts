import { MAX_UPLOAD_IMAGE_BYTES } from "@/lib/config";

// 上传入口已把单图限制为 8MiB；读取这部分编码数据不会展开像素，
// 同时可兼容带较大 ICC / EXIF 段的合法 JPEG。
const IMAGE_HEADER_PREFLIGHT_BYTES = MAX_UPLOAD_IMAGE_BYTES;

export type EncodedImageDimensions = {
  format: "jpeg" | "png" | "webp";
  width: number;
  height: number;
};

function fail(message: string): never {
  throw new Error(`图片文件无效：${message}`);
}

function requireBytes(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    fail("文件头不完整。");
  }
}

function isAscii(bytes: Uint8Array, offset: number, value: string) {
  if (offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function readU16BE(bytes: Uint8Array, offset: number) {
  requireBytes(bytes, offset, 2);
  return bytes[offset] * 256 + bytes[offset + 1];
}

function readU16LE(bytes: Uint8Array, offset: number) {
  requireBytes(bytes, offset, 2);
  return bytes[offset] + bytes[offset + 1] * 256;
}

function readU24LE(bytes: Uint8Array, offset: number) {
  requireBytes(bytes, offset, 3);
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
}

function readU32BE(bytes: Uint8Array, offset: number) {
  requireBytes(bytes, offset, 4);
  return (
    bytes[offset] * 16777216 +
    bytes[offset + 1] * 65536 +
    bytes[offset + 2] * 256 +
    bytes[offset + 3]
  );
}

function readU32LE(bytes: Uint8Array, offset: number) {
  requireBytes(bytes, offset, 4);
  return (
    bytes[offset] +
    bytes[offset + 1] * 256 +
    bytes[offset + 2] * 65536 +
    bytes[offset + 3] * 16777216
  );
}

function validDimensions(
  format: EncodedImageDimensions["format"],
  width: number,
  height: number
): EncodedImageDimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    fail("宽高信息无效。");
  }
  return { format, width, height };
}

function parsePng(bytes: Uint8Array, totalSize: number) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  requireBytes(bytes, 0, 24);
  if (!signature.every((value, index) => bytes[index] === value)) {
    fail("PNG 签名错误。");
  }
  if (totalSize < 33 || readU32BE(bytes, 8) !== 13 || !isAscii(bytes, 12, "IHDR")) {
    fail("PNG IHDR 数据不完整。");
  }
  return validDimensions("png", readU32BE(bytes, 16), readU32BE(bytes, 20));
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

function parseJpeg(bytes: Uint8Array, totalSize: number) {
  requireBytes(bytes, 0, 2);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("JPEG 签名错误。");

  let offset = 2;
  let markerCount = 0;
  while (offset < totalSize && markerCount < 4096) {
    if (offset >= bytes.length) fail("JPEG 尺寸标记超出预检范围。");
    if (bytes[offset] !== 0xff) fail("JPEG 标记流损坏。");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) fail("JPEG 文件头不完整。");

    const marker = bytes[offset];
    offset += 1;
    markerCount += 1;

    if (marker === 0x00) fail("JPEG 标记无效。");
    if (marker === 0xd9 || marker === 0xda) {
      fail("JPEG 缺少图像尺寸标记。");
    }
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > bytes.length) fail("JPEG 段长度不完整。");
    const segmentLength = readU16BE(bytes, offset);
    if (segmentLength < 2) fail("JPEG 段长度无效。");
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > totalSize) fail("JPEG 段超出文件范围。");

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8) fail("JPEG 尺寸段无效。");
      requireBytes(bytes, offset + 2, 5);
      return validDimensions(
        "jpeg",
        readU16BE(bytes, offset + 5),
        readU16BE(bytes, offset + 3)
      );
    }

    offset = segmentEnd;
  }

  fail("JPEG 缺少可用的图像尺寸。");
}

function parseWebp(bytes: Uint8Array, totalSize: number) {
  requireBytes(bytes, 0, 20);
  if (!isAscii(bytes, 0, "RIFF") || !isAscii(bytes, 8, "WEBP")) {
    fail("WebP 签名错误。");
  }

  const riffEnd = readU32LE(bytes, 4) + 8;
  if (riffEnd < 20 || riffEnd > totalSize) fail("WebP RIFF 长度无效。");

  let offset = 12;
  let chunkCount = 0;
  while (offset + 8 <= riffEnd && chunkCount < 4096) {
    if (offset + 8 > bytes.length) fail("WebP 图像块超出预检范围。");
    const chunkType = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const chunkSize = readU32LE(bytes, offset + 4);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkSize;
    if (chunkEnd > riffEnd) fail("WebP 图像块长度无效。");

    if (chunkType === "VP8X") {
      if (chunkSize !== 10) fail("WebP VP8X 数据无效。");
      requireBytes(bytes, dataOffset, 10);
      return validDimensions(
        "webp",
        readU24LE(bytes, dataOffset + 4) + 1,
        readU24LE(bytes, dataOffset + 7) + 1
      );
    }

    if (chunkType === "VP8L") {
      if (chunkSize < 5) fail("WebP VP8L 数据无效。");
      requireBytes(bytes, dataOffset, 5);
      if (bytes[dataOffset] !== 0x2f) fail("WebP VP8L 签名错误。");
      const byte1 = bytes[dataOffset + 1];
      const byte2 = bytes[dataOffset + 2];
      const byte3 = bytes[dataOffset + 3];
      const byte4 = bytes[dataOffset + 4];
      return validDimensions(
        "webp",
        1 + byte1 + (byte2 & 0x3f) * 256,
        1 + Math.floor(byte2 / 64) + byte3 * 4 + (byte4 & 0x0f) * 1024
      );
    }

    if (chunkType === "VP8 ") {
      if (chunkSize < 10) fail("WebP VP8 数据无效。");
      requireBytes(bytes, dataOffset, 10);
      if (
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        fail("WebP VP8 帧签名错误。");
      }
      return validDimensions(
        "webp",
        readU16LE(bytes, dataOffset + 6) & 0x3fff,
        readU16LE(bytes, dataOffset + 8) & 0x3fff
      );
    }

    offset = chunkEnd + (chunkSize % 2);
    chunkCount += 1;
  }

  fail("WebP 缺少可用的图像尺寸。");
}

function parseImageDimensions(
  source: Uint8Array,
  totalSize = source.byteLength
): EncodedImageDimensions {
  if (totalSize < source.byteLength || totalSize <= 0) fail("文件长度无效。");
  if (source.length >= 2 && source[0] === 0xff && source[1] === 0xd8) {
    return parseJpeg(source, totalSize);
  }
  if (source.length >= 8 && isAscii(source, 1, "PNG")) {
    return parsePng(source, totalSize);
  }
  if (source.length >= 12 && isAscii(source, 0, "RIFF")) {
    return parseWebp(source, totalSize);
  }
  fail("仅支持 JPEG、PNG 或 WebP。");
}

export async function readImageDimensions(
  source: Blob | Uint8Array
): Promise<EncodedImageDimensions> {
  if (source instanceof Uint8Array) {
    const prefix = source.subarray(0, IMAGE_HEADER_PREFLIGHT_BYTES);
    return parseImageDimensions(prefix, source.byteLength);
  }

  const prefixSize = Math.min(source.size, IMAGE_HEADER_PREFLIGHT_BYTES);
  const prefix = new Uint8Array(await source.slice(0, prefixSize).arrayBuffer());
  return parseImageDimensions(prefix, source.size);
}
