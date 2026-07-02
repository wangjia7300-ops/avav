import {
  Boxes,
  FileText,
  Layers3,
  Lightbulb,
  Monitor,
  MousePointer2,
  PenTool,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Zap
} from "lucide-react";

const assetBase = "/brand-assets";

export const brand = {
  name: "AI视觉落地服务",
  englishName: "AI VISUAL IMPLEMENTATION SERVICE",
  positioning: "从商品图到完整视觉方案",
  keywords: ["智能", "高效", "专业", "未来感"],
  colors: [
    { name: "冰雪白", value: "#F7FAFF", usage: "页面背景、留白区" },
    { name: "冰川蓝", value: "#E6F0FF", usage: "浅色卡片、辅助底色" },
    { name: "电光蓝", value: "#2D64FF", usage: "主按钮、重点信息、图标" },
    { name: "星芒紫", value: "#7B5CFF", usage: "渐变强调、光效、AI 视觉" },
    { name: "深空蓝", value: "#0A1533", usage: "标题、深色背景、品牌收尾" }
  ],
  gradients: {
    primary: "linear-gradient(135deg, #2D64FF 0%, #7B5CFF 100%)",
    cube: "linear-gradient(135deg, #2D64FF 0%, #42D9FF 45%, #7B5CFF 100%)",
    glass: "linear-gradient(180deg, rgba(255,255,255,0.84), rgba(247,250,255,0.62))",
    deep: "linear-gradient(135deg, #071127 0%, #123A9C 52%, #7B5CFF 100%)"
  }
} as const;

export const brandAssets = {
  base: assetBase,
  logoMark: `${assetBase}/logo/logo-mark.svg`,
  logoLockup: `${assetBase}/logo/logo-lockup.svg`,
  heroCube: `${assetBase}/hero/hero-right-full-scene.webp`,
  icons: {
    recognition: `${assetBase}/icons/icon-recognition.svg`,
    insight: `${assetBase}/icons/icon-insight.svg`,
    layout: `${assetBase}/icons/icon-layout.svg`,
    prompt: `${assetBase}/icons/icon-prompt.svg`,
    users: `${assetBase}/icons/icon-users.svg`,
    clock: `${assetBase}/icons/icon-clock.svg`,
    stack: `${assetBase}/icons/icon-stack.svg`,
    checkOutput: `${assetBase}/icons/icon-check-output.svg`
  }
} as const;

export const navItems = [
  { label: "产品能力", href: "/#capabilities" },
  { label: "解决方案", href: "/#solutions" },
  { label: "案例", href: "/brand-showcase" },
  { label: "价格", href: "/#pricing" }
] as const;

export const heroTags = [
  { label: "智能识别", icon: brandAssets.icons.recognition },
  { label: "卖点洞察", icon: brandAssets.icons.insight },
  { label: "一键生成", icon: brandAssets.icons.layout },
  { label: "高效输出", icon: brandAssets.icons.checkOutput }
] as const;

export const heroStats = [
  { value: "10,000+", label: "商家使用", icon: brandAssets.icons.users },
  { value: "3 分钟", label: "生成完整方案", icon: brandAssets.icons.clock },
  { value: "GPT", label: "图像提示词", icon: brandAssets.icons.stack },
  { value: "高效输出", label: "降本增效看得见", icon: brandAssets.icons.checkOutput }
] as const;

export const featureCards = [
  {
    title: "商品识别",
    description: "精准识别商品品类、属性与核心特征，理解商品本质与使用场景。",
    icon: brandAssets.icons.recognition
  },
  {
    title: "卖点分析",
    description: "挖掘核心卖点与用户痛点，提炼高转化的营销关键词。",
    icon: brandAssets.icons.insight
  },
  {
    title: "页面结构生成",
    description: "智能规划主图与详情页结构，输出可直接落地的视觉方案。",
    icon: brandAssets.icons.layout
  },
  {
    title: "AI 提示词输出",
    description: "生成高质量 GPT 图像提示词和负面词，支持文生图与图生图创作。",
    icon: brandAssets.icons.prompt
  }
] as const;

export const guidelineNav = [
  "品牌视觉识别规范",
  "Logo 规范",
  "色彩规范",
  "字体规范",
  "图标规范",
  "组件规范",
  "品牌图形元素",
  "品牌个性",
  "应用示例"
] as const;

export const iconSpec = [
  { label: "商品识别", icon: MousePointer2 },
  { label: "卖点分析", icon: Lightbulb },
  { label: "页面生成", icon: Boxes },
  { label: "AI 提示词", icon: WandSparkles },
  { label: "数据看板", icon: Monitor },
  { label: "安全可靠", icon: ShieldCheck },
  { label: "专业输出", icon: PenTool },
  { label: "快速落地", icon: Zap }
] as const;

export const showcaseItems = [
  {
    index: "1",
    title: "桌面端官网首页",
    description: "品牌首屏、AI 魔方主视觉、数据条与能力卡片统一呈现。"
  },
  {
    index: "2",
    title: "工作台 / 控制台",
    description: "品牌级 SaaS 控制台，突出数据效率、任务状态与内容资产。"
  },
  {
    index: "3",
    title: "移动端界面",
    description: "面向移动端查看、分享、复用方案，保留清爽层级。"
  },
  {
    index: "4",
    title: "Banner / KV 广告位",
    description: "深空蓝品牌 KV，适合官网首屏、活动页和投放素材。"
  },
  {
    index: "5",
    title: "社交媒体 / 营销卡片",
    description: "适配内容平台分发，强调智能、高效、专业和未来感。"
  },
  {
    index: "6",
    title: "UI 组件系统",
    description: "按钮、标签、输入框、卡片、统计模块、提示条统一规范。"
  }
] as const;

export const componentExamples = [
  { title: "按钮 Button", icon: Sparkles },
  { title: "标签 Chip", icon: FileText },
  { title: "卡片 Card", icon: Layers3 },
  { title: "输入框 Input", icon: PenTool },
  { title: "统计 Stat", icon: Monitor },
  { title: "提示条 Notice", icon: ShieldCheck }
] as const;
