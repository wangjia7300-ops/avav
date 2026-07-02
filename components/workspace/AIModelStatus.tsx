"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Loader2, PlugZap, ServerCrash, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProviderCapabilities } from "@/lib/ai-providers";
import { useProviderStore } from "@/lib/provider-store";

type Capability = {
  id: string;
  name: string;
  description: string;
};

type ModelStatus = {
  mode: "mock" | "openai";
  ready: boolean;
  hasOpenAIKey: boolean;
  model: string;
  capabilities: Capability[];
  message: string;
};

type ApiResponse = { success: true; data: ModelStatus } | { success: false; error: string };

type LoadState = "idle" | "loading" | "success" | "error";

export function AIModelStatus() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const { config, isConfigured } = useProviderStore();
  const hasBrowserProvider = mounted && isConfigured && Boolean(config?.apiKey && config.model);
  const browserCapabilities = hasBrowserProvider ? getProviderCapabilities(config) : null;
  const effectiveMode = hasBrowserProvider || status?.mode === "openai" ? "openai" : "mock";
  const effectiveReady = hasBrowserProvider || Boolean(status?.ready);
  const effectiveModel = hasBrowserProvider ? config?.model : status?.model;

  async function testModelStatus() {
    setLoadState("loading");
    setError(null);

    try {
      const providerConfig = useProviderStore.getState().getActiveConfig();
      const response = await fetch("/api/ai-model/test", {
        method: providerConfig ? "POST" : "GET",
        headers: providerConfig
          ? {
              "Content-Type": "application/json"
            }
          : undefined,
        body: providerConfig ? JSON.stringify({ providerConfig }) : undefined
      });
      const payload = (await response.json()) as ApiResponse;

      if (!response.ok || !payload.success) {
        throw new Error("error" in payload ? payload.error : "模型配置测试失败。");
      }

      setStatus(payload.data);
      setLoadState("success");
    } catch (requestError) {
      setLoadState("error");
      setError(requestError instanceof Error ? requestError.message : "模型配置测试失败。");
    }
  }

  useEffect(() => {
    setMounted(true);
    void testModelStatus();
  }, []);

  const isLoading = loadState === "loading";
  const isReady = effectiveReady;

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4 text-primary" />
              AI 模型能力
            </CardTitle>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              MVP 首测模块：先用一张小图确认模型链路和图片理解能力，再上传产品图开始分析。
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={isLoading} onClick={testModelStatus}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            测试模型配置
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-medium text-muted-foreground">当前模式</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={effectiveMode === "openai" ? "default" : "secondary"}>
                {effectiveMode === "openai" ? "真实模型" : "Mock 演示"}
              </Badge>
            </div>
          </div>
          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-medium text-muted-foreground">API 配置</p>
            <div className="mt-2 flex items-center gap-2">
              {hasBrowserProvider ? (
                <Badge variant="success">页面已配置</Badge>
              ) : status?.hasOpenAIKey ? (
                <Badge variant="success">服务端已配置</Badge>
              ) : (
                <Badge variant="secondary">未配置</Badge>
              )}
            </div>
          </div>
          <div className="rounded-md border bg-white p-3">
            <p className="text-xs font-medium text-muted-foreground">识别模型</p>
            <p className="mt-2 truncate text-sm font-semibold text-slate-950">{effectiveModel ?? "-"}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {(browserCapabilities
            ? [
                {
                  id: "vision",
                  name: browserCapabilities.supportsVision ? "支持图片识别" : "不支持图片识别",
                  description: browserCapabilities.supportsVision
                    ? "可以执行产品图识别。"
                    : "开始分析会被拦截，请更换视觉模型。"
                },
                {
                  id: "structured",
                  name: browserCapabilities.supportsStructuredOutput ? "支持结构化输出" : "结构化输出需兜底",
                  description: browserCapabilities.supportsStructuredOutput
                    ? "适合输出固定 JSON。"
                    : "会使用提示词约束与宽松解析，失败时给出可读错误。"
                },
                {
                  id: "web",
                  name: "真实搜索已关闭",
                  description: "不会调用搜索 API 或模型联网插件；市场验证按 AI 推断与用户资料处理。"
                }
              ]
            : status?.capabilities ?? []
          ).map((capability) => (
            <div key={capability.id} className="rounded-md border bg-slate-50/70 p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </span>
                <p className="text-sm font-semibold text-slate-950">{capability.name}</p>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{capability.description}</p>
            </div>
          ))}
        </div>

        <div
          className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
            loadState === "error" || !isReady
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {loadState === "error" || !isReady ? (
            <ServerCrash className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="leading-6">
            {error ??
              (hasBrowserProvider
                ? `页面 API 已配置，开始分析时会优先使用 ${config?.providerId}/${config?.model}。`
                : status?.message ?? "正在读取模型状态...")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
