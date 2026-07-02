"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Code2, Loader2, Plug, ServerCrash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AIProviderConfig } from "@/components/workspace/AIProviderConfig";
import { getProviderCapabilities } from "@/lib/ai-providers";
import { useProviderStore } from "@/lib/provider-store";

type EnvItem = {
  key: string;
  configured: boolean;
  value: string;
  description: string;
};

type RouteItem = {
  method: string;
  path: string;
  name: string;
  status: "ready" | "mock";
  description: string;
};

type ProviderInfo = {
  id: string;
  name: string;
  models: string[];
  description: string;
};

type IntegrationStatus = {
  mode: "mock" | "real";
  provider: string;
  ready: boolean;
  supportsCustomProvider?: boolean;
  providers?: ProviderInfo[];
  env: EnvItem[];
  routes: RouteItem[];
  setupSteps: string[];
};

type ApiResponse =
  | {
      success: true;
      data: IntegrationStatus;
    }
  | {
      success: false;
      error: string;
    };

export function APIIntegrationPanel() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const { config, isConfigured } = useProviderStore();
  const hasBrowserProvider = mounted && isConfigured && Boolean(config?.apiKey && config.model);
  const providerCapabilities = hasBrowserProvider ? getProviderCapabilities(config) : null;
  const searchEnabled = false;
  const effectiveMode = hasBrowserProvider || status?.mode === "real" ? "real" : "mock";
  const effectiveReady = hasBrowserProvider || Boolean(status?.ready);
  const activeProviderLabel = hasBrowserProvider
    ? `${config?.providerId ?? "custom"} / ${config?.model ?? "未选择模型"}`
    : status?.provider ?? "OpenAI Responses API";

  async function loadStatus() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/api-integrations");
      const payload = (await response.json()) as ApiResponse;

      if (!response.ok || !payload.success) {
        throw new Error("error" in payload ? payload.error : "API 接入状态读取失败。");
      }

      setStatus(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "API 接入状态读取失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setMounted(true);
    void loadStatus();
  }, []);

  return (
    <div className="space-y-4">
      {/* Status overview */}
      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Plug className="h-4 w-4 text-primary" />
                API 接口接入
              </CardTitle>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
              面向 MVP 首测：外部模型调用通过服务端 API Route；真实搜索当前关闭，页面配置仅保存在当前页面会话内存中。
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={isLoading} onClick={loadStatus}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Code2 className="h-4 w-4" />}
              检查接入
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border bg-white p-3">
              <p className="text-xs font-medium text-muted-foreground">调用模式</p>
              <div className="mt-2">
                <Badge variant={effectiveMode === "real" ? "default" : "secondary"}>
                  {effectiveMode === "real" ? "真实 API" : "Mock 模式"}
                </Badge>
              </div>
            </div>
            <div className="rounded-md border bg-white p-3">
              <p className="text-xs font-medium text-muted-foreground">当前实际调用</p>
              <p className="mt-2 truncate text-sm font-semibold text-slate-950">
                {effectiveMode === "real" ? activeProviderLabel : "Mock 数据"}
              </p>
            </div>
            <div className="rounded-md border bg-white p-3">
              <p className="text-xs font-medium text-muted-foreground">接入状态</p>
              <div className="mt-2">
                <Badge variant={effectiveReady ? "success" : "secondary"}>
                  {effectiveReady ? "可测试" : "待配置"}
                </Badge>
              </div>
            </div>
          </div>

          {effectiveMode === "mock" ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              当前不会调用真实 AI 模型。请在下方「AI 供应商配置」里填写 API Key 和模型，或把
              <span className="mx-1 font-mono">NEXT_PUBLIC_USE_MOCK</span>
              改为
              <span className="mx-1 font-mono">false</span>
              并配置服务端 Key。
            </div>
          ) : hasBrowserProvider ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
              已检测到页面 API 配置。点击「开始分析」时会优先使用
              <span className="mx-1 font-semibold">{activeProviderLabel}</span>
              进行产品识别、视觉方案和提示词生成。
              真实搜索当前关闭，市场卖点阶段不会调用搜索 API 或模型联网插件。
            </div>
          ) : null}

          {providerCapabilities ? (
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                ["图片识别", providerCapabilities.supportsVision],
                ["结构化输出", providerCapabilities.supportsStructuredOutput],
                ["真实搜索", searchEnabled],
                ["长上下文", providerCapabilities.supportsLongContext]
              ].map(([label, enabled]) => (
                <div key={String(label)} className="rounded-md border bg-white px-3 py-2 text-xs">
                  <span className={enabled ? "text-emerald-700" : "text-slate-500"}>
                    {enabled ? "支持" : "未启用"}
                  </span>
                  <span className="ml-1 text-slate-700">{label}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            {(status?.env ?? []).map((item) => (
              <div key={item.key} className="rounded-md border bg-slate-50/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-950">{item.key}</p>
                  <Badge variant={item.configured ? "success" : "secondary"}>{item.value}</Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-950">已接入的服务端接口</p>
            <div className="grid gap-2">
              {(status?.routes ?? []).map((route) => (
                <div key={route.path} className="rounded-md border bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={route.status === "ready" ? "default" : "secondary"}>{route.method}</Badge>
                    <span className="font-mono text-xs text-slate-700">{route.path}</span>
                    <span className="text-sm font-semibold text-slate-950">{route.name}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{route.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
              error || !effectiveReady ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {error || !effectiveReady ? (
              <ServerCrash className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <p className="leading-6">
              {error ??
                (status?.ready
                  ? effectiveMode === "real"
                    ? "真实 API 已接入，下一次分析会使用模型生成结果。"
                    : "Mock 流程可测试；如需真实分析，请先完成 API 配置。"
                  : `配置步骤：${status?.setupSteps.join(" ") ?? "请检查 .env.local。"}`)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Custom AI Provider Configuration */}
      <AIProviderConfig />
      <Card className="border-dashed shadow-none">
        <CardContent className="px-4 py-3 text-xs leading-5 text-muted-foreground">
          真实搜索已关闭：本版本不会读取 SerpAPI、Firecrawl，也不会调用豆包/火山方舟联网搜索插件。市场洞察仅使用产品识别、用户补充资料和 AI 策划推断。
        </CardContent>
      </Card>
    </div>
  );
}
