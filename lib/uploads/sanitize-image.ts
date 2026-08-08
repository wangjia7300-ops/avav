import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import {
  MAX_UPLOAD_IMAGE_EDGE,
  MAX_UPLOAD_IMAGE_PIXELS,
  MAX_TOTAL_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_COUNT,
  REFERENCE_IMAGE_MAX_EDGE
} from "@/lib/config";
import { ServiceError } from "@/lib/services/errors";

const DATA_IMAGE_PATTERN =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp";

export type SanitizedImage = {
  dataUrl: string;
  mimeType: "image/webp";
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  encoding:
    | "lossless"
    | "quality_92"
    | "quality_86";
};

type UploadedAsset = {
  id: string;
  dataUrl: string;
};

function uploadError(
  message: string,
  code: string,
  statusCode: number
) {
  return new ServiceError(message, { code, statusCode });
}

function detectMimeType(buffer: Buffer): SupportedImageMime | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function decodeDataImage(value: string, position: number) {
  const match = DATA_IMAGE_PATTERN.exec(value);
  if (!match) {
    throw uploadError(
      `第 ${position} 张图片必须是 JPG、PNG 或 WEBP 的本地 data URL。`,
      "UPLOAD_IMAGE_FORMAT_INVALID",
      415
    );
  }

  const declaredMimeType = match[1].toLowerCase() as SupportedImageMime;
  const buffer = Buffer.from(match[2], "base64");
  const detectedMimeType = detectMimeType(buffer);

  if (!buffer.length || !detectedMimeType || detectedMimeType !== declaredMimeType) {
    throw uploadError(
      `第 ${position} 张图片的内容与声明格式不一致。`,
      "UPLOAD_IMAGE_CONTENT_INVALID",
      415
    );
  }
  if (buffer.length > MAX_UPLOAD_IMAGE_BYTES) {
    throw uploadError(
      `第 ${position} 张图片超过 8MB，请压缩后重试。`,
      "UPLOAD_IMAGE_TOO_LARGE",
      413
    );
  }

  return buffer;
}

async function sanitizeDecodedImage(
  buffer: Buffer,
  position: number
): Promise<SanitizedImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_UPLOAD_IMAGE_PIXELS,
      sequentialRead: true
    }).metadata();
  } catch {
    throw uploadError(
      `第 ${position} 张图片无法安全解码，可能已损坏或像素过大。`,
      "UPLOAD_IMAGE_DECODE_FAILED",
      422
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pages = metadata.pages ?? 1;
  if (
    !width ||
    !height ||
    width > MAX_UPLOAD_IMAGE_EDGE ||
    height > MAX_UPLOAD_IMAGE_EDGE ||
    width * height > MAX_UPLOAD_IMAGE_PIXELS
  ) {
    throw uploadError(
      `第 ${position} 张图片尺寸过大，最大边长为 8000px 且总像素不超过 2400 万。`,
      "UPLOAD_IMAGE_DIMENSIONS_EXCEEDED",
      422
    );
  }
  if (pages > 1) {
    throw uploadError(
      `第 ${position} 张图片包含多帧内容，请上传静态产品图。`,
      "UPLOAD_IMAGE_MULTIFRAME_UNSUPPORTED",
      422
    );
  }

  let output: Buffer;
  let encoding: SanitizedImage["encoding"] = "lossless";
  try {
    output = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_UPLOAD_IMAGE_PIXELS,
      sequentialRead: true
    })
      .rotate()
      .resize({
        width: REFERENCE_IMAGE_MAX_EDGE,
        height: REFERENCE_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true
      })
      .toColourspace("srgb")
      .webp({
        lossless: true,
        effort: 4
      })
      .toBuffer();

    if (output.length > MAX_UPLOAD_IMAGE_BYTES) {
      encoding = "quality_92";
      output = await sharp(buffer, {
        failOn: "error",
        limitInputPixels: MAX_UPLOAD_IMAGE_PIXELS,
        sequentialRead: true
      })
        .rotate()
        .resize({
          width: REFERENCE_IMAGE_MAX_EDGE,
          height: REFERENCE_IMAGE_MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true
        })
        .toColourspace("srgb")
        .webp({
          quality: 92,
          alphaQuality: 100,
          smartSubsample: true
        })
        .toBuffer();
    }

    if (output.length > MAX_UPLOAD_IMAGE_BYTES) {
      encoding = "quality_86";
      output = await sharp(buffer, {
        failOn: "error",
        limitInputPixels: MAX_UPLOAD_IMAGE_PIXELS,
        sequentialRead: true
      })
        .rotate()
        .resize({
          width: REFERENCE_IMAGE_MAX_EDGE,
          height: REFERENCE_IMAGE_MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true
        })
        .toColourspace("srgb")
        .webp({
          quality: 86,
          alphaQuality: 96,
          smartSubsample: true
        })
        .toBuffer();
    }

  } catch {
    throw uploadError(
      `第 ${position} 张图片隐私清洗失败，已阻止发送原图。`,
      "UPLOAD_IMAGE_SANITIZE_FAILED",
      422
    );
  }

  if (!output.length || output.length > MAX_UPLOAD_IMAGE_BYTES) {
    throw uploadError(
      `第 ${position} 张图片清洗后仍超过 8MB，请降低分辨率后重试。`,
      "UPLOAD_IMAGE_SANITIZED_TOO_LARGE",
      413
    );
  }

  const sanitizedMetadata = await sharp(output).metadata();
  return {
    dataUrl: `data:image/webp;base64,${output.toString("base64")}`,
    mimeType: "image/webp",
    bytes: output.length,
    width: sanitizedMetadata.width ?? width,
    height: sanitizedMetadata.height ?? height,
    sha256: createHash("sha256").update(output).digest("hex"),
    encoding
  };
}

export async function sanitizeDataImages(
  values: readonly string[]
): Promise<SanitizedImage[]> {
  if (!Array.isArray(values) || values.length < 1) {
    throw uploadError(
      "请至少上传一张产品图。",
      "UPLOAD_IMAGE_REQUIRED",
      400
    );
  }
  if (values.length > MAX_UPLOAD_IMAGE_COUNT) {
    throw uploadError(
      `最多上传 ${MAX_UPLOAD_IMAGE_COUNT} 张产品图。`,
      "UPLOAD_IMAGE_COUNT_EXCEEDED",
      400
    );
  }

  const decoded: Buffer[] = [];
  let rawTotal = 0;
  values.forEach((value, index) => {
    if (typeof value !== "string") {
      throw uploadError(
        `第 ${index + 1} 张图片格式不正确。`,
        "UPLOAD_IMAGE_FORMAT_INVALID",
        415
      );
    }
    const buffer = decodeDataImage(value, index + 1);
    rawTotal += buffer.length;
    decoded.push(buffer);
  });
  if (rawTotal > MAX_TOTAL_UPLOAD_IMAGE_BYTES) {
    throw uploadError(
      "产品参考图总大小超过 24MB，请移除或压缩部分图片后重试。",
      "UPLOAD_IMAGE_TOTAL_TOO_LARGE",
      413
    );
  }

  const sanitized: SanitizedImage[] = [];
  const seenHashes = new Set<string>();
  let sanitizedTotal = 0;
  for (let index = 0; index < decoded.length; index += 1) {
    const image = await sanitizeDecodedImage(decoded[index], index + 1);
    if (seenHashes.has(image.sha256)) continue;
    seenHashes.add(image.sha256);
    sanitizedTotal += image.bytes;
    if (sanitizedTotal > MAX_TOTAL_UPLOAD_IMAGE_BYTES) {
      throw uploadError(
        "产品参考图清洗后的总大小超过 24MB，请减少图片后重试。",
        "UPLOAD_IMAGE_TOTAL_TOO_LARGE",
        413
      );
    }
    sanitized.push(image);
  }

  return sanitized;
}

export async function sanitizeUploadedAssets(
  assets: readonly UploadedAsset[]
) {
  if (
    !Array.isArray(assets) ||
    assets.some(
      (asset) =>
        !asset ||
        typeof asset.id !== "string" ||
        !ASSET_ID_PATTERN.test(asset.id) ||
        typeof asset.dataUrl !== "string"
    )
  ) {
    throw uploadError(
      "产品素材结构或素材 ID 不正确。",
      "UPLOAD_ASSET_INVALID",
      400
    );
  }
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) {
    throw uploadError(
      "产品素材 ID 不能重复。",
      "UPLOAD_ASSET_ID_DUPLICATE",
      422
    );
  }
  const sanitized = await sanitizeDataImages(
    assets.map((asset) => asset.dataUrl)
  );
  if (sanitized.length !== assets.length) {
    throw uploadError(
      "检测到重复产品图，请移除重复图片后重试。",
      "UPLOAD_IMAGE_DUPLICATE",
      422
    );
  }

  return assets.map((asset, index) => ({
    id: asset.id,
    ...sanitized[index]
  }));
}
