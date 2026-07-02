"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ProductPreview } from "@/components/workspace/ProductPreview";
import { ResultTabs } from "@/components/workspace/ResultTabs";
import { StepSidebar } from "@/components/workspace/StepSidebar";
import { APIIntegrationPanel } from "@/components/workspace/APIIntegrationPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shouldUseMockData } from "@/lib/config";
import { buildProjectMarkdown } from "@/lib/markdown-export";
import { useProjectStore } from "@/lib/store";

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function WorkspacePage() {
  const {
    uploadedImages,
    imagePreviewUrl,
    imageName,
    manualProductInfo,
    outputScope,
    status,
    globalStatus,
    stepStates,
    currentStepIndex,
    activeTab,
    productAnalysis,
    marketResearch,
    mainImages,
    detailPages,
    prompts,
    generationMeta,
    planningSession,
    error,
    setUploadedImages,
    setManualProductInfo,
    setOutputScope,
    setActiveTab,
    setError,
    resetProject,
    runAnalysis,
    retryStep,
    markExportSuccess,
    markExportFailed
  } = useProjectStore();

  const [showSettings, setShowSettings] = useState(false);
  const isMockMode = shouldUseMockData();

  function handleClear() {
    resetProject();
  }

  function handleExport() {
    try {
      if (globalStatus === "processing" || status === "running") {
        markExportFailed("流程运行中，请等待当前步骤完成后再导出。");
        return;
      }

      if (globalStatus === "partial_completed" || globalStatus === "error") {
        const missingModules = Object.entries(stepStates)
          .filter(([, step]) => step.status !== "success")
          .map(([key]) => key)
          .join("、") || "未标注";
        const confirmed = window.confirm(
          `当前方案不是完整完成状态。\n\n未完成模块：${missingModules}\n\n确认仍要导出半成品 Markdown 吗？`
        );

        if (!confirmed) {
          return;
        }
      }

      const markdown = buildProjectMarkdown({
        imageName: uploadedImages.length
          ? uploadedImages.map((image) => image.imageName).join("、")
          : imageName,
        manualProductInfo,
        productAnalysis,
        marketResearch,
        mainImages,
        detailPages,
        prompts,
        outputScope,
        globalStatus,
        stepStates,
        isMockMode,
        generationMeta,
        planningSession
      });
      const date = new Date().toISOString().slice(0, 10);
      downloadTextFile(`AI电商视觉策划方案-${date}.md`, markdown);
      markExportSuccess();
    } catch (error) {
      markExportFailed(error instanceof Error ? error.message : "Markdown 导出失败。");
    }
  }

  const canExport =
    status !== "running" &&
    globalStatus !== "processing" &&
    Boolean(productAnalysis || marketResearch || mainImages.length || prompts.length);

  return (
    <main className="ai-shell min-h-screen text-slate-950">
      <AppHeader showWorkspaceCta={false} />
      {isMockMode ? (
        <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800">
          当前环境默认演示模式；如果已配置页面 API，具体结果以各步骤来源标记为准。
        </div>
      ) : null}
      <div
        className={cn(
          "grid min-h-[calc(100vh-72px)] grid-cols-1 border-t border-slate-100",
          showSettings
            ? "lg:grid-cols-[260px_minmax(0,1fr)_minmax(420px,520px)]"
            : "lg:grid-cols-[260px_minmax(0,1fr)_minmax(420px,520px)]"
        )}
      >
        {/* Left column: steps + settings toggle */}
        <div className="flex flex-col border-r border-slate-200/80 bg-white/90 lg:min-h-[calc(100vh-72px)]">
          <StepSidebar
            currentStepIndex={currentStepIndex}
            status={status}
            stepStates={stepStates}
            onRetryStep={(step) => void retryStep(step)}
          />
          <div className="border-t border-slate-100 px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
              className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-slate-700"
            >
              <Settings2 className="h-4 w-4" />
              {showSettings ? "隐藏 API 设置" : "API 供应商设置"}
            </Button>
          </div>
        </div>

        {/* Center: preview */}
        <ProductPreview
          uploadedImages={uploadedImages}
          imagePreviewUrl={imagePreviewUrl}
          manualProductInfo={manualProductInfo}
          outputScope={outputScope}
          status={status}
          globalStatus={globalStatus}
          stepStates={stepStates}
          planningSession={planningSession}
          currentStepIndex={currentStepIndex}
          error={error}
          onImagesChange={setUploadedImages}
          onManualInfoChange={setManualProductInfo}
          onOutputScopeChange={setOutputScope}
          onClear={handleClear}
          onError={setError}
          onRun={() => void runAnalysis()}
        />

        {/* Right: results OR settings */}
        {showSettings ? (
          <aside className="overflow-y-auto border-l border-slate-200/80 bg-white/70 lg:min-h-[calc(100vh-72px)]">
            <div className="p-4">
              <APIIntegrationPanel />
            </div>
          </aside>
        ) : (
          <ResultTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onExport={handleExport}
            canExport={canExport}
            productAnalysis={productAnalysis}
            marketResearch={marketResearch}
            mainImages={mainImages}
            detailPages={detailPages}
            prompts={prompts}
          />
        )}
      </div>
    </main>
  );
}
