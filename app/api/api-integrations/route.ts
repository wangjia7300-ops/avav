import { NextResponse } from "next/server";
import { ENABLE_REAL_SEARCH, shouldUseMockData } from "@/lib/config";
import { PRESET_PROVIDERS } from "@/lib/ai-providers";

const apiRoutes = [
  {
    method: "POST",
    path: "/api/analyze-product",
    name: "产品图片识别",
    status: "ready",
    description: "接收 imageBase64 或 imageUrl，返回 ProductAnalysis JSON。"
  },
  {
    method: "POST",
    path: "/api/research-product",
    name: "市场卖点分析",
    status: "ready",
    description: "真实搜索当前关闭；基于产品识别、用户补充资料和 AI 策划框架生成市场洞察。"
  },
  {
    method: "POST",
    path: "/api/generate-visual-style",
    name: "视觉风格体系",
    status: "ready",
    description: "基于产品识别结果、用户补充信息和市场资料摘要，生成详情页六大视觉风格模块 JSON。"
  },
  {
    method: "POST",
    path: "/api/generate-design-plan",
    name: "主图/详情页策划",
    status: "ready",
    description: "基于产品识别与市场洞察生成视觉策划 JSON。"
  },
  {
    method: "POST",
    path: "/api/generate-prompts",
    name: "AI 绘画提示词",
    status: "ready",
    description: "基于设计方案生成 GPT 图像提示词与负面词 JSON。"
  }
];

export async function GET() {
  const useMock = shouldUseMockData();
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
  const hasSerpApiKey = ENABLE_REAL_SEARCH && Boolean(process.env.SERPAPI_API_KEY);
  const hasFirecrawlKey = ENABLE_REAL_SEARCH && Boolean(process.env.FIRECRAWL_API_KEY);

  return NextResponse.json({
    success: true,
    data: {
      mode: useMock ? "mock" : "real",
      provider: "OpenAI Responses API",
      ready: useMock || hasOpenAIKey,
      supportsCustomProvider: true,
      providers: PRESET_PROVIDERS.map((p) => ({
        id: p.id,
        name: p.name,
        models: p.models,
        description: p.description,
        capabilities: p.capabilities
      })),
      env: [
        {
          key: "NEXT_PUBLIC_USE_MOCK",
          configured: true,
          value: useMock ? "true" : "false",
          description: "true 默认使用 mock；页面已配置 API 时会优先调用真实模型。"
        },
        {
          key: "OPENAI_API_KEY",
          configured: hasOpenAIKey,
          value: hasOpenAIKey ? "已配置（服务端兜底）" : "未配置",
          description: "只在服务端读取，未配置时可在页面中设置自定义供应商。"
        },
        {
          key: "SERPAPI_API_KEY",
          configured: hasSerpApiKey,
          value: hasSerpApiKey ? "已配置" : "本版本不使用",
          description: "真实搜索当前关闭；即使填写该 Key，本版本也不会调用 SerpAPI。"
        },
        {
          key: "FIRECRAWL_API_KEY",
          configured: hasFirecrawlKey,
          value: hasFirecrawlKey ? "已配置" : "本版本不使用",
          description: "真实搜索当前关闭；即使填写该 Key，本版本也不会调用 Firecrawl。"
        }
      ],
      routes: apiRoutes,
      setupSteps: [
        hasOpenAIKey
          ? "OPENAI_API_KEY 已配置，可作为兜底供应商。"
          : "在页面设置中选择 AI 供应商并填入 API Key，或在 .env.local 填写 OPENAI_API_KEY。",
        "真实搜索当前关闭；市场验证不会调用搜索 API 或模型联网插件。",
        "如果使用页面配置，保存后可直接重新分析；如果使用 .env.local，请将 NEXT_PUBLIC_USE_MOCK 改为 false。",
        "修改 .env.local 后需要重启 dev server。",
        "上传产品图并点击开始分析。"
      ]
    }
  });
}
