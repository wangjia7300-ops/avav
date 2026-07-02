import { NextResponse } from "next/server";
import { shouldUseMockData } from "@/lib/config";
import { getProviderCapabilities } from "@/lib/ai-providers";
import { createAIChatCompletion } from "@/lib/services/openai-client";
import { serializeApiError, ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig } from "@/lib/types";

const capabilities = [
  {
    id: "product_vision",
    name: "产品图片识别",
    description: "识别品类、外观、材质、颜色、可见功能和风险点。"
  },
  {
    id: "design_plan",
    name: "视觉策划生成",
    description: "生成主图方案和详情页方案，避免夸大不可确认参数。"
  },
  {
    id: "image_prompts",
    name: "AI 绘画提示词",
    description: "生成 GPT 图像提示词和负面词。"
  }
];

const tinyVisionTestImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAZUlEQVR42u3QMREAAAgEIPsHdbbBm8OTgQJUT/JZCRAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAfctwahDlGo2Y24AAAAASUVORK5CYII=";

export async function GET() {
  const useMock = shouldUseMockData();
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);

  return NextResponse.json({
    success: true,
    data: {
      mode: useMock ? "mock" : "openai",
      ready: useMock || hasOpenAIKey,
      hasOpenAIKey,
      model: process.env.OPENAI_PRODUCT_ANALYSIS_MODEL ?? "gpt-4.1-mini",
      capabilities,
      message: useMock
        ? "当前为 mock 演示模式，可以直接完成第一次流程测试。"
        : hasOpenAIKey
          ? "OpenAI Key 已配置，可以进行真实模型测试。"
          : "真实模式缺少 OPENAI_API_KEY，请在 .env.local 中配置后重启服务。"
    }
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      providerConfig?: AIProviderConfig | null;
    };
    const providerConfig = body.providerConfig ?? null;
    const providerCapabilities = getProviderCapabilities(providerConfig);

    if (!providerConfig?.apiKey || !providerConfig.model) {
      return NextResponse.json(
        {
          success: false,
          error: "请先填写 API Key 和模型名称，再测试模型配置。",
          code: "MODEL_TEST_CONFIG_MISSING"
        },
        { status: 400 }
      );
    }

    if (!providerCapabilities.supportsVision) {
      throw new ServiceError("当前模型不支持图片识别，请换用支持视觉理解的模型。", {
        statusCode: 400,
        code: "MODEL_CAPABILITY_UNSUPPORTED"
      });
    }

    const text = await createAIChatCompletion(providerConfig, {
      model: providerConfig.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "这是一次模型连通性与图片理解能力测试。",
                "请判断你是否收到了随消息发送的一张极小 PNG 测试图片。",
                "只返回 JSON，不要解释。"
              ].join("\n")
            },
            {
              type: "image_url",
              image_url: {
                url: tinyVisionTestImage,
                detail: "low"
              }
            }
          ]
        }
      ],
      jsonSchema: {
        name: "model_connection_test",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ok", "message", "imageInputReceived"],
          properties: {
            ok: { type: "boolean" },
            message: { type: "string" },
            imageInputReceived: { type: "boolean" }
          }
        }
      },
      maxTokens: 220
    });

    const result = JSON.parse(text) as {
      ok?: boolean;
      imageInputReceived?: boolean;
      message?: string;
    };

    if (!result.ok || !result.imageInputReceived) {
      throw new Error(
        result.message ||
          "文本连接成功，但图片理解测试未通过。请换用支持视觉理解的模型或接入点。"
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        mode: "openai",
        ready: true,
        hasOpenAIKey: true,
        model: providerConfig.model,
        capabilities,
        message: `${providerConfig.providerId}/${providerConfig.model} 文本连接与图片理解测试通过，可以开始真实分析。`
      }
    });
  } catch (error) {
    const response = serializeApiError(error, "模型连接测试失败。");

    return NextResponse.json(response.body, { status: response.status });
  }
}
