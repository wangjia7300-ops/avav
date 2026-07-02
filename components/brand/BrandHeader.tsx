import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { buttonVariants } from "@/components/ui/button";
import { navItems } from "@/lib/brand-tokens";
import { cn } from "@/lib/utils";

type BrandHeaderProps = {
  active?: "home" | "guidelines" | "showcase";
};

export function BrandHeader({ active = "home" }: BrandHeaderProps) {
  return (
    <header className="brand-nav-wrap">
      <div className="brand-container">
        <div className="brand-nav">
          <BrandLogo compact={active === "home"} />

          <nav className="hidden items-center gap-12 text-base font-semibold text-slate-800 lg:flex">
            {navItems.map((item) => (
              <Link key={item.label} href={item.href} className="transition-colors hover:text-brand-blue">
                {item.label}
              </Link>
            ))}
            {active !== "home" ? (
              <Link
                href="/brand-guidelines"
                className={cn(
                  "transition-colors hover:text-brand-blue",
                  active === "guidelines" && "text-brand-blue"
                )}
              >
                品牌规范
              </Link>
            ) : null}
          </nav>

          <Link
            href="/workspace"
            className={cn(buttonVariants({ size: "sm" }), "brand-button-primary h-12 px-7 text-base")}
          >
            开始创建项目
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
