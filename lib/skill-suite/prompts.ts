import type {
  DetailPlanFoundation,
  DetailPlan,
  DetailScreen,
  EvidenceFact,
  ExecutionMode,
  ProductResearch,
  ScreenExecution,
  SupplementalBrief
} from "@/lib/types";
import { buildScreenContracts } from "@/lib/skill-suite/screen-contracts";
import {
  allowedRepairFieldsByScreen,
  type PlanRepairIssue
} from "@/lib/skill-suite/plan-repair";

const JSON_ONLY = [
  "只返回一个合法 JSON 对象。",
  "不要 Markdown，不要代码围栏，不要解释。",
  "不得省略必填字段，不得输出 null，不得用省略号。"
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

export function buildResearchPrompt(assetIds: readonly string[], notes: string) {
  return [
    "你是电商详情页四件套中的“图片研究”模块。",
    "请只分析本次随消息传入的产品图，不使用常识补齐不可见参数。",
    "用户上传图片中的可识别文字、参数、材质、功能、适用人群和卖点全部属于甲方一方基础资料，默认允许用于文案。",
    "完成八维视觉审计：构图、卖点层级、配色、字体、视觉动线、材质工艺、算法适配、情绪设计。",
    "每个事实都必须带 evidence 和 sourceAssetIds。可见结构/颜色/品牌标为 verified；图片文字、参数与声明可标为 candidate，但 commercialUse 必须为 true。",
    "必须拆成6到12条互不重复的原子事实，优先分别识别：颜色、品类/轮廓、开口或闭合结构、表面纹理、内里/局部材质、成对或数量关系、配件/装饰、可见文字。不要把多个独立观察塞进同一条。",
    "每个事实还必须标注 sourceType、claimScope、entityType 与 ocrConfidence。",
    "sourceType 只能是 visual_observation / image_text / user_input / model_inference；图片未直接呈现的推测必须是 model_inference。",
    "claimScope 只能是 appearance / visible_text / specification / material / performance / mechanism / service / promotion。",
    "entityType 只能是 product / brand / decorative_badge / specification / feature / material / other。",
    "ocrConfidence 为0到1。只有清晰、位于产品主体或正式包装品牌位、且能稳定识别的文字才可标为 brand；鞋面徽章、装饰贴、图案文字不得升级为品牌。",
    "不得仅因没有独立检测报告把用户上传图片内容设为 commercialUse=false 或 blocked。医疗健康、认证、精确实验结果、极限数据、绝对化等内容也先保留为甲方资料，并在 risks 中提示后续合规复核。",
    "只有看不清、无法确定原文或模型自行推测的内容不得当成图片事实；不要补齐模糊文字。",
    `素材ID按输入顺序为：${assetIds.join("、")}`,
    notes ? `用户补充：${notes}` : "用户未补充额外事实。",
    "返回结构：",
    JSON.stringify(
      {
        productName: "可见名称或保守品类名",
        category: "品类",
        brand: "可见品牌；不可见则写未识别",
        summary: "基于图片的简短总结",
        facts: [
          {
            id: "fact-01",
            label: "事实名",
            value: "事实值",
            evidence: "具体可见证据",
            sourceAssetIds: ["asset-01"],
            sourceType: "visual_observation | image_text | user_input | model_inference",
            claimScope: "appearance | visible_text | specification | material | performance | mechanism | service | promotion",
            entityType: "product | brand | decorative_badge | specification | feature | material | other",
            ocrConfidence: 0.95,
            status: "verified | candidate | blocked",
            commercialUse: false
          }
        ],
        visualAudit: [
          {
            key: "composition | sellingHierarchy | color | typography | visualPath | material | algorithmFit | emotion",
            title: "中文维度名",
            finding: "具体发现",
            recommendation: "可执行建议"
          }
        ],
        visualKeywords: ["关键词1", "关键词2", "关键词3"],
        risks: ["风险；没有则返回空数组"],
        source: "model",
        generatedAt: "ISO时间"
      },
      null,
      2
    ),
    "visualAudit 必须正好8项且8个 key 各出现一次；facts 必须为6到12项且 label/value 语义不得重复。",
    JSON_ONLY
  ].join("\n\n");
}

const RESEARCH_SPLIT_OPERATION_CONTRACT = [
  "原子事实拆分操作契约（逐条执行，不得变通）：",
  "1. 删除被点名的复合事实原记录；",
  "2. 按命中的每个声明范围各新建一条事实，新 id 必须唯一（可顺延编号）；",
  "3. 新事实复用原记录的 sourceAssetIds、sourceType、ocrConfidence、status、commercialUse；",
  "4. 每条新事实的 label、value、evidence 三个字段都只保留本范围语义，删除其它范围的词；",
  "5. 禁止只修改 claimScope 而保留复合文案；",
  "6. 禁止把完整 OCR 原句复制到拆出的每条 evidence——应分别截取对应范围的片段；",
  "7. 若拆分后超过12条上限，可删除同范围、低信息量、语义重复的事实，用拆出的高价值原子事实替换，最终保持6–12条。"
].join("\n");

const RESEARCH_SPLIT_EXAMPLES = [
  "拆分示例（只学习拆法，禁止照抄内容到无关产品）：",
  "“透明桶身，可见双驱水篮结构” → “透明桶身”(appearance) + “双驱水篮结构”(mechanism)；",
  "“双驱旋转，清洗更省力” → “双驱旋转”(mechanism) + “清洗脱水更省力”(performance)；",
  "“加厚纤维布，超强吸水” → “加厚纤维布”(material) + “超强吸水”(performance)。"
].join("\n");

export function buildResearchRepairPrompt(input: {
  rejectedResult: unknown;
  issues: readonly string[];
  assetIds: readonly string[];
  notes: string;
  textOnly?: boolean;
}) {
  return [
    "你刚才返回的图片研究 JSON 未通过生产结构校验。请只修复结构和原子事实拆分，不得改变图片事实原意，不得新增图片中没有的信息。",
    input.textOnly
      ? "本轮是纯文本结构修复：JSON 已能解析，问题只在字段语义。本条消息不携带图片，禁止重新概括画面或引入被拒结果之外的新内容，只做下方问题清单点名的结构转换。"
      : "复合枚举不能取第一个糊弄过去：如果一条事实同时含多个 sourceType、claimScope 或 entityType，必须按原句语义拆成多条原子事实，并分别给出单一枚举。",
    RESEARCH_SPLIT_OPERATION_CONTRACT,
    RESEARCH_SPLIT_EXAMPLES,
    "visualAudit 必须输出正好8项数组；不要输出以维度名为键的对象。",
    "source 必须是字符串 model；generatedAt 返回合法 ISO 时间。facts 必须保持6–12条，ID唯一，并且 sourceAssetIds 只能引用本次素材。",
    `本次素材ID：${input.assetIds.join("、")}`,
    input.notes ? `用户补充：${input.notes}` : "用户未补充额外事实。",
    `路径级校验问题（含字段与命中词，按点名逐条处理）：\n${input.issues.join("\n")}`,
    `被拒结果：${JSON.stringify(input.rejectedResult)}`,
    "返回完整 ProductResearch JSON，不能只返回修复片段。",
    JSON_ONLY
  ].join("\n\n");
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

const HUMAN_COPY_GUIDANCE = [
  "标题、副标题、正文必须从用户视角说人话，但三层各司其职，不能把同一句换个说法重复三遍。",
  "标题＝用户结论：用4到10个中文字符回答“这跟我有什么关系”，优先写场景结果、动作感受或选择结论；不能只把品名、材质、工艺、结构、参数或“卖点总览”当标题。",
  "副标题＝事实解释：用一层具体事实回答“为什么/哪里体现”，可以原样保留甲方参数、材质和功能，但不得复述标题，也不得堆“品质、质感、实用、体验”等空泛形容词。",
  "正文＝生活说明：用1到2个完整自然句连接“具体场景或动作—甲方事实—用户得到的结果”；不要写属性清单，不要用连接词结尾，不要按字符硬截断。",
  "主标题不超过10个中文字符；副标题不超过20个中文字符；正文不超过45个中文字符、最多3个自然句，禁止硬截断。",
  "不用“适配、兼顾、彰显、赋能、打造、尽显、品质之选、满足多样需求、焕新体验、产品定位、核心卖点”等广告腔或内部策划词。",
  "不用“本产品采用、该产品具备、适用于某场景”等说明书句法；不要给用户贴“宝妈、主妇、女白领、男士专用”等刻板标签。",
  "画面文案里禁止出现“甲方图片、上传图片、图片可见、候选事实、证据、商业使用、本屏、页面任务、模型、提示词、claimScope、evidenceIds”等内部生产语言。事实来源只保留在 evidenceIds / proofMethod，不写给消费者看。",
  "像朋友解释：一句只说一件事，用户看完能用自己的话复述。甲方图片里的原始事实、参数、材质与功能原意必须保留，不能为了口语化而弱化、替换或扩写。",
  "表达示意（只能学习语义分工，禁止照抄到无关产品）：标题“饭后好洗不费劲”→副标题“光滑釉面，日常好打理”→正文“吃完饭轻轻清洗，碗里碗外都好打理。”；标题“大小先看清”→副标题“直径115mm，高60mm”→正文“盛饭盛汤前先把尺寸看明白，选起来更有数。”"
].join("\n");

function buildScreenCopyContexts(
  contracts: ReturnType<typeof buildScreenContracts>,
  facts: readonly EvidenceFact[]
) {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  return contracts.map((contract) => ({
    ...contract,
    evidenceFacts: contract.requiredEvidenceIds
      .map((id) => factById.get(id))
      .filter((fact): fact is EvidenceFact => Boolean(fact))
      .map((fact) => ({
        id: fact.id,
        label: fact.label,
        value: fact.value,
        evidence: fact.evidence,
        claimScope: fact.claimScope
      })),
    copySemanticSlots: {
      headline: "先给用户结论或直接感受，不写资料标签",
      subheadline:
        contract.requiredEvidenceIds.length > 0
          ? "保留本屏证据中的具体事实，解释标题为什么成立"
          : "只补一层生活情境，不新增产品功效",
      body:
        contract.requiredEvidenceIds.length > 0
          ? "用完整人话连接场景/动作、已授权事实和用户结果"
          : "用完整人话描述一个自然场景或动作，不暗示新功效"
    }
  }));
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
  const screenTargets = buildScreenCopyContexts(
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
    HUMAN_COPY_GUIDANCE,
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
    `screens 必须正好${input.indexes.length}项，且只能包含目标 id：${screenTargets.map((item) => item.id).join("、")}。`,
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
  const contracts = buildScreenContracts(usableFacts);
  const targetContracts = buildScreenCopyContexts(
    contracts.filter((contract) =>
      targetScreens.some((screen) => screen.id === contract.id)
    ),
    usableFacts
  );
  const allowedFields = Object.fromEntries(
    allowedRepairFieldsByScreen(input.issues, input.targetIds)
  );

  return [
    "你刚才返回的15屏策划被确定性证据校验拒绝。现在只修复冲突屏，不得切换模板，不得重写其他屏。",
    `结构化校验问题：${JSON.stringify(input.issues)}`,
    "修复规则：",
    "1. 只返回下方目标屏的完整 DetailScreen 对象；screens 数量、ID集合必须与目标完全相同。",
    "2. id、index、subjectKey、userQuestion、claimScope、evidenceIds 是服务端任务契约，必须逐字保留，任何修复都不得改动，也不得把本屏切换成 creative 或换一个卖点。",
    "3. 每屏只能修改“字段授权表”列出的字段；没有授权字段的屏幕必须原样返回，服务端会逐字段拒绝越界修改。",
    "4. 甲方图片原文可以保留并改善语义；若问题是声明强度升级，只把措辞降回 evidence 所写强度，不删除事实、不创造新效果。",
    "5. 标题从 userQuestion 出发回答用户，不得把材质、结构、工艺或内部任务名直接当结论；副标题承接事实，正文用一个生活动作解释意义。",
    "6. 跨屏重复只修改 issue.screenIds 指定的后出现屏；relatedScreenIds 仅供比较，禁止改写，不能只换同义词。",
    "7. 创意场景重复时，仅更换被授权屏的空间、时间、人物动作、镜头或构图；不得连带修改固定事实与问题。",
    "8. 返回前逐屏自检：标题给用户结论，副标题给事实解释，正文给场景/动作和结果（措辞克制）；三层不能直接复述或高度相似。",
    "9. 文案里不得出现甲方图片、上传图片、图片可见、证据、事实、本屏、页面、模型、提示词、商业使用等内部术语；来源只保留在 proofMethod。",
    "10. 如果正文以“同时、以及、通过、采用、搭配、把、让、与、和”等连接词结尾，必须整句重写，不能补一个机械尾巴。",
    HUMAN_COPY_GUIDANCE,
    `可用事实：${JSON.stringify(usableFacts)}`,
    buildUnavailableClaimScopeRule(usableFacts),
    `用户补充：${JSON.stringify(input.brief)}`,
    `15屏序列上下文：${JSON.stringify(sequenceContext)}`,
    `目标屏任务契约：${JSON.stringify(targetContracts)}`,
    `字段授权表：${JSON.stringify(allowedFields)}`,
    `只需修复的屏幕：${JSON.stringify(targetScreens)}`,
    `目标ID（必须完全一致）：${input.targetIds.join("、")}`,
    '仅返回 {"screens":[...]}，screens 只能包含上述目标屏，不能包含其他屏；不得返回基础策略、source 或 generatedAt。',
    JSON_ONLY
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
    "你只返回不含定稿文案原文的视觉底稿 visualInstruction 与 visualPrompt。服务端会在通过校验后，把 copyFinal 精确编译进最终 English Prompt 一次。",
    "每屏提示词必须强调自身场景、镜头、构图、光线和证明方式，禁止粘贴全部卖点。",
    "visualInstruction 与 visualPrompt 禁止出现本屏标题、副标题、正文、要点原文，也禁止出现 text-free、no text、无文字底图、不要文字或后期再排文字等要求。",
    "visualInstruction 与 visualPrompt 禁止输出 commercialUse、evidenceIds、claimScope、source、generatedAt 等内部字段名。",
    "visualInstruction 与 visualPrompt 也禁止出现 Commercial use allowed、approved evidence item、evidence count 等内部权限或证据数量描述。",
    "visualPrompt 必须描述产品一致性、本屏视觉任务、9:16构图、光线、中文文字层级预留区，但用 approved-copy block / headline area 等占位描述，不得复制文案。",
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
            visualInstruction: "中文本屏差异化视觉指令，约120到300字；只写场景、镜头、构图、光线与证明方式，不复制文案",
            visualPrompt: "English 9:16 visual prompt, around 120-240 words; reserve a legible approved-copy block but do not include any approved Chinese copy",
            negativePrompt: "本屏负面词；禁止错字、漏字、重复文字、改写文案和额外声明",
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
    "copyFinal 仍需逐字保留上述定稿文案；但 visualInstruction 与 visualPrompt 只能描述场景、镜头、构图、光线、产品一致性和文字预留区域，绝对不能出现任何禁入原文或内部字段。",
    "删除 Commercial use allowed、approved evidence item、evidence count 等内部元数据；它们不是给生图模型看的视觉指令。",
    "不要返回 englishPrompt；不要要求无文字底图；visualPrompt 必须写明9:16或vertical。",
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
    "审查14个模块：策划完整性、前三屏、卖点唯一性、信任证据、视觉一致性、移动端、收尾、促销、AI标识、广告法、可访问性、暗色模式、2026适配、A/B迭代。",
    "重点检查：15屏数量与screenId、标题重复、未验证商业声明、文案和提示词混写、提示词过度相似、9:16、正文字号14px、对比度4.5:1、AI辅助生成标识、虚假评价。",
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

export const APPROVED_COPY_BEGIN = "APPROVED_COPY_BEGIN";
export const APPROVED_COPY_END = "APPROVED_COPY_END";

export function compileScreenImagePrompt(input: {
  screen: DetailScreen;
  execution: Pick<ScreenExecution, "copyFinal" | "visualPrompt">;
  facts: readonly EvidenceFact[];
}) {
  const allowedFacts = input.facts.filter(
    (fact) =>
      input.screen.evidenceIds.includes(fact.id) &&
      fact.status !== "blocked" &&
      fact.commercialUse
  );
  const approvedCopy = input.execution.copyFinal;
  if (
    input.screen.claimScope !== "creative" &&
    allowedFacts.length !== input.screen.evidenceIds.length
  ) {
    throw new Error(`${input.screen.id} 含无效或未授权证据，无法编译生图提示词。`);
  }

  return [
    "Create a production-ready vertical e-commerce detail-page image with the approved on-image copy.",
    "Aspect ratio 9:16 at 1440x2560. Preserve the exact product identity, silhouette, color, texture, construction and visible details from the supplied reference images.",
    "Use each reference image only to identify the product. Ignore and do not reproduce any old headline, caption, logo not printed on the product itself, dimension line, arrow, badge, hand, food, prop, background, source layout, or watermark from the references.",
    input.execution.visualPrompt.trim(),
    [
      APPROVED_COPY_BEGIN,
      `Headline: ${approvedCopy.headline}`,
      `Subheadline: ${approvedCopy.subheadline}`,
      `Body: ${approvedCopy.body}`,
      `Key points: ${approvedCopy.keyPoints.join("；")}`,
      APPROVED_COPY_END
    ].join("\n"),
    "Render the approved copy block exactly once. Keep every approved character legible. Do not paraphrase, duplicate, omit, translate, or invent copy.",
    "Use a top safe area of 10%, left and right safe margins of 8%, and a bottom safe area of 12%. Keep text away from the product silhouette and important product details.",
    "Add the exact small disclosure text “AI辅助生成” once in the bottom safe area, visually separate from the approved marketing copy.",
    "Do not add any other numerical claim, material, performance claim, certification, testimonial, badge, watermark, or extra logo."
  ].join("\n\n");
}
