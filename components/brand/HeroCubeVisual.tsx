import { brandAssets } from "@/lib/brand-tokens";
import { cn } from "@/lib/utils";

type HeroCubeVisualProps = {
  className?: string;
};

export function HeroCubeVisual({ className }: HeroCubeVisualProps) {
  return (
    <div className={cn("brand-hero-cube", className)} aria-label="AI 魔方主视觉">
      <div className="brand-hero-glow" aria-hidden="true" />
      <div className="brand-cube-asset-wrap" aria-hidden="true">
        <img
          src={brandAssets.heroCube}
          alt="AI 魔方、发光底座、轨道线与电商视觉方案标签"
          className="brand-cube-asset"
        />
      </div>
    </div>
  );
}
