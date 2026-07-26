import type OpenAI from "openai";
import { MAX_UPLOAD_IMAGE_COUNT } from "@/lib/config";
import {
  buildResearchRepairPrompt,
  buildResearchPrompt
} from "@/lib/skill-suite/prompts";
import { authorizeUploadedImageFacts } from "@/lib/skill-suite/evidence-policy";
import {
  assertResearch,
  extractJsonObject,
  SkillSuiteValidationError
} from "@/lib/skill-suite/validation";
import { ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig } from "@/lib/types";
import {
  collectResearchStructureIssues,
  normalizeResearchDraft
} from "@/lib/skill-suite/research-normalization";
import { RESEARCH_JSON_SCHEMA } from "@/lib/skill-suite/research-schema";
import { complete, ensureModelMetadata } from "./shared";
import type { SkillSuiteRequest } from "./request";

export async function runResearchStage(
  body: Extract<SkillSuiteRequest, { stage: "research" }>,
  providerConfig: AIProviderConfig
) {
  if (
    !Array.isArray(body.assets) ||
    body.assets.length < 1 ||
    body.assets.length > MAX_UPLOAD_IMAGE_COUNT
  ) {
    throw new ServiceError(`请上传1–${MAX_UPLOAD_IMAGE_COUNT}张产品图。`, {
      statusCode: 400,
      code: "ASSET_COUNT_INVALID"
    });
  }

  const invalidAsset = body.assets.find(
    (asset) =>
      typeof asset?.id !== "string" ||
      typeof asset?.dataUrl !== "string" ||
      !/^data:image\/(?:png|jpeg|webp);base64,/i.test(asset.dataUrl)
  );
  if (invalidAsset) {
    throw new ServiceError("产品图必须是 JPG、PNG 或 WEBP 的本地 data URL。", {
      statusCode: 400,
      code: "ASSET_FORMAT_INVALID"
    });
  }

  const assetIds = body.assets.map((asset) => asset.id);
  const notes = body.notes?.trim() ?? "";
  const imageParts = body.assets.map(
    (asset) =>
      ({
        type: "image_url",
        image_url: { url: asset.dataUrl, detail: "high" }
      }) as OpenAI.Chat.Completions.ChatCompletionContentPartImage
  );
  // 语义类问题（JSON 已完整、仅字段语义冲突）在修复轮次改为纯文本任务，
  // 避免模型重新看图后再次生成自然复合句，抵消“只修结构”的要求。
  const SEMANTIC_ISSUE_CODES = new Set([
    "COMPOSITE_ENUM",
    "CROSS_FIELD_CONFLICT",
    "INVALID_ENUM",
    "DUPLICATE_VALUE",
    "OUT_OF_RANGE"
  ]);
  let currentPrompt = buildResearchPrompt(assetIds, notes);
  let parsed: unknown;
  let repairCount = 0;
  let responseMetadata: unknown;
  let includeImages = true;
  let lastIssueFingerprint: string | null = null;

  while (repairCount <= 2) {
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: currentPrompt },
      ...(includeImages ? imageParts : [])
    ];
    const text = await complete(
      providerConfig,
      [
        {
          role: "system",
          content:
            "你是电商产品图片研究员。只依据图片和用户补充提取内容；用户上传图片内的可识别文字、参数、材质、功能和卖点全部视为甲方一方基础资料，可用于文案。风险只做备注，不因缺少外部报告删除内容。"
        },
        { role: "user", content }
      ],
      7000,
      {
        jsonSchema: {
          name: "product_research",
          schema: RESEARCH_JSON_SCHEMA,
          strict: true
        },
        onResponseMetadata: (metadata) => {
          responseMetadata = metadata;
        }
      }
    );

    let rejectedResult: unknown = text;
    let jsonParsed = false;
    let structuredIssues: Array<{ path: string; code: string }> = [];
    let issues: string[] = [];
    try {
      const extracted = extractJsonObject<unknown>(text);
      const normalized = normalizeResearchDraft(extracted);
      parsed =
        normalized &&
        typeof normalized === "object" &&
        !Array.isArray(normalized)
          ? {
              ...normalized,
              source: "model",
              generatedAt: new Date().toISOString()
            }
          : normalized;
      rejectedResult = parsed;
      jsonParsed = true;
      const collected = collectResearchStructureIssues(parsed, {
        allowedAssetIds: assetIds
      });
      structuredIssues = collected.map((issue) => ({
        path: issue.path,
        code: issue.code
      }));
      issues = collected.map(
        (issue, index) =>
          `${index + 1}. [${issue.code}] ${issue.path}：${issue.message}`
      );
    } catch (error) {
      if (
        error instanceof SkillSuiteValidationError &&
        error.code === "MODEL_JSON_INVALID"
      ) {
        structuredIssues = [{ path: "$", code: "MODEL_JSON_INVALID" }];
        issues = ["1. [MODEL_JSON_INVALID] $：返回内容不是完整 JSON 对象。"];
      } else {
        throw error;
      }
    }

    if (issues.length === 0) break;

    // 连续两轮修复停留在同一组问题上，说明修复不收敛，
    // 立即失败并展示字段级命中详情，避免继续重复计费。
    const issueFingerprint = structuredIssues
      .map((issue) => `${issue.path}|${issue.code}`)
      .sort()
      .join(";");
    if (repairCount > 0 && issueFingerprint === lastIssueFingerprint) {
      throw new SkillSuiteValidationError(
        "真实模型图研修复连续两轮停留在同一组结构问题上，已提前终止，未写入兜底数据。",
        "RESEARCH_REPAIR_NOT_CONVERGING",
        issues
      );
    }
    lastIssueFingerprint = issueFingerprint;

    if (repairCount === 2) {
      throw new SkillSuiteValidationError(
        "真实模型图研结果经两次定点修复后仍不符合生产结构，未写入兜底数据。",
        "RESEARCH_SCHEMA_INVALID",
        issues
      );
    }

    const textOnlyRepair =
      jsonParsed &&
      structuredIssues.every((issue) => SEMANTIC_ISSUE_CODES.has(issue.code));

    repairCount += 1;
    includeImages = !textOnlyRepair;
    currentPrompt = buildResearchRepairPrompt({
      rejectedResult,
      issues,
      assetIds,
      notes,
      textOnly: textOnlyRepair
    });
  }

  assertResearch(parsed);
  const authorized = authorizeUploadedImageFacts(
    parsed,
    assetIds
  );
  assertResearch(authorized);
  const research = ensureModelMetadata(authorized);

  return {
    data: research,
    meta: {
      repairCount,
      fallbackUsed: false,
      responseMetadata
    }
  };
}
