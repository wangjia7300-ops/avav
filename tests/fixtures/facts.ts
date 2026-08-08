import type { EvidenceFact } from "@/lib/types";

export const facts: EvidenceFact[] = [
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
