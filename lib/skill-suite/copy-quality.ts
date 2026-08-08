import type { DetailScreen } from "@/lib/types";

type CopyQualitySeverity = "error" | "warning";

type CopyQualityIssueCode =
  | "headline_too_long"
  | "subheadline_too_long"
  | "body_too_long"
  | "body_too_many_lines"
  | "body_too_many_sentences"
  | "advertising_tone"
  | "manual_tone"
  | "internal_process_tone"
  | "stereotype_label"
  | "headline_not_user_facing"
  | "body_not_user_facing"
  | "field_role_overlap"
  | "sentence_fragment"
  | "first_screen_lacks_warmth"
  | "final_screen_lacks_warmth"
  | "hard_to_restate";

export type CopyQualityIssue = {
  id: string;
  code: CopyQualityIssueCode;
  severity: CopyQualitySeverity;
  screenId: string;
  path: string;
  message: string;
  evidence: string;
  suggestion: string;
  preserveClientFacts: true;
};

export type CopyQualityReport = {
  issues: CopyQualityIssue[];
  counts: {
    errors: number;
    warnings: number;
  };
  hasErrors: boolean;
  repairPrompt: string;
};

type CopyField = "headline" | "subheadline" | "body" | `keyPoints[${number}]`;

type PhraseRule = {
  label: string;
  pattern: RegExp;
};

const ADVERTISING_TONE_RULES: readonly PhraseRule[] = [
  { label: "适配", pattern: /适配/u },
  { label: "兼顾", pattern: /兼顾/u },
  { label: "彰显", pattern: /彰显/u },
  { label: "赋能", pattern: /赋能/u },
  { label: "打造", pattern: /打造/u },
  { label: "满足多样需求", pattern: /满足.{0,4}多样.{0,4}需求/u },
  { label: "品质之选", pattern: /(?:品质|质感|理想)之选/u },
  { label: "焕新/解锁", pattern: /(?:焕新|解锁).{0,8}(?:体验|生活|场景)/u },
  { label: "全方位/一站式", pattern: /(?:全方位|一站式|多重).{0,8}(?:满足|解决|体验)/u },
  { label: "尽显", pattern: /尽显/u },
  { label: "完美适配", pattern: /完美适配/u },
  { label: "轻松满足", pattern: /轻松满足/u },
  { label: "专为…设计", pattern: /专为.{1,18}设计/u },
  { label: "提升/带来体验", pattern: /(?:提升|带来).{0,10}体验/u },
  { label: "高颜值/高品质", pattern: /高(?:颜值|品质|质感)/u },
  { label: "满满仪式感", pattern: /满满.{0,4}仪式感/u },
  { label: "保驾护航", pattern: /保驾护航/u }
];

const MANUAL_TONE_RULES: readonly PhraseRule[] = [
  {
    label: "“本产品/该产品”说明书句式",
    pattern: /(?:本产品|该产品).{0,16}(?:采用|配备|搭载|具备|支持|适用于)/u
  },
  {
    label: "“采用…材质/工艺/结构/设计”说明书句式",
    pattern: /采用.{1,24}(?:材质|工艺|结构|设计|系统)/u
  },
  {
    label: "“具备/支持…功能”说明书句式",
    pattern: /(?:具备|支持|搭载|配备).{1,20}(?:功能|模式|系统|结构)/u
  },
  {
    label: "“适用于/可用于”说明书句式",
    pattern: /(?:适用于|可用于).{1,24}(?:场景|环境|人群|用途)/u
  }
];

const STEREOTYPE_RULES: readonly PhraseRule[] = [
  { label: "全职主妇", pattern: /全职主妇/u },
  { label: "家庭主妇", pattern: /家庭主妇/u },
  { label: "家庭煮妇", pattern: /家庭煮妇/u },
  { label: "宝妈专属标签", pattern: /(?:宝妈|妈妈)(?:专用|必备|首选|标配)/u },
  { label: "性别专属标签", pattern: /(?:女生|女性|女人|男生|男性|男人)(?:专用|必备|首选|标配)/u },
  { label: "性别化职业标签", pattern: /(?:女白领|男白领|职场女性|职场男性)/u },
  { label: "独居白领标签", pattern: /独居白领/u },
  { label: "贤妻良母标签", pattern: /贤妻良母/u }
];

const INTERNAL_PROCESS_RULES: readonly PhraseRule[] = [
  {
    label: "甲方/上传图片等来源术语",
    pattern: /(?:甲方|用户上传|上传图片|素材图|参考图|原图|图片可见|图片标注|图片原文)/u
  },
  {
    label: "证据/事实等生产术语",
    pattern: /(?:事实库|可用事实|候选事实|证据(?:已|库|链|引用|授权)?|商业使用|可发布)/u
  },
  {
    label: "页面/模型等流程术语",
    pattern: /(?:本屏|该屏|页面任务|转化任务|策划|模型|提示词|claimScope|commercialUse|evidenceIds|fact-\d+)/iu
  },
  {
    label: "内部汇总标签",
    pattern: /(?:产品定位|卖点总览|核心卖点|参数总览|规格总览|功能总览|信息汇总)/u
  }
];

const USER_MEANING_RULES: readonly RegExp[] = [
  /(?:你|你的|自己)/u,
  /(?:每天|每日|日常|每一|一日三餐|早餐|午餐|晚餐|饭后|吃饭|喝水|做饭|出门|回家|上学|上班|通勤|旅途|睡前|清晨|夜晚|冷天|热天)/u,
  /(?:好洗|好拿|好握|好放|好用|好背|好穿|好收|好找|好认|好清理|好打理|好搭配|易洗|易拿|易用|易清理|易打理)/u,
  /(?:一眼|一看|看清|看懂|看明白|看得见|认得出|心里有数|一目了然)/u,
  /(?:省心|省力|省事|不费劲|不费力|不操心|少操心|更轻松|更从容|更顺手|稳稳当当|稳稳放好|顺手|随手|刚刚好|正合适|可选|用得上)/u,
  /(?:轻松|从容|清爽|温柔|温暖|舒服|自在|惬意|安心|踏实|有温度|有味道|不慌|不乱)/u,
  /(?:摆一摆|放一放|换个角度|先看清|先看懂|带着走|拿起来|穿上|背上|盛饭|盛汤|收起来|理一理|核对|对照|认清|比一比)/u,
  /(?:先|再|一起)?(?:选|挑)(?:对|准|好|清楚)|选前|挑选时/u,
  /(?:不用|无需|免得|省得)(?:再|另|额外)?(?:买|购|配|添)/u,
  /(?:一套|这套).{0,4}(?:配齐|齐全|够用|到位)|配齐.{0,6}(?:不用|无需|省心|省事|够用)/u,
  /(?:一擦|一拖|一洗|一冲|一拧|一压|一踩).{0,8}(?:干|净|吸干|擦干|拖净|脱水|甩干|省力|不费劲|不费力)/u,
  /(?:水渍|污渍|地面).{0,8}(?:擦干|吸干|拖净|吸走|带走|清理)/u
];

const BODY_MEANING_RULES: readonly RegExp[] = [
  ...USER_MEANING_RULES,
  /(?:让|把|用|放|拿|握|穿|背|装|盛|摆|洗|清理|打理|看|选|收|带|吃|喝|打开|关上|保持|形成|呈现|搭配|来自|经过|可|能|更|不用|不易|减少|避免|方便)/u
];

const TECHNICAL_HEADLINE_RULES: readonly RegExp[] = [
  /(?:\d+(?:\.\d+)?\s*(?:cm|mm|kg|g|ml|l|w|v|hz|mah|小时|分钟|天|年级|码|%|％|℃|°c|摄氏度))|(?:尺寸|容量|重量|功率|电压|频率|型号|规格|参数)/iu,
  /(?:材质|用材|面料|工艺|结构|内胆|陶土|陶瓷|不锈钢|硅胶|釉面|纤维|淬烧|烧制|EVA|PVC|ABS|PP)/iu,
  /(?:双驱动|驱动结构|旋转结构|水篮|洗脱结构|脱水结构|功能设计|核心设计)/u,
  /(?:产品|品类|配置|配件|清单|功能|卖点)(?:总览|汇总|说明|介绍|一览)?/u
];

const DANGLING_END_PATTERN =
  /(?:，|,|、|：|:|以及|并且|而且|但是|同时|通过|采用|搭配|包含|包括|用于|让|把|将|与|和|及|为|从|向|在|更)$/u;

const WARMTH_RULES: readonly RegExp[] = [
  /好好吃饭/u,
  /一日三餐/u,
  /每一餐/u,
  /每一天/u,
  /日常/u,
  /生活/u,
  /每天/u,
  /一天/u,
  /回家/u,
  /出门/u,
  /上学/u,
  /上班/u,
  /家里/u,
  /餐桌/u,
  /早餐/u,
  /晚餐/u,
  /清晨/u,
  /夜晚/u,
  /随手/u,
  /烟火/u,
  /相聚/u,
  /陪伴/u,
  /心意/u,
  /温暖/u,
  /温馨/u,
  /从容/u,
  /惬意/u,
  /松弛/u,
  /刚刚好/u,
  /点亮.{0,8}(?:生活|日常|时刻)/u,
  /让.{0,12}(?:生活|餐桌|一餐|日常).{0,8}(?:轻松|温柔|有味道|有质感)/u
];

const MULTI_TOPIC_RULES: readonly RegExp[] = [
  /兼顾.{1,16}(?:与|和|、)/u,
  /集.{1,24}于一体/u,
  /既.{1,16}又/u,
  /不仅.{1,20}(?:还|而且)/u,
  /同时.{1,20}(?:还|也|并)/u,
  /(?:全方位|多重|一站式).{0,12}(?:满足|解决|体验)/u
];

const FACT_PRESERVATION_NOTE =
  "仅调整外围表达和信息层级；甲方图片中的事实、参数、材质、功能、适用范围及原意必须逐项保留，不得机械替换、弱化或新增承诺。";

function visibleLength(value: string): number {
  return Array.from(value.replace(/\s/gu, "")).length;
}

function nonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function naturalSentenceCount(value: string): number {
  return nonEmptyLines(value)
    .flatMap((line) => line.split(/[。！？!?；;]+/u))
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

function matchedRuleLabels(value: string, rules: readonly PhraseRule[]): string[] {
  return rules.filter((rule) => rule.pattern.test(value)).map((rule) => rule.label);
}

function normalizedCopy(value: string): string {
  return value.replace(/[\s，。；、：！？,.!?:;\-—_]/gu, "").toLowerCase();
}

function characterBigrams(value: string): Set<string> {
  const normalized = normalizedCopy(value);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function bigramSimilarity(left: string, right: string): number {
  const leftGrams = characterBigrams(left);
  const rightGrams = characterBigrams(right);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let intersection = 0;
  leftGrams.forEach((gram) => {
    if (rightGrams.has(gram)) intersection += 1;
  });
  return intersection / (leftGrams.size + rightGrams.size - intersection);
}

function issueId(screenId: string, code: CopyQualityIssueCode, path: string): string {
  return `${screenId}:${code}:${path}`;
}

function createIssue(input: Omit<CopyQualityIssue, "id" | "preserveClientFacts">): CopyQualityIssue {
  return {
    ...input,
    id: issueId(input.screenId, input.code, input.path),
    preserveClientFacts: true
  };
}

function fieldEntries(screen: DetailScreen): Array<{ field: CopyField; value: string }> {
  return [
    { field: "headline", value: screen.copy.headline },
    { field: "subheadline", value: screen.copy.subheadline },
    { field: "body", value: screen.copy.body },
    ...screen.copy.keyPoints.map((value, index) => ({
      field: `keyPoints[${index}]` as const,
      value
    }))
  ];
}

function fieldPath(screenIndex: number, field: CopyField): string {
  return `screens[${screenIndex}].copy.${field}`;
}

function hasWarmth(value: string): boolean {
  return WARMTH_RULES.some((pattern) => pattern.test(value));
}

function hasUserMeaning(value: string): boolean {
  return USER_MEANING_RULES.some((pattern) => pattern.test(value));
}

function isClearlyTechnicalHeadline(value: string): boolean {
  return TECHNICAL_HEADLINE_RULES.some((pattern) => pattern.test(value));
}

function bodyHasNaturalMeaning(value: string): boolean {
  return BODY_MEANING_RULES.some((pattern) => pattern.test(value));
}

function isSentenceFragment(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const withoutTerminal = trimmed.replace(/[。！？!?]+$/u, "").trim();
  const openingPairs = [
    ["（", "）"],
    ["(", ")"],
    ["【", "】"],
    ["[", "]"],
    ["“", "”"],
    ["‘", "’"]
  ] as const;
  const hasUnbalancedPair = openingPairs.some(
    ([opening, closing]) =>
      Array.from(withoutTerminal).filter((char) => char === opening).length !==
      Array.from(withoutTerminal).filter((char) => char === closing).length
  );
  return hasUnbalancedPair || DANGLING_END_PATTERN.test(withoutTerminal);
}

function fieldRoleOverlapReasons(screen: DetailScreen): string[] {
  const fields = [
    ["标题", screen.copy.headline],
    ["副标题", screen.copy.subheadline],
    ["正文", screen.copy.body]
  ] as const;
  const reasons: string[] = [];

  for (let left = 0; left < fields.length; left += 1) {
    for (let right = left + 1; right < fields.length; right += 1) {
      const [leftLabel, leftValue] = fields[left];
      const [rightLabel, rightValue] = fields[right];
      const normalizedLeft = normalizedCopy(leftValue);
      const normalizedRight = normalizedCopy(rightValue);
      const shorter =
        normalizedLeft.length <= normalizedRight.length
          ? normalizedLeft
          : normalizedRight;
      const longer =
        normalizedLeft.length > normalizedRight.length
          ? normalizedLeft
          : normalizedRight;
      const containsRepeatedPhrase =
        shorter.length >= 6 && longer.includes(shorter);
      const similarity = bigramSimilarity(leftValue, rightValue);

      if (containsRepeatedPhrase || similarity >= 0.72) {
        reasons.push(
          `${leftLabel}与${rightLabel}${containsRepeatedPhrase ? "直接复述" : `相似度${similarity.toFixed(2)}`}`
        );
      }
    }
  }

  return reasons;
}

function restatementReasons(screen: DetailScreen, isFinalScreen: boolean): string[] {
  const reasons: string[] = [];
  const headlineLength = visibleLength(screen.copy.headline);
  const headlineClauseCount = screen.copy.headline
    .split(/[，,、；;\/+]/u)
    .map((part) => part.trim())
    .filter(Boolean).length;
  const combined = [
    screen.copy.headline,
    screen.copy.subheadline,
    screen.copy.body
  ].join(" ");

  if (headlineLength > 10) reasons.push(`主标题${headlineLength}字`);
  if (headlineClauseCount > 2) reasons.push(`主标题包含${headlineClauseCount}个并列片段`);
  if (!isFinalScreen && screen.copy.keyPoints.length > 3) {
    reasons.push(`包含${screen.copy.keyPoints.length}个要点`);
  }
  if (MULTI_TOPIC_RULES.some((pattern) => pattern.test(combined))) {
    reasons.push("同时承载多个利益点");
  }

  return reasons;
}

function createFieldToneIssues(
  screen: DetailScreen,
  screenIndex: number,
  rules: readonly PhraseRule[],
  code: "advertising_tone" | "manual_tone" | "internal_process_tone",
  label: string,
  severity: CopyQualitySeverity = "warning"
): CopyQualityIssue[] {
  return fieldEntries(screen).flatMap(({ field, value }) => {
    const matches = matchedRuleLabels(value, rules);
    if (matches.length === 0) return [];

    const path = fieldPath(screenIndex, field);
    return [
      createIssue({
        code,
        severity,
        screenId: screen.id,
        path,
        message: `${label}影响口语化和用户理解。`,
        evidence: `命中：${matches.join("、")}；原文：“${value}”`,
        suggestion: `改成用户在具体场景中能感受到的一句话，减少抽象包装词。${FACT_PRESERVATION_NOTE}`
      })
    ];
  });
}

function createStereotypeIssues(
  screen: DetailScreen,
  screenIndex: number
): CopyQualityIssue[] {
  return fieldEntries(screen).flatMap(({ field, value }) => {
    const matches = matchedRuleLabels(value, STEREOTYPE_RULES);
    if (matches.length === 0) return [];

    const path = fieldPath(screenIndex, field);
    return [
      createIssue({
        code: "stereotype_label",
        severity: "warning",
        screenId: screen.id,
        path,
        message: "人群称谓带有性别或职业刻板标签。",
        evidence: `命中：${matches.join("、")}；原文：“${value}”`,
        suggestion: `改用可观察的生活状态或使用场景描述人群，避免把家务、审美或购买动机绑定到性别和职业。${FACT_PRESERVATION_NOTE}`
      })
    ];
  });
}

function inspectScreen(
  screen: DetailScreen,
  screenIndex: number,
  totalScreens: number
): CopyQualityIssue[] {
  const issues: CopyQualityIssue[] = [];
  const headlinePath = fieldPath(screenIndex, "headline");
  const subheadlinePath = fieldPath(screenIndex, "subheadline");
  const bodyPath = fieldPath(screenIndex, "body");
  const headlineLength = visibleLength(screen.copy.headline);
  const subheadlineLength = visibleLength(screen.copy.subheadline);
  const bodyLength = visibleLength(screen.copy.body);
  const bodyLines = nonEmptyLines(screen.copy.body).length;
  const bodySentences = naturalSentenceCount(screen.copy.body);
  const isFirstScreen = screenIndex === 0;
  const isFinalScreen = screenIndex === totalScreens - 1;

  if (headlineLength > 10) {
    issues.push(
      createIssue({
        code: "headline_too_long",
        severity: "error",
        screenId: screen.id,
        path: headlinePath,
        message: "主标题超过10字，移动端首读负担过高。",
        evidence: `当前${headlineLength}字：“${screen.copy.headline}”`,
        suggestion: `保留本屏唯一核心信息，将场景解释移到副标题或正文。${FACT_PRESERVATION_NOTE}`
      })
    );
  }

  if (!hasUserMeaning(screen.copy.headline)) {
    const clearlyTechnical = isClearlyTechnicalHeadline(screen.copy.headline);
    issues.push(
      createIssue({
        code: "headline_not_user_facing",
        severity: clearlyTechnical ? "error" : "warning",
        screenId: screen.id,
        path: headlinePath,
        message: clearlyTechnical
          ? "主标题仍在报参数、材质、工艺或结构，没有先回答“这对我有什么用”。"
          : "主标题未命中明确的用户结果表达，需要人工复核是否足够好懂。",
        evidence: `当前标题：“${screen.copy.headline}”`,
        suggestion: clearlyTechnical
          ? `把主标题改成用户能感知的场景结果或选择结论；具体材质、参数和结构放到副标题或正文。${FACT_PRESERVATION_NOTE}`
          : `如果标题已经是自然的动作结果、使用感受或选择结论，可以保留；否则补成用户一眼能懂的结果。${FACT_PRESERVATION_NOTE}`
      })
    );
  }

  if (subheadlineLength > 20) {
    issues.push(
      createIssue({
        code: "subheadline_too_long",
        severity: "error",
        screenId: screen.id,
        path: subheadlinePath,
        message: "副标题超过20字，移动端信息层级不清。",
        evidence: `当前${subheadlineLength}字：“${screen.copy.subheadline}”`,
        suggestion: `只保留对主标题的一层解释，其余信息下沉到正文。${FACT_PRESERVATION_NOTE}`
      })
    );
  }

  if (bodyLength > 45) {
    issues.push(
      createIssue({
        code: "body_too_long",
        severity: "error",
        screenId: screen.id,
        path: bodyPath,
        message: "正文超过45字，难以在9:16移动端三行内自然呈现。",
        evidence: `当前${bodyLength}字：“${screen.copy.body}”`,
        suggestion: `保留事实主体、关键参数和用户利益，删除同义重复与空泛修饰。${FACT_PRESERVATION_NOTE}`
      })
    );
  }

  if (bodyLines > 3) {
    issues.push(
      createIssue({
        code: "body_too_many_lines",
        severity: "error",
        screenId: screen.id,
        path: bodyPath,
        message: "正文超过3个非空自然行。",
        evidence: `当前${bodyLines}行。`,
        suggestion: `合并同一语义的行，每屏最多保留3行且一行只承担一个自然意思。${FACT_PRESERVATION_NOTE}`
      })
    );
  }

  if (bodySentences > 3) {
    issues.push(
      createIssue({
        code: "body_too_many_sentences",
        severity: "error",
        screenId: screen.id,
        path: bodyPath,
        message: "正文超过3个自然句。",
        evidence: `当前${bodySentences}句：“${screen.copy.body}”`,
        suggestion: `按“一屏一事”合并或下沉次要句，只保留最多3个自然句。${FACT_PRESERVATION_NOTE}`
      })
    );
  }

  if (!bodyHasNaturalMeaning(screen.copy.body)) {
    issues.push(
      createIssue({
        code: "body_not_user_facing",
        severity: "error",
        screenId: screen.id,
        path: bodyPath,
        message: "正文只是属性名词堆叠，没有说明用户在什么场景下如何理解或使用。",
        evidence: `当前正文：“${screen.copy.body}”`,
        suggestion: `用完整自然句连接“具体场景/动作—甲方事实—用户得到的结果”，不要照抄参数清单。${FACT_PRESERVATION_NOTE}`
      })
    );
  }

  fieldEntries(screen).forEach(({ field, value }) => {
    if (!isSentenceFragment(value)) return;
    issues.push(
      createIssue({
        code: "sentence_fragment",
        severity: "error",
        screenId: screen.id,
        path: fieldPath(screenIndex, field),
        message: "文案以连接词、标点或未闭合符号结尾，属于残句。",
        evidence: `当前文案：“${value}”`,
        suggestion: `重新写成符合本字段长度限制的完整表达，严禁按字符截断。${FACT_PRESERVATION_NOTE}`
      })
    );
  });

  issues.push(
    ...createFieldToneIssues(
      screen,
      screenIndex,
      ADVERTISING_TONE_RULES,
      "advertising_tone",
      "广告腔词",
      "error"
    ),
    ...createFieldToneIssues(
      screen,
      screenIndex,
      MANUAL_TONE_RULES,
      "manual_tone",
      "产品说明书式句法"
    ),
    ...createFieldToneIssues(
      screen,
      screenIndex,
      INTERNAL_PROCESS_RULES,
      "internal_process_tone",
      "内部生产术语",
      "error"
    ),
    ...createStereotypeIssues(screen, screenIndex)
  );

  const overlapReasons = fieldRoleOverlapReasons(screen);
  if (overlapReasons.length > 0) {
    issues.push(
      createIssue({
        code: "field_role_overlap",
        severity: "error",
        screenId: screen.id,
        path: `screens[${screenIndex}].copy`,
        message: "标题、副标题和正文没有分工，出现同一句话向下复述。",
        evidence: overlapReasons.join("；"),
        suggestion: `标题只给用户结论，副标题只解释一层事实，正文只补场景、动作和结果；三层不要互相改写。${FACT_PRESERVATION_NOTE}`
      })
    );
  }

  if (isFirstScreen) {
    const openingCopy = `${screen.copy.headline} ${screen.copy.subheadline}`;
    if (!hasWarmth(openingCopy)) {
      issues.push(
        createIssue({
          code: "first_screen_lacks_warmth",
          severity: "warning",
          screenId: screen.id,
          path: `screens[${screenIndex}].copy`,
          message: "首屏标题层缺少可感知的生活场景或情绪温度。",
          evidence: `首屏标题与副标题：“${openingCopy}”`,
          suggestion: `让用户先看见与自己有关的生活瞬间，再承接产品事实；不要把首屏写成品名和属性清单。${FACT_PRESERVATION_NOTE}`
        })
      );
    }
  }

  if (isFinalScreen) {
    const closingCopy = `${screen.copy.headline} ${screen.copy.subheadline} ${screen.copy.body}`;
    if (!hasWarmth(closingCopy)) {
      issues.push(
        createIssue({
          code: "final_screen_lacks_warmth",
          severity: "warning",
          screenId: screen.id,
          path: `screens[${screenIndex}].copy`,
          message: "收尾屏停留在卖点汇总，缺少让人记住的生活感受。",
          evidence: `收尾文案：“${closingCopy}”`,
          suggestion: `在已确认卖点之后补一个克制、有温度的收束句，不虚构促销、销量或效果。${FACT_PRESERVATION_NOTE}`
        })
      );
    }
  }

  const reasons = restatementReasons(screen, isFinalScreen);
  if (reasons.length > 0) {
    issues.push(
      createIssue({
        code: "hard_to_restate",
        severity: "warning",
        screenId: screen.id,
        path: `screens[${screenIndex}].copy`,
        message: "本屏难以让用户用一句话复述。",
        evidence: reasons.join("；"),
        suggestion: `只保留一个核心卖点、一个场景利益和一组直接证据，其他内容移到相邻屏。${FACT_PRESERVATION_NOTE}`
      })
    );
  }

  return issues;
}

export function buildCopyQualityRepairPrompt(
  issues: readonly CopyQualityIssue[]
): string {
  if (issues.length === 0) {
    return [
      "文案质量检查未发现需要修复的问题。",
      FACT_PRESERVATION_NOTE
    ].join("\n");
  }

  return [
    "只修复下列路径中的文案质量问题，不得修改未列出的字段。",
    FACT_PRESERVATION_NOTE,
    "不得新增百分比、认证、材质、规格、功效、时长、排名、用户证言或交易承诺。",
    ...issues.map(
      (issue, index) => {
        const conciseSuggestion = issue.suggestion
          .replace(FACT_PRESERVATION_NOTE, "")
          .trim();
        return `${index + 1}. [${issue.severity}] ${issue.path}：${issue.message} 修复方向：${conciseSuggestion}`;
      }
    )
  ].join("\n");
}

export function checkCopyQuality(
  screens: readonly DetailScreen[]
): CopyQualityReport {
  const issues = screens.flatMap((screen, index) =>
    inspectScreen(screen, index, screens.length)
  );
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;

  return {
    issues,
    counts: { errors, warnings },
    hasErrors: errors > 0,
    repairPrompt: buildCopyQualityRepairPrompt(issues)
  };
}
