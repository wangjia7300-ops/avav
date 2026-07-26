import { buildQAPrompt } from "@/lib/skill-suite/prompts";
import {
  assertPlan,
  assertQAReport,
  assertResearch,
  extractJsonObject,
  runDeterministicQA
} from "@/lib/skill-suite/validation";
import type {
  AIProviderConfig,
  ProductResearch,
  QAReport,
  QAFinding
} from "@/lib/types";
import { complete, textMessages } from "./shared";
import type { SkillSuiteRequest } from "./request";

function mergeFindings(
  deterministic: QAFinding[],
  semantic: QAFinding[],
  facts: ProductResearch["facts"]
) {
  const seen = new Set(deterministic.map((item) => `${item.screenId ?? ""}:${item.title}`));
  const availableScopes = new Set(
    facts
      .filter((fact) => fact.commercialUse && fact.status !== "blocked")
      .map((fact) => fact.claimScope)
  );
  return [
    ...deterministic,
    ...semantic.filter((item) => {
      const key = `${item.screenId ?? ""}:${item.title}`;
      if (seen.has(key)) return false;
      // “通过”必须来自可复现的规则检查。语义模型只负责补充问题，
      // 不能在没有真实像素稿或业务资料时自报字号、暗色模式、A/B 等通过项。
      if (item.severity === "pass") return false;
      if (
        item.module === "促销" &&
        !availableScopes.has("promotion")
      ) {
        return false;
      }
      if (
        item.module === "信任证据" &&
        /缺乏|缺少|没有/.test(`${item.title}${item.evidence}`) &&
        !facts.some((fact) =>
          /评价|好评|口碑|用户反馈/.test(`${fact.label}${fact.value}`)
        )
      ) {
        return false;
      }
      if (
        !availableScopes.has("performance") &&
        /保暖|保温|锁温|防滑|耐磨|舒适|柔软|透气|抗菌|耐用/.test(
          `${item.title}${item.evidence}${item.fix}`
        )
      ) {
        return false;
      }
      seen.add(key);
      return true;
    })
  ];
}

export async function runQAStage(
  body: Extract<SkillSuiteRequest, { stage: "qa" }>,
  providerConfig: AIProviderConfig
) {
  assertResearch(body.research);
  assertPlan(body.plan, body.research.facts);
  const deterministicFindings = runDeterministicQA(
    body.plan,
    body.executions,
    body.research.facts
  );
  const prompt = buildQAPrompt({
    research: body.research,
    plan: body.plan,
    executions: body.executions,
    deterministicFindings
  });
  const text = await complete(providerConfig, textMessages(prompt), 6500);
  const parsed = extractJsonObject<QAReport>(text);
  assertQAReport(parsed);
  const deterministicErrors = deterministicFindings.filter(
    (item) => item.severity === "error"
  );
  const report: QAReport = {
    ...parsed,
    findings: mergeFindings(
      deterministicFindings,
      parsed.findings,
      body.research.facts
    ),
    summary: deterministicErrors.length
      ? `规则质检发现${deterministicErrors.length}项必须修复；修复前不可视为通过。${parsed.summary}`
      : parsed.summary,
    source: "rules+model",
    generatedAt: new Date().toISOString()
  };

  return { data: report };
}
