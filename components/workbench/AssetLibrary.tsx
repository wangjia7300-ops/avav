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
  onAssetKindChange: (assetId: string, kind: ProjectAsset["kind"]) => void;
};

const KIND_SEQUENCE: ProjectAsset["kind"][] = ["product", "detail", "scene"];

const KIND_LABEL: Record<string, string> = {
  product: "产品",
  detail: "细节",
  scene: "场景"
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
  onAssetsChange,
  onAssetKindChange
}: AssetLibraryProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadModeRef = useRef<"append" | "replace">("append");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | ProjectAsset["kind"]>("all");
  const visibleAssets =
    filter === "all" ? assets : assets.filter((asset) => asset.kind === filter);

  function openPicker(mode: "append" | "replace") {
    uploadModeRef.current = mode;
    inputRef.current?.click();
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const mode = assets.length ? uploadModeRef.current : "replace";
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
      const added = await Promise.all(candidates.map(fileToAsset));
      const next = mode === "append" ? [...assets, ...added] : added;
      onAssetsChange(next);
      onSelectionChange(
        mode === "append"
          ? [...selectedIds, ...added.map((asset) => asset.id)]
          : added.map((asset) => asset.id)
      );
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

  function cycleKind(asset: ProjectAsset) {
    const currentIndex = KIND_SEQUENCE.indexOf(asset.kind);
    const nextKind =
      KIND_SEQUENCE[(currentIndex + 1) % KIND_SEQUENCE.length] ?? "product";
    onAssetKindChange(asset.id, nextKind);
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
          aria-label="追加上传产品素材"
          onClick={() => openPicker("append")}
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
              <div
                key={asset.id}
                className={`asset-tile${selected ? " is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="asset-select"
                  onClick={() => toggleAsset(asset.id)}
                  aria-pressed={selected}
                  aria-label={`选择 ${asset.name} 参与分析`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.dataUrl} alt={asset.name} />
                  <span className="asset-check">
                    {selected ? <Check size={12} weight="bold" /> : null}
                  </span>
                </button>
                <div className="asset-tile-meta">
                  <small title={asset.name}>{asset.name}</small>
                  <button
                    type="button"
                    className="asset-kind"
                    onClick={() => cycleKind(asset)}
                    aria-label={`切换素材分类，当前为${KIND_LABEL[asset.kind] ?? asset.kind}`}
                    title="点击切换：产品 → 细节 → 场景"
                  >
                    {KIND_LABEL[asset.kind] ?? asset.kind}
                  </button>
                </div>
              </div>
            );
          })}
          {!visibleAssets.length ? (
            <p className="asset-filter-empty">该分类暂无素材，点击缩略图下方的分类标签可重新归类</p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="asset-empty"
          onClick={() => openPicker("replace")}
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
          onClick={() => openPicker("replace")}
        >
          <ArrowClockwise size={16} />
          替换全部素材
        </button>
        <p className="asset-privacy-note">
          刷新或新建项目会清空业务资料，API配置独立保留。
        </p>
      </div>
    </aside>
  );
}
