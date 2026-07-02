# AI视觉落地服务 · 网页落地素材说明

> 这套素材由单张首页效果图拆分而来，适合交给 Codex 还原成真实网页 UI。  
> 源图是位图，不是 Figma/MasterGo 源文件，因此 SVG 图标为重绘版，AI 魔方提供「带浅色背景」和「近似透明」两个版本。

## 画布基准

- 原图尺寸：1672 × 941
- 建议网页基准：1920 × 1080 或 1440 × 900
- 建议最大内容宽度：1500px
- 主风格：科技极简、冰白背景、科技蓝、蓝紫微光、玻璃拟态、圆角卡片

## 品牌文字

- 品牌名：AI视觉落地服务
- 英文名：AI VISUAL IMPLEMENTATION SERVICE
- 注意：原参考图里出现「AI电商视觉策划助手」，网页实现时统一替换为「AI视觉落地服务」。

## 主要素材路径

### 参考图
- `assets/reference/homepage-reference-original.png`
- `assets/reference/homepage-reference-1920x1080.png`

### Logo
- `assets/logo/logo-mark.svg`
- `assets/logo/logo-lockup.svg`
- `assets/logo/logo-mark-crop-transparent.png`
- `assets/logo/logo-full-crop-transparent.png`

### 主视觉
- `assets/hero/ai-cube-with-light-bg.png`
- `assets/hero/ai-cube-with-light-bg.webp`
- `assets/hero/ai-cube-transparent-approx.png`
- `assets/hero/hero-right-full-scene.webp`
- `assets/hero/hero-right-background-glow.webp`

建议网页中优先使用：
- AI 魔方完整场景：`hero-right-full-scene.webp`
- 需要自己写轨道/背景时：`ai-cube-transparent-approx.png` + `decorative-orbits.svg`

### 页面切片参考
- `assets/ui-slices/header-nav.png`
- `assets/ui-slices/hero-left-content.png`
- `assets/ui-slices/cta-buttons.png`
- `assets/ui-slices/feature-chips.png`
- `assets/ui-slices/stats-strip.png`
- `assets/ui-slices/feature-cards-row.png`

### SVG 图标
- `assets/icons/logo-mark.svg`
- `assets/icons/icon-recognition.svg`
- `assets/icons/icon-insight.svg`
- `assets/icons/icon-layout.svg`
- `assets/icons/icon-prompt.svg`
- `assets/icons/icon-users.svg`
- `assets/icons/icon-clock.svg`
- `assets/icons/icon-stack.svg`
- `assets/icons/icon-check-output.svg`
- `assets/icons/decorative-orbits.svg`

## 页面还原建议

### 1. 不要把整张图直接当背景
请用 HTML/CSS 还原布局，图片素材只用于：
- Logo 或图标
- AI 魔方主视觉
- 光效 / 轨道装饰
- 复杂插画参考

### 2. 文字全部用真实 HTML
这样可响应式、可 SEO、可改文案，也不会因为图片文字模糊。

### 3. AI 魔方处理方式

推荐两种方案：

方案 A：快速还原  
用 `hero-right-full-scene.webp` 作为右侧完整主视觉背景图。

方案 B：更像真实网页  
用 `ai-cube-transparent-approx.png` 放在右侧中心，再叠加：
- `decorative-orbits.svg`
- CSS radial-gradient 光晕
- 4 个浮动标签：主图生成、详情页策略、AI提示词、视觉方案

## 建议布局参数

```css
:root {
  --color-bg: #F7FAFF;
  --color-surface: #FFFFFF;
  --color-primary: #2563FF;
  --color-primary-2: #0B67FF;
  --color-violet: #7C3AED;
  --color-cyan: #00D4FF;
  --color-navy: #0A1533;
  --color-text: #081127;
  --color-muted: #64748B;
  --color-line: #E6EBF5;

  --radius-nav: 36px;
  --radius-card: 24px;
  --radius-button: 16px;
  --shadow-soft: 0 16px 48px rgba(15, 23, 42, .08);
  --shadow-card: 0 12px 36px rgba(37, 99, 255, .06);
  --gradient-primary: linear-gradient(135deg, #0B67FF 0%, #2563FF 60%, #7C3AED 100%);
}
```

## 页面结构

```html
<header class="site-header">...</header>
<main>
  <section class="hero">
    <div class="hero-copy">...</div>
    <div class="hero-visual">...</div>
  </section>
  <section class="stats-strip">...</section>
  <section class="feature-grid">...</section>
</main>
```
