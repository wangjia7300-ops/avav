"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCcw,
  Server,
  Settings2,
  ShieldCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AIProviderConfig,
  createProviderDraft,
  isProviderConfigComplete,
  normalizeProviderConfig,
  providerConfigSignature
} from "@/components/workspace/AIProviderConfig";
import {
  AIModelStatus,
  type ModelTestPhase,
  type ModelTestResult
} from "@/components/workspace/AIModelStatus";
import { WorkspaceDialog } from "@/components/workspace/WorkspaceDialog";
import { useProviderStore } from "@/lib/provider-store";
import type { AIProviderConfig as AIProviderConfigValue } from "@/lib/types";

type APISettingsDialogProps = {
  open: boolean;
  onClose: () => void;
};

type ModelTestFailure = {
  message: string;
  code?: string;
  field?: "apiKey" | "model" | "baseURL";
  retryable?: boolean;
};

type ModelTestApiResponse =
  | { success: true; data: ModelTestResult }
  | ({ success: false; error: string } & Omit<ModelTestFailure, "message">);

type ServerModelStatus = {
  ready: boolean;
  providerId: string | null;
  model: string | null;
  message: string;
};

const fieldElementIds: Record<NonNullable<ModelTestFailure["field"]>, string> = {
  apiKey: "ai-provider-key",
  model: "ai-provider-model",
  baseURL: "ai-provider-endpoint"
};

function fallbackFailure(message = "模型连接测试失败，请检查配置后重试。"): ModelTestFailure {
  return { message, retryable: true };
}

export function APISettingsDialog({ open, onClose }: APISettingsDialogProps) {
  const savedConfig = useProviderStore((state) => state.config);
  const hasSavedProvider = useProviderStore((state) => state.isConfigured);
  const setSavedConfig = useProviderStore((state) => state.setConfig);
  const resetSavedConfig = useProviderStore((state) => state.resetConfig);
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState<AIProviderConfigValue>(() => createProviderDraft("openai"));
  const [phase, setPhase] = useState<ModelTestPhase>("idle");
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [failure, setFailure] = useState<ModelTestFailure | null>(null);
  const [showErrorView, setShowErrorView] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerModelStatus | null>(null);
  const [serverStatusLoading, setServerStatusLoading] = useState(true);
  const initializedRef = useRef(false);
  const mountedRef = useRef(false);
  const dirtyRef = useRef(false);
  const draftRef = useRef(draft);
  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const autoTestTimerRef = useRef<number | null>(null);
  const lastAutoTestSignatureRef = useRef<string | null>(null);
  const testingServerRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);

    if (!initializedRef.current) {
      const initialDraft = useProviderStore.getState().config ?? createProviderDraft("openai");
      initializedRef.current = true;
      draftRef.current = initialDraft;
      setDraft(initialDraft);
    }

    void fetch("/api/ai-model/test", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { success: true; data: ServerModelStatus }
          | null;
        if (mountedRef.current && response.ok && payload?.success) {
          setServerStatus(payload.data);
        }
      })
      .finally(() => {
        if (mountedRef.current) setServerStatusLoading(false);
      });

    return () => {
      mountedRef.current = false;
      requestControllerRef.current?.abort();
      if (autoTestTimerRef.current !== null) {
        window.clearTimeout(autoTestTimerRef.current);
      }
    };
  }, []);

  const hasSavedConfig = Boolean(hasSavedProvider && savedConfig);
  const isDraftSaved = useMemo(
    () =>
      Boolean(
        hasSavedProvider &&
          savedConfig &&
          providerConfigSignature(savedConfig) === providerConfigSignature(draft)
      ),
    [draft, hasSavedProvider, savedConfig]
  );
  const canTest = isProviderConfigComplete(draft);

  const clearAutoTestTimer = useCallback(() => {
    if (autoTestTimerRef.current !== null) {
      window.clearTimeout(autoTestTimerRef.current);
      autoTestTimerRef.current = null;
    }
  }, []);

  const showFailure = useCallback((nextFailure: ModelTestFailure) => {
    if (!mountedRef.current) return;
    setFailure(nextFailure);
    setPhase("failed");
    setShowErrorView(true);
  }, []);

  const runModelTest = useCallback(
    async (candidate: AIProviderConfigValue | null, source: "auto" | "manual") => {
      const normalizedCandidate = candidate ? normalizeProviderConfig(candidate) : null;
      testingServerRef.current = normalizedCandidate === null;

      if (normalizedCandidate && !isProviderConfigComplete(normalizedCandidate)) {
        showFailure({
          message:
            normalizedCandidate.providerId === "custom"
              ? "请完整填写 API Key、模型和以 https:// 开头的 Endpoint。"
              : "请完整填写 API Key 和模型后再测试。",
          field: normalizedCandidate.apiKey ? "model" : "apiKey",
          retryable: false
        });
        return;
      }

      const signature = normalizedCandidate
        ? providerConfigSignature(normalizedCandidate)
        : "__server_config__";
      if (source === "auto" && lastAutoTestSignatureRef.current === signature) return;

      clearAutoTestTimer();
      lastAutoTestSignatureRef.current = signature;
      requestControllerRef.current?.abort();

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const controller = new AbortController();
      requestControllerRef.current = controller;
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 125_000);

      setShowErrorView(false);
      setFailure(null);
      setResult(null);
      setPhase("testing");

      try {
        const response = await fetch("/api/ai-model/test", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(
            normalizedCandidate ? { providerConfig: normalizedCandidate } : {}
          ),
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => null)) as ModelTestApiResponse | null;

        if (requestId !== requestIdRef.current || !mountedRef.current) return;

        if (!response.ok || !payload?.success) {
          showFailure(
            payload && !payload.success
              ? {
                  message: payload.error,
                  code: payload.code,
                  field: payload.field,
                  retryable: payload.retryable
                }
              : fallbackFailure()
          );
          return;
        }

        if (normalizedCandidate) {
          dirtyRef.current = false;
          draftRef.current = normalizedCandidate;
          setDraft(normalizedCandidate);
          setSavedConfig(normalizedCandidate);
        }
        setResult(payload.data);
        setPhase("verified");
      } catch (requestError) {
        if (requestId !== requestIdRef.current || !mountedRef.current) return;
        if (requestError instanceof DOMException && requestError.name === "AbortError" && !timedOut) {
          return;
        }

        showFailure(
          fallbackFailure(
            timedOut
              ? "模型测试超时，请检查网络、Endpoint 或模型接入点后重试。"
              : "无法连接模型测试服务，请检查网络后重试。"
          )
        );
      } finally {
        window.clearTimeout(timeoutId);
        if (requestId === requestIdRef.current) {
          requestControllerRef.current = null;
        }
      }
    },
    [clearAutoTestTimer, setSavedConfig, showFailure]
  );

  const handleDraftChange = useCallback(
    (nextDraft: AIProviderConfigValue) => {
      clearAutoTestTimer();
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      requestIdRef.current += 1;
      dirtyRef.current = true;
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setResult(null);
      setFailure(null);
      setPhase("editing");
    },
    [clearAutoTestTimer]
  );

  const handleAutoTest = useCallback(
    (candidate: AIProviderConfigValue) => {
      if (!dirtyRef.current || !isProviderConfigComplete(candidate)) return;

      const signature = providerConfigSignature(candidate);
      if (lastAutoTestSignatureRef.current === signature) return;

      clearAutoTestTimer();
      autoTestTimerRef.current = window.setTimeout(() => {
        autoTestTimerRef.current = null;
        void runModelTest(candidate, "auto");
      }, 650);
    },
    [clearAutoTestTimer, runModelTest]
  );

  const handleManualTest = useCallback(() => {
    void runModelTest(draftRef.current, "manual");
  }, [runModelTest]);

  const handleServerTest = useCallback(() => {
    resetSavedConfig();
    void runModelTest(null, "manual");
  }, [resetSavedConfig, runModelTest]);

  const handleReset = useCallback(() => {
    clearAutoTestTimer();
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    requestIdRef.current += 1;
    const initialDraft = createProviderDraft("openai");
    dirtyRef.current = false;
    draftRef.current = initialDraft;
    lastAutoTestSignatureRef.current = null;
    resetSavedConfig();
    setDraft(initialDraft);
    setPhase("idle");
    setResult(null);
    setFailure(null);
    setShowErrorView(false);
  }, [clearAutoTestTimer, resetSavedConfig]);

  const handleReturnToForm = useCallback(() => {
    setShowErrorView(false);
    setPhase("editing");
    window.requestAnimationFrame(() => {
      const fieldId = failure?.field ? fieldElementIds[failure.field] : "ai-provider-model";
      document.getElementById(fieldId)?.focus();
    });
  }, [failure?.field]);

  const handleRetry = useCallback(() => {
    setShowErrorView(false);
    void runModelTest(testingServerRef.current ? null : draftRef.current, "manual");
  }, [runModelTest]);

  const dialogTitle = showErrorView ? "模型连接失败" : "API 供应商设置";
  const dialogDescription = showErrorView
    ? testingServerRef.current
      ? "服务端配置已保留，请处理供应商账户状态后重试。"
      : "配置尚未保存。请检查 API Key、模型或 Endpoint 后重试。"
    : "配置 AI 模型供应商，并自动验证连接与图片理解能力。";

  return (
    <WorkspaceDialog
      id="api-settings-dialog"
      open={open}
      onClose={onClose}
      title={dialogTitle}
      description={dialogDescription}
      closeLabel={showErrorView ? "关闭模型连接错误" : "关闭 API 供应商设置"}
      icon={showErrorView ? AlertTriangle : Settings2}
      size="wide"
    >
      {!mounted ? (
        <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取本地配置...
        </div>
      ) : showErrorView && failure ? (
        <div role="alert" aria-live="assertive" className="mx-auto max-w-2xl py-4 sm:py-8">
          <div className="rounded-md border border-red-200 bg-white p-5 shadow-sm sm:p-7">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <h3 className="mt-5 text-xl font-semibold text-slate-950">当前模型暂时无法使用</h3>
            <p className="mt-2 break-words text-sm leading-6 text-red-700">{failure.message}</p>

            <div className="mt-5 rounded-xl bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">建议依次检查</p>
              {failure.code === "AI_PROVIDER_ACCOUNT_OVERDUE" ? (
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  当前 Key、Endpoint 与模型已成功到达 Ark；请先在火山方舟控制台结清逾期余额，再点击重新测试。
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <li>1. API Key 是否完整，并具有当前模型或接入点权限。</li>
                  <li>2. 官方模型名称或火山方舟 ep-... 接入点 ID 是否正确。</li>
                  <li>3. 当前模型是否支持图片理解；自定义 Endpoint 是否使用 HTTPS。</li>
                </ul>
              )}
            </div>

            {hasSavedConfig && !isDraftSaved ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <ShieldCheck className="mt-1 h-4 w-4 shrink-0" />
                <p className="leading-6">本次失败配置未保存，之前已保存的配置仍然保留。</p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={handleReturnToForm}>
                <ArrowLeft className="h-4 w-4" />
                返回修改
              </Button>
              <Button type="button" onClick={handleRetry} className="ai-gradient-button">
                <RefreshCcw className="h-4 w-4" />
                重新测试
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {serverStatusLoading ? (
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取服务端模型配置...
            </div>
          ) : serverStatus?.ready ? (
            <div className="flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-emerald-700">
                  <Server className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-900">
                    <CheckCircle2 className="h-4 w-4" />
                    服务端模型已载入
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-emerald-800">
                    {serverStatus.providerId}/{serverStatus.model}。浏览器配置留空时自动使用此模型。
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={phase === "testing"}
                onClick={handleServerTest}
                className="shrink-0 border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100"
              >
                {phase === "testing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
                测试服务端配置
              </Button>
            </div>
          ) : null}
          <AIProviderConfig
            config={draft}
            phase={phase}
            hasSavedConfig={hasSavedConfig}
            isDraftSaved={isDraftSaved}
            onChange={handleDraftChange}
            onAutoTest={handleAutoTest}
            onReset={handleReset}
          />
          <AIModelStatus
            config={draft}
            phase={phase}
            result={result}
            error={failure?.message ?? null}
            hasSavedConfig={hasSavedConfig}
            isDraftSaved={isDraftSaved}
            canTest={canTest}
            onTest={handleManualTest}
          />
        </div>
      )}
    </WorkspaceDialog>
  );
}
