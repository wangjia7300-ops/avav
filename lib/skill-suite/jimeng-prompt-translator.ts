import type {
  DetailScreen,
  EvidenceFact,
  ScreenExecution
} from "@/lib/types";

type JimengTranslationIssueCode =
  | "subject_override"
  | "scene_override"
  | "contract_override";

export type JimengTranslationIssue = Readonly<{
  code: JimengTranslationIssueCode;
  message: string;
  evidence: string;
}>;

export type JimengVisualSpec = Readonly<{
  screenId: string;
  subjectKey: string;
  conversionTask: string;
  primarySellingPoint: string;
  scene: string;
  shot: string;
  composition: string;
  proofMethod: string;
  visualInstruction: string;
  constraint: string;
  copy: DetailScreen["copy"];
}>;

export type JimengPromptInput = Readonly<{
  screen: DetailScreen;
  execution: Pick<
    ScreenExecution,
    "copyFinal" | "visualInstruction" | "negativePrompt"
  >;
  facts: readonly EvidenceFact[];
}>;

const SUBJECT_OVERRIDE_PATTERNS = [
  /(?:忽略|无视).{0,10}(?:参考图|产品图|主体)/u,
  /(?:把|将)?(?:产品|主体|款式|结构|配色|颜色).{0,6}(?:换成|改成|替换为|变成|重新设计)/u,
  /(?:换成|改成|替换为|变成).{0,10}(?:另一款|其他款|新款|产品|主体)/u
] as const;

const SCENE_OVERRIDE_PATTERNS = [
  /(?:背景|场景|环境).{0,5}(?:换成|改成|替换为|重设为|重新设定)/u,
  /(?:换成|改成|替换为).{0,12}(?:背景|场景|环境)/u
] as const;

const CONTRACT_OVERRIDE_PATTERNS = [
  /(?:忽略|取消|推翻|覆盖).{0,12}(?:本屏|策划|任务|构图|镜头|文案|约束)/u,
  /(?:不要|无需).{0,6}(?:9:16|竖版|定稿文字|安全区)/u
] as const;

function firstMatch(value: string, patterns: readonly RegExp[]) {
  return patterns.find((pattern) => pattern.test(value));
}

export function inspectJimengVisualInstruction(
  value: string
): JimengTranslationIssue[] {
  const issues: JimengTranslationIssue[] = [];
  if (firstMatch(value, SUBJECT_OVERRIDE_PATTERNS)) {
    issues.push({
      code: "subject_override",
      message: "视觉增量试图替换参考图中的产品主体。",
      evidence: value
    });
  }
  if (firstMatch(value, SCENE_OVERRIDE_PATTERNS)) {
    issues.push({
      code: "scene_override",
      message: "视觉增量试图重定义策划已经锁定的场景。",
      evidence: value
    });
  }
  if (firstMatch(value, CONTRACT_OVERRIDE_PATTERNS)) {
    issues.push({
      code: "contract_override",
      message: "视觉增量试图覆盖本屏既定任务、版式或文字合同。",
      evidence: value
    });
  }
  return issues;
}

function buildJimengVisualSpec(
  input: Pick<JimengPromptInput, "screen" | "execution">
): JimengVisualSpec {
  const visualInstruction = input.execution.visualInstruction.trim();
  const translationIssues = inspectJimengVisualInstruction(visualInstruction);
  if (translationIssues.length > 0) {
    throw new Error(
      `${input.screen.id} 视觉增量与主体/场景合同冲突：${translationIssues
        .map((issue) => issue.message)
        .join("；")}`
    );
  }

  const leakedCopy = [
    input.screen.copy.headline,
    input.screen.copy.subheadline,
    input.screen.copy.body,
    ...input.screen.copy.keyPoints
  ].find((token) => token.trim() && visualInstruction.includes(token.trim()));
  if (leakedCopy) {
    throw new Error(
      `${input.screen.id} 视觉增量提前包含定稿文案“${leakedCopy}”，会造成重复注入。`
    );
  }

  return {
    screenId: input.screen.id,
    subjectKey: input.screen.subjectKey,
    conversionTask: input.screen.conversionTask,
    primarySellingPoint: input.screen.primarySellingPoint,
    scene: input.screen.scene,
    shot: input.screen.shot,
    composition: input.screen.composition,
    proofMethod: input.screen.proofMethod,
    visualInstruction,
    constraint: input.execution.negativePrompt.trim(),
    // screen.copy is the only authoritative copy source. copyFinal is retained
    // for backward-compatible transport and independently checked as stale.
    copy: input.screen.copy
  };
}

export function compileScreenImagePrompt(input: JimengPromptInput) {
  const allowedFacts = input.facts.filter(
    (fact) =>
      input.screen.evidenceIds.includes(fact.id) &&
      fact.status !== "blocked" &&
      fact.commercialUse
  );
  if (
    input.screen.claimScope !== "creative" &&
    allowedFacts.length !== input.screen.evidenceIds.length
  ) {
    throw new Error(
      `${input.screen.id} 含无效或未授权证据，无法编译生图提示词。`
    );
  }

  const spec = buildJimengVisualSpec(input);
  const keyPointCopy = spec.copy.keyPoints
    .map((item, index) => `要点${index + 1}“${item}”`)
    .join("；");
  const prompt = [
    `【主体与任务】生成一张9:16竖版电商详情页，输出尺寸1440x2560。本屏任务是${spec.conversionTask}，只围绕“${spec.primarySellingPoint}”完成一个清晰的购买沟通任务。`,
    "【参考图身份】图1是产品主身份基准；其余图片只补充侧面、背面和细节。若不同角度存在冲突，以图1为准。严格保持产品的外形比例、结构、配色、纹理、部件位置和产品自身标识不变，只改变机位、光线与排版。不要沿用参考图中的旧标题、说明文字、尺寸线、箭头、角标、手、食物、道具、旧背景、旧版式或水印。",
    `【场景与动作】${spec.scene}。${spec.visualInstruction}`,
    `【镜头与构图】镜头：${spec.shot}。构图：${spec.composition}。通过${spec.proofMethod}直观证明本屏卖点，主体完整清晰，材质真实，商业摄影质感，光线服务于结构与细节。`,
    `【定稿文字】画面只出现以下定稿中文：主标题“${spec.copy.headline}”；副标题“${spec.copy.subheadline}”；正文“${spec.copy.body}”；${keyPointCopy}；底部小字“AI辅助生成”。所有文字逐字呈现，每段只出现一次，不改写、不翻译、不增删。`,
    "【排版】顶部安全区10%，左右安全边距8%，底部安全区12%；标题、副标题、正文、要点层级清楚，中文清晰可读，文字不遮挡产品轮廓、结构和关键细节。",
    `【约束】${spec.constraint}。只出现上述定稿文字，不新增参数、认证、评价、促销角标、其他Logo、额外卖点或水印。`
  ].join("\n");

  if (prompt.length > 2_000) {
    throw new Error(
      `${input.screen.id} 即梦生图指令超过2000字，请精简本屏视觉底稿。`
    );
  }
  return prompt;
}
