"use client";

import { useState } from "react";
import {
  Check,
  FileText,
  ImageSquare,
  MagnifyingGlass,
  PaintBrush,
  Plus,
  ShieldCheck
} from "@phosphor-icons/react";
import { APISettingsDialog } from "@/components/workspace/APISettingsDialog";
import { ImageAPISettingsDialog } from "@/components/workspace/ImageAPISettingsDialog";
import { cn } from "@/lib/utils";
import type { WorkflowStage } from "@/lib/types";
import { WORKFLOW_STEPS } from "@/lib/skill-suite/workflow";

const stageIcons: Record<WorkflowStage, typeof MagnifyingGlass> = {
  research: MagnifyingGlass,
  planning: FileText,
  execution: PaintBrush,
  qa: ShieldCheck
};

type AppHeaderProps = {
  stage: WorkflowStage;
  completedStages: WorkflowStage[];
  onStageChange: (stage: WorkflowStage) => void;
  onNewProject: () => void;
};

export function AppHeader({
  stage,
  completedStages,
  onStageChange,
  onNewProject
}: AppHeaderProps) {
  const [apiOpen, setApiOpen] = useState(false);
  const [imageApiOpen, setImageApiOpen] = useState(false);

  return (
    <>
      <header className="workbench-header">
        <div className="workbench-brand">
          <button
            type="button"
            className="brand-mark"
            aria-label="新建详情页项目"
            onClick={onNewProject}
          >
            <Plus size={18} weight="bold" />
          </button>
          <div>
            <p className="brand-title">电商详情页工作台</p>
            <p className="brand-subtitle">四阶段生产系统</p>
          </div>
        </div>

        <nav className="workflow-nav" aria-label="详情页生产流程">
          {WORKFLOW_STEPS.map((item, index) => {
            const Icon = stageIcons[item.id];
            const completed = completedStages.includes(item.id);
            const active = stage === item.id;
            return (
              <div key={item.id} className="workflow-nav-item">
                {index > 0 ? <span className="workflow-connector" aria-hidden="true" /> : null}
                <button
                  type="button"
                  className={cn(
                    "workflow-step",
                    active && "is-active",
                    completed && !active && "is-complete"
                  )}
                  onClick={() => onStageChange(item.id)}
                  aria-current={active ? "step" : undefined}
                >
                  <span className="workflow-step-icon">
                    {completed && !active ? <Check size={15} weight="bold" /> : <Icon size={16} />}
                  </span>
                  <span>
                    <b>{item.label}</b>
                    <small>{index + 1}/4</small>
                  </span>
                </button>
              </div>
            );
          })}
        </nav>

        <div className="header-actions">
          <button type="button" className="header-config-button" onClick={() => setApiOpen(true)}>
            <FileText size={17} />
            文案模型
          </button>
          <button
            type="button"
            className="header-config-button"
            onClick={() => setImageApiOpen(true)}
          >
            <ImageSquare size={17} />
            生图模型
          </button>
        </div>
      </header>

      <APISettingsDialog open={apiOpen} onClose={() => setApiOpen(false)} />
      <ImageAPISettingsDialog open={imageApiOpen} onClose={() => setImageApiOpen(false)} />
    </>
  );
}
