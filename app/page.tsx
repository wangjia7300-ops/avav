import Link from "next/link";
import { HeroScene } from "@/components/brand/HeroScene";

export default function LandingPage() {
  return (
    <main className="brand-static-home" aria-label="AI视觉落地服务官网首页">
      <div className="brand-static-home-frame">
        <img
          src="/hero-assets/homepage-bg-v2.png"
          alt="AI视觉落地服务，从商品图到完整视觉方案，生成主图、详情页和 AI 提示词"
          className="brand-static-home-image"
        />

        <HeroScene />

        <header className="brand-home-header-overlay">
          <Link href="/" className="brand-home-logo-overlay" aria-label="AI视觉落地服务首页">
            <img src="/brand-assets/logo/logo-mark.svg" alt="" />
            <span>AI视觉落地服务</span>
          </Link>
          <Link href="/workspace" className="brand-home-header-cta">
            开始创建项目
            <span aria-hidden="true">→</span>
          </Link>
        </header>

        <section className="brand-home-copy-overlay" aria-label="首页主文案">
          <div className="brand-home-copy-clean" aria-hidden="true" />
          <div className="brand-home-copy-content">
            <div className="brand-home-eyebrow">✦ AI 驱动 · 从商品图到完整视觉方案</div>
            <h1>
              一键主图详情页
              <span>AI提示词</span>
            </h1>
            <p>
              智能识别商品，深度挖掘卖点与场景，自动生成高转化的视觉方案与 GPT 图像
              提示词，助力电商内容创作更快、更准、更出色。
            </p>
            <Link href="/workspace" className="brand-home-primary-cta">
              立即体验
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        <Link href="/workspace" className="brand-static-hotspot brand-static-hotspot-cta">
          <span className="sr-only">立即体验</span>
        </Link>
      </div>
    </main>
  );
}
