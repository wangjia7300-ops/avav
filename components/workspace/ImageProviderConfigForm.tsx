"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Globe,
  ImagePlus,
  Key,
  Layers3,
  ShieldCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createImageProviderDraft,
  getImageProviderPreset,
  IMAGE_PROVIDER_PRESETS
} from "@/lib/image-providers";
import type { ImageProviderConfig, ImageProviderId } from "@/lib/types";

type ImageProviderConfigFormProps = {
  config: ImageProviderConfig;
  hasSavedConfig: boolean;
  hasRetainedMetadata: boolean;
  isDraftSaved: boolean;
  error: string | null;
  errorField: "apiKey" | "baseURL" | "imageModel" | null;
  successMessage: string | null;
  onChange: (config: ImageProviderConfig) => void;
};

export function ImageProviderConfigForm({
  config,
  hasSavedConfig,
  hasRetainedMetadata,
  isDraftSaved,
  error,
  errorField,
  successMessage,
  onChange
}: ImageProviderConfigFormProps) {
  const [showKey, setShowKey] = useState(false);
  const selectedPreset = getImageProviderPreset(config.providerId);
  const isCustom = config.providerId === "custom";
  const status = isDraftSaved
    ? { label: "已保存 · 尚未出图验证", variant: "success" as const, icon: CheckCircle2 }
    : hasSavedConfig
      ? { label: "修改未保存", variant: "violet" as const, icon: Layers3 }
      : hasRetainedMetadata
        ? { label: "配置已保留 · 需输入 Key", variant: "violet" as const, icon: Key }
      : { label: "待配置", variant: "secondary" as const, icon: ImagePlus };
  const StatusIcon = status.icon;

  function updateConfig(patch: Partial<ImageProviderConfig>) {
    onChange({ ...config, ...patch });
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ImagePlus className="h-4 w-4 text-primary" />
              生图 API 配置
            </CardTitle>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              这套配置只用于提示词旁的单张生图和“全部生图”，不会读取或修改策划 API。
            </p>
          </div>
          <Badge variant={status.variant} className="h-fit gap-1">
            <StatusIcon className="h-3 w-3" />
            {status.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 text-xs leading-5 text-violet-800">
          <p className="font-semibold">支持组合配置</p>
          <p className="mt-1">
            策划模型和生图模型可选择不同供应商、不同 API Key 与不同 Endpoint。
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="image-provider-select" className="text-xs font-semibold text-slate-950">
            生图供应商
          </label>
          <div className="relative">
            <select
              id="image-provider-select"
              value={config.providerId}
              onChange={(event) =>
                onChange(createImageProviderDraft(event.target.value as ImageProviderId))
              }
              className="w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {IMAGE_PROVIDER_PRESETS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {selectedPreset ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {selectedPreset.description}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="image-provider-key"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-950"
          >
            <Key className="h-3.5 w-3.5" />
            生图 API Key
          </label>
          <div className="relative">
            <input
              id="image-provider-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              value={config.apiKey}
              onChange={(event) => updateConfig({ apiKey: event.target.value })}
              aria-invalid={errorField === "apiKey"}
              aria-describedby={errorField === "apiKey" ? "image-provider-error" : undefined}
              placeholder={config.providerId === "openai" ? "sk-..." : "输入生图 API Key"}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setShowKey((visible) => !visible)}
              aria-label={showKey ? "隐藏生图 API Key" : "显示生图 API Key"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {isCustom ? (
          <div className="space-y-2">
            <label
              htmlFor="image-provider-endpoint"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-950"
            >
              <Globe className="h-3.5 w-3.5" />
              生图 API Endpoint
            </label>
            <input
              id="image-provider-endpoint"
              type="url"
              value={config.baseURL}
              onChange={(event) => updateConfig({ baseURL: event.target.value })}
              aria-invalid={errorField === "baseURL"}
              aria-describedby={errorField === "baseURL" ? "image-provider-error" : undefined}
              placeholder="https://api.example.com/v1"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              仅支持公开 HTTPS 地址，系统会自动拼接 /images/generations。
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="image-provider-model"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-950"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            生图模型
          </label>
          <input
            id="image-provider-model"
            type="text"
            value={config.imageModel}
            onChange={(event) => updateConfig({ imageModel: event.target.value })}
            aria-invalid={errorField === "imageModel"}
            aria-describedby={errorField === "imageModel" ? "image-provider-error" : undefined}
            placeholder={selectedPreset?.modelPlaceholder ?? "输入生图模型"}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="text-xs leading-5 text-muted-foreground">
            生图调用可能产生费用，因此保存时不会自动出图；模型会在首次生成时验证。
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            API Key 仅保存在当前页面内存，刷新或关闭页面后清除；供应商、模型和 Endpoint 会作为非敏感配置保留。
          </p>
        </div>

        {error ? (
          <div id="image-provider-error" role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : successMessage ? (
          <div role="status" aria-live="polite" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
