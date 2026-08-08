"use client";

import { useRef, useState } from "react";
import {
  ArrowClockwise,
  Check,
  ImageSquare,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import {
  MAX_TOTAL_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_COUNT,
  REFERENCE_IMAGE_MAX_EDGE
} from "@/lib/config";
import type { ProjectAsset } from "@/lib/types";
import { normalizeReferenceImageFile } from "@/lib/uploads/normalize-reference-image";

type AssetLibraryProps = {
  assets: ProjectAsset[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  /**
   * 素材与默认选择必须作为一次事务提交。返回 false 表示父级拒绝本次
   * 变更（例如用户取消“清空旧结果”确认），子组件不得继续写 selection。
   */
  onAssetsChange: (
    assets: ProjectAsset[],
    selectedIds?: string[]
  ) => boolean;
};

async function fileToAsset(file: File) {
  const optimized = await normalizeReferenceImageFile(file);
  return {
    id: `asset_${crypto.randomUUID().replace(/-/g, "")}`,
    name: file.name,
    dataUrl: optimized.dataUrl,
    size: optimized.size
  } satisfies ProjectAsset;
}

export function AssetLibrary({
  assets,
  selectedIds,
  onSelectionChange,
  onAssetsChange
}: AssetLibraryProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadModeRef = useRef<"append" | "replace">("append");
  const dragDepthRef = useRef(0);
  const isReadingRef = useRef(false);
  const latestAssetsRef = useRef(assets);
  latestAssetsRef.current = assets;
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  function openPicker(mode: "append" | "replace") {
    if (isReadingRef.current) return;
    uploadModeRef.current = mode;
    inputRef.current?.click();
  }

  async function handleFiles(
    files: FileList | readonly File[] | null,
    requestedMode = uploadModeRef.current
  ) {
    if (!files?.length || isReadingRef.current) return;
    setError(null);
    const mode = assets.length ? requestedMode : "replace";
    const startingAssets = assets;
    const candidates = Array.from(files);
    const totalAfter =
      mode === "append" ? assets.length + candidates.length : candidates.length;
    if (totalAfter > MAX_UPLOAD_IMAGE_COUNT) {
      setError(
        mode === "append"
          ? `最多共 ${MAX_UPLOAD_IMAGE_COUNT} 张产品图，当前已有 ${assets.length} 张。`
          : `最多上传 ${MAX_UPLOAD_IMAGE_COUNT} 张产品图。`
      );
      return;
    }
    const supportedByName = /\.(?:jpe?g|png|webp)$/i;
    if (candidates.some((file) => {
      const hasSupportedMime = ["image/jpeg", "image/png", "image/webp"].includes(
        file.type
      );
      const hasNoMimeButSupportedName =
        !file.type && supportedByName.test(file.name);
      return (
        (!hasSupportedMime && !hasNoMimeButSupportedName) ||
        file.size > MAX_UPLOAD_IMAGE_BYTES
      );
    })) {
      setError("仅支持单张不超过8MB的 JPG、PNG、WEBP。");
      return;
    }
    try {
      isReadingRef.current = true;
      setIsReading(true);
      const added: ProjectAsset[] = [];
      // 逐张解码，避免9张高分辨率照片同时占用大量浏览器内存。
      for (const candidate of candidates) {
        added.push(await fileToAsset(candidate));
      }
      const next = mode === "append" ? [...assets, ...added] : added;
      const optimizedBytes = next.reduce(
        (total, asset) => total + asset.size,
        0
      );
      if (optimizedBytes > MAX_TOTAL_UPLOAD_IMAGE_BYTES) {
        setError("优化后的产品图总大小不能超过24MB，请移除部分图片。");
        return;
      }
      if (latestAssetsRef.current !== startingAssets) {
        setError("优化期间素材已发生变化，请重新选择要上传的图片。");
        return;
      }
      const nextSelectedIds =
        mode === "append"
          ? [...new Set([...selectedIds, ...added.map((asset) => asset.id)])]
          : added.map((asset) => asset.id);
      if (!onAssetsChange(next, nextSelectedIds)) return;
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "图片读取失败。");
    } finally {
      isReadingRef.current = false;
      setIsReading(false);
    }
  }

  function containsFiles(event: React.DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: React.DragEvent<HTMLElement>) {
    if (!containsFiles(event) || isReadingRef.current) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    if (!containsFiles(event) || isReadingRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    if (!containsFiles(event) || isReadingRef.current) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    // 拖入永远是追加语义，不能继承一次未完成的“替换全部”选择。
    uploadModeRef.current = "append";
    void handleFiles(event.dataTransfer.files, "append");
  }

  function toggleAsset(id: string) {
    if (isReadingRef.current) return;
    onSelectionChange(
      selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id]
    );
  }

  function removeAsset(id: string) {
    if (isReadingRef.current) return;
    const remainingAssets = assets.filter((asset) => asset.id !== id);
    const remainingSelectedIds = selectedIds.filter((assetId) => assetId !== id);
    onAssetsChange(remainingAssets, remainingSelectedIds);
  }

  return (
    <aside
      className={`asset-library${isDraggingFiles ? " is-dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-label="产品参考图素材库，可点击或拖入图片"
    >
      {isDraggingFiles ? (
        <div className="asset-drop-overlay" aria-hidden="true">
          <ImageSquare size={28} weight="fill" />
          <strong>松开即可添加产品参考图</strong>
          <span>支持 JPG、PNG、WEBP，最多{MAX_UPLOAD_IMAGE_COUNT}张</span>
        </div>
      ) : null}
      <div className="rail-heading">
        <div>
          <p className="eyebrow">素材库</p>
          <h2>产品参考图</h2>
        </div>
        <button
          type="button"
          className="icon-button accent"
          aria-label="追加上传产品素材"
          onClick={() => openPicker("append")}
          disabled={isReading}
        >
          <Plus size={17} weight="bold" />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="asset-summary">
        <span>{assets.length} / {MAX_UPLOAD_IMAGE_COUNT} 张</span>
        <span>
          {isReading ? "正在优化为1K…" : `${selectedIds.length} 张参与分析`}
        </span>
      </div>

      <div className="asset-upload-guide" aria-label="上传图片建议">
        <strong>建议上传哪些图</strong>
        <p>
          正面、侧面、背面、关键结构或规格图；上传后自动保持比例缩至最长边
          {REFERENCE_IMAGE_MAX_EDGE}px。
        </p>
      </div>

      {assets.length ? (
        <div className="asset-grid">
          {assets.map((asset) => {
            const selected = selectedIds.includes(asset.id);
            return (
              <div
                key={asset.id}
                className={`asset-tile${selected ? " is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="asset-select"
                  onClick={() => toggleAsset(asset.id)}
                  disabled={isReading}
                  aria-pressed={selected}
                  aria-label={`选择 ${asset.name} 参与分析`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.dataUrl} alt={asset.name} />
                  <span className="asset-check">
                    {selected ? <Check size={12} weight="bold" /> : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="asset-delete"
                  onClick={() => removeAsset(asset.id)}
                  disabled={isReading}
                  aria-label={`删除 ${asset.name}`}
                  title="删除这张图片"
                >
                  <Trash size={13} weight="bold" />
                </button>
                <div className="asset-tile-meta">
                  <small title={asset.name}>{asset.name}</small>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <button
          type="button"
          className="asset-empty"
          onClick={() => openPicker("replace")}
          disabled={isReading}
        >
          <ImageSquare size={26} />
          <strong>上传多角度产品图</strong>
          <span>点击选择，或把正面、侧面、背面与细节图拖到这里</span>
        </button>
      )}

      {error ? <p className="inline-error">{error}</p> : null}

      <div className="asset-library-footer">
        <button
          type="button"
          className="rail-secondary-button"
          onClick={() => openPicker("replace")}
          disabled={isReading}
        >
          <ArrowClockwise size={16} />
          替换全部素材
        </button>
        <p className="asset-privacy-note">
          图片不会被应用持久化；执行图研或生图时，将在重新验证并移除
          EXIF/GPS 后发送给当前选择的模型供应商。
        </p>
      </div>
    </aside>
  );
}
