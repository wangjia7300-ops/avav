import {
  MAX_UPLOAD_IMAGE_EDGE,
  MAX_UPLOAD_IMAGE_PIXELS,
  REFERENCE_IMAGE_MAX_EDGE
} from "@/lib/config";
import { readImageDimensions } from "@/lib/uploads/read-image-dimensions";

export type ReferenceImageDimensions = {
  width: number;
  height: number;
  resized: boolean;
};

export type NormalizedReferenceImage = ReferenceImageDimensions & {
  dataUrl: string;
  size: number;
};

export function fitReferenceImageDimensions(
  width: number,
  height: number
): ReferenceImageDimensions {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("图片尺寸无效。");
  }
  if (
    width > MAX_UPLOAD_IMAGE_EDGE ||
    height > MAX_UPLOAD_IMAGE_EDGE ||
    width * height > MAX_UPLOAD_IMAGE_PIXELS
  ) {
    throw new Error(
      "图片尺寸过大，最大边长为8000px且总像素不能超过2400万。"
    );
  }

  const longestEdge = Math.max(width, height);
  if (longestEdge <= REFERENCE_IMAGE_MAX_EDGE) {
    return {
      width: Math.round(width),
      height: Math.round(height),
      resized: false
    };
  }

  const scale = REFERENCE_IMAGE_MAX_EDGE / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true
  };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(blob);
  });
}

function canvasToWebp(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("浏览器无法完成图片压缩。"));
      },
      "image/webp",
      0.9
    );
  });
}

export async function normalizeReferenceImageFile(
  file: File
): Promise<NormalizedReferenceImage> {
  // 先读取编码头而不解码像素，阻止小文件伪装成超大位图占满浏览器内存。
  const encodedDimensions = await readImageDimensions(file);
  fitReferenceImageDimensions(
    encodedDimensions.width,
    encodedDimensions.height
  );

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image"
    });
    const dimensions = fitReferenceImageDimensions(
      bitmap.width,
      bitmap.height
    );
    if (!dimensions.resized) {
      return {
        ...dimensions,
        dataUrl: await blobToDataUrl(file),
        size: file.size
      };
    }

    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("浏览器无法创建图片处理画布。");
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const optimized = await canvasToWebp(canvas);

    return {
      ...dimensions,
      dataUrl: await blobToDataUrl(optimized),
      size: optimized.size
    };
  } catch {
    throw new Error(`无法优化 ${file.name}，请确认图片未损坏。`);
  } finally {
    bitmap?.close();
  }
}
