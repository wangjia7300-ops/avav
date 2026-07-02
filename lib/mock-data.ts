import type { ProductAnalysis } from "@/lib/types";

export const mockProductAnalysis: ProductAnalysis = {
  category: "柜式冷风扇",
  productNameGuess: "家用移动冷风扇",
  appearance: ["白色上半机身", "深灰色水箱", "顶部控制面板", "前置大面积格栅", "底部脚轮"],
  visibleFeatures: ["大容量水箱", "可视水位窗", "机械旋钮", "移动脚轮", "大风叶"],
  materials: ["塑料机身", "透明水位窗", "金属/塑料格栅"],
  colors: ["白色", "深灰色", "浅灰色"],
  styleKeywords: ["清凉", "家用", "实用", "白灰配色", "夏季电器"],
  risks: ["图片角度可能遮挡背部结构", "图片未展示容量与功率等具体参数", "品牌与型号信息未出现在画面中"],
  brandNames: {
    chinese: "",
    english: ""
  },
  brandVisualStyle: ["简洁家电标识", "高识别度圆形/文字 Logo"],
  specifications: ["图片可见高度比例较高", "具体尺寸/容量/功率以商家资料补充"],
  sellingPoints: ["可移动使用", "大面积出风", "水箱结构可视", "家用清凉场景"],
  dataSellingPoints: ["大面积出风", "移动脚轮", "可视水位窗"],
  targetAudience: ["夏季居家用户", "宿舍/租房人群", "厨房/小商铺局部降温用户"],
  parameters: ["可移动结构", "前置格栅", "可视水位窗"],
  productDetails: ["白灰配色", "前置格栅", "底部脚轮", "透明水位窗"],
  specialRequirements: {
    needModel: "否，首版优先产品主体与生活场景",
    needScene: "是，客厅/厨房/商铺等清凉使用场景",
    needDataVisualization: "是，容量、风量、噪音等以商家资料为准",
    others: ["需要产品实物", "需要痛点对比图", "需要卖点标签"]
  },
  visualStyleSystem: {
    overallTone: ["清凉舒适", "家用实用", "轻科技感", "转化型电商视觉"],
    imageTexture: ["高清商业摄影", "柔和真实质感", "产品边缘高光", "轻量冰感元素"],
    lightingLogic: ["柔和主光", "蓝白环境补光", "产品轮廓光", "卖点区域局部高亮"],
    colorSystem: ["白色主调", "冰蓝辅助", "深灰文字", "少量科技蓝强调"],
    typographyRules: ["中文黑体/圆体组合", "主标题大字号加粗", "副标题中等字重", "正文小字号舒适行距"],
    compositionRules: ["移动端竖屏优先", "顶部标题区", "中部产品/场景主体", "底部卖点卡片", "模块化信息分区"]
  }
};
