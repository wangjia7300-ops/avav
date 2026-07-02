"use client";

import { Download, FileSearch, Image, LayoutTemplate, Lightbulb, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DesignPlanPanel } from "@/components/workspace/DesignPlanPanel";
import { MarketInsightPanel } from "@/components/workspace/MarketInsightPanel";
import { ProductAnalysisPanel } from "@/components/workspace/ProductAnalysisPanel";
import { PromptPanel } from "@/components/workspace/PromptPanel";
import { cn } from "@/lib/utils";
import type {
  DetailPagePlan,
  GeneratedPrompt,
  MainImagePlan,
  MarketResearch,
  ProductAnalysis,
  ResultTab
} from "@/lib/types";

type ResultTabsProps = {
  activeTab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
  onExport: () => void;
  canExport: boolean;
  productAnalysis: ProductAnalysis | null;
  marketResearch: MarketResearch | null;
  mainImages: MainImagePlan[];
  detailPages: DetailPagePlan[];
  prompts: GeneratedPrompt[];
};

const tabs: Array<{ id: ResultTab; label: string; icon: typeof FileSearch }> = [
  { id: "product", label: "产品分析", icon: FileSearch },
  { id: "market", label: "市场验证", icon: Lightbulb },
  { id: "mainImages", label: "主图方案", icon: Image },
  { id: "detailPages", label: "详情页方案", icon: LayoutTemplate },
  { id: "prompts", label: "AI提示词", icon: Sparkles }
];

export function ResultTabs({
  activeTab,
  onTabChange,
  onExport,
  canExport,
  productAnalysis,
  marketResearch,
  mainImages,
  detailPages,
  prompts
}: ResultTabsProps) {
  return (
    <aside className="border-l border-slate-200/80 bg-white/70 lg:min-h-[calc(100vh-72px)]">
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-100 bg-white/90 p-4 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Results
              </p>
              <div className="mt-1 flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-950">结果面板</h2>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={!canExport}
              className="ai-outline-button"
            >
              <Download className="h-4 w-4" />
              导出 Markdown
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    "flex h-10 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-medium transition-all",
                    selected
                      ? "border-primary bg-[linear-gradient(135deg,#0f6bff,#8b5cf6)] text-white shadow-[0_12px_24px_rgba(79,70,229,0.18)]"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/60 hover:text-primary"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {activeTab === "product" ? <ProductAnalysisPanel analysis={productAnalysis} /> : null}
          {activeTab === "market" ? <MarketInsightPanel research={marketResearch} /> : null}
          {activeTab === "mainImages" ? <DesignPlanPanel type="main" plans={mainImages} /> : null}
          {activeTab === "detailPages" ? (
            <DesignPlanPanel type="detail" plans={detailPages} />
          ) : null}
          {activeTab === "prompts" ? <PromptPanel prompts={prompts} /> : null}
        </div>
      </div>
    </aside>
  );
}
