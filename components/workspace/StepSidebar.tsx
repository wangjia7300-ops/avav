"use client";

import {
  BadgeCheck,
  Boxes,
  Download,
  FileText,
  ImageUp,
  ListChecks,
  Palette,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalysisStatus, WorkflowStepId, WorkflowStepStates } from "@/lib/types";

type StepItem = {
  id: WorkflowStepId;
  title: string;
  description: string;
  icon: typeof ImageUp;
};

export const workflowSteps: StepItem[] = [
  {
    id: "upload",
    title: "上传产品图",
    description: "获取产品外观输入",
    icon: ImageUp
  },
  {
    id: "product",
    title: "产品识图",
    description: "只看图片输出基础信息卡片",
    icon: Boxes
  },
  {
    id: "research",
    title: "市场验证",
    description: "提炼卖点体系与用户画像",
    icon: ListChecks
  },
  {
    id: "style",
    title: "视觉风格体系",
    description: "反推详情页风格定位",
    icon: Palette
  },
  {
    id: "design",
    title: "文案视觉策划",
    description: "精简文案并规划画面",
    icon: Sparkles
  },
  {
    id: "prompts",
    title: "提示词生成",
    description: "逐屏输出详细内容提示词",
    icon: FileText
  },
  {
    id: "export",
    title: "Markdown 导出",
    description: "保留来源与证据等级",
    icon: Download
  }
];

type StepSidebarProps = {
  currentStepIndex: number;
  status: AnalysisStatus;
  stepStates: WorkflowStepStates;
  onRetryStep: (step: Exclude<WorkflowStepId, "upload" | "export">) => void;
};

export function StepSidebar({ currentStepIndex, status, stepStates, onRetryStep }: StepSidebarProps) {
  return (
    <aside className="bg-transparent lg:min-h-[calc(100vh-72px)]">
      <div className="p-4 lg:sticky lg:top-[88px]">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Project Flow
          </p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">策划流程</h2>
        </div>

        <ol className="space-y-2">
          {workflowSteps.map((step, index) => {
            const stepState = step.id === "upload" ? null : stepStates[step.id];
            const isCompleted =
              step.id === "upload"
                ? status !== "idle"
                : stepState?.status === "success";
            const isFailed = stepState?.status === "failed";
            const isPending = stepState?.status === "pending";
            const isRetryable =
              step.id === "product" ||
              step.id === "research" ||
              step.id === "style" ||
              step.id === "design" ||
              step.id === "prompts";
            const isActive =
              isPending ||
              (status !== "completed" && (currentStepIndex === index || (status === "ready" && index === 0)));
            const Icon = step.icon;

            return (
              <li
                key={step.id}
                className={cn(
                  "rounded-lg border px-3 py-3 transition-all",
                  isFailed
                    ? "border-red-200 bg-red-50/70"
                    : isActive
                    ? "border-primary bg-white shadow-[0_14px_30px_rgba(37,99,235,0.10)]"
                    : isCompleted
                      ? "border-emerald-200 bg-emerald-50/60"
                      : "border-slate-200 bg-white/80 hover:bg-white"
                )}
              >
                <div className="flex gap-3">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      isFailed
                        ? "bg-red-600 text-white"
                        : isCompleted
                        ? "bg-emerald-600 text-white"
                        : isActive
                          ? "bg-[linear-gradient(135deg,#0f6bff,#8b5cf6)] text-white shadow-[0_10px_20px_rgba(79,70,229,0.20)]"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {isCompleted ? <BadgeCheck className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-950">{step.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
                    {isFailed ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-red-600">
                        {stepState?.errorMessage}
                      </p>
                    ) : null}
                  </div>
                  {isFailed && isRetryable ? (
                    <button
                      type="button"
                      className="h-7 rounded-md border border-red-200 bg-white px-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      onClick={() => onRetryStep(step.id as Exclude<WorkflowStepId, "upload" | "export">)}
                    >
                      重试
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
