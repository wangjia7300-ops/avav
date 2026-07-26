import type {
  DetailScreen,
  EvidenceClaimScope,
  EvidenceFact,
  ScreenCopy
} from "@/lib/types";

export type ClaimGuardIssueKind =
  | "claim-strength-escalation"
  | "claim-scope-mismatch"
  | "creative-claim-without-evidence"
  | "internal-prompt-metadata";

export type ClaimGuardIssue = {
  ruleId: string;
  kind: ClaimGuardIssueKind;
  severity: "error" | "warning";
  screenId: string;
  field: string;
  phrase: string;
  evidenceIds: string[];
  message: string;
  fix: string;
};

export type ClaimGuardExecution = {
  screenId: string;
  visualInstruction?: string;
  visualPrompt?: string;
  englishPrompt?: string;
  negativePrompt?: string;
  productionReference?: Readonly<Record<string, unknown>>;
};

export type ClaimGuardInput = {
  screens: readonly DetailScreen[];
  facts: readonly EvidenceFact[];
  executions?:
    | readonly ClaimGuardExecution[]
    | Readonly<Record<string, ClaimGuardExecution>>;
};

type CopyField =
  | Exclude<keyof ScreenCopy, "keyPoints">
  | `keyPoints.${number}`;

type ClaimStrengthRule = {
  ruleId: string;
  pattern: RegExp;
  message: string;
  fix: string;
  contextTerms?: readonly string[];
};

type ScopeClaimRule = {
  ruleId: string;
  expectedScope: EvidenceClaimScope;
  pattern: RegExp;
  message: string;
  fix: string;
};

const CLAIM_STRENGTH_RULES: readonly ClaimStrengthRule[] = [
  {
    ruleId: "cleaning-result-escalation",
    pattern:
      /一冲(?:即|就)?净|一擦(?:即|就)?净|洁净如新|告别顽固(?:油污|污渍)|无需反复(?:刷洗|清洗)|污渍不易残留|简单冲洗(?:就能)?(?:洁净如新|干净)/g,
    message: "文案把“易清洗/日常好打理”升级成了未经原图授权的确定性清洁结果。",
    fix: "保留甲方图片原句，例如“釉面光洁易清洗、日常好打理”；不要承诺一冲或一擦即可达到特定结果。"
  },
  {
    ruleId: "cleaning-duration-escalation",
    pattern:
      /使用久了也不会(?:脱色|褪色)|多次清洗(?:依旧|仍)[^，。；]{0,8}|反复清洗(?:也)?(?:不|不会)[^，。；]{0,8}|批量清洗(?:更)?(?:高效|省心)|持久光洁/g,
    message: "文案新增了使用时长、反复清洗或批量效率结论，强于甲方图片中的基础声明。",
    fix: "仅保留图片原文中的“不脱色不褪色”或“易清洗”，不要新增次数、时长或效率承诺。"
  },
  {
    ruleId: "anti-slip-to-spill-proof",
    pattern: /防洒漏|不(?:用)?担心洒漏|不会洒漏|防泼洒/g,
    message: "文案把碗底防滑升级成了防洒漏，两个功能之间没有直接证据关系。",
    fix: "保留“防滑、贴合桌面、稳固不晃”等甲方图片原句，删除防洒漏结论。"
  },
  {
    ruleId: "food-contact-safety-escalation",
    pattern:
      /可?放心(?:放入|使用|加热)?|更安全|更安心|安全实用|绝对安全|零铅|0铅|无铅镉|零镉|0镉|零重金属|0重金属/g,
    contextTerms: ["微波", "加热", "铅", "镉", "有害物质", "重金属"],
    message: "文案把微波炉或铅镉原始声明升级成了综合安全、放心或零含量结论。",
    fix: "上传图片中的“不含铅镉等有害物质、可进微波炉等加热”可原句保留并提示人工复核；不要追加“放心、更安全、零含量”。"
  },
  {
    ruleId: "absorption-result-escalation",
    pattern:
      /(?:水渍|积水)?(?:一擦|一拖)(?:即|就|便|全|都)?(?:能|可)?(?:把)?(?:水渍|积水)?(?:全|都|完全)?(?:吸干|擦干|拖干)|(?:一次|一遍)(?:全|都|完全)?(?:吸干|擦干|拖干)/g,
    message: "文案把“吸水/超强吸水”升级成了未经原图授权的一次性完全吸干结果。",
    fix: "保留甲方图片中的“吸水、超强吸水”等原句；除非原图明确写明，否则不要承诺一擦、一拖或一次即可全部吸干。"
  }
];

const SCOPE_CLAIM_RULES: readonly ScopeClaimRule[] = [
  {
    ruleId: "mop-performance-scope-mismatch",
    expectedScope: "performance",
    pattern:
      /(?:耐用|超强吸水|强力吸水|快速吸水|吸水|吸干|省力|干湿两用|拖净|清洁力)/g,
    message: "文案出现了拖把效果结论，但本屏没有执行 performance 或 mixed 事实任务。",
    fix: "只有绑定同范围甲方事实时才能保留该效果；材质、外观或创意屏应删除效果扩写，只表达本屏已授权事实。"
  },
  {
    ruleId: "mop-mechanism-scope-mismatch",
    expectedScope: "mechanism",
    pattern:
      /(?:双驱动|旋转(?:清洗|洗脱|脱水|甩干)?|洗衣机式水篮|水篮|清洗脱水(?:二合一)?|脱水结构|甩干结构)/g,
    message: "文案出现了拖把驱动、旋转或脱水机制，但本屏没有执行 mechanism 或 mixed 事实任务。",
    fix: "只有绑定同范围甲方机制事实时才能保留；其他任务屏不得借结构词扩写工作原理。"
  }
];

const CREATIVE_WITHOUT_EVIDENCE_RULES: readonly ClaimStrengthRule[] = [
  {
    ruleId: "creative-size-fit-without-evidence",
    pattern: /大小合适|尺寸合适|顺手好用/g,
    message: "creative 空证据屏出现了尺寸或适配结论。",
    fix: "若甲方图片提供尺寸，请绑定对应规格事实并改为非 creative 声明；否则改成纯场景描述。"
  },
  {
    ruleId: "creative-time-saving-without-evidence",
    pattern:
      /省(?:却|下|了)?[^，。；]{0,8}(?:清洗|打理)[^，。；]{0,4}时间|节省[^，。；]{0,8}时间|省时/g,
    message: "creative 空证据屏出现了省时或清洗效率承诺。",
    fix: "若图片仅说明“日常好打理”，就保留该原句；不要扩写为节省时间。"
  },
  {
    ruleId: "creative-stacking-without-evidence",
    pattern: /叠放|节省(?:家居|收纳)?空间|橱柜层高|适配常规橱柜|置物架/g,
    message: "creative 空证据屏出现了叠放、节省空间或橱柜适配结论。",
    fix: "只有甲方图片或人工资料明确展示该能力时才能绑定事实使用；否则删除该功能声明。"
  }
];

const INTERNAL_METADATA_RULES = [
  {
    ruleId: "commercial-use-metadata-leak",
    pattern: /\bcommercial\s+use\s+allowed\b|\bcommercialUse\b/i,
    message: "生图提示词泄漏了内部 commercial use 权限元数据。"
  },
  {
    ruleId: "evidence-count-metadata-leak",
    pattern:
      /\bthis screen is grounded by\s+\d+\s+approved evidence item(?:\(s\)|s)?\b|\bapproved evidence item(?:\(s\)|s)?\b|\bevidence\s+count\b/i,
    message: "生图提示词泄漏了内部证据数量或 approved evidence 元数据。"
  }
] as const;

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, "");
}

function authorizedOriginalTexts(facts: readonly EvidenceFact[]) {
  return facts
    .filter(
      (fact) =>
        fact.commercialUse &&
        fact.status !== "blocked" &&
        (fact.sourceType === "image_text" || fact.sourceType === "user_input")
    )
    .map((fact) =>
      normalize([fact.label, fact.value, fact.evidence].filter(Boolean).join("；"))
    );
}

function copyFields(copy: ScreenCopy): Array<[CopyField, string]> {
  return [
    ["headline", copy.headline],
    ["subheadline", copy.subheadline],
    ["body", copy.body],
    ...copy.keyPoints.map(
      (value, index) =>
        [`keyPoints.${index}` as CopyField, value] as [CopyField, string]
    )
  ];
}

function findMatches(text: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  return Array.from(text.matchAll(matcher), (match) => match[0]).filter(Boolean);
}

function isAuthorizedOriginalPhrase(
  phrase: string,
  fieldText: string,
  originals: readonly string[],
  contextTerms: readonly string[] = []
) {
  const normalizedPhrase = normalize(phrase);
  const activeContext = contextTerms
    .filter((term) => fieldText.includes(term))
    .map(normalize);

  return originals.some(
    (source) =>
      source.includes(normalizedPhrase) &&
      (activeContext.length === 0 ||
        activeContext.some((term) => source.includes(term)))
  );
}

function issueKey(issue: ClaimGuardIssue) {
  return [
    issue.ruleId,
    issue.screenId,
    issue.field,
    normalize(issue.phrase)
  ].join("|");
}

function executionList(
  executions: ClaimGuardInput["executions"]
): readonly ClaimGuardExecution[] {
  if (!executions) return [];
  return Array.isArray(executions)
    ? executions
    : Object.values(executions as Readonly<Record<string, ClaimGuardExecution>>);
}

function executionPromptFields(
  execution: ClaimGuardExecution
): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ["visualInstruction", execution.visualInstruction ?? ""],
    ["visualPrompt", execution.visualPrompt ?? ""],
    ["englishPrompt", execution.englishPrompt ?? ""],
    ["negativePrompt", execution.negativePrompt ?? ""]
  ];

  Object.entries(execution.productionReference ?? {}).forEach(([key, value]) => {
    if (typeof value === "string") {
      fields.push([`productionReference.${key}`, value]);
    }
  });

  return fields;
}

/**
 * Read-only guard for claim-strength drift and internal prompt metadata.
 *
 * It reports issues only. Exact wording supplied by an authorized uploaded
 * image or user input is preserved and is not treated as an escalation.
 */
export function findClaimGuardIssues(input: ClaimGuardInput): ClaimGuardIssue[] {
  const issues: ClaimGuardIssue[] = [];
  const originals = authorizedOriginalTexts(input.facts);

  input.screens.forEach((screen) => {
    const copyClaimFields = copyFields(screen.copy).map(
        ([field, text]) => [`copy.${field}`, text] as [string, string]
      );
    const primaryRepeatsCopy = copyClaimFields.some(
      ([, text]) => normalize(text) === normalize(screen.primarySellingPoint)
    );
    const claimFields: Array<[string, string]> = [
      ...(primaryRepeatsCopy
        ? []
        : [["primarySellingPoint", screen.primarySellingPoint] as [string, string]]),
      ...copyClaimFields
    ];
    claimFields.forEach(([field, text]) => {
      SCOPE_CLAIM_RULES.forEach((rule) => {
        if (
          screen.claimScope === rule.expectedScope ||
          screen.claimScope === "mixed"
        ) {
          return;
        }

        findMatches(text, rule.pattern).forEach((phrase) => {
          issues.push({
            ruleId: rule.ruleId,
            kind: "claim-scope-mismatch",
            severity: "error",
            screenId: screen.id,
            field,
            phrase,
            evidenceIds: [...screen.evidenceIds],
            message: rule.message,
            fix: rule.fix
          });
        });
      });

      CLAIM_STRENGTH_RULES.forEach((rule) => {
        if (
          rule.contextTerms?.length &&
          !rule.contextTerms.some((term) => text.includes(term))
        ) {
          return;
        }
        findMatches(text, rule.pattern).forEach((phrase) => {
          if (
            isAuthorizedOriginalPhrase(
              phrase,
              text,
              originals,
              rule.contextTerms
            )
          ) {
            return;
          }

          issues.push({
            ruleId: rule.ruleId,
            kind: "claim-strength-escalation",
            severity: "error",
            screenId: screen.id,
            field,
            phrase,
            evidenceIds: [...screen.evidenceIds],
            message: rule.message,
            fix: rule.fix
          });
        });
      });

      if (screen.claimScope === "creative" && screen.evidenceIds.length === 0) {
        CREATIVE_WITHOUT_EVIDENCE_RULES.forEach((rule) => {
          findMatches(text, rule.pattern).forEach((phrase) => {
            issues.push({
              ruleId: rule.ruleId,
              kind: "creative-claim-without-evidence",
              severity: "error",
              screenId: screen.id,
              field,
              phrase,
              evidenceIds: [],
              message: rule.message,
              fix: rule.fix
            });
          });
        });
      }
    });
  });

  executionList(input.executions).forEach((execution) => {
    executionPromptFields(execution).forEach(([field, text]) => {
      INTERNAL_METADATA_RULES.forEach((rule) => {
        const match = text.match(rule.pattern);
        if (!match?.[0]) return;

        issues.push({
          ruleId: rule.ruleId,
          kind: "internal-prompt-metadata",
          severity: "error",
          screenId: execution.screenId,
          field: `execution.${field}`,
          phrase: match[0],
          evidenceIds: [],
          message: rule.message,
          fix: "从面向生图模型的提示词中移除内部权限、证据ID和证据数量，只保留可执行的视觉与定稿文案。"
        });
      });
    });
  });

  const unique = new Map<string, ClaimGuardIssue>();
  issues.forEach((issue) => unique.set(issueKey(issue), issue));
  return Array.from(unique.values());
}
