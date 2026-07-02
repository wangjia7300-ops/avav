import { CheckCircle2, Copy, Type } from "lucide-react";
import { AICubeVisual } from "@/components/brand/AICubeVisual";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { GlassCard } from "@/components/brand/GlassCard";
import { brand, componentExamples, guidelineNav, iconSpec } from "@/lib/brand-tokens";

export default function BrandGuidelinesPage() {
  return (
    <main className="brand-page">
      <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
        <aside className="border-r border-blue-100/70 bg-white/64 p-6 backdrop-blur-xl">
          <BrandLogo />

          <nav className="mt-10 space-y-2">
            {guidelineNav.map((item, index) => (
              <a
                key={item}
                href={`#section-${index}`}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-slate-500 transition hover:bg-blue-50 hover:text-brand-blue"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50 text-xs font-black text-brand-blue">
                  {index === 0 ? "●" : index.toString().padStart(2, "0")}
                </span>
                {item}
              </a>
            ))}
          </nav>

          <div className="mt-12">
            <AICubeVisual compact />
          </div>
          <p className="mt-6 text-xs font-semibold text-slate-400">版本 1.0 · 2026.06</p>
        </aside>

        <section className="min-w-0 p-5 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-normal text-brand-deep lg:text-5xl">
                品牌视觉识别规范
              </h1>
              <p className="mt-3 text-sm font-semibold uppercase tracking-normal text-slate-500">
                Brand Visual Identity Guidelines
              </p>
            </div>
            <div className="rounded-full border border-blue-100 bg-white/70 px-5 py-2 text-sm font-semibold text-slate-500">
              智能 · 专业 · 高效 · 未来感
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <GlassCard id="section-1" className="p-6 xl:col-span-7">
              <SectionTitle index="01" title="Logo 标准" />
              <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_0.72fr_0.78fr]">
                <div>
                  <p className="mb-5 text-sm font-semibold text-slate-500">主标识（横版）</p>
                  <div className="rounded-2xl border border-blue-100 bg-white p-7">
                    <BrandLogo href="" />
                  </div>
                </div>
                <div>
                  <p className="mb-5 text-sm font-semibold text-slate-500">竖版 / 紧凑标识</p>
                  <div className="rounded-2xl border border-blue-100 bg-white p-7 text-center">
                    <BrandLogo href="" compact className="justify-center" />
                  </div>
                </div>
                <div>
                  <p className="mb-5 text-sm font-semibold text-slate-500">Logo 安全区</p>
                  <div className="rounded-2xl border border-blue-100 bg-white p-4">
                    <div className="grid grid-cols-[24px_1fr_24px] grid-rows-[24px_1fr_24px] overflow-hidden rounded-xl border border-blue-100 text-[10px] text-blue-300">
                      <span className="flex items-center justify-center border-b border-r border-blue-100">X</span>
                      <span className="border-b border-blue-100" />
                      <span className="flex items-center justify-center border-b border-l border-blue-100">X</span>
                      <span className="border-r border-blue-100" />
                      <div className="p-4">
                        <BrandLogo href="" compact />
                      </div>
                      <span className="border-l border-blue-100" />
                      <span className="flex items-center justify-center border-r border-t border-blue-100">X</span>
                      <span className="border-t border-blue-100" />
                      <span className="flex items-center justify-center border-l border-t border-blue-100">X</span>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">安全空间 = X（标识高度的 1/2）</p>
                  </div>
                </div>
              </div>
            </GlassCard>

            <GlassCard id="section-2" className="p-6 xl:col-span-5">
              <SectionTitle index="02" title="Logo 不同背景应用" />
              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                <LogoBackground title="浅色背景" className="bg-white" />
                <LogoBackground title="深色背景" className="bg-brand-deep" inverse />
                <LogoBackground title="品牌色背景" className="bg-[linear-gradient(135deg,#2D64FF,#7B5CFF)]" inverse />
                <LogoBackground title="渐变 / 图像背景" className="bg-[linear-gradient(135deg,#2D64FF,#7B5CFF_55%,#65E4FF)]" inverse />
              </div>
            </GlassCard>

            <GlassCard id="section-3" className="p-6 xl:col-span-4">
              <SectionTitle index="03" title="品牌色彩规范" />
              <div className="mt-7 grid grid-cols-5 gap-2">
                {brand.colors.map((color) => (
                  <div key={color.name}>
                    <div className="h-16 rounded-xl border border-blue-100" style={{ background: color.value }} />
                    <p className="mt-3 text-xs font-bold text-brand-deep">{color.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{color.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 h-3 rounded-full bg-[linear-gradient(90deg,#F7FAFF,#E6F0FF,#2D64FF,#7B5CFF,#0A1533)]" />
            </GlassCard>

            <GlassCard id="section-4" className="p-6 xl:col-span-4">
              <SectionTitle index="04" title="字体规范" />
              <div className="mt-7 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-bold text-slate-500">中文字体</p>
                  <p className="mt-3 text-3xl font-black text-brand-deep">思源黑体 CN</p>
                  <p className="mt-2 text-sm text-slate-500">Bold / Medium / Regular</p>
                  <p className="mt-5 text-sm leading-7 text-slate-600">智能识别商品，一键生成高转化视觉内容。</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-500">英文字体</p>
                  <p className="mt-3 text-3xl font-black text-brand-deep">Inter</p>
                  <p className="mt-2 text-sm text-slate-500">Bold / Medium / Regular</p>
                  <p className="mt-5 text-sm font-semibold uppercase text-slate-700">AI VISUAL IMPLEMENTATION SERVICE</p>
                </div>
              </div>
            </GlassCard>

            <GlassCard id="section-5" className="p-6 xl:col-span-4">
              <SectionTitle index="05" title="图标规范" />
              <p className="mt-5 text-sm leading-7 text-slate-600">
                风格：线性 + 面性结合，圆角端点，统一描边 2px，圆角 8px，蓝紫渐变强调。
              </p>
              <div className="mt-5 grid grid-cols-4 gap-3">
                {iconSpec.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="rounded-xl border border-blue-100 bg-white/70 p-3 text-center">
                      <Icon className="mx-auto h-6 w-6 text-brand-blue" />
                      <p className="mt-2 text-[11px] font-semibold text-slate-500">{item.label}</p>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            <GlassCard id="section-6" className="p-6 xl:col-span-6">
              <SectionTitle index="06" title="UI 组件规范" />
              <div className="mt-7 grid gap-5 md:grid-cols-2">
                <div className="rounded-2xl border border-blue-100 bg-white/70 p-5">
                  <p className="text-sm font-bold text-slate-500">按钮 Button</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button className="brand-button-primary h-10 px-5 text-sm font-bold">主按钮</button>
                    <button className="brand-button-secondary h-10 px-5 text-sm font-bold">次按钮</button>
                    <button className="h-10 rounded-full border border-red-200 bg-red-50 px-5 text-sm font-bold text-red-500">危险操作</button>
                  </div>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-white/70 p-5">
                  <p className="text-sm font-bold text-slate-500">标签 Chip</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {["AI 驱动", "高效输出", "GPT 提示词", "智能识别"].map((chip) => (
                      <span key={chip} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-brand-blue">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-white/70 p-5">
                  <p className="text-sm font-bold text-slate-500">输入框 Input</p>
                  <div className="mt-4 flex h-11 items-center rounded-xl border border-blue-100 bg-white px-4 text-sm text-slate-400">
                    请输入关键词或商品名称
                    <Copy className="ml-auto h-4 w-4" />
                  </div>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-white/70 p-5">
                  <p className="text-sm font-bold text-slate-500">提示条 Notification</p>
                  <div className="mt-4 flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                    <CheckCircle2 className="h-5 w-5" />
                    已生成成功
                  </div>
                </div>
              </div>
            </GlassCard>

            <GlassCard id="section-7" className="p-6 xl:col-span-4">
              <SectionTitle index="07" title="品牌图形元素" />
              <div className="mt-6">
                <AICubeVisual compact />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {["AI 魔方", "能量环", "轨道线", "光粒子"].map((item) => (
                  <div key={item} className="rounded-xl border border-blue-100 bg-white/70 px-4 py-3 text-sm font-bold text-brand-blue">
                    {item}
                  </div>
                ))}
              </div>
            </GlassCard>

            <GlassCard id="section-8" className="p-6 xl:col-span-2">
              <SectionTitle index="08" title="品牌个性" />
              <div className="mt-6 space-y-4">
                {brand.keywords.map((keyword) => (
                  <div key={keyword} className="rounded-2xl border border-blue-100 bg-white/72 p-4">
                    <Type className="h-5 w-5 text-brand-blue" />
                    <p className="mt-2 text-xl font-black text-brand-blue">{keyword}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">清晰、可信、克制、有科技感。</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        </section>
      </div>
    </main>
  );
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-6 min-w-6 items-center justify-center rounded-lg bg-brand-blue px-1.5 text-xs font-black text-white">
        {index}
      </span>
      <h2 className="text-lg font-black tracking-normal text-brand-deep">{title}</h2>
    </div>
  );
}

function LogoBackground({ title, className, inverse }: { title: string; className: string; inverse?: boolean }) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-slate-500">{title}</p>
      <div className={`rounded-2xl border border-blue-100 p-5 ${className}`}>
        <BrandLogo href="" inverse={inverse} compact />
      </div>
    </div>
  );
}
