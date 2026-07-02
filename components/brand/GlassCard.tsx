import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

type GlassCardProps = ComponentPropsWithoutRef<"div">;

export function GlassCard({ children, className, ...props }: GlassCardProps) {
  return (
    <div className={cn("brand-glass-card", className)} {...props}>
      {children}
    </div>
  );
}
