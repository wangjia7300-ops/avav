import { FileText, ImageIcon, Layers3, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const floatingTags = [
  { label: "详情页策略", icon: Layers3, className: "left-[12%] top-[30%]" },
  { label: "主题生成", icon: ImageIcon, className: "right-[14%] top-[16%]" },
  { label: "AI提示词", icon: Sparkles, className: "right-[6%] top-[43%]" },
  { label: "视觉方案", icon: FileText, className: "left-[18%] bottom-[30%]" }
] as const;

type AICubeVisualProps = {
  compact?: boolean;
  className?: string;
};

export function AICubeVisual({ compact, className }: AICubeVisualProps) {
  return (
    <div className={cn("brand-cube-stage", compact && "brand-cube-stage-compact", className)}>
      <div className="brand-energy-grid" />
      <div className="brand-orbit brand-orbit-one" />
      <div className="brand-orbit brand-orbit-two" />
      <div className="brand-orbit brand-orbit-three" />
      <div className="brand-particle-field">
        {Array.from({ length: 20 }).map((_, index) => (
          <span
            key={index}
            className="brand-particle"
            style={{
              left: `${8 + ((index * 19) % 82)}%`,
              top: `${12 + ((index * 29) % 72)}%`,
              animationDelay: `${index * 130}ms`
            }}
          />
        ))}
      </div>

      {!compact
        ? floatingTags.map((tag) => {
            const Icon = tag.icon;

            return (
              <div key={tag.label} className={cn("brand-floating-tag", tag.className)}>
                <Icon className="h-4 w-4 text-brand-blue" />
                {tag.label}
              </div>
            );
          })
        : null}

      <svg
        className="brand-cube-svg"
        viewBox="0 0 760 620"
        role="img"
        aria-label="发光 AI 魔方品牌主视觉"
      >
        <defs>
          <linearGradient id="cubeTop" x1="100" y1="120" x2="570" y2="500" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#72E6FF" />
            <stop offset="0.45" stopColor="#2D64FF" />
            <stop offset="1" stopColor="#8A6CFF" />
          </linearGradient>
          <linearGradient id="cubeSide" x1="210" y1="150" x2="615" y2="420" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1E7BFF" stopOpacity="0.96" />
            <stop offset="1" stopColor="#7B5CFF" stopOpacity="0.82" />
          </linearGradient>
          <linearGradient id="cubeLeft" x1="145" y1="210" x2="410" y2="450" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#64DFFF" stopOpacity="0.86" />
            <stop offset="1" stopColor="#2D64FF" stopOpacity="0.72" />
          </linearGradient>
          <radialGradient id="baseGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#F7FAFF" stopOpacity="1" />
            <stop offset="0.35" stopColor="#6CE7FF" stopOpacity="0.72" />
            <stop offset="0.72" stopColor="#2D64FF" stopOpacity="0.32" />
            <stop offset="1" stopColor="#7B5CFF" stopOpacity="0" />
          </radialGradient>
          <filter id="cubeGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="9" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0.15 0 0 0 0 0.42 0 0 0 0 1 0 0 0 0.65 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="brand-svg-orbits" fill="none" strokeLinecap="round">
          <ellipse cx="382" cy="360" rx="295" ry="90" stroke="#7B5CFF" strokeOpacity="0.22" />
          <ellipse cx="382" cy="358" rx="252" ry="74" stroke="#2D64FF" strokeOpacity="0.28" />
          <ellipse cx="382" cy="364" rx="190" ry="54" stroke="#5EE3FF" strokeOpacity="0.36" />
          <path d="M140 240c106-100 333-138 480-18" stroke="#2D64FF" strokeOpacity="0.18" />
          <path d="M118 438c141 68 391 70 525-8" stroke="#7B5CFF" strokeOpacity="0.2" />
        </g>

        <g className="brand-cube-base">
          <ellipse cx="382" cy="470" rx="235" ry="88" fill="url(#baseGlow)" />
          <ellipse cx="382" cy="448" rx="190" ry="58" fill="#F7FAFF" stroke="#C7DBFF" strokeWidth="2" />
          <ellipse cx="382" cy="448" rx="145" ry="38" fill="none" stroke="#2D64FF" strokeOpacity="0.48" strokeWidth="6" />
          <ellipse cx="382" cy="448" rx="93" ry="24" fill="none" stroke="#8A6CFF" strokeOpacity="0.5" strokeWidth="4" />
          <ellipse cx="382" cy="448" rx="52" ry="13" fill="#E6F0FF" stroke="#79E4FF" strokeWidth="3" />
        </g>

        <g className="brand-cube-main" filter="url(#cubeGlow)">
          <path d="M382 86 544 174 382 262 220 174 382 86Z" fill="url(#cubeTop)" fillOpacity="0.86" />
          <path d="M220 174 382 262v190L220 362V174Z" fill="url(#cubeLeft)" fillOpacity="0.82" />
          <path d="M544 174 382 262v190l162-90V174Z" fill="url(#cubeSide)" fillOpacity="0.86" />
          <path d="M382 86 544 174v188l-162 90-162-90V174L382 86Z" fill="none" stroke="#DDF8FF" strokeWidth="4" strokeLinejoin="round" />
          <path d="M220 174 382 262 544 174M382 262v190" fill="none" stroke="#DDF8FF" strokeWidth="3" strokeOpacity="0.8" />
          <path d="M268 201v136M316 228v136M448 229v136M496 202v136" stroke="#DDF8FF" strokeOpacity="0.22" strokeWidth="2" />
          <path d="M252 336 382 409l130-72M252 280l130 73 130-73" stroke="#DDF8FF" strokeOpacity="0.24" strokeWidth="2" />
          <text
            x="382"
            y="346"
            textAnchor="middle"
            fontSize="96"
            fontWeight="800"
            fill="#FFFFFF"
            letterSpacing="0"
          >
            AI
          </text>
        </g>
      </svg>
    </div>
  );
}
