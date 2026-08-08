import type {
  DetailPlanFoundation,
  DetailPlan,
  DetailScreen,
  EvidenceFact,
  ExecutionMode,
  ProductResearch,
  SupplementalBrief
} from "@/lib/types";
import { buildScreenContracts } from "@/lib/skill-suite/screen-contracts";
import {
  buildCopyCompilerGuidance,
  buildCopySemanticBriefs
} from "@/lib/skill-suite/ecommerce-copy-compiler";
import {
  allowedRepairFieldsByScreen,
  type PlanRepairIssue
} from "@/lib/skill-suite/plan-repair";

const JSON_ONLY = [
  "只返回一个合法 JSON 对象。",
  "不要 Markdown，不要代码围栏，不要解释。",
  "不得省略必填字段，不得输出 null，不得用省略号。"
].join("\n");

const JSON_REPAIR_PATCH_ONLY = [
  "只返回一个合法 JSON 对象。",
  "不要 Markdown，不要代码围栏，不要解释。",
  "不得省略结构化输出要求的授权字段；无需修改的授权字段返回 null；至少一个授权字段必须返回真实的新值；不得用省略号。"
].join("\n");

const CLAIM_SCOPE_RESTRICTIONS: Record<string, string> = {
  specification: "尺寸、容量、重量、功率、电压、频率、型号、时长和任何数字参数",
  material: "未经识别的面料、材质、内胆、成分或工艺",
  performance:
    "保暖、保温、温暖、暖意、暖感、暖和、御寒、暖脚、蓄热、柔软、舒适、亲肤、轻盈、防滑、防水、防泼水、耐磨、轻量、减重、缓震、支撑、抗菌、除臭、透气、隔热、防漏、密封、抗撕、耐撕、耐用、承重、护脊、减压、安全、持久",
  mechanism: "工作原理、功能结构、循环、过滤、回弹、导流或效果实现机制",
  service: "包装清单、配件、售后、质保、保修、退换、客服或包邮",
  promotion: "价格、优惠、赠品、限时、折扣、满减或促销"
};

function buildUnavailableClaimScopeRule(facts: readonly EvidenceFact[]) {
  const supported = new Set(
    facts
      .filter((fact) => fact.status !== "blocked" && fact.commercialUse)
      .map((fact) => fact.claimScope)
  );
  const unavailable = Object.entries(CLAIM_SCOPE_RESTRICTIONS).filter(
    ([scope]) => !supported.has(scope as EvidenceFact["claimScope"])
  );
  if (!unavailable.length) return "所有声明范围均有可用事实。";
  return [
    `本项目没有以下范围的可用事实：${unavailable.map(([scope]) => scope).join("、")}。`,
    ...unavailable.map(
      ([scope, words]) =>
        `禁止把 ${scope} 写成产品卖点；primarySellingPoint、headline、subheadline、body、keyPoints、产品定位、核心卖点和决策链中不得出现：${words}。`
    )
  ].join("\n");
}

export function buildPlanningFoundationPrompt(
  research: ProductResearch,
  brief: SupplementalBrief
) {
  const usableFacts = research.facts.filter(
    (fact) => fact.status !== "blocked" && fact.commercialUse
  );

  return [
    "你是电商详情页四件套中的“详情页策划”模块。先只生成15屏策划的策略骨架，不生成 screens。",
    "最多提炼6个核心卖点。甲方上传图片中的可用事实可以改善语义，但不得新增图片外参数、认证、量化结论或绝对化承诺。",
    "只有 facts 才是产品事实授权源；research 的 summary、visualAudit、risks 以及用户填写的目标人群/语气只作策划背景，不能把可见材质自动升级为保暖、舒适、柔软、防滑、耐磨等功效。",
    "决策链必须适用于15屏9:16移动详情页，暂停主图；不得强制加入没有证据的包装、售后、促销或认证。",
    `产品图研：${JSON.stringify(research)}`,
    `用户补充：${JSON.stringify(brief)}`,
    `可商业使用事实：${JSON.stringify(usableFacts)}`,
    buildUnavailableClaimScopeRule(usableFacts),
    "返回结构：",
    JSON.stringify(
      {
        productPositioning: "一句定位",
        coreSellingPoints: ["2到6个卖点"],
        personas: [
          {
            name: "人群名",
            context: "使用情境",
            pain: "痛点",
            decisionTrigger: "决策触发"
          }
        ],
        decisionChain: ["至少3步"],
        globalVisualDirection:
          "统一色板、字体、情绪、产品一致性和9:16移动端安全区"
      },
      null,
      2
    ),
    "personas 至少2项；不要返回 screens、source 或 generatedAt。",
    JSON_ONLY
  ].join("\n\n");
}

export function buildPlanningFoundationRepairPrompt(input: {
  research: ProductResearch;
  brief: SupplementalBrief;
  rejectedFoundation: DetailPlanFoundation;
  issues: readonly string[];
}) {
  const usableFacts = input.research.facts.filter(
    (fact) => fact.status !== "blocked" && fact.commercialUse
  );
  return [
    "策划策略骨架被确定性证据校验拒绝。请只修正骨架，不生成 screens。",
    `校验问题：${input.issues.join("；")}`,
    "只能由下方可用事实支撑产品属性。目标人群、语气、research summary、visualAudit 和 risks 不是产品事实授权源。",
    "如果没有 performance 事实，必须从产品定位、核心卖点和决策链中删除保暖、温暖、舒适、柔软、防滑、耐磨等产品效果表达，改为可见外观、材质名称、视觉细节、场景氛围或中性品类表达。personas 的 context/pain 可以描述用户自身需求，但 decisionTrigger 不得伪装成已有产品功效。",
    "如果没有 service / promotion / specification / mechanism 事实，也不得补充对应承诺。",
    `可用事实：${JSON.stringify(usableFacts)}`,
    buildUnavailableClaimScopeRule(usableFacts),
    `用户补充背景：${JSON.stringify(input.brief)}`,
    `被拒骨架：${JSON.stringify(input.rejectedFoundation)}`,
    "返回字段与被拒骨架完全一致；不要返回 screens、source 或 generatedAt。",
    JSON_ONLY
  ].join("\n\n");
}

export function buildPlanningScreenBatchPrompt(input: {
  research: ProductResearch;
  brief: SupplementalBrief;
  foundation: DetailPlanFoundation;
  indexes: readonly number[];
}) {
  const usableFacts = input.research.facts.filter(
    (fact) => fact.status !== "blocked" && fact.commercialUse
  );
  const contracts = buildScreenContracts(usableFacts);
  const screenTargets = buildCopySemanticBriefs(
    input.indexes.map((index) => contracts[index - 1]),
    usableFacts
  );

  return [
    "你是电商详情页四件套中的“详情页策划”模块。根据已经批准的策略骨架，只生成本批屏幕。",
    "全部页面为9:16竖版、移动优先；暂停主图。每屏一个转化任务、一个核心卖点或信息任务。",
    "禁止循环复用标题，禁止字符硬截断，禁止把用户差评写进正向商业声明。",
    "甲方上传图片内的 verified 事实和 commercialUse=true 的 candidate 均可进入文案；可以保留原意并改善语义。",
    "不得凭空新增图片中不存在的参数、认证、量化结论、绝对化承诺或虚构用户评价。",
    "每屏必须声明 claimScope。单一事实屏必须引用至少1个同 claimScope 的可用 evidenceId；组合2种以上事实范围的矩阵/总结屏使用 mixed 并引用至少2条事实；不承载产品事实的场景、情绪、搭配或中性建议屏使用 creative 且 evidenceIds 为空。",
    "creative 屏不得出现保暖、保温、御寒、暖脚、柔软、舒适、亲肤、轻盈、防滑、防水、耐磨、轻量、减重、缓震、支撑、抗菌、除臭、安全、耐用、售后、质保、赠品、价格、包装等新的产品属性或交易承诺。",
    buildCopyCompilerGuidance(),
    `策略骨架：${JSON.stringify(input.foundation)}`,
    `可商业使用事实：${JSON.stringify(usableFacts)}`,
    buildUnavailableClaimScopeRule(usableFacts),
    `用户补充：${JSON.stringify(input.brief)}`,
    `本批屏幕目标：${JSON.stringify(screenTargets)}`,
    "返回结构：",
    JSON.stringify(
      {
        screens: [
          {
            id: "必须等于目标id",
            index: 1,
            subjectKey: "必须逐字复制目标 subjectKey",
            userQuestion: "必须逐字复制目标 userQuestion",
            role: "页面角色",
            conversionTask: "本屏转化任务",
            primarySellingPoint: "唯一核心卖点或信息任务",
            claimScope:
              "appearance | visible_text | specification | material | performance | mechanism | service | promotion | creative | mixed",
            evidenceIds: [
              "非creative屏至少1项；只引用同claimScope且可商业使用的事实id"
            ],
            proofMethod: "本屏证明方式",
            copy: {
              headline: "用户一看就懂的唯一标题，最多10字",
              subheadline: "只解释主标题一层，最多20字",
              body: "最多45字、最多3个自然句的完整人话，不得截断",
              keyPoints: ["1到3条直接短要点"]
            },
            scene: "独立场景",
            shot: "镜头",
            composition: "9:16构图与安全区",
            transition: "与前后屏衔接"
          }
        ]
      },
      null,
      2
    ),
    `screens 必须正好${input.indexes.length}项，且只能包含目标 id：${screenTargets.map((item) => item.screenId).join("、")}。`,
    "所有字段必须填写；subjectKey、userQuestion、claimScope 与 evidenceIds 必须逐字执行本批任务契约，不得擅自换屏、循环复用事实或把全部卖点塞进一屏；不得返回策略骨架字段、source 或 generatedAt。",
    JSON_ONLY
  ].join("\n\n");
}

export function buildPlanningRepairPrompt(input: {
  research: ProductResearch;
  brief: SupplementalBrief;
  rejectedPlan: DetailPlan;
  issues: readonly PlanRepairIssue[];
  targetIds: readonly string[];
}) {
  const targetId = input.targetIds[0] ?? "screen-xx";
  const usableFacts = input.research.facts.filter(
    (fact) => fact.status !== "blocked" && fact.commercialUse
  );
  const targetIdSet = new Set(input.targetIds);
  const targetScreens = input.rejectedPlan.screens.filter((screen) =>
    targetIdSet.has(screen.id)
  );
  const sequenceContext = input.rejectedPlan.screens.map((screen) => ({
    id: screen.id,
    subjectKey: screen.subjectKey,
    userQuestion: screen.userQuestion,
    role: screen.role,
    primarySellingPoint: screen.primarySellingPoint,
    headline: screen.copy.headline,
    subheadline: screen.copy.subheadline
  }));
  const targetEvidenceIds = new Set(
    targetScreens.flatMap((screen) => screen.evidenceIds)
  );
  const targetFacts = usableFacts.filter((fact) =>
    targetEvidenceIds.has(fact.id)
  );
  const contracts = buildScreenContracts(usableFacts);
  const targetContracts = buildCopySemanticBriefs(
    contracts.filter((contract) =>
      targetScreens.some((screen) => screen.id === contract.id)
    ),
    usableFacts
  );
  const allowedFields = Object.fromEntries(
    allowedRepairFieldsByScreen(input.issues, input.targetIds)
  );
  const targetAllowedFields = allowedFields[targetId] ?? [];
  const exampleChanges = Object.fromEntries(
    targetAllowedFields.map((field, index) => [
      field,
      index > 0
        ? null
        : field === "copy.keyPoints"
          ? ["修正后要点"]
          : "修正后内容"
    ])
  );
  const patchExample = JSON.stringify({
    screenId: targetId,
    changes: exampleChanges
  });

  return [
    "你刚才返回的15屏策划被确定性校验拒绝。现在只修复一个冲突屏，不得切换模板，不得重写其他屏。",
    `结构化校验问题：${JSON.stringify(input.issues)}`,
    "修复规则：",
    "1. 只返回一个差异 patch，根对象只能有 screenId 和 changes；不要返回 screens 数组或完整 DetailScreen。",
    "2. changes 必须列出“字段授权表”的全部字段；无需修改的授权字段填 null，至少一个字段必须填写真实新值。不得新增未授权字段。",
    "3. id、index、subjectKey、userQuestion、claimScope、evidenceIds 由服务端锁定，禁止放入 changes，也禁止以其他根字段返回。",
    "4. 甲方图片原文可以保留并改善语义；若问题是声明强度升级，只把措辞降回 evidence 所写强度，不删除事实、不创造新效果。",
    "5. 标题从 userQuestion 出发回答用户，不得把材质、结构、工艺或内部任务名直接当结论；副标题承接事实，正文用一个生活动作解释意义。",
    "6. 跨屏重复只修改 issue.screenIds 指定的后出现屏；relatedScreenIds 仅供比较，禁止改写，不能只换同义词。",
    "7. 创意场景重复时，仅更换被授权屏的空间、时间、人物动作、镜头或构图；不得连带修改固定事实与问题。",
    "8. 返回前逐屏自检：标题给用户结论，副标题给事实解释，正文给场景/动作和结果（措辞克制）；三层不能直接复述或高度相似。",
    "9. 文案里不得出现甲方图片、上传图片、图片可见、证据、事实、本屏、页面、模型、提示词、商业使用等内部术语；来源只保留在 proofMethod。",
    "10. 如果正文以“同时、以及、通过、采用、搭配、把、让、与、和”等连接词结尾，必须整句重写，不能补一个机械尾巴。",
    buildCopyCompilerGuidance(),
    `本屏已锁定的证据事实：${JSON.stringify(targetFacts)}`,
    buildUnavailableClaimScopeRule(usableFacts),
    `用户补充：${JSON.stringify(input.brief)}`,
    `15屏序列上下文：${JSON.stringify(sequenceContext)}`,
    `目标屏任务契约：${JSON.stringify(targetContracts)}`,
    `字段授权表：${JSON.stringify(allowedFields)}`,
    `只需修复的原屏：${JSON.stringify(targetScreens)}`,
    `目标ID（必须完全一致）：${input.targetIds.join("、")}`,
    `返回示例：${patchExample}。字段名使用授权表中的点路径原文；无需修改的字段填 null；copy.keyPoints 的非空值是1到3条字符串数组，其余非空值都是字符串。`,
    '仅返回上述 patch JSON，不得返回其他屏、基础策略、source 或 generatedAt。',
    JSON_REPAIR_PATCH_ONLY
  ].join("\n\n");
}

export function buildPlanningRepairRetryPrompt(input: {
  originalPrompt: string;
  errorCode: string;
  errorMessage: string;
  errorDetails: readonly string[];
  targetIds: readonly string[];
}) {
  return [
    input.originalPrompt,
    "上一次单屏修复 patch 仍未通过契约。请根据下面的服务端反馈重新返回 patch，不要沿用上一次的空变更、串屏或越界结构。",
    `上次错误码：${input.errorCode}`,
    `上次错误：${input.errorMessage}`,
    `契约反馈：${JSON.stringify(input.errorDetails)}`,
    `本次 screenId 必须且只能是：${input.targetIds.join("、")}`,
    '仅返回 {"screenId":"screen-xx","changes":{...}}；changes 必须列出全部授权字段，未修改项填 null，且至少一个字段真实变化。不要解释，不要 Markdown。',
    JSON_REPAIR_PATCH_ONLY
  ].join("\n\n");
}

export function buildExecutionPrompt(
  screens: readonly DetailScreen[],
  research: ProductResearch,
  plan: DetailPlan,
  mode: ExecutionMode
) {
  const facts = research.facts.filter(
    (fact) => fact.status !== "blocked" && fact.commercialUse
  );

  return [
    "你是电商详情页四件套中的“详情页执行”模块。",
    "把策划转成可交付成果 A / B / D / E；即使当前选择某一种模式，也必须返回完整四类字段，便于用户切换。",
    "A=文案定稿；B=AI视觉/生图指令；D=AI搜索/GEO优化；E=视觉制作参考（默认）。",
    "文案层只负责画面写什么，提示词层不得同义复述或再次改写文案；copyFinal 必须逐字段、逐字等于策划 copy。",
    "你只返回不含定稿文案原文的中文即梦视觉底稿 visualInstruction 与 visualPrompt。服务端会在通过校验后，把 copyFinal 精确编译进最终即梦生图指令一次。",
    "每屏提示词必须强调自身场景、镜头、构图、光线和证明方式，禁止粘贴全部卖点。",
    "visualInstruction 与 visualPrompt 禁止出现本屏标题、副标题、正文、要点原文，也禁止出现 text-free、no text、无文字底图、不要文字或后期再排文字等要求。",
    "visualInstruction 与 visualPrompt 禁止输出 commercialUse、evidenceIds、claimScope、source、generatedAt 等内部字段名。",
    "visualInstruction 与 visualPrompt 也禁止出现 Commercial use allowed、approved evidence item、evidence count 等内部权限或证据数量描述。",
    "visualInstruction 只补充人物/道具动作、光线、材质和视觉风格，不重复 screens 已给出的 scene、shot、composition、proofMethod，也不得写华丽词堆。",
    "visualPrompt 是兼容旧数据字段的中文即梦视觉摘要，必须写明9:16竖版、产品一致性和文字层级预留区，但不得复制文案。",
    "negativePrompt 字段仅保存一条简短的“约束条件”，最多120个汉字；不要输出逗号堆叠的通用负面词库。",
    "可使用标记为 commercialUse=true 的甲方普通民用属性；不得擅自新增量化结论、认证、绝对化词语、医疗安全功效或虚假用户评价。",
    "固定要求：9:16、文字与背景对比度至少4.5:1、必须含AI辅助生成标识。暗色模式只能写在 productionReference.darkMode，禁止混入本次静态生图指令。",
    `当前模式：${mode}`,
    `统一视觉方向：${plan.globalVisualDirection}`,
    `可用事实：${JSON.stringify(facts)}`,
    buildUnavailableClaimScopeRule(facts),
    `待执行屏幕：${JSON.stringify(screens)}`,
    "返回结构：",
    JSON.stringify(
      {
        executions: [
          {
            screenId: "screen-01",
            copyFinal: {
              headline: "原意定稿",
              subheadline: "原意定稿",
              body: "完整句子",
              keyPoints: ["短要点"]
            },
            visualInstruction: "中文即梦视觉补充，约60到160字；只写人物/道具动作、光线、材质和风格，不重复策划字段，不复制文案",
            visualPrompt: "中文即梦视觉摘要，约80到160字；写明9:16竖版、产品一致性与文字层级预留区，不复制文案",
            negativePrompt: "一条不超过120字的本屏约束条件，不要堆叠通用负面词",
            geo: {
              query: "用户可能向AI购物助手提出的问题",
              answer: "只基于证据的简短答案",
              entities: ["品类", "属性"]
            },
            productionReference: {
              information: "本屏信息层级",
              wireframe: "从上到下的线框描述",
              typography: "字号、字重、行距、对比度",
              sceneDirection: "场景、镜头、光线、主体占比",
              palette: ["#FFFFFF", "#333333", "#C65F32"],
              darkMode: "暗色模式适配",
              designNotes: "执行与合规备注"
            },
            aiLabel: "AI辅助生成",
            source: "model",
            generatedAt: "ISO时间"
          }
        ]
      },
      null,
      2
    ),
    `必须返回且只返回这${screens.length}个 screenId：${screens.map((item) => item.id).join("、")}`,
    JSON_ONLY
  ].join("\n\n");
}

export function buildExecutionRepairPrompt(input: {
  screens: readonly DetailScreen[];
  research: ProductResearch;
  plan: DetailPlan;
  mode: ExecutionMode;
  rejectedResult: unknown;
  issues: readonly string[];
}) {
  const forbiddenCopy = input.screens.map((screen) => ({
    screenId: screen.id,
    forbiddenInVisualDraft: [
      screen.copy.headline,
      screen.copy.subheadline,
      screen.copy.body,
      ...screen.copy.keyPoints
    ]
  }));

  return [
    buildExecutionPrompt(
      input.screens,
      input.research,
      input.plan,
      input.mode
    ),
    "你刚才返回的执行交付被确定性校验拒绝。请修正并重新返回本批完整 executions。",
    `校验问题：${input.issues.join("；")}`,
    `visualInstruction 与 visualPrompt 的禁入原文：${JSON.stringify(forbiddenCopy)}`,
    "copyFinal 仍需逐字保留上述定稿文案；visualInstruction 只补充动作、光线、材质和风格，visualPrompt 只做中文摘要；两者绝对不能出现任何禁入原文或内部字段。",
    "删除 Commercial use allowed、approved evidence item、evidence count 等内部元数据；它们不是给生图模型看的视觉指令。",
    "不要返回 englishPrompt；不要要求无文字底图；visualPrompt 必须使用中文并写明9:16竖版。",
    "negativePrompt 只是兼容字段，请改成一条不超过120字的中文约束条件，不要输出通用负面词清单。",
    `被拒结果：${JSON.stringify(input.rejectedResult)}`,
    JSON_ONLY
  ].join("\n\n");
}

export function buildQAPrompt(input: {
  research: ProductResearch;
  plan: DetailPlan;
  executions: Record<string, unknown>;
  deterministicFindings: readonly unknown[];
}) {
  return [
    "你是独立、只读的电商详情页质检模块。禁止修改输入数据，只输出问题报告。",
    "按严重级别输出：error=必须修复，warning=优化建议，pass=已通过。",
    "审查15个模块：策划完整性、前三屏、卖点唯一性、信任证据、视觉一致性、移动端、收尾、促销、AI标识、广告法、可访问性、暗色模式、2026适配、A/B迭代、文案与转译语义一致性。",
    "重点检查：15屏数量与screenId、标题重复、未验证商业声明、文案和提示词混写、提示词过度相似、9:16、正文字号14px、对比度4.5:1、AI辅助生成标识、虚假评价。",
    "文案与转译语义一致性必须逐屏检查：标题是否直接回答 userQuestion；副标题是否锚定本屏事实且不扩写承诺；正文是否用完整人话连接场景/动作、事实和用户结果；三层是否各司其职而非同义复述。",
    "同时核对即梦转译：最终指令中的主体、场景、镜头、构图、证明方式必须与策划一致；定稿文案只出现一次，视觉增量不得替换产品主体、重设场景或覆盖策划任务。",
    "凡 sourceAssetIds 指向用户上传图片且 commercialUse=true 的内容，都属于甲方授权基础资料，不得仅因缺少外部报告判为 error 或从文案中删除。",
    "敏感、量化、认证、医疗安全或绝对化图片原文可以标记 warning 提醒人工复核；不要把“来源于甲方上传图片”本身判为发布阻断。",
    "包装、售后、促销、用户评价和检测报告都是可选资料。输入中没有相应事实时，保持缺省是正确的事实克制，不得以“缺乏促销”“缺乏评价”“缺乏包装/售后信息”判 warning 或 error。",
    "同理，输入中没有 performance 事实时，不得建议补充保暖、锁温、防滑、耐磨、舒适等功效卖点；不得把拒绝臆造功效判为策划不完整。",
    "规则引擎已给出一批客观发现；不得把 error 降级。可以补充语义层问题。",
    `输入：${JSON.stringify(input)}`,
    "返回结构：",
    JSON.stringify(
      {
        findings: [
          {
            id: "qa-001",
            severity: "error | warning | pass",
            module: "模块名",
            screenId: "可选screen-01",
            title: "简短问题",
            evidence: "具体证据",
            fix: "可执行修正"
          }
        ],
        summary: "总体结论",
        source: "rules+model",
        generatedAt: "ISO时间"
      },
      null,
      2
    ),
    JSON_ONLY
  ].join("\n\n");
}
