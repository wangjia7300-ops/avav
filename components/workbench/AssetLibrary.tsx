"use client";

import { useRef, useState } from "react";
import {
  ArrowClockwise,
  Check,
  ImageSquare,
  Plus,
} from "@phosphor-icons/react";
import { MAX_UPLOAD_IMAGE_BYTES, MAX_UPLOAD_IMAGE_COUNT } from "@/lib/config";
import type { ProjectAsset } from "@/lib/types";

type AssetLibraryProps = {
  assets: ProjectAsset[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onAssetsChange: (assets: ProjectAsset[]) => void;
};

function fileToAsset(file: File, index: number) {
  return new Promise<ProjectAsset>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: `asset-${Date.now()}-${index + 1}`,
        name: file.name,
        dataUrl: String(reader.result),
        kind: "product",
        size: file.size
      });
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function AssetLibrary({
  assets,
  selectedIds,
  onSelectionChange,
  onAssetsChange
}: AssetLibraryProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | ProjectAsset["kind"]>("all");
  const visibleAssets =
    filter === "all" ? assets : assets.filter((asset) => asset.kind === filter);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const candidates = Array.from(files);
    if (candidates.length > MAX_UPLOAD_IMAGE_COUNT) {
      setError(`最多上传 ${MAX_UPLOAD_IMAGE_COUNT} 张产品图。`);
      return;
    }
    if (
      candidates.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > MAX_UPLOAD_IMAGE_BYTES
      )
    ) {
      setError("仅支持单张不超过8MB的 JPG、PNG、WEBP。");
      return;
    }

    try {
      const next = await Promise.all(candidates.map(fileToAsset));
      onAssetsChange(next);
      onSelectionChange(next.map((asset) => asset.id));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "图片读取失败。");
    }
  }

  function toggleAsset(id: string) {
    onSelectionChange(
      selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id]
    );
  }

  return (
    <aside className="asset-library">
      <div className="rail-heading">
        <div>
          <p className="eyebrow">素材库</p>
          <h2>产品参考图</h2>
        </div>
        <button
          type="button"
          className="icon-button accent"
          aria-label="上传产品素材"
          onClick={() => inputRef.current?.click()}
        >
          <Plus size={17} weight="bold" />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      <div className="asset-summary">
        <span>{assets.length} / {MAX_UPLOAD_IMAGE_COUNT} 张</span>
        <span>{selectedIds.length} 张参与分析</span>
      </div>

      <div className="asset-filter-row" aria-label="素材筛选">
        {([
          ["all", "全部"],
          ["product", "产品"],
          ["detail", "细节"],
          ["scene", "场景"]
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`asset-filter${filter === value ? " is-active" : ""}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {assets.length ? (
        <div className="asset-grid">
          {visibleAssets.map((asset) => {
            const selected = selectedIds.includes(asset.id);
            return (
              <button
                key={asset.id}
                type="button"
                className={`asset-tile${selected ? " is-selected" : ""}`}
                onClick={() => toggleAsset(asset.id)}
                aria-pressed={selected}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.dataUrl} alt={asset.name} />
                <span className="asset-check">
                  {selected ? <Check size={12} weight="bold" /> : null}
                </span>
                <small title={asset.name}>{asset.name}</small>
              </button>
            );
          })}
          {!visibleAssets.length ? (
            <p className="asset-filter-empty">该分类暂无素材</p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="asset-empty"
          onClick={() => inputRef.current?.click()}
        >
          <ImageSquare size={26} />
          <strong>上传多角度产品图</strong>
          <span>建议正面、侧面、背面与细节图</span>
        </button>
      )}

      {error ? <p className="inline-error">{error}</p> : null}

      <div className="asset-library-footer">
        <button
          type="button"
          className="rail-secondary-button"
          onClick={() => inputRef.current?.click()}
        >
          <ArrowClockwise size={16} />
          替换素材
        </button>
        <p className="asset-privacy-note">
          刷新或新建项目会清空业务资料，API配置独立保留。
        </p>
      </div>
    </aside>
  );
}
