import type { QAFinding } from "@/lib/types";

export const qaFindings: QAFinding[] = [
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
