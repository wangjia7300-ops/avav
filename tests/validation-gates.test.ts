import { describe, expect, it } from "vitest";
import {
  assertQAModelResponse,
  assertQAReport,
  assertResearch,
  extractJsonObject,
  SkillSuiteValidationError
} from "@/lib/skill-suite/validation";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";
import type { ProductResearch, QAReport } from "@/lib/types";

function expectSkillSuiteError(run: () => unknown, code: string) {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SkillSuiteValidationError);
  expect((caught as SkillSuiteValidationError).code).toBe(code);
}

function sampleResearch(): ProductResearch {
  const research = createSampleProject().research;
  if (!research) throw new Error("测试夹具缺少 research 数据");
  return research;
}

// 夹具 fact-strap 的 evidence 已与校验器对齐（“材质”→“织物”，
// appearance 事实不再携带 material 语义），夹具本身即绿例。
function passingResearch(): ProductResearch {
  return sampleResearch();
}

function sampleQAReport(): QAReport {
  const qa = createSampleProject().qa;
  if (!qa) throw new Error("测试夹具缺少 qa 数据");
  return qa;
}

describe("extractJsonObject 模型输出解析闸门", () => {
  it("绿例：裸 JSON 对象文本可直接解析", () => {
    expect(extractJsonObject<{ ok: boolean }>('{"ok": true}')).toEqual({
      ok: true
    });
  });

  it("绿例：```json 围栏包裹的对象可正常解析", () => {
    const text = '```json\n{"name": "详情页", "screens": 15}\n```';
    expect(extractJsonObject(text)).toEqual({ name: "详情页", screens: 15 });
  });

  it("绿例：不带语言标记的 ``` 围栏同样可解析", () => {
    const text = '```\n{"status": "done"}\n```';
    expect(extractJsonObject(text)).toEqual({ status: "done" });
  });

  it("绿例：前后带解释文字时截取首个 { 到最后一个 }", () => {
    const text =
      '模型说明：以下是本次的结构化结果。{"status": "ok", "count": 2}以上就是全部输出，感谢使用。';
    expect(extractJsonObject(text)).toEqual({ status: "ok", count: 2 });
  });

  it("绿例：嵌套对象按首 { 到末 } 截取后完整保留内部结构", () => {
    const text =
      '先解释一下 {"outer": {"inner": {"value": 1}}, "list": [1, 2]} 然后收尾';
    expect(extractJsonObject(text)).toEqual({
      outer: { inner: { value: 1 } },
      list: [1, 2]
    });
  });

  it("红例：非 JSON 的自然语言文本抛 MODEL_JSON_INVALID", () => {
    expectSkillSuiteError(
      () => extractJsonObject("模型这次没有输出结构化数据，抱歉。"),
      "MODEL_JSON_INVALID"
    );
  });

  it("红例：空字符串抛 MODEL_JSON_INVALID", () => {
    expectSkillSuiteError(() => extractJsonObject(""), "MODEL_JSON_INVALID");
  });

  it("红例：纯空白字符串抛 MODEL_JSON_INVALID", () => {
    expectSkillSuiteError(
      () => extractJsonObject("   \n\t  "),
      "MODEL_JSON_INVALID"
    );
  });

  it("红例：对象数组文本按首 { 到末 } 截取后不是合法对象，抛 MODEL_JSON_INVALID", () => {
    expectSkillSuiteError(
      () => extractJsonObject('[{"a": 1}, {"b": 2}]'),
      "MODEL_JSON_INVALID"
    );
  });

  it("红例：花括号不完整的残缺 JSON 抛 MODEL_JSON_INVALID", () => {
    expectSkillSuiteError(
      () => extractJsonObject('{"unclosed": 1'),
      "MODEL_JSON_INVALID"
    );
  });

  it("红例：不含对象的纯数组文本抛 MODEL_JSON_INVALID", () => {
    expectSkillSuiteError(
      () => extractJsonObject("[1, 2, 3]"),
      "MODEL_JSON_INVALID"
    );
  });

  it("红例：解析结果为 null 时抛 MODEL_JSON_INVALID", () => {
    expectSkillSuiteError(() => extractJsonObject("null"), "MODEL_JSON_INVALID");
  });
});

describe("assertResearch 图研结果闸门", () => {
  it("绿例：基于测试夹具的完整图研结果通过校验", () => {
    const research = passingResearch();
    expect(() => assertResearch(research)).not.toThrow();
  });

  it("红例：facts 少于6条时抛 RESEARCH_SCHEMA_INVALID", () => {
    const research = passingResearch();
    const broken = { ...research, facts: research.facts.slice(0, 5) };
    expectSkillSuiteError(
      () => assertResearch(broken),
      "RESEARCH_SCHEMA_INVALID"
    );
  });

  it("红例：visualAudit 不足8项时抛 RESEARCH_SCHEMA_INVALID", () => {
    const research = passingResearch();
    const broken = { ...research, visualAudit: research.visualAudit.slice(0, 7) };
    expectSkillSuiteError(
      () => assertResearch(broken),
      "RESEARCH_SCHEMA_INVALID"
    );
  });

  it("红例：facts 中 label+value 仅标点差异的语义重复抛 RESEARCH_SCHEMA_INVALID", () => {
    const research = passingResearch();
    const [first, ...rest] = research.facts;
    // 与第一条事实的 label+value 归一化指纹完全相同（仅多了标点），id 不同
    const semanticDuplicate = {
      ...first,
      id: "fact-semantic-duplicate",
      label: `${first.label}：`,
      value: `${first.value}。`
    };
    // 替换最后一条，保证总数仍满足6条下限，只暴露语义重复问题
    const broken = {
      ...research,
      facts: [first, ...rest.slice(0, rest.length - 1), semanticDuplicate]
    };
    expectSkillSuiteError(
      () => assertResearch(broken),
      "RESEARCH_SCHEMA_INVALID"
    );
  });

  it("红例：根节点不是对象时抛 RESEARCH_SCHEMA_INVALID", () => {
    expectSkillSuiteError(
      () => assertResearch("不是对象"),
      "RESEARCH_SCHEMA_INVALID"
    );
  });
});

describe("assertQAReport 质检报告闸门", () => {
  it("绿例：测试夹具的 qa 报告通过校验", () => {
    const qa = sampleQAReport();
    expect(() => assertQAReport(qa)).not.toThrow();
  });

  it("绿例：模型只需返回 findings 与 summary，由服务端补齐状态", () => {
    const minimal = {
      findings: [
        {
          id: "finding-01",
          severity: "error",
          module: "文案",
          title: "标题重复",
          evidence: "screen-01 与 screen-02 使用相同标题",
          fix: "重写其中一屏的标题"
        }
      ],
      summary: "存在1个需要修复的阻断问题。"
    };
    expect(() => assertQAModelResponse(minimal)).not.toThrow();
  });

  it("红例：正式报告缺少状态与覆盖率时拒绝通过", () => {
    const minimal = {
      findings: [],
      summary: "没有发现规则问题。"
    };
    expectSkillSuiteError(
      () => assertQAReport(minimal),
      "QA_SCHEMA_INVALID"
    );
  });

  it("红例：findings 中 severity 非法时抛 QA_SCHEMA_INVALID", () => {
    const qa = sampleQAReport();
    const broken = {
      ...qa,
      findings: [
        { ...qa.findings[0], severity: "blocker" },
        ...qa.findings.slice(1)
      ]
    };
    expectSkillSuiteError(() => assertQAReport(broken), "QA_SCHEMA_INVALID");
  });

  it("红例：summary 缺失时抛 QA_SCHEMA_INVALID", () => {
    const qa = sampleQAReport();
    const broken = {
      findings: qa.findings,
      source: qa.source,
      generatedAt: qa.generatedAt
    };
    expectSkillSuiteError(() => assertQAReport(broken), "QA_SCHEMA_INVALID");
  });

  it("红例：summary 为纯空白字符串时抛 QA_SCHEMA_INVALID", () => {
    const qa = sampleQAReport();
    const broken = { ...qa, summary: "   " };
    expectSkillSuiteError(() => assertQAReport(broken), "QA_SCHEMA_INVALID");
  });

  it("红例：findings 不是数组时抛 QA_SCHEMA_INVALID", () => {
    const qa = sampleQAReport();
    const broken = { ...qa, findings: "没有问题" };
    expectSkillSuiteError(() => assertQAReport(broken), "QA_SCHEMA_INVALID");
  });

  it("红例：findings 中缺少 fix 字段时抛 QA_SCHEMA_INVALID", () => {
    const qa = sampleQAReport();
    const base = qa.findings[0];
    const findingWithoutFix = {
      id: base.id,
      severity: base.severity,
      module: base.module,
      title: base.title,
      evidence: base.evidence
    };
    const broken = { ...qa, findings: [findingWithoutFix, ...qa.findings.slice(1)] };
    expectSkillSuiteError(() => assertQAReport(broken), "QA_SCHEMA_INVALID");
  });
});
