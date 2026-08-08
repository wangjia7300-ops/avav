import type {
  DetailPageProject,
  DetailScreen,
  VisualAuditDimension
} from "@/lib/types";
import { EMPTY_BRIEF } from "@/lib/skill-suite/defaults";
import { buildScreenContracts } from "@/lib/skill-suite/screen-contracts";
import { facts } from "./facts";
import { screenBlueprints, sampleCopies } from "./screens";
import { buildExecution } from "./executions";
import { qaFindings } from "./qa-findings";

const now = "2026-07-24T08:00:00.000Z";

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
  composition:
    "9:16竖版；顶部12%标题安全区；主体位于中部；底部保留信息区。",
  transition:
    index === 0
      ? "建立第一印象"
      : index === 14
        ? "收束决策链"
        : `承接第${index}屏并引向第${index + 2}屏`
}));

const executions = Object.fromEntries(
  screens.map((screen) => [screen.id, buildExecution(screen)])
);

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
      productPositioning:
        "以清爽撞色和可见多隔层结构建立日常收纳包的清晰认知。",
      coreSellingPoints: [
        "多隔层外观", "三段撞色", "双拉链开合", "网眼肩带外观"
      ],
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
      decisionChain: [
        "确认品类与风格", "理解结构", "查看细节证据",
        "代入日常场景", "完成收尾行动"
      ],
      globalVisualDirection:
        "暖白底、测试蓝与低饱和蓝点缀；中文无衬线；9:16纵向信息动线；产品结构保持一致。",
      screens,
      source: "sample",
      generatedAt: now
    },
    executions,
    qa: {
      status: "prompt_complete",
      coverage: createCoverage(screens),
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
      summary:
        "测试夹具无发布阻断；甲方普通民用基础资料可用于文案，另有4项制作与留档建议。",
      source: "rules+model",
      generatedAt: now
    },
    updatedAt: now
  };
}

function createCoverage(screens: DetailScreen[]) {
  return {
    expectedScreens: 15 as const,
    planScreens: 15,
    executionScreens: 15,
    generatedImageScreens: 0,
    pixelVerifiedScreens: 0,
    missingPlanIds: [] as string[],
    missingExecutionIds: [] as string[],
    missingImageIds: screens.map((s) => s.id),
    unexpectedPlanIds: [] as string[],
    unexpectedExecutionIds: [] as string[]
  };
}
