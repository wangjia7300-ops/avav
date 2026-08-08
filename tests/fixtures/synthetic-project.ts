import type {
  DetailPageProject,
  DetailScreen,
  EvidenceFact,
  QAFinding,
  ScreenExecution,
  VisualAuditDimension
} from "@/lib/types";
import { EMPTY_BRIEF } from "@/lib/skill-suite/defaults";
import { compileScreenImagePrompt } from "@/lib/skill-suite/jimeng-prompt-translator";
import { buildScreenContracts } from "@/lib/skill-suite/screen-contracts";

const now = "2026-07-24T08:00:00.000Z";

const facts: EvidenceFact[] = [
  {
    id: "fact-color",
    label: "配色",
    value: "灰白、测试蓝与深灰撞色",
    evidence: "产品正面大图可见三段式配色。",
    sourceAssetIds: ["synthetic-fixture"],
    sourceType: "visual_observation",
    claimScope: "appearance",
    entityType: "product",
    ocrConfidence: 1,
    status: "verified",
    commercialUse: true
  },
  {
    id: "fact-structure",
    label: "结构",
    value: "正面多隔层与双拉链开合",
    evidence: "主图可见多个前袋、双拉链头及侧袋。",
    sourceAssetIds: ["synthetic-fixture"],
    sourceType: "visual_observation",
    claimScope: "appearance",
    entityType: "product",
    ocrConfidence: 1,
    status: "verified",
    commercialUse: true
  },
  {
    id: "fact-strap",
    label: "背负外观",
    value: "双肩带带有可见网眼织物",
    evidence: "左下角背面展示图可见肩带网眼织物外观。",
    sourceAssetIds: ["synthetic-fixture"],
    sourceType: "visual_observation",
    claimScope: "appearance",
    entityType: "feature",
    ocrConfidence: 1,
    status: "verified",
    commercialUse: true
  },
  {
    id: "fact-size",
    label: "甲方基础规格",
    value: "40 × 30 × 15 cm",
    evidence: "甲方产品图左侧明确标注该规格，按普通民用产品基础资料使用。",
    sourceAssetIds: ["synthetic-fixture"],
    sourceType: "image_text",
    claimScope: "specification",
    entityType: "specification",
    ocrConfidence: 0.98,
    status: "candidate",
    commercialUse: true
  },
  {
    id: "fact-grade",
    label: "甲方适用人群资料",
    value: "测试规格A",
    evidence: "甲方产品图左侧明确标注适用规格，属于普通民用产品基础资料。",
    sourceAssetIds: ["synthetic-fixture"],
    sourceType: "image_text",
    claimScope: "specification",
    entityType: "specification",
    ocrConfidence: 0.98,
    status: "candidate",
    commercialUse: true
  },
  {
    id: "fact-brand",
    label: "品牌文字",
    value: "TEST BRAND / 测试品牌",
    evidence: "甲方产品图左上品牌位清晰可见中英文品牌文字。",
    sourceAssetIds: ["synthetic-fixture"],
    sourceType: "image_text",
    claimScope: "visible_text",
    entityType: "brand",
    ocrConfidence: 0.99,
    status: "verified",
    commercialUse: true
  }
];

const screenBlueprints: Array<
  [string, string, string, string, string[], string, string, string]
> = [
  [
    "首屏定位",
    "建立产品第一印象",
    "日常出行前的轻松开场",
    "日常出行出门，更从容",
    [],
    "把收纳包放进出门前的真实日常",
    "干净背景正面主视觉",
    "正面中景"
  ],
  [
    "场景痛点",
    "让用户代入整理场景",
    "灰白、测试蓝与深灰撞色",
    "配色清爽好认",
    ["fact-color"],
    "三段配色在画面里直接看清",
    "日常出行前整理桌面",
    "俯拍中近景"
  ],
  [
    "结构总览",
    "解释外部收纳结构",
    "正面多隔层与双拉链",
    "分区一眼看懂",
    ["fact-structure"],
    "结构标注与局部放大",
    "纯色棚拍结构拆解",
    "正面平视"
  ],
  [
    "开合细节",
    "展示使用路径",
    "肩带网眼织物外观",
    "肩带细节看得见",
    ["fact-strap"],
    "近景展示肩带网眼织物",
    "桌面取物动作",
    "45度特写"
  ],
  [
    "基础规格",
    "呈现甲方基础规格",
    "常规尺寸信息",
    "日常尺寸，一屏看清",
    ["fact-size"],
    "引用甲方产品图基础资料",
    "比例参照静物",
    "正面全景"
  ],
  [
    "适用规格",
    "说清甲方图片标注规格",
    "测试规格A",
    "测试规格A可选",
    ["fact-grade"],
    "甲方图片明确标注适用规格",
    "暖白陈列台",
    "正面中景"
  ],
  [
    "品牌识别",
    "看清产品品牌",
    "TEST BRAND / 测试品牌",
    "品牌标识看得见",
    ["fact-brand"],
    "品牌文字来自甲方上传图片",
    "正面品牌位特写",
    "标识近景"
  ],
  [
    "侧面轮廓",
    "补足多角度认知",
    "多角度观察",
    "侧面也看清",
    [],
    "换个角度观察包身轮廓",
    "极简转台",
    "左侧45度"
  ],
  [
    "日常场景",
    "呈现使用氛围",
    "出门前的整理动作",
    "出门前，顺手整理",
    [],
    "只展示自然整理动作",
    "明亮玄关准备出门",
    "人物半身侧拍"
  ],
  [
    "物品示意",
    "帮助理解收纳逻辑",
    "桌面物品示意",
    "书本文具摆一摆",
    [],
    "道具只帮助理解使用场景",
    "桌面平铺收纳",
    "俯拍"
  ],
  [
    "人群沟通",
    "建立审美共鸣",
    "日常穿搭场景",
    "日常搭配不费力",
    [],
    "用真实穿搭建立生活代入",
    "校园外景",
    "背影跟拍"
  ],
  [
    "工艺观察",
    "展示可见做工",
    "换角度观察细节",
    "细节换个角度看",
    [],
    "仅展示图像可见细节",
    "表面纹理与走线微距",
    "微距"
  ],
  [
    "搭配灵感",
    "拓展日常搭配想象",
    "校园日常氛围",
    "校园日常也清爽",
    [],
    "产品自然进入校园日常",
    "明亮校园穿搭场景",
    "人物背负中景"
  ],
  [
    "使用提示",
    "降低理解成本",
    "选择前回看配色与尺寸",
    "选前再看两件事",
    ["fact-color", "fact-size"],
    "把配色和甲方尺寸放在同一屏回看",
    "三步操作连贯画面",
    "分镜拼版"
  ],
  [
    "收尾行动",
    "完成决策闭环",
    "回到每天出门的日常",
    "每天出门都从容",
    [],
    "用轻松日常结束整套详情页",
    "产品与细节矩阵",
    "正面英雄镜头"
  ]
];

const sampleCopies: DetailScreen["copy"][] = [
  {
    headline: "日常出行出门，更从容",
    subheadline: "书本理好，准备出发",
    body: "早上把书本和文具理一理，背上收纳包就出门。",
    keyPoints: ["真实日常出行日常"]
  },
  {
    headline: "配色清爽好认",
    subheadline: "灰白、测试蓝和深灰相间",
    body: "三段配色分区清楚，远近都好认。",
    keyPoints: ["灰白", "测试蓝", "深灰"]
  },
  {
    headline: "分区一眼看懂",
    subheadline: "正面多隔层，双拉链开合",
    body: "常带物品怎么放，先把外部分区看明白。",
    keyPoints: ["正面多隔层", "双拉链开合"]
  },
  {
    headline: "肩带细节看得见",
    subheadline: "双肩带带有网眼织物",
    body: "换到背面近看，肩带上的网眼细节更清楚。",
    keyPoints: ["双肩带", "网眼织物"]
  },
  {
    headline: "大小先看清",
    subheadline: "40 × 30 × 15 cm",
    body: "选收纳包前先把长宽厚看明白，大小心里有数。",
    keyPoints: ["40cm", "30cm", "15cm"]
  },
  {
    headline: "规格先选对",
    subheadline: "测试规格A可选",
    body: "给低规格孩子选收纳包，先对照标注规格。",
    keyPoints: ["测试规格A"]
  },
  {
    headline: "品牌标识看得见",
    subheadline: "TEST BRAND / 测试品牌",
    body: "中英文品牌都在正面，拿到手时也方便核对。",
    keyPoints: ["TEST BRAND", "测试品牌"]
  },
  {
    headline: "侧面也看清",
    subheadline: "换个角度看包身轮廓",
    body: "从左侧慢慢转过来，把包身轮廓看完整。",
    keyPoints: ["侧面观察"]
  },
  {
    headline: "出门前，顺手整理",
    subheadline: "书本和文具各自归位",
    body: "早上出门前，把随身物品摆好，再背起收纳包。",
    keyPoints: ["出门前整理"]
  },
  {
    headline: "书本文具摆一摆",
    subheadline: "先想清每天会带什么",
    body: "把常带物品在桌面铺开，选购时更容易核对需求。",
    keyPoints: ["常带物品示意"]
  },
  {
    headline: "日常搭配不费力",
    subheadline: "校园穿搭，清爽自然",
    body: "换上日常日常出行的衣服，看看整体颜色是否合眼缘。",
    keyPoints: ["校园穿搭"]
  },
  {
    headline: "细节换个角度看",
    subheadline: "表面纹理与走线靠近看",
    body: "拉近镜头，看清边缘、走线和表面纹理。",
    keyPoints: ["细节近看"]
  },
  {
    headline: "校园日常也清爽",
    subheadline: "把收纳包放进日常出行场景",
    body: "走进教室或操场，在真实环境里看颜色和轮廓。",
    keyPoints: ["校园日常"]
  },
  {
    headline: "选前再看两件事",
    subheadline: "配色与尺寸一屏回看",
    body: "先看三段配色，再核对40 × 30 × 15 cm。",
    keyPoints: ["三段配色", "40 × 30 × 15 cm"]
  },
  {
    headline: "每天出门都从容",
    subheadline: "让日常出行准备轻松一点",
    body: "书本理好，收纳包背上，新一天从家门口开始。",
    keyPoints: ["轻松出门"]
  }
];

const screenContracts = buildScreenContracts(facts);

const screens: DetailScreen[] = screenBlueprints.map((item, index) => ({
  id: `screen-${String(index + 1).padStart(2, "0")}`,
  index: index + 1,
  subjectKey: screenContracts[index].subjectKey,
  userQuestion: screenContracts[index].userQuestion,
  role: item[0],
  conversionTask: item[1],
  primarySellingPoint: item[2],
  claimScope:
    item[4].length > 0
      ? new Set(
          item[4]
            .map((id) => facts.find((fact) => fact.id === id)?.claimScope)
            .filter(Boolean)
        ).size > 1
        ? "mixed"
        : facts.find((fact) => fact.id === item[4][0])?.claimScope ?? "creative"
      : "creative",
  evidenceIds: item[4],
  proofMethod: item[5],
  copy: sampleCopies[index],
  scene: item[6],
  shot: item[7],
  composition: "9:16竖版；顶部12%标题安全区；主体位于中部；底部保留信息区。",
  transition:
    index === 0
      ? "建立第一印象"
      : index === 14
        ? "收束决策链"
        : `承接第${index}屏并引向第${index + 2}屏`
}));

function buildExecution(screen: DetailScreen): ScreenExecution {
  const draft: Omit<ScreenExecution, "englishPrompt"> = {
    screenId: screen.id,
    copyFinal: screen.copy,
    visualInstruction: "采用真实商业摄影质感和柔和定向光，围绕本屏的单一购买任务组织画面。严格保持参考图中的原始产品配色与主体结构，为标题、副标题、正文和要点预留清晰层级与安全区，文字不得遮挡产品。",
    visualPrompt: "9:16竖版电商详情页，严格保持参考图产品的主体结构、部件位置和原始外观。采用本屏既定场景与机位，使用干净商业光线和真实材质，只表达一个画面任务，并为中文标题、副标题、正文和要点预留清楚层级。",
    negativePrompt:
      "不改变包体结构、拉链数量、肩带和配色，不新增口袋、认证、额外卖点或水印",
    geo: {
      query: `这款收纳包的${screen.primarySellingPoint}有什么可见特点？`,
      answer: `从图片可确认：${screen.evidenceIds
        .map((id) => facts.find((fact) => fact.id === id)?.value)
        .filter(Boolean)
        .join("、") || "本屏暂无可用于商业表达的参数证据"}。`,
      entities: ["收纳包", "测试收纳包", screen.primarySellingPoint]
    },
    productionReference: {
      information: `标题 → ${screen.primarySellingPoint} → 证据/说明`,
      wireframe: "顶部标题区 / 中部产品视觉 / 下部证据或要点区",
      typography: "H1 46px/700；H2 24px/600；正文16px/1.6；对比度≥4.5:1",
      sceneDirection: `${screen.scene}；${screen.shot}；产品占画面45%–62%。`,
      palette: ["#FAF7F2", "#C66A36", "#6A2E1A", "#333333"],
      darkMode: "深灰底配暖白字，产品边缘增加柔和轮廓光，避免纯黑吞噬细节。",
      designNotes: "AI辅助生成完整图文画面；定稿文案原样呈现一次；出图后复核中文错字、漏字与重复；禁止加入未验证参数。"
    },
    aiLabel: "AI辅助生成",
    source: "sample",
    generatedAt: now
  };

  return {
    ...draft,
    englishPrompt: compileScreenImagePrompt({
      screen,
      execution: draft,
      facts
    })
  };
}

const executions = Object.fromEntries(screens.map((screen) => [screen.id, buildExecution(screen)]));

const qaFindings: QAFinding[] = [
  {
    id: "sample-warning-source-archive",
    severity: "warning",
    module: "信任证据",
    screenId: "screen-05",
    title: "甲方基础规格建议留档",
    evidence: "尺寸来自甲方产品图，属于普通民用产品基础资料。",
    fix: "允许用于文案；保留甲方源图与版本记录，渠道另有要求时再补规格表。"
  },
  {
    id: "sample-pass-civilian-claim",
    severity: "pass",
    module: "文案权限",
    screenId: "screen-05",
    title: "普通民用基础资料已开放",
    evidence: "fact-size 来自甲方产品图且 commercialUse 为 true。",
    fix: "可做场景化转译，但不得扩写为新的量化结论、认证或绝对化承诺。"
  },
  {
    id: "sample-warning-typography",
    severity: "warning",
    module: "移动端",
    screenId: "screen-03",
    title: "生图后需复核实际字号",
    evidence: "当前仅有字号规范，尚无最终像素稿。",
    fix: "生图和排版完成后检查正文是否≥14px。"
  },
  {
    id: "sample-warning-asset",
    severity: "warning",
    module: "视觉",
    screenId: "screen-08",
    title: "侧面素材不足",
    evidence: "测试夹具只有一张合成主图。",
    fix: "补充干净的侧面与背面产品图。"
  },
  {
    id: "sample-warning-scene",
    severity: "warning",
    module: "视觉",
    screenId: "screen-13",
    title: "搭配场景需保持产品一致",
    evidence: "测试夹具只有一张合成主图，场景生图仍需依赖该参考图。",
    fix: "场景生成时锁定包体配色、口袋、拉链与肩带结构。"
  },
  {
    id: "sample-pass-ratio",
    severity: "pass",
    module: "移动端",
    title: "15屏比例一致",
    evidence: "全部屏幕定义为9:16。",
    fix: "保持现状。"
  },
  {
    id: "sample-pass-ai",
    severity: "pass",
    module: "AI合规",
    title: "AI辅助生成标识完整",
    evidence: "全部执行结果保留AI辅助生成元数据。",
    fix: "导出时继续保留。"
  },
  {
    id: "sample-pass-copy",
    severity: "pass",
    module: "文案",
    title: "15屏标题无完全重复",
    evidence: "标题标准化后重复数为0。",
    fix: "保持现状。"
  }
];

export function createSampleProject(): DetailPageProject {
  return {
    id: "synthetic-test-project",
    name: "测试夹具 · 虚构产品",
    assets: [
      {
        id: "synthetic-fixture",
        name: "synthetic-fixture.png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        size: 0
      }
    ],
    brief: {
      ...EMPTY_BRIEF,
      platform: "天猫 / 京东详情页",
      targetAudience: "关注收纳包收纳结构与配色的家庭用户",
      tone: "清爽、可信、移动端优先",
      notes: "测试夹具数据仅用于展示工作台；真实项目必须重新调用模型。"
    },
    research: {
      productName: "TEST BRAND 测试收纳包（测试夹具）",
      category: "测试收纳包",
      brand: "TEST BRAND / 测试品牌（图片可见）",
      summary: "灰白、测试蓝与深灰撞色的多隔层测试收纳包。",
      facts,
      visualAudit: [
        ["composition", "构图", "产品正面占据画面右侧，左侧集中承载信息。", "新详情页改为主体居中并按屏拆分信息。"],
        ["sellingHierarchy", "卖点层级", "原图同屏放入规格、尺寸和功能，信息竞争。", "每屏只承担一个卖点或证明任务。"],
        ["color", "配色", "浅蓝背景与暖色包体形成明显对比。", "保留暖色产品识别，背景改用暖白与低饱和蓝。"],
        ["typography", "字体", "标题粗重，参数与说明层级较多。", "标题、证据、说明使用三档层级。"],
        ["visualPath", "视觉动线", "视线先落在产品，再向左读取规格。", "用顶部标题—主体—底部证据构成纵向动线。"],
        ["material", "材质工艺", "可见皮质感拼片与网眼肩带。", "用微距展示可见纹理，不推断材料成分。"],
        ["algorithmFit", "算法适配", "信息密集但核心品类清晰。", "前三屏快速回答是什么、为何相关、证据是什么。"],
        ["emotion", "情绪设计", "暖色偏亲和，面向家庭购买语境。", "使用清爽校园日常氛围，避免低幼化。"]
      ].map(([key, title, finding, recommendation]) => ({
        key: key as VisualAuditDimension["key"],
        title,
        finding,
        recommendation
      })),
      visualKeywords: ["清爽学院", "暖色撞色", "可信结构展示"],
      risks: ["图片中的尺寸和适用规格仅为OCR候选，未提供独立证据。"],
      source: "sample",
      generatedAt: now
    },
    plan: {
      productPositioning: "以清爽撞色和可见多隔层结构建立日常收纳包的清晰认知。",
      coreSellingPoints: ["多隔层外观", "三段撞色", "双拉链开合", "网眼肩带外观"],
      personas: [
        {
          name: "日常整理型家长",
          context: "准备日常出行用品",
          pain: "物品容易混在一起",
          decisionTrigger: "结构看得懂、证据清楚"
        },
        {
          name: "审美参与型用户",
          context: "日常搭配与校园使用",
          pain: "不喜欢沉闷或过度幼稚的外观",
          decisionTrigger: "配色清爽、轮廓有层次"
        }
      ],
      decisionChain: ["确认品类与风格", "理解结构", "查看细节证据", "代入日常场景", "完成收尾行动"],
      globalVisualDirection:
        "暖白底、测试蓝与低饱和蓝点缀；中文无衬线；9:16纵向信息动线；产品结构保持一致。",
      screens,
      source: "sample",
      generatedAt: now
    },
    executions,
    qa: {
      status: "prompt_complete",
      coverage: {
        expectedScreens: 15,
        planScreens: 15,
        executionScreens: 15,
        generatedImageScreens: 0,
        pixelVerifiedScreens: 0,
        missingPlanIds: [],
        missingExecutionIds: [],
        missingImageIds: Array.from(
          { length: 15 },
          (_, index) => `screen-${String(index + 1).padStart(2, "0")}`
        ),
        unexpectedPlanIds: [],
        unexpectedExecutionIds: []
      },
      checks: {
        rules: "evaluated",
        semantic: "evaluated",
        render: "not_evaluated",
        pixel: "not_evaluated"
      },
      notEvaluated: [
        {
          check: "render",
          status: "not_evaluated",
          reason: "测试夹具未绑定真实成图。"
        },
        {
          check: "pixel",
          status: "not_evaluated",
          reason: "测试夹具未执行像素质检。"
        }
      ],
      publishDecision: "review_required",
      findings: qaFindings,
      summary: "测试夹具无发布阻断；甲方普通民用基础资料可用于文案，另有4项制作与留档建议。",
      source: "rules+model",
      generatedAt: now
    },
    updatedAt: now
  };
}
