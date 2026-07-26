"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FlaskConical,
  Globe,
  Image as ImageIcon,
  Key,
  Loader2,
  Rocket,
  ShieldAlert
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRESET_PROVIDERS } from "@/lib/ai-providers";
import type { ModelTestPhase } from "@/components/workspace/AIModelStatus";
import type { AIProviderConfig, AIProviderId } from "@/lib/types";

export function createProviderDraft(providerId: AIProviderId): AIProviderConfig {
  const preset = PRESET_PROVIDERS.find((provider) => provider.id === providerId);

  return {
    providerId,
    apiKey: "",
    baseURL: preset?.baseURL ?? "",
    model: preset?.models[0] ?? ""
  };
}

export function normalizeProviderConfig(config: AIProviderConfig): AIProviderConfig {
  return {
    providerId: config.providerId,
    apiKey: config.apiKey.trim(),
    baseURL: config.baseURL.trim(),
    model: config.model.trim(),
    displayName: config.displayName
  };
}

export function isProviderConfigComplete(config: AIProviderConfig) {
  const normalized = normalizeProviderConfig(config);
  const hasRequiredFields = Boolean(normalized.apiKey && normalized.model);

  if (!hasRequiredFields) return false;
  if (normalized.providerId !== "custom") return true;

  return /^https:\/\//i.test(normalized.baseURL);
}

export function providerConfigSignature(config: AIProviderConfig) {
  const normalized = normalizeProviderConfig(config);

  return [
    normalized.providerId,
    normalized.baseURL,
    normalized.model,
    normalized.apiKey
  ].join("\u0000");
}

type AIProviderConfigProps = {
  config: AIProviderConfig;
  phase: ModelTestPhase;
  hasSavedConfig: boolean;
  isDraftSaved: boolean;
  onChange: (config: AIProviderConfig) => void;
  onAutoTest: (config: AIProviderConfig) => void;
  onReset: () => void;
};

export function AIProviderConfig({
  config,
  phase,
  hasSavedConfig,
  isDraftSaved,
  onChange,
  onAutoTest,
  onReset
}: AIProviderConfigProps) {
  const [showKey, setShowKey] = useState(false);
  const selectedProviderId = config.providerId;
  const selectedPreset = PRESET_PROVIDERS.find((provider) => provider.id === selectedProviderId);
  const isCustom = selectedProviderId === "custom";
  const isTesting = phase === "testing";
  const selectedVisionVariant =
    selectedPreset?.visionSupport === "supported"
      ? "success"
      : selectedPreset?.visionSupport === "not_supported"
        ? "secondary"
        : "violet";

  const status = isTesting
    ? { label: "自动测试中", variant: "violet" as const, icon: Loader2 }
    : phase === "verified" && isDraftSaved
      ? { label: "已验证", variant: "success" as const, icon: CheckCircle2 }
      : phase === "failed"
        ? { label: "测试失败", variant: "secondary" as const, icon: ShieldAlert }
        : hasSavedConfig && !isDraftSaved
          ? { label: "修改待验证", variant: "violet" as const, icon: FlaskConical }
          : hasSavedConfig
            ? { label: "已保存 · 待验证", variant: "default" as const, icon: FlaskConical }
            : { label: "待配置", variant: "secondary" as const, icon: FlaskConical };
  const StatusIcon = status.icon;

  function updateConfig(patch: Partial<AIProviderConfig>) {
    onChange({ ...config, ...patch });
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Rocket className="h-4 w-4 text-primary" />
              AI 供应商配置
            </CardTitle>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              填完整配置后，离开输入框会自动测试；只有测试通过的配置才会保存到浏览器。
            </p>
          </div>
          <Badge variant={status.variant} className="h-fit gap-1">
            <StatusIcon className={isTesting ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
            {status.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="ai-provider-select" className="text-xs font-semibold text-slate-950">
            供应商
          </label>
          <div className="relative">
            <select
              id="ai-provider-select"
              value={selectedProviderId}
              disabled={isTesting}
              onChange={(event) =>
                onChange(createProviderDraft(event.target.value as AIProviderId))
              }
              className="w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            >
              {PRESET_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {selectedPreset ? (
            <div className="space-y-2">
              <p className="text-xs leading-5 text-muted-foreground">{selectedPreset.description}</p>
              <Badge variant={selectedVisionVariant} className="gap-1">
                <ImageIcon className="h-3 w-3" />
                {selectedPreset.visionNote}
              </Badge>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="ai-provider-key"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-950"
          >
            <Key className="h-3.5 w-3.5" />
            API Key
          </label>
          <div className="relative">
            <input
              id="ai-provider-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              value={config.apiKey}
              disabled={isTesting}
              onChange={(event) => updateConfig({ apiKey: event.target.value })}
              onBlur={(event) => onAutoTest({ ...config, apiKey: event.currentTarget.value })}
              placeholder={
                selectedProviderId === "openai"
                  ? "sk-..."
                  : selectedProviderId === "anthropic"
                    ? "sk-ant-..."
                    : "输入 API Key"
              }
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowKey((visible) => !visible)}
              aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {isCustom ? (
          <div className="space-y-2">
            <label
              htmlFor="ai-provider-endpoint"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-950"
            >
              <Globe className="h-3.5 w-3.5" />
              API Endpoint
            </label>
            <input
              id="ai-provider-endpoint"
              type="url"
              value={config.baseURL}
              disabled={isTesting}
              onChange={(event) => updateConfig({ baseURL: event.target.value })}
              onBlur={(event) => onAutoTest({ ...config, baseURL: event.currentTarget.value })}
              placeholder="https://api.example.com/v1"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              仅支持 HTTPS 的 OpenAI 兼容 Endpoint。火山方舟 ep-... 是接入点 ID，应填到“模型”字段。
            </p>
            {config.baseURL && !/^https:\/\//i.test(config.baseURL.trim()) ? (
              <p className="text-xs font-medium text-red-600">Endpoint 必须以 https:// 开头。</p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="ai-provider-model"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-950"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            模型
          </label>
          {selectedPreset && selectedPreset.models.length > 0 && !isCustom ? (
            <div className="relative">
              <select
                id="ai-provider-model"
                value={config.model || selectedPreset.models[0]}
                disabled={isTesting}
                onChange={(event) => {
                  const nextConfig = { ...config, model: event.target.value };
                  onChange(nextConfig);
                  onAutoTest(nextConfig);
                }}
                className="w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              >
                {selectedPreset.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                    {model.includes("4v")
                      ? "（支持图片）"
                      : selectedPreset.visionSupport === "not_supported"
                        ? "（文本）"
                        : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          ) : (
            <input
              id="ai-provider-model"
              type="text"
              value={config.model}
              disabled={isTesting}
              onChange={(event) => updateConfig({ model: event.target.value })}
              onBlur={(event) => onAutoTest({ ...config, model: event.currentTarget.value })}
              placeholder="输入模型名称或火山方舟 ep-... 接入点 ID"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          )}
        </div>

        {selectedPreset?.visionSupport === "not_supported" ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            当前预设模型不支持产品图片识别，自动测试预计无法通过。请改用视觉模型。
          </div>
        ) : null}

        <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            API Key 仅通过 HTTPS 发送到服务端进行测试；测试通过后保存在当前浏览器，不会写入项目文件或服务端数据库。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onReset} disabled={isTesting}>
            重置为服务端配置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
