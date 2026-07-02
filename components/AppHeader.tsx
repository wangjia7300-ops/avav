import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { brand, brandAssets } from "@/lib/brand-tokens";
import { cn } from "@/lib/utils";

type AppHeaderProps = {
  showWorkspaceCta?: boolean;
};

export function AppHeader({ showWorkspaceCta = true }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="ai-container flex h-[72px] items-center justify-between">
        <Link href="/" className="flex items-center gap-3 font-semibold text-slate-950">
          <span className="ai-brand-mark">
            <img src={brandAssets.logoMark} alt="" className="h-6 w-6" />
          </span>
          <span className="text-lg sm:text-xl">{brand.name}</span>
        </Link>

        {showWorkspaceCta ? (
          <nav className="hidden items-center gap-12 text-sm font-medium text-slate-700 lg:flex">
            <a href="#capabilities" className="transition-colors hover:text-primary">
              产品能力
            </a>
            <Link href="/workspace" className="transition-colors hover:text-primary">
              工作台
            </Link>
            <a href="#workflow" className="transition-colors hover:text-primary">
              案例
            </a>
            <a href="#pricing" className="transition-colors hover:text-primary">
              定价
            </a>
          </nav>
        ) : null}

        {showWorkspaceCta ? (
          <Link
            href="/workspace"
            className={cn(
              buttonVariants({ size: "sm" }),
              "ai-gradient-button h-10 px-5 text-sm"
            )}
          >
            <Sparkles className="h-4 w-4" />
            开始创建项目
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
    </header>
  );
}
