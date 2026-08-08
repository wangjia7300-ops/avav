import {
  getAtomicResearchExtractionLimits,
  type AtomicResearchObservation,
  type AtomicResearchOutputProfile
} from "@/lib/skill-suite/research-atomic-contract";

const JSON_ONLY = [
  "只返回一个合法 JSON 对象。",
  "不要 Markdown，不要代码围栏，不要解释。",
  "不得省略必填字段，不得输出 null 或省略号。"
].join("\n");

export function buildAtomicResearchExtractionPrompt(
  assetIds: readonly string[],
  profile: AtomicResearchOutputProfile = "standard"
) {
  const limits = getAtomicResearchExtractionLimits(assetIds, profile);
  const countInstruction =
    limits.minItems === limits.maxItems
      ? `必须恰好返回${limits.maxItems}条观察。`
      : `必须返回${limits.minItems}–${limits.maxItems}条观察，不得超过${limits.maxItems}条。`;
  return [
    "你是电商产品图的小批原子事实提取器。当前只做逐图观察，不写策划、文案或最终结论。",
    "只记录图片直接可见的产品轮廓、颜色、结构、局部、数量关系、场景表现和清晰可辨文字。禁止用常识补齐材质、参数、功效或认证。",
    "用户上传图片中清晰可识别的参数、材质、功能和卖点是甲方基础资料，应以 image_text 原样提取；模糊内容不得猜测。",
    "每条 observation 只记录一个事实范围；label是简短事实名，value是完整值，evidence说明在对应图中看到了什么。",
    `字段必须紧凑：label不超过${limits.labelMaxLength}字，value不超过${limits.valueMaxLength}字，evidence不超过${limits.evidenceMaxLength}字；禁止背景铺陈、策划建议和同义反复。`,
    "sourceType 只能是 visual_observation 或 image_text；claimScope 只能是 appearance / visible_text / specification / material / performance / mechanism / service / promotion。",
    "entityType 只能是 product / brand / decorative_badge / specification / feature / material / other。只有清晰的产品或正式包装品牌位才能写 brand。",
    `${countInstruction}只保留对识别产品和后续15屏策划最有价值的事实；每张素材至少返回2条互不重复观察。不得输出 observationId，该ID由服务端分配。`,
    `本批图片与素材ID严格按顺序一一对应：${assetIds.join("、")}`,
    JSON_ONLY
  ].join("\n\n");
}

export function buildResearchFinalizeSelectionPrompt(input: {
  assetIds: readonly string[];
  notes: string;
  observations: readonly AtomicResearchObservation[];
}, profile: AtomicResearchOutputProfile = "standard") {
  const compact = profile === "compact";
  return [
    "你是电商详情页的图片研究汇总模块。当前消息不携带图片，下方经锁定的原子观察是唯一产品事实来源。",
    `你只能选择6–${compact ? 8 : 12}个 selectedObservationIds，不能返回 facts，不能改写观察的标签、值、证据或来源。`,
    "优先选择彼此不重复、对15屏详情页有用、且置信度更高的观察。不得用合法 observationId 伪装新材质、功效、参数或认证。",
    "productName、category、brand 必须保守；品牌没有清晰 image_text 观察时写“未识别”。summary 只概括已锁定观察。",
    "visualAudit 必须正好8项并唯一覆盖 composition、sellingHierarchy、color、typography、visualPath、material、algorithmFit、emotion；建议可以是后续设计方向，不得冒充产品事实。",
    compact
      ? "本次是长度恢复模式：summary只写1句；8项visualAudit的title、finding、recommendation各只写1个短句；visualKeywords最多6条，risks最多4条。"
      : "保持输出紧凑：summary不超过2句；8项visualAudit的finding与recommendation各只写1个可执行短句；不得扩写长篇报告。",
    `全部素材ID：${input.assetIds.join("、")}`,
    input.notes
      ? `用户补充背景（仅作研究背景，不得越过原子观察生成新产品事实）：${input.notes}`
      : "用户未补充额外背景。",
    `已锁定原子观察：${JSON.stringify(input.observations)}`,
    JSON_ONLY
  ].join("\n\n");
}
