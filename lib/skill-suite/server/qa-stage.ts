import { buildQAPrompt } from "@/lib/skill-suite/prompts";
import {
  assertPlan,
  assertQAModelResponse,
  assertQAReport,
  assertResearch,
  buildQACoverage,
  extractJsonObject,
  isQAInputComplete,
  runDeterministicQA
} from "@/lib/skill-suite/validation";
import type {
  AIProviderConfig,
  ProductResearch,
  QANotEvaluated,
  QAReport,
  QAFinding
} from "@/lib/types";
import { ServiceError } from "@/lib/services/errors";
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

function coverageFinding(
  severity: QAFinding["severity"],
  title: string,
  evidence: string,
  fix: string
): QAFinding {
  return {
    id: `qa-coverage-${title}`,
    severity,
    module: "质检覆盖",
    title,
    evidence,
    fix
  };
}

function renderNotEvaluated(): QANotEvaluated[] {
  return [
    {
      check: "render",
      status: "not_evaluated",
      reason: "当前请求未携带15屏真实成图，不能检查主体一致性、文字遮挡与实际画面比例。"
    },
    {
      check: "pixel",
      status: "not_evaluated",
      reason: "没有绑定可追溯的成图像素产物，不能执行OCR、尺寸与可读性检查。"
    }
  ];
}

export async function runQAStage(
  body: Extract<SkillSuiteRequest, { stage: "qa" }>,
  providerConfig: AIProviderConfig,
  signal?: AbortSignal
) {
  assertResearch(body.research);
  const coverage = buildQACoverage(body.plan, body.executions);
  let planValidationDetails: string[] = [];
  try {
    assertPlan(body.plan, body.research.facts);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "details" in error &&
      Array.isArray(error.details)
    ) {
      planValidationDetails = error.details.filter(
        (item): item is string => typeof item === "string"
      );
    } else {
      throw error;
    }
  }

  const deterministicFindings = runDeterministicQA(
    body.plan,
    body.executions,
    body.research.facts
  );
  if (planValidationDetails.length) {
    deterministicFindings.unshift(
      coverageFinding(
        "error",
        "策划结构未通过完整性校验",
        planValidationDetails.slice(0, 8).join("；"),
        "先修复对应策划屏，再只续跑受影响的执行屏。"
      )
    );
  }

  const generatedAt = new Date().toISOString();
  if (!isQAInputComplete(coverage)) {
    const report: QAReport = {
      status: "incomplete",
      coverage,
      checks: {
        rules: "evaluated",
        semantic: "not_evaluated",
        render: "not_evaluated",
        pixel: "not_evaluated"
      },
      notEvaluated: [
        {
          check: "semantic",
          status: "not_evaluated",
          reason: "15屏策划或执行未齐，不运行会造成“全量已检查”误解的语义质检。",
          screenIds: coverage.missingExecutionIds
        },
        ...renderNotEvaluated()
      ],
      publishDecision: "not_ready",
      findings: deterministicFindings,
      summary:
        `质检未完成：策划覆盖 ${coverage.planScreens}/15，执行覆盖 ${coverage.executionScreens}/15。` +
        "规则结果仅代表已提供内容，缺失屏和未运行项不得视为通过。",
      source: "rules",
      generatedAt
    };
    assertQAReport(report);
    return { data: report };
  }

  const prompt = buildQAPrompt({
    research: body.research,
    plan: body.plan,
    executions: body.executions,
    deterministicFindings
  });
  let parsed: Pick<QAReport, "findings" | "summary"> | null = null;
  try {
    const text = await complete(
      providerConfig,
      textMessages(prompt),
      6500,
      { signal, costStage: "qa", costOperation: "语义质检" }
    );
    const candidate = extractJsonObject<unknown>(text);
    assertQAModelResponse(candidate);
    parsed = candidate;
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof ServiceError && error.code === "AI_REQUEST_ABORTED")
    ) {
      throw error;
    }
    const findings = [
      ...deterministicFindings,
      coverageFinding(
        "warning",
        "语义模型质检未完成",
        "确定性规则已经完成，但语义模型超时、不可用或返回结构无效。",
        "检查文案模型配置后重新运行；本报告保留规则结果，但不能冒充完整质检。"
      )
    ];
    const report: QAReport = {
      status: "rules_only",
      coverage,
      checks: {
        rules: "evaluated",
        semantic: "not_evaluated",
        render: "not_evaluated",
        pixel: "not_evaluated"
      },
      notEvaluated: [
        {
          check: "semantic",
          status: "not_evaluated",
          reason: "语义模型调用失败，未以空结果或模板结果冒充成功。"
        },
        ...renderNotEvaluated()
      ],
      publishDecision: findings.some((item) => item.severity === "error")
        ? "not_ready"
        : "review_required",
      findings,
      summary:
        "规则质检已完成，语义质检未完成；请保留当前规则结果并重试语义检查。",
      source: "rules",
      generatedAt
    };
    assertQAReport(report);
    return { data: report };
  }

  const deterministicErrors = deterministicFindings.filter(
    (item) => item.severity === "error"
  );
  const findings = mergeFindings(
    deterministicFindings,
    parsed.findings,
    body.research.facts
  );
  const hasErrors = findings.some((item) => item.severity === "error");
  const hasWarnings = findings.some((item) => item.severity === "warning");
  const allRenderedPixelsVerified =
    coverage.generatedImageScreens === coverage.expectedScreens &&
    coverage.pixelVerifiedScreens === coverage.expectedScreens;
  const report: QAReport = {
    status: hasErrors ? "blocked" : "prompt_complete",
    coverage,
    checks: {
      rules: "evaluated",
      semantic: "evaluated",
      render: "not_evaluated",
      pixel: "not_evaluated"
    },
    notEvaluated: renderNotEvaluated(),
    publishDecision: hasErrors
      ? "not_ready"
      : hasWarnings || !allRenderedPixelsVerified
        ? "review_required"
        : "ready",
    findings,
    summary: deterministicErrors.length
      ? `规则质检发现${deterministicErrors.length}项必须修复；修复前不可视为通过。${parsed.summary}`
      : parsed.summary,
    source: "rules+model",
    generatedAt
  };
  assertQAReport(report);

  return { data: report };
}
