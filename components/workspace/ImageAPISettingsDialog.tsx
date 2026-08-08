"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImagePlus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageProviderConfigForm } from "@/components/workspace/ImageProviderConfigForm";
import { WorkspaceDialog } from "@/components/workspace/WorkspaceDialog";
import { useImageProviderStore } from "@/lib/image-provider-store";
import {
  createImageProviderDraft,
  imageProviderConfigSignature,
  isImageProviderConfigComplete,
  normalizeImageProviderConfig
} from "@/lib/image-providers";
import type { ImageProviderConfig } from "@/lib/types";

type ImageAPISettingsDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function ImageAPISettingsDialog({ open, onClose }: ImageAPISettingsDialogProps) {
  const savedConfig = useImageProviderStore((state) => state.config);
  const hasSavedProvider = useImageProviderStore((state) => state.isConfigured);
  const legacyKeyMigrated = useImageProviderStore((state) => state.legacyKeyMigrated);
  const setSavedConfig = useImageProviderStore((state) => state.setConfig);
  const resetSavedConfig = useImageProviderStore((state) => state.resetConfig);
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState<ImageProviderConfig>(() => createImageProviderDraft());
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<
    "apiKey" | "baseURL" | "imageModel" | null
  >(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const initialDraft = useImageProviderStore.getState().config ?? createImageProviderDraft();
    setDraft(initialDraft);
    setMounted(true);
  }, []);

  const hasSavedConfig = Boolean(hasSavedProvider && savedConfig);
  const hasRetainedMetadata = Boolean(savedConfig);
  const isDraftSaved = useMemo(
    () =>
      Boolean(
        hasSavedProvider &&
          savedConfig &&
          imageProviderConfigSignature(savedConfig) === imageProviderConfigSignature(draft)
      ),
    [draft, hasSavedProvider, savedConfig]
  );

  const handleChange = useCallback((nextDraft: ImageProviderConfig) => {
    setDraft(nextDraft);
    setError(null);
    setErrorField(null);
    setSuccessMessage(null);
  }, []);

  const handleSave = useCallback(() => {
    const normalized = normalizeImageProviderConfig(draft);

    if (!isImageProviderConfigComplete(normalized)) {
      const missingCustomEndpoint =
        normalized.providerId === "custom" && !/^https:\/\//i.test(normalized.baseURL);
      setError(
        missingCustomEndpoint
          ? "请填写以 https:// 开头的生图 API Endpoint。"
          : "请完整填写生图 API Key 和生图模型。"
      );
      setErrorField(
        !normalized.apiKey
          ? "apiKey"
          : missingCustomEndpoint
            ? "baseURL"
            : "imageModel"
      );
      window.requestAnimationFrame(() => {
        const fieldId = !normalized.apiKey
          ? "image-provider-key"
          : missingCustomEndpoint
            ? "image-provider-endpoint"
            : "image-provider-model";
        document.getElementById(fieldId)?.focus();
      });
      return;
    }

    setSavedConfig(normalized);
    setDraft(normalized);
    setError(null);
    setErrorField(null);
    setSuccessMessage(
      "生图 API 配置已保存，首次出图时会验证真实模型能力；不会影响策划 API，刷新后需重新输入 Key。"
    );
  }, [draft, setSavedConfig]);

  const handleReset = useCallback(() => {
    resetSavedConfig();
    setDraft(createImageProviderDraft());
    setError(null);
    setErrorField(null);
    setSuccessMessage("生图 API Key 与已保留的供应商配置均已清除。");
  }, [resetSavedConfig]);

  return (
    <WorkspaceDialog
      id="image-api-settings-dialog"
      open={open}
      onClose={onClose}
      title="生图 API 设置"
      description="单独配置图片生成供应商，与产品识别和视觉策划模型自由组合。"
      closeLabel="关闭生图 API 设置"
      icon={ImagePlus}
      size="medium"
    >
      {!mounted ? (
        <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
          正在读取生图配置...
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {legacyKeyMigrated ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="leading-6">
                旧版生图 API Key 已从浏览器持久化记录中移除；本次页面打开期间仍可继续使用。
              </p>
            </div>
          ) : null}
          <ImageProviderConfigForm
            config={draft}
            hasSavedConfig={hasSavedConfig}
            hasRetainedMetadata={hasRetainedMetadata}
            isDraftSaved={isDraftSaved}
            error={error}
            errorField={errorField}
            successMessage={successMessage}
            onChange={handleChange}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={!hasRetainedMetadata}
              className="sm:mr-auto"
            >
              <Trash2 className="h-4 w-4" />
              清除生图配置
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="button" onClick={handleSave} className="ai-gradient-button">
              <Save className="h-4 w-4" />
              保存生图配置
            </Button>
          </div>
        </div>
      )}
    </WorkspaceDialog>
  );
}
