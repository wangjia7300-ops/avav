import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Bell, ChartNoAxesCombined, Search, Sparkles } from "lucide-react";
import { AICubeVisual } from "@/components/brand/AICubeVisual";
import { BrandHeader } from "@/components/brand/BrandHeader";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { GlassCard } from "@/components/brand/GlassCard";
import { componentExamples, showcaseItems } from "@/lib/brand-tokens";

export default function BrandShowcasePage() {
  return (
    <main className="brand-page">
      <BrandHeader active="showcase" />

      <section className="brand-container pb-16 pt-10">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-normal text-brand-deep lg:text-5xl">
              品牌应用与设计系统展示
            </h1>
            <p className="mt-3 text-base font-medium text-slate-500">
              AI视觉落地服务品牌系统在多场景、多终端的应用呈现
            </p>
          </div>
          <Link href="/workspace" className="brand-button-primary inline-flex h-11 items-center justify-center gap-2 px-6 text-sm font-bold">
            开始创建项目
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-5 xl:grid-cols-12">
          <ShowcaseBlock index="1" title={showcaseItems[0].title} className="xl:col-span-5">
            <DesktopHomepagePreview />
          </ShowcaseBlock>

          <ShowcaseBlock index="2" title={showcaseItems[1].title} className="xl:col-span-4">
            <DashboardPreview />
          </ShowcaseBlock>

          <ShowcaseBlock index="3" title={showcaseItems[2].title} className="xl:col-span-3">
            <MobilePreview />
          </ShowcaseBlock>

          <ShowcaseBlock index="4" title={showcaseItems[3].title} className="xl:col-span-4">
            <BannerPreview />
          </ShowcaseBlock>

          <ShowcaseBlock index="5" title={showcaseItems[4].title} className="xl:col-span-4">
            <SocialCardsPreview />
          </ShowcaseBlock>

          <ShowcaseBlock index="6" title={showcaseItems[5].title} className="xl:col-span-4">
            <ComponentSystemPreview />
          </ShowcaseBlock>

          <GlassCard className="relative overflow-hidden p-8 xl:col-span-12">
            <div className="grid items-center gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="text-4xl font-black tracking-normal text-brand-deep lg:text-5xl">
                  <span className="brand-gradient-text">AI</span> 让视觉创作更智能，让商业增长更高效
                </p>
                <div className="mt-8 flex flex-wrap gap-6 text-sm font-bold text-slate-600">
                  {["智能识别", "精准洞察", "高效生成", "多端适配", "安全可靠"].map((item) => (
                    <span key={item} className="inline-flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-brand-blue" />
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <AICubeVisual compact />
            </div>
          </GlassCard>

          <GlassCard className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between xl:col-span-12">
            <BrandLogo />
            <div className="flex flex-wrap justify-center gap-8 text-sm font-bold text-slate-500">
              {["智能", "高效", "专业", "创新", "未来感"].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </GlassCard>
        </div>
      </section>
    </main>
  );
}

function ShowcaseBlock({
  index,
  title,
  className,
  children
}: {
  index: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <GlassCard className={`p-4 ${className ?? ""}`}>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-blue text-sm font-black text-white">
          {index}
        </span>
        <h2 className="text-base font-black text-brand-blue">{title}</h2>
      </div>
      {children}
    </GlassCard>
  );
}

function DesktopHomepagePreview() {
  return (
    <div className="brand-preview-frame p-4">
      <div className="flex items-center justify-between border-b border-blue-100 pb-3">
        <BrandLogo compact />
        <div className="hidden gap-5 text-[11px] font-bold text-slate-500 sm:flex">
          <span>产品能力</span>
          <span>解决方案</span>
          <span>案例</span>
          <span>价格</span>
        </div>
        <span className="rounded-full bg-brand-blue px-3 py-1.5 text-[11px] font-bold text-white">开始创建项目</span>
      </div>
      <div className="grid gap-4 py-5 md:grid-cols-[0.9fr_1.1fr]">
        <div>
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-brand-blue">AI 驱动 · 完整视觉方案</span>
          <p className="mt-4 text-3xl font-black leading-tight text-brand-deep">
            让商品图一键进化为
            <br />
            主图、详情页与
            <br />
            <span className="brand-gradient-text">AI 提示词</span>
          </p>
          <div className="mt-4 flex gap-2">
            <span className="brand-button-primary px-4 py-2 text-xs font-bold">立即体验</span>
            <span className="brand-button-secondary px-4 py-2 text-xs font-bold">查看演示</span>
          </div>
        </div>
        <AICubeVisual compact />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {["10,000+", "3 分钟", "GPT", "高效输出"].map((item) => (
          <div key={item} className="rounded-xl bg-blue-50 px-3 py-2 text-center text-xs font-black text-brand-blue">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="brand-preview-frame min-h-[314px] bg-white">
      <div className="flex items-center gap-3 border-b border-blue-100 p-3">
        <BrandLogo compact />
        <div className="ml-auto flex h-8 w-44 items-center gap-2 rounded-full bg-slate-50 px-3 text-xs text-slate-400">
          <Search className="h-3.5 w-3.5" />
          搜索商品 / 任务 / 方案
        </div>
        <Bell className="h-4 w-4 text-slate-400" />
      </div>
      <div className="grid grid-cols-[86px_1fr]">
        <div className="space-y-2 border-r border-blue-100 bg-blue-50/45 p-3">
          {["概览", "商品识别", "卖点分析", "方案生成", "AI 提示词"].map((item, index) => (
            <div key={item} className={`rounded-lg px-2 py-2 text-[11px] font-bold ${index === 0 ? "bg-brand-blue text-white" : "text-slate-500"}`}>
              {item}
            </div>
          ))}
        </div>
        <div className="p-4">
          <p className="text-lg font-black text-brand-deep">欢迎回来，品牌伙伴</p>
          <div className="mt-4 grid grid-cols-4 gap-3">
            {["1,288", "356", "98.6%", "12,560"].map((value) => (
              <div key={value} className="rounded-xl border border-blue-100 bg-white p-3">
                <p className="text-lg font-black text-brand-deep">{value}</p>
                <p className="text-[10px] text-emerald-500">↑ 12%</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_0.85fr]">
            <div className="rounded-xl border border-blue-100 bg-white p-4">
              <p className="text-xs font-bold text-slate-500">最近任务</p>
              <div className="mt-3 space-y-2">
                {["商品图智能主图生成", "详情页视觉方案生成", "电商提示词批量生成"].map((item) => (
                  <div key={item} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                    <span>{item}</span>
                    <span className="text-emerald-500">已完成</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-blue-100 bg-white p-4">
              <ChartNoAxesCombined className="h-24 w-full text-brand-blue" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobilePreview() {
  return (
    <div className="flex justify-center gap-3">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-[314px] w-[92px] rounded-[24px] border-[5px] border-slate-950 bg-white p-2 shadow-xl">
          <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-slate-900" />
          <div className="rounded-xl bg-blue-50 p-2">
            <p className="text-[10px] font-black text-brand-deep">AI 视觉落地</p>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {[1, 2, 3, 4].map((card) => (
                <div key={card} className="h-9 rounded-lg bg-white" />
              ))}
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {[1, 2, 3, 4].map((line) => (
              <div key={line} className="h-6 rounded-lg bg-slate-50" />
            ))}
          </div>
          <div className="mt-3 h-7 rounded-full bg-brand-blue" />
        </div>
      ))}
    </div>
  );
}

function BannerPreview() {
  return (
    <div className="brand-preview-frame relative min-h-[228px] overflow-hidden bg-[linear-gradient(135deg,#071127,#123A9C_54%,#7B5CFF)] p-6 text-white">
      <div className="relative z-10 max-w-[320px]">
        <p className="text-3xl font-black leading-tight">AI 驱动视觉生产力</p>
        <p className="mt-3 text-sm leading-7 text-white/72">让每一张商品图更有价值，智能识别、精准洞察、高效生成、多端适配。</p>
        <span className="mt-5 inline-flex rounded-full bg-white/16 px-5 py-2 text-sm font-bold">立即体验 →</span>
      </div>
      <AICubeVisual compact className="absolute -right-8 -top-10 w-[58%]" />
    </div>
  );
}

function SocialCardsPreview() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {["商品图一键进化", "高效识别精准洞察", "GPT 提示词一键输出", "释放创意提升转化"].map((title) => (
        <div key={title} className="rounded-2xl border border-blue-100 bg-white/78 p-4">
          <div className="mx-auto h-20">
            <AICubeVisual compact />
          </div>
          <p className="mt-3 text-lg font-black leading-tight text-brand-deep">{title}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">让视觉落地更快、更准、更专业。</p>
        </div>
      ))}
    </div>
  );
}

function ComponentSystemPreview() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {componentExamples.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.title} className="rounded-2xl border border-blue-100 bg-white/76 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-brand-blue">
                <Icon className="h-5 w-5" />
              </span>
              <p className="text-sm font-black text-brand-deep">{item.title}</p>
            </div>
            <div className="mt-3 h-2 rounded-full bg-blue-50">
              <div className="h-full w-2/3 rounded-full bg-brand-blue" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
