import Link from "next/link";
import { cn } from "@/lib/utils";
import { brand, brandAssets } from "@/lib/brand-tokens";

type BrandLogoProps = {
  href?: "/" | "/brand-guidelines" | "/brand-showcase" | "/workspace" | "";
  inverse?: boolean;
  compact?: boolean;
  className?: string;
};

export function BrandLogo({ href = "/", inverse, compact, className }: BrandLogoProps) {
  const content = (
    <div className={cn("flex items-center gap-3", className)}>
      <span className={cn("brand-logo-mark", inverse && "brand-logo-mark-inverse")}>
        {inverse ? (
          <svg viewBox="0 0 48 48" aria-hidden="true" className="h-7 w-7">
            <path
              d="M24 4 8 13.2v18.6L24 41l16-9.2V13.2L24 4Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinejoin="round"
            />
            <path
              d="M8.5 13.5 24 22.5l15.5-9M24 22.5V41M16 18l16-9"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <img src={brandAssets.logoMark} alt="" className="h-8 w-8" />
        )}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block font-bold leading-tight",
            compact ? "text-2xl" : "text-lg",
            inverse ? "text-white" : "text-brand-deep"
          )}
        >
          {brand.name}
        </span>
        {!compact ? (
          <span className={cn("block text-[10px] font-semibold leading-tight", inverse ? "text-white/68" : "text-slate-500")}>
            {brand.englishName}
          </span>
        ) : null}
      </span>
    </div>
  );

  return href ? (
    <Link href={href} className="inline-flex">
      {content}
    </Link>
  ) : (
    content
  );
}
