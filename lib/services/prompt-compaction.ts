import type { PromptTextLayer } from "@/lib/types";

const repeatedCompliancePatterns: Array<[RegExp, string]> = [
  [/主色主色/g, "主色"],
  [/辅色辅色/g, "辅色"],
  [/产品色产品色/g, "产品色"],
  [/点缀色点缀色/g, "点缀色"],
  [/材质观感材质观感/g, "材质观感"],
  [/比例关系比例关系/g, "比例关系"],
  [/关键部件关键部件/g, "关键部件"],
  [/产品外观锚点[:：]\s*产品外观锚点[:：]/g, "产品外观锚点："],
  [/真实证据素材区域以简洁信息卡表达，不生成证书、公章或检测报告画面/g, "不生成证书、公章或检测报告画面"],
  [/小型品牌素材安全区，不额外生成品牌标识/g, "品牌安全留白区，不额外生成Logo或品牌字样"],
  [/不得生成证书、公章、检测报告、Logo或排名榜单/g, "不得生成证书、公章、检测报告、Logo或排名榜单"],
  [/画面文字必须清晰端正，无错别字、伪文字、水印、乱码/g, "文字清晰端正，无错别字、伪文字、水印、乱码"],
  [/画面必须包含清晰可读的中文电商排版/g, "画面包含清晰可读的中文电商排版"]
];

const redundantClauses = [
  "不要输出分析报告",
  "不要拆成报告小节",
  "不要在每条提示词里重复粘贴完整产品分析背景",
  "最终交付会按固定结构展示",
  "真实素材叠加预留区",
  "不生成证书画面"
];

export function normalizePromptText(text: string | undefined) {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；、,.])/g, "$1")
    .replace(/([。；;])\s+/g, "$1")
    .replace(/^[，,、；;\s]+|[，,、；;\s]+$/g, "")
    .trim();
}

function cleanSegment(segment: string) {
  return repeatedCompliancePatterns
    .reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), segment)
    .replace(/；{2,}/g, "；")
    .replace(/。{2,}/g, "。")
    .trim();
}

export function dedupePromptSegments(text: string, options?: { maxSegments?: number; maxChars?: number }) {
  const normalized = cleanSegment(normalizePromptText(text));
  const rawSegments = normalized.split(/(?<=[。；;])|[\n\r]+/).map((item) => cleanSegment(item));
  const seen = new Set<string>();
  const segments: string[] = [];

  for (const raw of rawSegments) {
    const segment = raw.replace(/^[。；;]+|[。；;]+$/g, "").trim();
    if (!segment) continue;
    if (redundantClauses.some((clause) => segment.includes(clause))) continue;
    const key = segment
      .replace(/[「」『』"'\s]/g, "")
      .replace(/[,，、。；;]/g, "")
      .slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    segments.push(segment);
    if (options?.maxSegments && segments.length >= options.maxSegments) break;
  }

  let result = segments.join("。").replace(/。+/g, "。");
  if (result && !/[。；;]$/.test(result)) result += "。";

  if (options?.maxChars && result.length > options.maxChars) {
    result = `${result.slice(0, options.maxChars).replace(/[，,、；;][^，,、；;。]*$/, "")}。`;
  }

  return result.trim();
}

export function compactNegativePrompt(text: string | undefined) {
  const items = normalizePromptText(text)
    .split(/[，,、；;。]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const normalizedItems = items.map((item) =>
    item
      .replace(/中文文字模糊|文字模糊/g, "文字模糊")
      .replace(/文字错误|错别字/g, "错别字")
      .replace(/logo错位/gi, "logo错位")
  );
  const preferred = [
    "产品变形",
    "比例异常",
    "结构改变",
    "材质失真",
    "文字乱码",
    "错别字",
    "文字模糊",
    "水印",
    "logo错位",
    "背景杂乱",
    "光影不统一",
    "产品遮挡文字",
    "证书",
    "公章",
    "检测报告",
    "虚假数据"
  ];
  const unique = Array.from(new Set([...preferred.filter((item) => normalizedItems.includes(item)), ...normalizedItems]));
  return unique.slice(0, 18).join("，");
}

export function buildConciseTextInstruction(textLayer?: PromptTextLayer) {
  const headline = normalizePromptText(textLayer?.headline);
  const subheadline = normalizePromptText(textLayer?.subheadline);
  const body = normalizePromptText(textLayer?.body);
  const labels = (textLayer?.labels ?? []).map(normalizePromptText).filter(Boolean).slice(0, 4);
  const cta = normalizePromptText(textLayer?.cta);
  const copyParts = [
    headline ? `主标题「${headline}」` : "",
    subheadline ? `副标题「${subheadline}」` : "",
    body ? `正文「${body.replace(/\n/g, " / ")}」` : "",
    labels.length ? `标签「${labels.join("」「")}」` : "",
    cta ? `CTA「${cta}」` : ""
  ].filter(Boolean);

  if (!copyParts.length) return "";

  return `画面直接生成清晰中文排版：${copyParts.join("，")}；字体端正、层级分明、无错别字，文字与产品保持安全距离。`;
}

export function promptAlreadyContainsTextLayer(text: string, textLayer?: PromptTextLayer) {
  const source = normalizePromptText(text);
  const required = [
    normalizePromptText(textLayer?.headline),
    normalizePromptText(textLayer?.subheadline),
    normalizePromptText(textLayer?.body).split("\n")[0]
  ].filter((item) => item.length >= 2);

  return required.length > 0 && required.every((item) => source.includes(item));
}
