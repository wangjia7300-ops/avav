"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImagePlus, Save } from "lucide-react";
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
  const setSavedConfig = useImageProviderStore((state) => state.setConfig);
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
    setSuccessMessage("生图 API 配置已独立保存，不会影响策划 API。首次生成时将验证模型连通性。");
  }, [draft, setSavedConfig]);

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
          <ImageProviderConfigForm
            config={draft}
            hasSavedConfig={hasSavedConfig}
            isDraftSaved={isDraftSaved}
            error={error}
            errorField={errorField}
            successMessage={successMessage}
            onChange={handleChange}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
