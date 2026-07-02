import { sanitizePromptText } from "@/lib/prompt-templates";
import { sanitizeBackgroundPrompt, sanitizeTextLayer } from "@/lib/services/copywriting-guardrails";
import { compactNegativePrompt, dedupePromptSegments } from "@/lib/services/prompt-compaction";
import type { GeneratedPrompt, PromptTextLayer } from "@/lib/types";

type PromptDeliverySections = {
  productSetting: string;
  visualStyle: string;
  imageTexture: string;
  lightingLogic: string;
  colorSystem: {
    primary: string;
    secondary: string;
    product: string;
    accent: string;
  };
  typography: string[];
  composition: string;
  visualRequirements: string;
  headline: string;
  subheadline: string;
  infoLayout: string;
  layoutForm: string;
  designEmphasis: string;
  chinesePrompt: string;
  negativePrompt: string;
};

function firstCleanSentence(text: string, fallback: string) {
  const cleaned = sanitizePromptText(text);
  const sentence = cleaned
    .split(/[。；;]/)
    .map((item) => item.replace(/^产品外观锚点[:：]\s*/, "").trim())
    .find((item) => item.length > 8 && !/^生成第?\d*屏|^生成一张|^画面|^排版/.test(item));
  return sentence ? sentence.slice(0, 120) : fallback;
}

function buildTextSummary(layer: PromptTextLayer) {
  const safeLayer = sanitizeTextLayer(layer);
  return {
    headline: sanitizePromptText(safeLayer.headline ?? "") || "按本屏核心利益点生成主标题",
    subheadline: sanitizePromptText(safeLayer.subheadline ?? "") || "用一句话补充场景和结果",
    body: sanitizePromptText(safeLayer.body ?? ""),
    labels: (safeLayer.labels ?? []).map(sanitizePromptText).filter(Boolean),
    cta: sanitizePromptText(safeLayer.cta ?? ""),
    layoutHint: sanitizePromptText(safeLayer.layoutHint ?? "")
  };
}

export function buildPromptDeliverySections(prompt: GeneratedPrompt): PromptDeliverySections {
  const safeTextLayer = sanitizeTextLayer(prompt.textLayer);
  const text = buildTextSummary(safeTextLayer);
  const chinesePrompt = dedupePromptSegments(
    sanitizeBackgroundPrompt(prompt.backgroundPrompt, safeTextLayer),
    { maxChars: prompt.imageType === "detail_page" ? 620 : 480 }
  );
  const productSetting = firstCleanSentence(
    chinesePrompt,
    "严格保持产品外观、颜色、结构、材质和比例一致，所有画面以同一产品为核心主体。"
  );

  return {
    productSetting,
    visualStyle:
      "高级电商视觉风格，场景化表达，卖点可视化，产品为视觉中心，前后调性一致。",
    imageTexture:
      "高清商业摄影质感，产品边缘清晰，材质真实，背景低噪，画面干净通透。",
    lightingLogic:
      "柔和主光塑形，侧逆光勾勒轮廓，高光服务材质，整体不压暗产品。",
    colorSystem: {
      primary: "依据本品风格体系使用主氛围色，负责整体情绪。",
      secondary: "低饱和辅助色负责背景层次与信息区。",
      product: "保持产品原始颜色和材质色，不随场景改色。",
      accent: "少量高饱和色用于重点信息、光效或CTA。"
    },
    typography: [
      "主标题：阿里巴巴普惠体 Heavy",
      "副标题：阿里巴巴普惠体 Bold",
      "正文：思源黑体 Regular",
      "数字：DIN / 无衬线粗体",
      "层级清晰，主标题醒目，正文精炼，手机阅读友好"
    ],
    composition:
      prompt.imageType === "detail_page"
        ? "2:3竖屏，标题顶部左对齐，中部主视觉区，底部辅助信息区；每屏只讲一个核心信息。"
        : "1:1方形主图，标题顶部左对齐，产品与核心场景占据高关注热区，一张图只讲一个点击理由。",
    visualRequirements:
      "场景高清，整体高级统一；卖点用场景、对比、标注或结构可视化表达；文案不遮挡产品。",
    headline: text.headline,
    subheadline: text.subheadline,
    infoLayout:
      text.layoutHint ||
      "顶部左对齐放主标题和副标题，中部放产品或卖点可视化主体，底部放辅助说明、标签或CTA，所有文字与产品保持安全距离。",
    layoutForm:
      prompt.imageType === "detail_page"
        ? "移动端竖屏模块化排版，顶部信息先读，中部视觉承接，底部补充说明，阅读路径清晰。"
        : "货架主图排版，0.5秒可识别品类、产品主体和核心利益，避免复杂解释。",
    designEmphasis:
      "高级留白、黄金分割、清晰景别，信息不堆叠，画面有商业摄影质感。",
    chinesePrompt: sanitizePromptText(chinesePrompt),
    negativePrompt: compactNegativePrompt(sanitizePromptText(prompt.negativePrompt))
  };
}

export function formatPromptForDelivery(prompt: GeneratedPrompt) {
  const sections = buildPromptDeliverySections(prompt);

  return [
    "**产品统一设定：**",
    sections.productSetting,
    "",
    "**统一视觉风格：**",
    sections.visualStyle,
    "",
    "**统一画面质感：**",
    sections.imageTexture,
    "",
    "**统一布光逻辑：**",
    sections.lightingLogic,
    "",
    "**统一色彩体系：**",
    "",
    `- 主色：${sections.colorSystem.primary}`,
    `- 辅色：${sections.colorSystem.secondary}`,
    `- 产品色：${sections.colorSystem.product}`,
    `- 点缀色：${sections.colorSystem.accent}`,
    "",
    "**统一字体规范：**",
    "",
    ...sections.typography.map((item) => `- ${item}`),
    "",
    "**统一构图规范：**",
    sections.composition,
    "",
    "### 视觉要求",
    sections.visualRequirements,
    "",
    "### 主标题",
    sections.headline,
    "",
    "### 副标题",
    sections.subheadline,
    "",
    "### 信息布局",
    sections.infoLayout,
    "",
    "### 排版形式",
    sections.layoutForm,
    "",
    "### 设计感强调",
    sections.designEmphasis,
    "",
    "### 中文提示词",
    sections.chinesePrompt,
    "",
    "### 负面提示词",
    sections.negativePrompt
  ].join("\n");
}
