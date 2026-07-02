"use client";

import { useRef, useState } from "react";
import { ImagePlus, Plus, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ANALYSIS_IMAGE_MAX_EDGE,
  ANALYSIS_IMAGE_QUALITY,
  formatBytes,
  MAX_ANALYSIS_IMAGE_BYTES,
  MIN_UPLOAD_IMAGE_DIMENSION,
  MAX_TOTAL_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_COUNT
} from "@/lib/config";
import type { UploadedProductImage } from "@/lib/types";
import { cn } from "@/lib/utils";

type ProductUploaderProps = {
  images: UploadedProductImage[];
  disabled?: boolean;
  onImagesChange: (images: UploadedProductImage[]) => void;
  onClear: () => void;
  onError: (message: string) => void;
};

const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
const acceptedImageExtensionPattern = /\.(jpe?g|png|webp)$/i;

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("图片读取失败，请重新选择文件。"));
      }
    };
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择文件。"));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片尺寸读取失败，请重新选择清晰的产品图片。"));
    };
    image.src = objectUrl;
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("压缩图片读取失败，请重新选择文件。"));
      }
    };
    reader.onerror = () => reject(new Error("压缩图片读取失败，请重新选择文件。"));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片压缩失败，请重新选择清晰的产品图片。"));
    };
    image.src = objectUrl;
  });
}

async function compressImageForAnalysis(file: File) {
  const image = await loadImageFromFile(file);
  const scale = Math.min(1, ANALYSIS_IMAGE_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器不支持图片压缩，请换一张较小图片。");
  }

  context.drawImage(image, 0, 0, width, height);
  const webpBlob = await canvasToBlob(canvas, "image/webp", ANALYSIS_IMAGE_QUALITY);
  const jpegBlob = webpBlob && webpBlob.size <= MAX_ANALYSIS_IMAGE_BYTES
    ? webpBlob
    : await canvasToBlob(canvas, "image/jpeg", ANALYSIS_IMAGE_QUALITY);
  const blob = jpegBlob ?? webpBlob;

  if (!blob) {
    throw new Error("图片压缩失败，请换一张 JPG/PNG/WEBP 图片。");
  }

  if (blob.size > MAX_ANALYSIS_IMAGE_BYTES) {
    throw new Error(
      `「${file.name}」压缩后仍有 ${formatBytes(blob.size)}，请裁剪或换一张更小的图片（建议 ${formatBytes(MAX_ANALYSIS_IMAGE_BYTES)} 以内）。`
    );
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    size: blob.size,
    width,
    height
  };
}

function getFileId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function getImageId(image: UploadedProductImage) {
  return image.id ?? `${image.imageName}-${image.imageSize}`;
}

function isAcceptedImage(file: File) {
  return acceptedTypes.includes(file.type) || acceptedImageExtensionPattern.test(file.name);
}

export function ProductUploader({
  images,
  disabled,
  onImagesChange,
  onClear,
  onError
}: ProductUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setDragging] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  async function handleFiles(fileList?: FileList | File[]) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;

    setUploadNotice(null);

    if (images.length >= MAX_UPLOAD_IMAGE_COUNT) {
      onError(`最多上传 ${MAX_UPLOAD_IMAGE_COUNT} 张产品图，请先移除一张再添加。`);
      return;
    }

    const existingIds = new Set(images.map(getImageId));
    const selectedIds = new Set<string>();
    const acceptedFiles: File[] = [];
    const skipped: string[] = [];
    let nextTotalSize = images.reduce((total, image) => total + (image.compressedSize ?? image.imageSize), 0);

    for (const file of files) {
      const fileId = getFileId(file);

      if (!isAcceptedImage(file)) {
        skipped.push(`「${file.name}」不是 JPG/PNG/WEBP`);
        continue;
      }

      if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
        skipped.push(`「${file.name}」超过 ${formatBytes(MAX_UPLOAD_IMAGE_BYTES)}`);
        continue;
      }

      try {
        const dimensions = await readImageDimensions(file);

        if (
          dimensions.width < MIN_UPLOAD_IMAGE_DIMENSION ||
          dimensions.height < MIN_UPLOAD_IMAGE_DIMENSION
        ) {
          skipped.push(
            `「${file.name}」尺寸过小（${dimensions.width}×${dimensions.height}），请上传更清晰的产品图`
          );
          continue;
        }
      } catch (error) {
        skipped.push(error instanceof Error ? `「${file.name}」${error.message}` : `「${file.name}」尺寸读取失败`);
        continue;
      }

      if (existingIds.has(fileId) || selectedIds.has(fileId)) {
        skipped.push(`「${file.name}」已添加`);
        continue;
      }

      if (images.length + acceptedFiles.length >= MAX_UPLOAD_IMAGE_COUNT) {
        skipped.push(`已达到 ${MAX_UPLOAD_IMAGE_COUNT} 张上限`);
        continue;
      }

      if (nextTotalSize + file.size > MAX_TOTAL_UPLOAD_IMAGE_BYTES) {
        skipped.push(`图片总大小超过 ${formatBytes(MAX_TOTAL_UPLOAD_IMAGE_BYTES)}`);
        continue;
      }

      selectedIds.add(fileId);
      acceptedFiles.push(file);
      nextTotalSize += file.size;
    }

    if (!acceptedFiles.length) {
      onError(skipped[0] ?? "没有可添加的图片，请重新选择 JPG、PNG 或 WEBP。");
      return;
    }

    try {
      const nextImages = await Promise.all(
        acceptedFiles.map(async (file) => {
          const [previewUrl, compressed] = await Promise.all([
            readAsDataUrl(file),
            compressImageForAnalysis(file)
          ]);

          return {
            id: getFileId(file),
            previewUrl,
            analysisUrl: compressed.dataUrl,
            imageName: file.name,
            imageSize: file.size,
            originalSize: file.size,
            compressedSize: compressed.size,
            width: compressed.width,
            height: compressed.height
          };
        })
      );
      onImagesChange([...images, ...nextImages]);
      if (skipped.length) {
        setUploadNotice(`已添加 ${nextImages.length} 张；跳过 ${skipped.length} 项：${skipped.slice(0, 2).join("，")}${skipped.length > 2 ? "…" : ""}`);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "图片读取失败，请重新选择文件。");
    }
  }

  function removeImage(index: number) {
    setUploadNotice(null);
    onImagesChange(images.filter((_, imageIndex) => imageIndex !== index));
  }

  const primaryImage = images[0] ?? null;

  return (
    <div
      className={cn(
        "relative rounded-lg border border-dashed bg-white/95 shadow-[0_16px_38px_rgba(15,23,42,0.05)] transition-all",
        isDragging ? "border-primary bg-primary/5 shadow-[0_18px_42px_rgba(37,99,235,0.12)]" : "border-blue-100",
        disabled && "opacity-70"
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (disabled) return;
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files ?? undefined);
          event.currentTarget.value = "";
        }}
      />

      {primaryImage ? (
        <div className="p-3">
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-slate-50">
            <img
              src={primaryImage.previewUrl}
              alt={primaryImage.imageName}
              className="h-full w-full object-contain"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-950">{primaryImage.imageName}</p>
              <p className="text-xs text-muted-foreground">
                已上传 {images.length} 张，首张作为主参考图；API 使用压缩图
                {primaryImage.compressedSize ? `（${formatBytes(primaryImage.compressedSize)}）` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={disabled || images.length >= MAX_UPLOAD_IMAGE_COUNT}
                className="ai-outline-button"
                onClick={() => inputRef.current?.click()}
              >
                <ImagePlus className="h-4 w-4" />
                继续添加多张
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={disabled}
                className="ai-outline-button"
                aria-label="清空图片"
                title="清空图片"
                onClick={onClear}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {uploadNotice ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
              {uploadNotice}
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
            <button
              type="button"
              disabled={disabled || images.length >= MAX_UPLOAD_IMAGE_COUNT}
              className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-primary/40 bg-primary/5 text-primary transition hover:bg-primary/10 disabled:pointer-events-none disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300"
              onClick={() => inputRef.current?.click()}
            >
              <Plus className="h-5 w-5" />
              <span className="mt-1 text-[11px] font-medium">添加更多</span>
            </button>
            {images.map((image, index) => (
              <div key={image.id ?? `${image.imageName}-${index}`} className="group relative">
                <div
                  className={cn(
                    "aspect-square overflow-hidden rounded-md border bg-slate-50",
                    index === 0 ? "border-primary" : "border-slate-200"
                  )}
                >
                  <img
                    src={image.previewUrl}
                    alt={image.imageName}
                    className="h-full w-full object-cover"
                  />
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border bg-white/90 text-slate-700 shadow-sm transition hover:bg-white disabled:pointer-events-none disabled:opacity-50"
                  aria-label={`移除第 ${index + 1} 张图片`}
                  title="移除图片"
                  onClick={() => removeImage(index)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {index === 0 ? "主参考 · " : ""}
                  {image.imageName}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          className="flex min-h-[300px] w-full flex-col items-center justify-center px-6 py-10 text-center"
          onClick={() => inputRef.current?.click()}
        >
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {isDragging ? <UploadCloud className="h-6 w-6" /> : <ImagePlus className="h-6 w-6" />}
          </span>
          <span className="text-sm font-semibold text-slate-950">拖拽上传产品图</span>
          <span className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
            支持 JPG、PNG、WEBP，可一次选择多张，也可以上传后继续添加。首张作为主参考图，其余用于补充角度和细节。
          </span>
          <span className="ai-gradient-button mt-5 inline-flex h-9 items-center px-4 text-sm font-medium">
            选择图片
          </span>
          <span className="mt-3 text-xs text-muted-foreground">
            最多 {MAX_UPLOAD_IMAGE_COUNT} 张，单张不超过 {formatBytes(MAX_UPLOAD_IMAGE_BYTES)}
          </span>
        </button>
      )}
    </div>
  );
}
