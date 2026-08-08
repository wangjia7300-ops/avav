"use client";

import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Loader2,
  PlugZap,
  Sparkles
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AIProviderConfig } from "@/lib/types";

export type ModelTestPhase = "idle" | "editing" | "testing" | "verified" | "failed";

type ModelCapability = {
  id: string;
  name: string;
  description: string;
};

export type ModelTestResult = {
  mode: "real";
  ready: boolean;
  providerId?: string | null;
  model: string;
  capabilities: ModelCapability[];
  message: string;
};

const defaultCapabilities: ModelCapability[] = [
  {
    id: "product_vision",
    name: "产品图片识别",
    description: "识别品类、品牌文字、可见外观/结构/颜色和 OCR 候选声明。"
  },
  {
    id: "design_plan",
    name: "视觉策划生成",
    description: "生成电商画面方案，并避免夸大不可确认参数。"
  },
  {
    id: "image_prompts",
    name: "AI 绘画提示词",
    description: "输出 GPT 图像提示词和负面词。"
  }
];

type AIModelStatusProps = {
  config: AIProviderConfig;
  phase: ModelTestPhase;
  result: ModelTestResult | null;
  error: string | null;
  hasSavedConfig: boolean;
  hasRetainedMetadata: boolean;
  isDraftSaved: boolean;
  canTest: boolean;
  onTest: () => void;
};

function getConnectionCopy(
  phase: ModelTestPhase,
  canTest: boolean,
  hasRetainedMetadata: boolean,
  isDraftSaved: boolean,
  result: ModelTestResult | null,
  error: string | null
) {
  if (phase === "testing") {
    return "正在验证 API 连通性和图片理解能力，请保持弹窗打开。";
  }

  if (phase === "verified") {
    return result?.message ?? "模型连接与图片理解测试通过，本次页面打开期间可以使用。";
  }

  if (phase === "failed") {
    return error ?? "模型连接测试未通过，请返回检查配置。";
  }

  if (!canTest) {
    if (hasRetainedMetadata) {
      return "供应商、模型和 Endpoint 已保留；为保护密钥，请重新输入 API Key。";
    }
    return "请先完整填写 API Key、模型，以及自定义供应商的 HTTPS Endpoint。";
  }

  if (isDraftSaved) {
    return "当前配置已在本次页面打开期间启用。修改字段后会自动重新测试。";
  }

  return "配置填写完成；离开当前输入框后会自动测试，通过后在本次页面打开期间启用。";
}

export function AIModelStatus({
  config,
  phase,
  result,
  error,
  hasSavedConfig,
  hasRetainedMetadata,
  isDraftSaved,
  canTest,
  onTest
}: AIModelStatusProps) {
  const isTesting = phase === "testing";
  const isVerified = phase === "verified";
  const isFailed = phase === "failed";
  const capabilities = result?.capabilities?.length ? result.capabilities : defaultCapabilities;
  const connectionCopy = getConnectionCopy(
    phase,
    canTest,
    hasRetainedMetadata,
    isDraftSaved,
    result,
    error
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
            <Bot className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-950">AI 模型能力与连接状态</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              测试会发送一张极小图片，确认当前策划模型具备连接和图片理解能力。
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canTest || isTesting}
          onClick={onTest}
          className="shrink-0"
        >
          {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          {isTesting ? "正在测试" : isVerified || isFailed ? "重新测试" : "立即测试"}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-slate-50/70 p-3">
          <p className="text-xs font-medium text-muted-foreground">当前模式</p>
          <Badge variant="default" className="mt-2">
            真实模型
          </Badge>
        </div>
        <div className="rounded-lg border bg-slate-50/70 p-3">
          <p className="text-xs font-medium text-muted-foreground">API 配置</p>
          <Badge
            variant={
              isDraftSaved
                ? "success"
                : hasSavedConfig || hasRetainedMetadata
                  ? "violet"
                  : "secondary"
            }
            className="mt-2"
          >
            {isDraftSaved
              ? "本次打开可用"
              : hasSavedConfig
                ? "修改待验证"
                : hasRetainedMetadata
                  ? "需重新输入 Key"
                  : "待验证"}
          </Badge>
        </div>
        <div className="rounded-lg border bg-slate-50/70 p-3">
          <p className="text-xs font-medium text-muted-foreground">连接状态</p>
          <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold">
            {isTesting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-primary">测试中</span>
              </>
            ) : isVerified ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-700">已通过</span>
              </>
            ) : isFailed ? (
              <>
                <CircleAlert className="h-3.5 w-3.5 text-red-600" />
                <span className="text-red-700">未通过</span>
              </>
            ) : (
              <>
                <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-600">待测试</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {capabilities.map((capability) => (
          <div key={capability.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold text-slate-950">{capability.name}</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{capability.description}</p>
          </div>
        ))}
      </div>

      <div
        aria-live={isFailed ? "assertive" : "polite"}
        className={cn(
          "mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
          isFailed
            ? "bg-red-50 text-red-700"
            : isVerified
              ? "bg-emerald-50 text-emerald-700"
              : isTesting
                ? "bg-blue-50 text-blue-700"
                : "bg-amber-50 text-amber-800"
        )}
      >
        {isFailed ? (
          <CircleAlert className="mt-1 h-4 w-4 shrink-0" />
        ) : isVerified ? (
          <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" />
        ) : isTesting ? (
          <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Clock3 className="mt-1 h-4 w-4 shrink-0" />
        )}
        <p className="min-w-0 break-words leading-6">
          {connectionCopy}
          {config.model ? ` 当前模型：${config.model}` : ""}
        </p>
      </div>
    </section>
  );
}
