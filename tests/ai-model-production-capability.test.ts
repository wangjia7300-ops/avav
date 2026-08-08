import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProviderConfig } from "@/lib/types";

const providerBoundary = vi.hoisted(() => ({
  createAIChatCompletion: vi.fn()
}));

vi.mock("@/lib/services/openai-client", () => ({
  createAIChatCompletion: providerBoundary.createAIChatCompletion
}));

import { POST } from "@/app/api/ai-model/test/route";

const providerConfig: AIProviderConfig = {
  providerId: "openai",
  apiKey: "test-api-key",
  baseURL: "https://api.openai.com/v1",
  model: "test-vision-model",
  displayName: "Test provider"
};

const validCapabilityResult = {
  category: "测试品类",
  dominantColor: "蓝绿色",
  visibleFact: "画面中有蓝绿色几何图形",
  planningRole: "首屏建立产品认知",
  executionMode: "E",
  qaRule: "只采用图片内可见证据"
};

function localModelTestRequest() {
  const body = JSON.stringify({ providerConfig });
  return new Request("http://127.0.0.1:3000/api/ai-model/test", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      "sec-fetch-site": "same-origin"
    },
    body
  });
}

describe("POST /api/ai-model/test production capability contract", () => {
  beforeEach(() => {
    providerBoundary.createAIChatCompletion.mockReset();
  });

  it.each([
    ["category 为空白", "category", "   "],
    ["dominantColor 为空白", "dominantColor", "   "],
    ["visibleFact 为空白", "visibleFact", "   "],
    ["planningRole 缺失", "planningRole", undefined],
    ["planningRole 为空白", "planningRole", "   "],
    ["executionMode 缺失", "executionMode", undefined],
    ["executionMode 为空白", "executionMode", "   "],
    ["qaRule 缺失", "qaRule", undefined],
    ["qaRule 为空白", "qaRule", "   "]
  ])("%s 时不得将模型标记为 ready", async (_label, field, value) => {
    const result: Record<string, unknown> = { ...validCapabilityResult };
    if (value === undefined) {
      delete result[field];
    } else {
      result[field] = value;
    }
    providerBoundary.createAIChatCompletion.mockResolvedValue(
      JSON.stringify(result)
    );

    const response = await POST(localModelTestRequest());
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({ success: false });
    expect(payload.data?.ready).not.toBe(true);
  });

  it("允许模型用自然语言表达品类和执行模式，不把示例词当连接凭证", async () => {
    providerBoundary.createAIChatCompletion.mockResolvedValue(
      JSON.stringify({
        ...validCapabilityResult,
        category: "抽象色彩图形",
        executionMode: "生成电商详情页执行稿"
      })
    );

    const response = await POST(localModelTestRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, data: { ready: true } });
  });

  it("允许 planningRole 与 qaRule 用自然语言表达同一能力", async () => {
    providerBoundary.createAIChatCompletion.mockResolvedValue(
      JSON.stringify(validCapabilityResult)
    );

    const response = await POST(localModelTestRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      data: { ready: true }
    });
  });
});
