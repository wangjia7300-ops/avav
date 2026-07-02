import OpenAI from "openai";
import { providerSupportsBuiltInSearch } from "@/lib/ai-providers";
import { ENABLE_REAL_SEARCH } from "@/lib/config";
import type { AIProviderConfig, ProductAnalysis, ProductManualInfo, SearchProviderConfig } from "@/lib/types";

type SearchProviderName = "SerpAPI" | "Firecrawl" | "Doubao Web Search";

export type ProductSearchResult = {
  provider: SearchProviderName;
  query: string;
  title: string;
  link: string;
  snippet: string;
};

export type ProductSearchBundle = {
  usedSearch: boolean;
  providerNames: SearchProviderName[];
  queries: string[];
  results: ProductSearchResult[];
  errors: string[];
  sourceNote: string;
};

type OrganicResult = {
  title?: string;
  link?: string;
  url?: string;
  snippet?: string;
  description?: string;
};

const MAX_QUERIES = 6;
const RESULTS_PER_QUERY = 5;
const MAX_TOTAL_RESULTS = 14;
const VOLCENGINE_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const ARK_ENDPOINT_ID_PATTERN = /^ep-[a-z0-9-]+$/i;

function normalizeArkConfig(config: AIProviderConfig) {
  const rawBaseURL = config.baseURL.trim();
  const rawModel = config.model.trim();

  if (ARK_ENDPOINT_ID_PATTERN.test(rawBaseURL)) {
    return {
      baseURL: VOLCENGINE_ARK_BASE_URL,
      model: rawBaseURL
    };
  }

  return {
    baseURL: (rawBaseURL || VOLCENGINE_ARK_BASE_URL)
      .replace(/\/+$/g, "")
      .replace(/\/responses$/i, "")
      .replace(/\/chat\/completions$/i, ""),
    model: rawModel
  };
}

function uniqueItems(items: string[], limit = Number.POSITIVE_INFINITY) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function splitManualItems(value?: string) {
  return (value ?? "")
    .split(/[、，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanSnippet(value?: string) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .slice(0, 220);
}

function resolveSearchConfig(config?: SearchProviderConfig | null): SearchProviderConfig | null {
  if (config?.apiKey) {
    return {
      providerId: config.providerId,
      apiKey: config.apiKey
    };
  }

  if (process.env.SERPAPI_API_KEY) {
    return {
      providerId: "serpapi",
      apiKey: process.env.SERPAPI_API_KEY
    };
  }

  if (process.env.FIRECRAWL_API_KEY) {
    return {
      providerId: "firecrawl",
      apiKey: process.env.FIRECRAWL_API_KEY
    };
  }

  return null;
}

export function buildProductResearchQueries(
  product: ProductAnalysis,
  manualProductInfo?: ProductManualInfo
) {
  const productName =
    manualProductInfo?.productName ||
    product.productNameGuess ||
    manualProductInfo?.category ||
    product.category ||
    "产品";
  const category = manualProductInfo?.category || product.category || productName;
  const brand = manualProductInfo?.brand || product.brandNames?.chinese || product.brandNames?.english || "";
  const sellingPoints = uniqueItems([
    ...splitManualItems(manualProductInfo?.sellingPoints),
    ...(product.sellingPoints ?? []),
    ...product.visibleFeatures
  ], 4).join(" ");
  const audience = uniqueItems([
    ...splitManualItems(manualProductInfo?.targetAudience),
    ...(product.targetAudience ?? [])
  ], 2).join(" ");
  const baseName = uniqueItems([brand, productName, category], 3).join(" ");

  return uniqueItems(
    [
      `${brand ? `${brand} ` : ""}${productName} 官方 参数 详情页`,
      `${category} 1688 同类产品 标准名称 核心参数 供应链`,
      `${category} 淘宝 京东 TOP3 竞品 标题 卖点 价格带`,
      `${category} 用户评价 好评 差评 常见问题`,
      `${category} 小红书 抖音 测评 种草 拔草 使用场景`,
      `${category} ${sellingPoints} 同类产品 详情页 视觉风格 主图 ${audience}`
    ],
    MAX_QUERIES
  );
}

async function searchWithSerpApi(apiKey: string, query: string): Promise<ProductSearchResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("hl", "zh-cn");
  url.searchParams.set("gl", "cn");
  url.searchParams.set("num", String(RESULTS_PER_QUERY));

  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    organic_results?: OrganicResult[];
  };

  if (!response.ok || payload.error) {
    throw new Error(payload.error || `SerpAPI HTTP ${response.status}`);
  }

  return (payload.organic_results ?? [])
    .map((item) => ({
      provider: "SerpAPI" as const,
      query,
      title: cleanSnippet(item.title),
      link: item.link || item.url || "",
      snippet: cleanSnippet(item.snippet || item.description)
    }))
    .filter((item) => item.title && (item.link || item.snippet));
}

async function searchWithFirecrawl(apiKey: string, query: string): Promise<ProductSearchResult[]> {
  const response = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      query,
      limit: RESULTS_PER_QUERY,
      sources: ["web"],
      scrapeOptions: {
        formats: [{ type: "markdown" }],
        onlyMainContent: true
      }
    }),
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    data?: OrganicResult[] | { web?: OrganicResult[] };
  };

  if (!response.ok || payload.success === false || payload.error) {
    throw new Error(payload.error || `Firecrawl HTTP ${response.status}`);
  }

  const results = Array.isArray(payload.data) ? payload.data : payload.data?.web ?? [];

  return results
    .map((item) => ({
      provider: "Firecrawl" as const,
      query,
      title: cleanSnippet(item.title),
      link: item.url || item.link || "",
      snippet: cleanSnippet(item.description || item.snippet)
    }))
    .filter((item) => item.title && (item.link || item.snippet));
}

function extractResponsesText(response: unknown) {
  const payload = response as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };

  if (payload.output_text) {
    return payload.output_text.trim();
  }

  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter((text): text is string => Boolean(text))
      .join("\n")
      .trim() ?? ""
  );
}

function extractJsonLikeText(text: string) {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const objectStart = clean.indexOf("{");
  const objectEnd = clean.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return clean.slice(objectStart, objectEnd + 1);
  }

  return clean;
}

function normalizeArkSearchItems(items: unknown, queries: string[]): ProductSearchResult[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, index) => {
      const value = item as {
        query?: string;
        title?: string;
        link?: string;
        url?: string;
        snippet?: string;
        summary?: string;
        source?: string;
      };

      return {
        provider: "Doubao Web Search" as const,
        query: cleanSnippet(value.query) || queries[index % Math.max(queries.length, 1)] || "联网搜索",
        title: cleanSnippet(value.title || value.source),
        link: value.link || value.url || "",
        snippet: cleanSnippet(value.snippet || value.summary)
      };
    })
    .filter((item) => item.title && item.link && /^https?:\/\//i.test(item.link));
}

async function searchWithArkWebSearch(
  providerConfig: AIProviderConfig,
  productAnalysis: ProductAnalysis,
  manualProductInfo: ProductManualInfo | undefined,
  queries: string[]
): Promise<ProductSearchResult[]> {
  const { baseURL, model } = normalizeArkConfig(providerConfig);
  if (!providerConfig.apiKey || !model) {
    return [];
  }

  const client = new OpenAI({
    apiKey: providerConfig.apiKey,
    baseURL,
    timeout: Number(process.env.AI_REQUEST_TIMEOUT_MS) || 120000,
    maxRetries: 0
  });

  const response = await client.responses.create({
    model,
    instructions: [
      "你是电商市场研究员。你必须使用联网搜索工具核验信息。",
      "请根据给定产品和搜索词进行真实联网搜索，只返回 JSON，不要 Markdown。",
      "每条结果必须来自可访问网页，并尽量提供 source link。没有链接的内容不要作为搜索结果返回。",
      "严禁编造销量、价格、排名、评价原文。没有搜索证据就留空数组。"
    ].join("\n"),
    input: [
      {
        role: "user",
        content: [
          "请围绕该产品执行电商市场搜索，返回最多14条可用证据。",
          "JSON 格式：{\"results\":[{\"query\":\"搜索词\",\"title\":\"网页标题\",\"link\":\"https://...\",\"snippet\":\"与标题/卖点/用户痛点/详情视觉相关的摘要\"}]}",
          `产品识别：${JSON.stringify(productAnalysis)}`,
          `用户补充：${JSON.stringify(manualProductInfo ?? {})}`,
          `搜索词：${queries.join("；")}`
        ].join("\n")
      }
    ] as never,
    tools: [{ type: "web_search" }],
    max_output_tokens: 2200
  } as never);

  const text = extractResponsesText(response);
  if (!text) {
    return [];
  }

  const parsed = JSON.parse(extractJsonLikeText(text)) as { results?: unknown };
  return normalizeArkSearchItems(parsed.results, queries);
}

function dedupeResults(results: ProductSearchResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = (result.link || result.title).toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function collectProductSearchEvidence(input: {
  productAnalysis: ProductAnalysis;
  manualProductInfo?: ProductManualInfo;
  searchConfig?: SearchProviderConfig | null;
  providerConfig?: AIProviderConfig | null;
}): Promise<ProductSearchBundle> {
  const queries = buildProductResearchQueries(input.productAnalysis, input.manualProductInfo);

  if (!ENABLE_REAL_SEARCH) {
    return {
      usedSearch: false,
      providerNames: [],
      queries,
      results: [],
      errors: [],
      sourceNote:
        "真实联网搜索当前已关闭；市场洞察基于产品识别、用户补充资料和电商策划框架生成，不调用搜索 API 或模型搜索插件。"
    };
  }

  const config = resolveSearchConfig(input.searchConfig);
  const canUseArkSearch = providerSupportsBuiltInSearch(input.providerConfig);

  if (!config) {
    if (canUseArkSearch && input.providerConfig) {
      try {
        const arkResults = dedupeResults(
          await searchWithArkWebSearch(input.providerConfig, input.productAnalysis, input.manualProductInfo, queries)
        ).slice(0, MAX_TOTAL_RESULTS);

        return {
          usedSearch: arkResults.length > 0,
          providerNames: arkResults.length ? ["Doubao Web Search"] : [],
          queries,
          results: arkResults,
          errors: [],
          sourceNote: arkResults.length
            ? `已使用豆包/火山方舟联网搜索插件获取真实网页证据（${arkResults.length} 条摘要）。`
            : "已尝试调用豆包/火山方舟联网搜索插件，但模型未返回带来源链接的可用网页证据。"
        };
      } catch (error) {
        return {
          usedSearch: false,
          providerNames: [],
          queries,
          results: [],
          errors: [`豆包联网搜索失败：${error instanceof Error ? error.message : "未知错误"}`],
          sourceNote:
            "已配置豆包/火山方舟模型，但联网搜索插件调用失败；市场洞察将降级为 AI 推断或用户资料分析。"
        };
      }
    }

    return {
      usedSearch: false,
      providerNames: [],
      queries,
      results: [],
      errors: [],
      sourceNote:
        "未配置真实搜索 API Key，市场洞察暂时只能基于产品识别结果和电商研究框架生成。"
    };
  }

  const providerName: SearchProviderName = config.providerId === "firecrawl" ? "Firecrawl" : "SerpAPI";
  const errors: string[] = [];
  const resultGroups = await Promise.all(
    queries.map(async (query) => {
      try {
        return config.providerId === "firecrawl"
          ? await searchWithFirecrawl(config.apiKey, query)
          : await searchWithSerpApi(config.apiKey, query);
      } catch (error) {
        errors.push(`${query}：${error instanceof Error ? error.message : "搜索失败"}`);
        return [];
      }
    })
  );

  const results = dedupeResults(resultGroups.flat()).slice(0, MAX_TOTAL_RESULTS);

  return {
    usedSearch: results.length > 0,
    providerNames: results.length ? [providerName] : [],
    queries,
    results,
    errors,
    sourceNote: results.length
      ? `已使用真实联网搜索结果（${providerName}，${results.length} 条摘要）并结合产品识别结果生成。`
      : `已调用 ${providerName}，但没有取得可用搜索摘要；请检查搜索 API Key、额度或网络后重试。`
  };
}

export function formatSearchEvidenceForPrompt(bundle: ProductSearchBundle) {
  if (!bundle.results.length) {
    return [
      bundle.sourceNote,
      bundle.errors.length ? `搜索错误：${bundle.errors.join("；")}` : "",
      `建议人工研究词：${bundle.queries.join("；")}`
    ]
      .filter(Boolean)
      .join("\n");
  }

  return bundle.results
    .map((result, index) =>
      [
        `${index + 1}. 来源：${result.provider}`,
        `搜索词：${result.query}`,
        `标题：${result.title}`,
        result.snippet ? `摘要：${result.snippet}` : "",
        result.link ? `链接：${result.link}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}
