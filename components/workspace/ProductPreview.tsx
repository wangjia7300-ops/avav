"use client";

import { ClipboardList, RotateCcw, WandSparkles } from "lucide-react";
import { ProductUploader } from "@/components/upload/ProductUploader";
import { Button } from "@/components/ui/button";
import { AIModelStatus } from "@/components/workspace/AIModelStatus";
import { AnalysisProgress } from "@/components/workspace/AnalysisProgress";
import { PlanningSessionPanel } from "@/components/workspace/PlanningSessionPanel";
import type {
  AnalysisStatus,
  GlobalAnalysisStatus,
  OutputScope,
  PlanningSession,
  ProductManualInfo,
  UploadedProductImage,
  WorkflowStepStates
} from "@/lib/types";

type ProductPreviewProps = {
  uploadedImages: UploadedProductImage[];
  imagePreviewUrl: string | null;
  manualProductInfo: ProductManualInfo;
  outputScope: OutputScope;
  status: AnalysisStatus;
  globalStatus: GlobalAnalysisStatus;
  stepStates: WorkflowStepStates;
  planningSession: PlanningSession;
  currentStepIndex: number;
  error: string | null;
  onImagesChange: (images: UploadedProductImage[]) => void;
  onManualInfoChange: (info: ProductManualInfo) => void;
  onOutputScopeChange: (scope: OutputScope) => void;
  onClear: () => void;
  onError: (message: string) => void;
  onRun: () => void;
};

export function ProductPreview({
  uploadedImages,
  imagePreviewUrl,
  manualProductInfo,
  outputScope,
  status,
  globalStatus,
  stepStates,
  planningSession,
  currentStepIndex,
  error,
  onImagesChange,
  onManualInfoChange,
  onOutputScopeChange,
  onClear,
  onError,
  onRun
}: ProductPreviewProps) {
  const isRunning = status === "running";
  const canRun = uploadedImages.length > 0 && !isRunning;

  function updateManualInfo<K extends keyof ProductManualInfo>(key: K, value: ProductManualInfo[K]) {
    onManualInfoChange({
      ...manualProductInfo,
      [key]: value
    });
  }

  return (
    <section className="min-w-0 space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workspace
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
            创建电商视觉策划
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            上传一张或多张产品图后，可补充产品信息，系统会依次完成产品识图、市场验证、视觉风格体系、文案视觉策划和逐屏 AI 提示词生成。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={onClear}
            disabled={isRunning || !imagePreviewUrl}
            className="ai-outline-button"
          >
            <RotateCcw className="h-4 w-4" />
            重置
          </Button>
          <Button onClick={onRun} disabled={!canRun} className="ai-gradient-button">
            <WandSparkles className="h-4 w-4" />
            {status === "completed" ? "重新分析" : "开始分析"}
          </Button>
        </div>
      </div>

      <ProductUploader
        images={uploadedImages}
        disabled={isRunning}
        onImagesChange={onImagesChange}
        onClear={onClear}
        onError={onError}
      />

      <section className="ai-card-soft p-4">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-950">手动填写产品信息（可选）</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              适合补充图片里看不清的品牌、型号、核心卖点或目标人群；AI 会作为辅助上下文使用。
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">输出范围（必选）</span>
            <select
              value={outputScope}
              disabled={isRunning}
              onChange={(event) => onOutputScopeChange(event.target.value as OutputScope)}
              className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            >
              <option value="all">完整策划：主图 + 详情页 + 全部提示词</option>
              <option value="main_only">仅主图：策划 5 张主图 + 生成主图提示词</option>
              <option value="detail_only">仅详情页：策划详情页 + 生成详情页提示词</option>
            </select>
            <p className="text-xs leading-5 text-muted-foreground">
              用于快速单独产出主图或详情页资产；产品识图、市场资料提炼和视觉风格体系仍会作为前置依据。
            </p>
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">商品驱动类型（必选）</span>
            <select
              value={manualProductInfo.productDriveType ?? "rational_functional"}
              disabled={isRunning}
              onChange={(event) =>
                updateManualInfo("productDriveType", event.target.value as ProductManualInfo["productDriveType"])
              }
              className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            >
              <option value="rational_functional">理性功能型：小家电、数码、功效护肤等</option>
              <option value="emotional_aesthetic">感性美学型：服饰、潮玩、文创、香水等</option>
            </select>
            <p className="text-xs leading-5 text-muted-foreground">
              理性功能型走 FAB 利益转译；感性美学型会弱化参数屏，优先用风格、氛围和情绪共鸣策划。
            </p>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-slate-700">产品名称/型号</span>
            <input
              value={manualProductInfo.productName ?? ""}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("productName", event.target.value)}
              placeholder="例如：家用移动冷风扇 FS1"
              className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-slate-700">产品品类</span>
            <input
              value={manualProductInfo.category ?? ""}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("category", event.target.value)}
              placeholder="例如：冷风扇、护肤品、宠物用品"
              className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-slate-700">品牌</span>
            <input
              value={manualProductInfo.brand ?? ""}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("brand", event.target.value)}
              placeholder="品牌名或店铺名"
              className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-slate-700">目标人群</span>
            <input
              value={manualProductInfo.targetAudience ?? ""}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("targetAudience", event.target.value)}
              placeholder="例如：租房人群、宝妈、办公室用户"
              className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-slate-700">目标平台</span>
            <input
              value={manualProductInfo.targetPlatform ?? ""}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("targetPlatform", event.target.value)}
              placeholder="例如：淘宝、京东、抖音、小红书"
              className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-slate-700">价格带/销量线索</span>
            <input
              value={[manualProductInfo.priceRange, manualProductInfo.salesRange].filter(Boolean).join(" / ")}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("priceRange", event.target.value)}
              placeholder="例如：99-199 元；月销约 1000+"
              className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">已知卖点</span>
            <textarea
              value={manualProductInfo.sellingPoints ?? ""}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("sellingPoints", event.target.value)}
              placeholder="例如：大风量、可移动、低噪、适合厨房和小商铺。参数不确定可以留空或写大概方向。"
              className="min-h-20 w-full resize-y rounded-md border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">竞品文案/平台资料粘贴</span>
            <textarea
              value={manualProductInfo.competitorText ?? ""}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("competitorText", event.target.value)}
              placeholder="可粘贴竞品标题、主图文案、详情页卖点、价格带、平台截图 OCR 文本。系统会作为 A 级用户输入证据处理。"
              className="min-h-24 w-full resize-y rounded-md border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">用户评论/买家反馈粘贴</span>
            <textarea
              value={manualProductInfo.reviewText ?? ""}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("reviewText", event.target.value)}
              placeholder="可粘贴好评、差评、问答、测评笔记或用户真实反馈。系统会提取购买理由、痛点、顾虑和使用场景。"
              className="min-h-24 w-full resize-y rounded-md border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">其他补充</span>
            <textarea
              value={manualProductInfo.notes ?? ""}
              disabled={isRunning}
              onChange={(event) => updateManualInfo("notes", event.target.value)}
              placeholder="例如：希望主打高端感、需要适合小红书风格、详情页要强调对比优势。"
              className="min-h-20 w-full resize-y rounded-md border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
          </label>
        </div>
      </section>

      <AIModelStatus />

      <PlanningSessionPanel session={planningSession} />

      <AnalysisProgress
        status={status}
        globalStatus={globalStatus}
        stepStates={stepStates}
        currentStepIndex={currentStepIndex}
        error={error}
      />
    </section>
  );
}
