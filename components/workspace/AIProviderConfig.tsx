"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FlaskConical,
  Globe,
  Key,
  Rocket,
  ShieldAlert,
  Image
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRESET_PROVIDERS } from "@/lib/ai-providers";
import { useProviderStore } from "@/lib/provider-store";
import type { AIProviderId } from "@/lib/types";

export function AIProviderConfig() {
  const { config, isConfigured, selectPreset, setApiKey, setBaseURL, setModel, resetConfig } =
    useProviderStore();

  const [showKey, setShowKey] = useState(false);
  const [mounted, setMounted] = useState(false);

  // API 配置只保存在当前页面内存中，顺手清理旧版本留下的本地存储。
  useEffect(() => {
    window.localStorage.removeItem("ai-provider-config");
    window.localStorage.removeItem("search-provider-config");
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Rocket className="h-4 w-4 text-primary" />
            AI 供应商配置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">加载中...</p>
        </CardContent>
      </Card>
    );
  }

  const selectedProviderId = config?.providerId ?? "openai";
  const selectedPreset = PRESET_PROVIDERS.find((p) => p.id === selectedProviderId);
  const isCustom = selectedProviderId === "custom";
  const selectedVisionVariant =
    selectedPreset?.visionSupport === "supported"
      ? "success"
      : selectedPreset?.visionSupport === "not_supported"
        ? "secondary"
        : "violet";

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
              选择 AI 模型供应商并配置 API Key。配置仅在当前页面会话内存中使用，刷新页面后不会保留。
            </p>
          </div>
          {isConfigured ? (
            <Badge variant="success" className="h-fit gap-1">
              <CheckCircle2 className="h-3 w-3" />
              已配置
            </Badge>
          ) : (
            <Badge variant="secondary" className="h-fit">
              未配置
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Provider selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-950">供应商</label>
          <div className="relative">
            <select
              value={selectedProviderId}
              onChange={(e) => selectPreset(e.target.value as AIProviderId)}
              className="w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {PRESET_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {selectedPreset && (
            <div className="space-y-2">
              <p className="text-xs leading-5 text-muted-foreground">{selectedPreset.description}</p>
              <Badge variant={selectedVisionVariant} className="gap-1">
                <Image className="h-3 w-3" />
                {selectedPreset.visionNote}
              </Badge>
            </div>
          )}
        </div>

        {/* API Key */}
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-950">
            <Key className="h-3.5 w-3.5" />
            API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={config?.apiKey ?? ""}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                selectedProviderId === "openai"
                  ? "sk-..."
                  : selectedProviderId === "anthropic"
                    ? "sk-ant-..."
                    : "输入 API Key"
              }
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
              tabIndex={-1}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Custom base URL */}
        {isCustom && (
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-950">
              <Globe className="h-3.5 w-3.5" />
              API Endpoint
            </label>
            <input
              type="url"
              value={config?.baseURL ?? ""}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              可输入 OpenAI 兼容 base URL，也支持完整 Responses endpoint，例如
              https://ark.cn-beijing.volces.com/api/v3/responses。
              火山方舟的 ep-... 是接入点 ID，不是 URL，请优先填到「模型」字段。
            </p>
          </div>
        )}

        {/* Model selector */}
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-950">
            <FlaskConical className="h-3.5 w-3.5" />
            模型
          </label>
          {selectedPreset && selectedPreset.models.length > 0 && !isCustom ? (
            <div className="relative">
              <select
                value={config?.model ?? selectedPreset.models[0]}
                onChange={(e) => setModel(e.target.value)}
                className="w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {selectedPreset.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                    {model.includes("4v") ? "（支持图片）" : selectedPreset.visionSupport === "not_supported" ? "（文本）" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          ) : (
            <input
              type="text"
              value={config?.model ?? ""}
              onChange={(e) => setModel(e.target.value)}
              placeholder="输入模型名称或火山方舟 ep-... 接入点 ID"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}
        </div>

        {selectedPreset?.visionSupport === "not_supported" ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            当前供应商预设主要用于文本任务，产品图片识别会失败。请换用 OpenAI、Anthropic、火山方舟视觉接入点或 GLM 视觉模型。
          </div>
        ) : null}

        {/* Security note */}
        <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            API Key 通过 HTTPS 发送到服务端，不写入 localStorage、不落盘存储；仅保存在当前页面内存中。
            请勿在公共电脑上长时间停留已填写页面。
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetConfig}
            disabled={!config}
          >
            重置为服务端配置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
