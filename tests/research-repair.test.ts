import { describe, expect, it } from "vitest";
import {
  collectResearchStructureIssues,
  RESEARCH_AUDIT_KEYS
} from "@/lib/skill-suite/research-normalization";

function validAudit() {
  return RESEARCH_AUDIT_KEYS.map((key) => ({
    key,
    title: `${key}维度`,
    finding: `${key}具体发现`,
    recommendation: `${key}可执行建议`
  }));
}

function validFact(index: number) {
  return {
    id: `fact-${String(index).padStart(2, "0")}`,
    label: `外观事实${index}`,
    value: `外观事实值${index}`,
    evidence: `asset-01中的可见证据${index}`,
    sourceAssetIds: ["asset-01"],
    sourceType: "visual_observation",
    claimScope: "appearance",
    entityType: "product",
    ocrConfidence: 1,
    status: "verified",
    commercialUse: true
  };
}

function validResearchPayload() {
  return {
    productName: "旋转拖把套装",
    category: "清洁工具>拖把",
    brand: "未识别",
    summary: "灰白配色旋转拖把与配套拖把桶。",
    facts: Array.from({ length: 6 }, (_, index) => validFact(index + 1)),
    visualAudit: validAudit(),
    visualKeywords: ["旋转拖把", "灰白配色", "透明桶身"],
    risks: [],
    source: "model",
    generatedAt: "2026-07-26T10:00:00+08:00"
  };
}

const ALLOWED_ASSETS = { allowedAssetIds: ["asset-01"] } as const;

describe("图研修复管线：字段级跨范围命中反馈", () => {
  it("appearance 事实的 value 混入「双驱旋转」时，issue 同时点名字段、命中词和目标范围", () => {
    const payload = validResearchPayload();
    payload.facts[0] = {
      ...payload.facts[0],
      label: "桶身外观",
      value: "透明桶身，双驱旋转结构",
      evidence: "产品图可见透明桶身"
    };

    const issues = collectResearchStructureIssues(payload, ALLOWED_ASSETS);
    const conflict = issues.find(
      (issue) =>
        issue.path === "facts[0].claimScope" &&
        issue.code === "CROSS_FIELD_CONFLICT"
    );

    expect(conflict).toBeDefined();
    // 字段级定位：必须点名是 value 字段命中，而不是笼统说“混入了机制”。
    expect(conflict?.message).toContain("facts[0].value 命中");
    // 目标范围：必须告诉修复模型这些词属于 mechanism。
    expect(conflict?.message).toContain("工作机制(mechanism)");
    // 完整命中词：CLAIM_SCOPE_SIGNAL_RULES 已把长备选项前置，
    // “双驱旋转”必须作为连续词整体命中，与修复提示词的拆分示例对齐。
    expect(conflict?.message).toContain("命中「双驱旋转」");
    // 修复指令必须要求拆分而不是改枚举糊弄。
    expect(conflict?.message).toContain("拆成多条原子事实");
    expect(conflict?.message).toContain("不得只修改 claimScope");
  });

  it("performance 事实的 evidence 混入「双驱动」时，同样给出 evidence 字段级命中", () => {
    const payload = validResearchPayload();
    payload.facts[0] = {
      ...payload.facts[0],
      label: "使用省力",
      value: "清洗脱水更省力",
      evidence: "产品图写有双驱动省力",
      sourceType: "image_text",
      claimScope: "performance",
      entityType: "feature",
      ocrConfidence: 0.95,
      status: "candidate"
    };

    const issues = collectResearchStructureIssues(payload, ALLOWED_ASSETS);
    const conflict = issues.find(
      (issue) =>
        issue.path === "facts[0].claimScope" &&
        issue.code === "CROSS_FIELD_CONFLICT"
    );

    expect(conflict).toBeDefined();
    expect(conflict?.message).toContain("facts[0].evidence 命中");
    expect(conflict?.message).toContain("双驱动");
    expect(conflict?.message).toContain("工作机制(mechanism)");
    // 同范围词（省力属于 performance 自身）不应被当成跨范围命中。
    expect(conflict?.message).not.toContain("性能/用户效果(performance)");
  });
});

describe("图研修复管线：拆分后的合规结果", () => {
  it("复合事实按契约拆成两条单范围事实后不再报 CROSS_FIELD_CONFLICT", () => {
    // 红例：一条 mechanism 事实里同时塞进机制与性能语义。
    const fused = validResearchPayload();
    fused.facts[0] = {
      ...fused.facts[0],
      label: "双驱旋转更省力",
      value: "双驱旋转，清洗更省力",
      evidence: "产品图写有双驱旋转，清洗更省力",
      sourceType: "image_text",
      claimScope: "mechanism",
      entityType: "feature",
      ocrConfidence: 0.95,
      status: "candidate"
    };
    expect(
      collectResearchStructureIssues(fused, ALLOWED_ASSETS).some(
        (issue) => issue.code === "CROSS_FIELD_CONFLICT"
      )
    ).toBe(true);

    // 绿例：按拆分契约得到两条单范围原子事实，复用素材ID、id 各自唯一。
    const repaired = validResearchPayload();
    repaired.facts[0] = {
      ...repaired.facts[0],
      label: "双驱旋转结构",
      value: "双驱旋转",
      evidence: "产品图文字标注双驱旋转",
      sourceType: "image_text",
      claimScope: "mechanism",
      entityType: "feature",
      ocrConfidence: 0.95,
      status: "candidate"
    };
    repaired.facts[1] = {
      ...repaired.facts[1],
      label: "清洗脱水省力",
      value: "清洗脱水更省力",
      evidence: "产品图文字标注清洗脱水更省力",
      sourceType: "image_text",
      claimScope: "performance",
      entityType: "feature",
      ocrConfidence: 0.95,
      status: "candidate"
    };

    const issues = collectResearchStructureIssues(repaired, ALLOWED_ASSETS);
    expect(
      issues.some((issue) => issue.code === "CROSS_FIELD_CONFLICT")
    ).toBe(false);
    // 拆分结果本身也必须整体通过结构校验，才能真正结束修复循环。
    expect(issues).toEqual([]);
  });
});
