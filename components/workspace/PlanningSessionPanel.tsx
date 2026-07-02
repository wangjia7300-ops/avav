"use client";

import { Bot, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { PlanningSession, PlanningTurn } from "@/lib/types";
import { cn } from "@/lib/utils";

type PlanningSessionPanelProps = {
  session: PlanningSession;
};

function statusLabel(turn: PlanningTurn) {
  if (turn.status === "success") return "已完成";
  if (turn.status === "failed") return "失败";
  return "进行中";
}

function statusIcon(turn: PlanningTurn) {
  if (turn.status === "success") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (turn.status === "failed") return <XCircle className="h-3.5 w-3.5" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
}

export function PlanningSessionPanel({ session }: PlanningSessionPanelProps) {
  const turns = session.turns.slice(-6);

  return (
    <section className="ai-card-soft p-4">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-950">AI 多轮策划会话</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            MVP 会把每一步的输入与结论传给后续步骤，避免策划和提示词各说各话。
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {!turns.length ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white/60 p-3 text-xs leading-5 text-muted-foreground">
            开始分析后，这里会按“产品识图 → 市场验证 → 视觉风格 → 策划方案 → AI 提示词”记录多轮结论，并传给后续 API。
          </div>
        ) : null}
        {turns.map((turn, index) => (
          <div
            key={turn.id}
            className="rounded-lg border border-slate-200/80 bg-white/70 p-3 text-xs shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">
                  {session.turns.length - turns.length + index + 1}. {turn.title}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {turn.generationMeta?.sourceType
                    ? `来源：${turn.generationMeta.sourceType}｜证据：${turn.generationMeta.evidenceLevel ?? "未标注"}`
                    : "来源待记录"}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-medium",
                  turn.status === "success" && "bg-emerald-50 text-emerald-700",
                  turn.status === "failed" && "bg-red-50 text-red-700",
                  turn.status === "pending" && "bg-blue-50 text-blue-700"
                )}
              >
                {statusIcon(turn)}
                {statusLabel(turn)}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 leading-5 text-slate-600">
              输入：{turn.inputSummary}
            </p>
            {turn.outputSummary ? (
              <p className="mt-1 line-clamp-2 leading-5 text-slate-700">
                结论：{turn.outputSummary}
              </p>
            ) : null}
            {turn.errorMessage ? (
              <p className="mt-1 line-clamp-2 leading-5 text-red-600">
                错误：{turn.errorMessage}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
