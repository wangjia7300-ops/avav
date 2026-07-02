"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { AnalysisStatus, GlobalAnalysisStatus, WorkflowStepStates } from "@/lib/types";

const statusCopy: Record<AnalysisStatus, string> = {
  idle: "等待上传产品图片",
  ready: "图片已就绪，点击开始分析",
  running: "正在运行产品识图、市场验证、视觉风格与策划流程",
  completed: "分析完成，可查看结果并导出 Markdown",
  error: "流程中断，请查看错误信息后重试"
};

type AnalysisProgressProps = {
  status: AnalysisStatus;
  globalStatus: GlobalAnalysisStatus;
  stepStates: WorkflowStepStates;
  currentStepIndex: number;
  error: string | null;
};

export function AnalysisProgress({ status, globalStatus, stepStates, currentStepIndex, error }: AnalysisProgressProps) {
  const maxStepIndex = 5;
  const successfulSteps = Object.values(stepStates).filter((step) => step.status === "success").length;
  const progress =
    globalStatus === "completed"
      ? 100
      : status === "idle"
        ? 0
        : Math.max(Math.round((currentStepIndex / maxStepIndex) * 100), Math.round((successfulSteps / 5) * 100));
  const Icon =
    globalStatus === "completed" ? CheckCircle2 : globalStatus === "partial_completed" || status === "error" ? AlertCircle : Loader2;
  const headline =
    globalStatus === "partial_completed"
      ? "流程部分完成，可查看已生成结果并重试失败步骤"
      : statusCopy[status];
  const failedSteps = Object.entries(stepStates).filter(([, step]) => step.status === "failed");

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className={status === "running" ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-950">{headline}</p>
            <span className="text-xs font-medium text-muted-foreground">{progress}%</span>
          </div>
          <Progress value={progress} className="mt-3" />
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          {failedSteps.length ? (
            <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
              {failedSteps.map(([key, step]) => (
                <p key={key}>
                  {key}：{step.errorMessage ?? "步骤失败"}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
