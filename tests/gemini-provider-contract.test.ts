import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChatCompletion,
  PRESET_PROVIDERS
} from "@/lib/ai-providers";
import {
  createProviderDraft,
  isProviderConfigComplete
} from "@/components/workspace/AIProviderConfig";
import type {
  AIProviderConfig,
  AIProviderId
} from "@/lib/types";

const GEMINI_PROVIDER_ID = "gemini" as AIProviderId;
const GEMINI_NATIVE_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
const originalGeminiProxyUrl = process.env.GEMINI_PROXY_URL;
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn<FetchLike>>;

function geminiConfig(): AIProviderConfig {
  return {
    providerId: GEMINI_PROVIDER_ID,
    apiKey: "gemini-test-secret",
    baseURL: GEMINI_NATIVE_BASE_URL,
    model: "gemini-3.6-flash"
  };
}

function successResponse(
  text = '{"category":"拖把","visibleFact":"灰白双槽桶"}',
  finishReason = "STOP"
) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason,
          content: { parts: [{ text }] }
        }
      ],
      modelVersion: "gemini-3.6-flash"
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function requestBody(fetchMock: FetchMock) {
  const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(options?.body ?? "{}")) as Record<string, unknown>;
}

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string" },
    visibleFact: { type: "string" }
  },
  required: ["category", "visibleFact"]
};

describe("Google Gemini native generateContent provider contract", () => {
  beforeEach(() => {
    delete process.env.GEMINI_PROXY_URL;
  });

  afterEach(() => {
    if (originalGeminiProxyUrl === undefined) {
      delete process.env.GEMINI_PROXY_URL;
    } else {
      process.env.GEMINI_PROXY_URL = originalGeminiProxyUrl;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("服务端配置 Gemini 代理时把代理 dispatcher 交给 generateContent 请求", async () => {
    process.env.GEMINI_PROXY_URL = "http://127.0.0.1:10808";
    const fetchMock = vi.fn<FetchLike>(async () => successResponse("OK"));
    vi.stubGlobal("fetch", fetchMock);

    await createChatCompletion(geminiConfig(), {
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "测试连接" }],
      maxTokens: 20,
      timeoutMs: 20_000,
      maxTransportRetries: 0
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      dispatcher: expect.anything()
    });
  });

  it("供应商列表提供可直接填写 Key 的 Gemini 原生视觉模型配置", () => {
    const preset = PRESET_PROVIDERS.find(
      (provider) => provider.id === GEMINI_PROVIDER_ID
    );

    expect(preset).toMatchObject({
      id: "gemini",
      name: expect.stringContaining("Gemini"),
      baseURL: GEMINI_NATIVE_BASE_URL,
      requiresAuth: true,
      visionSupport: "supported"
    });
    expect(preset?.models[0]).toBe("gemini-flash-latest");

    const draft = createProviderDraft(GEMINI_PROVIDER_ID);
    expect(draft).toEqual({
      providerId: "gemini",
      apiKey: "",
      baseURL: GEMINI_NATIVE_BASE_URL,
      model: "gemini-flash-latest"
    });
    expect(
      isProviderConfigComplete({ ...draft, apiKey: "session-only-key" })
    ).toBe(true);
  });

  it("通过统一 provider seam 把 system 指令、文字与 base64 产品图转换为 generateContent", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => successResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await createChatCompletion(geminiConfig(), {
      model: "gemini-3.6-flash",
      messages: [
        { role: "system", content: "只提取图片中可见事实。" },
        {
          role: "user",
          content: [
            { type: "text", text: "研究这张产品图" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/webp;base64,ZmFrZQ==",
                detail: "high"
              }
            }
          ]
        }
      ],
      maxTokens: 1_200,
      timeoutMs: 20_000,
      maxTransportRetries: 0
    });

    expect(result.text).toBe(
      '{"category":"拖把","visibleFact":"灰白双槽桶"}'
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${GEMINI_NATIVE_BASE_URL}/models/gemini-3.6-flash:generateContent`
    );
    expect(requestBody(fetchMock)).toEqual({
      contents: [
        {
          role: "user",
          parts: [
            { text: "研究这张产品图" },
            {
              inlineData: {
                mimeType: "image/webp",
                data: "ZmFrZQ=="
              }
            }
          ]
        }
      ],
      systemInstruction: {
        parts: [{ text: "只提取图片中可见事实。" }]
      },
      generationConfig: {
        maxOutputTokens: 1_200,
        thinkingConfig: { thinkingLevel: "minimal" }
      }
    });
    const headers = new Headers(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).headers
    );
    expect(headers.get("x-goog-api-key")).toBe("gemini-test-secret");
  });

  it("Gemini 结构化输出使用原生 responseJsonSchema", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => successResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createChatCompletion(geminiConfig(), {
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "返回产品事实 JSON" }],
      jsonSchema: {
        name: "gemini_product_fact",
        schema: responseSchema,
        strict: true
      },
      maxTokens: 800,
      timeoutMs: 20_000,
      maxTransportRetries: 0
    });

    expect(requestBody(fetchMock)).toMatchObject({
      generationConfig: {
        maxOutputTokens: 800,
        thinkingConfig: { thinkingLevel: "minimal" },
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema
      }
    });
  });

  it("只有 STOP 终态才接受文本，MAX_TOKENS 半截 JSON 必须丢弃", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      successResponse('{"category":"拖把"', "MAX_TOKENS")
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createChatCompletion(geminiConfig(), {
        model: "gemini-3.6-flash",
        messages: [{ role: "user", content: "返回完整 JSON" }],
        maxTokens: 16,
        timeoutMs: 20_000,
        maxTransportRetries: 0
      })
    ).rejects.toMatchObject({
      code: "AI_RESPONSE_TRUNCATED",
      statusCode: 502
    });
  });

  it("上传的 https 参考图使用 fileData，取消信号通过隔离信号传给 fetch", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => successResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await createChatCompletion(geminiConfig(), {
      model: "gemini-3.6-flash",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://assets.example.com/product.jpg" }
            }
          ]
        }
      ],
      signal: controller.signal,
      timeoutMs: 20_000,
      maxTransportRetries: 0
    });

    expect(requestBody(fetchMock)).toMatchObject({
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                mimeType: "image/jpeg",
                fileUri: "https://assets.example.com/product.jpg"
              }
            }
          ]
        }
      ]
    });
    const requestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestOptions.signal).not.toBe(controller.signal);
    expect(requestOptions.signal?.aborted).toBe(false);
    controller.abort();
    expect(requestOptions.signal?.aborted).toBe(false);
  });

  it("即使存在父取消信号，请求仍会在 timeoutMs 截止时取消", async () => {
    vi.useFakeTimers();
    const parentController = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<FetchLike>((_url, options) => {
      requestSignal = options?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        if (!requestSignal) return;
        const rejectAborted = () => {
          reject(
            requestSignal?.reason ??
              Object.assign(new Error("The operation was aborted."), {
                name: "AbortError"
              })
          );
        };
        if (requestSignal.aborted) {
          rejectAborted();
          return;
        }
        requestSignal.addEventListener("abort", rejectAborted, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const completion = createChatCompletion(geminiConfig(), {
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "连接测试" }],
      signal: parentController.signal,
      timeoutMs: 10_000,
      maxTransportRetries: 2
    });
    const outcome = completion.then(
      () => null,
      (error: unknown) => error
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestSignal).toBeDefined();
    expect(requestSignal).not.toBe(parentController.signal);

    await vi.advanceTimersByTimeAsync(10_000);
    const caught = await outcome;

    expect(caught).toMatchObject({
      code: "AI_PROVIDER_TIMEOUT",
      statusCode: 504
    });
    expect(parentController.signal.aborted).toBe(false);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Gemini 付费请求不在统一传输层静默重放", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(null, { status: 504 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createChatCompletion(geminiConfig(), {
        model: "gemini-3.6-flash",
        messages: [{ role: "user", content: "连接测试" }],
        maxTokens: 80,
        timeoutMs: 20_000,
        maxTransportRetries: 2
      })
    ).rejects.toMatchObject({ code: "AI_PROVIDER_TIMEOUT" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Gemini 鉴权失败映射为统一安全错误且不会泄露 API Key", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify({
          error: { message: "API key rejected: gemini-test-secret" }
        }),
        { status: 401 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    await createChatCompletion(geminiConfig(), {
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "连接测试" }],
      maxTokens: 80,
      timeoutMs: 20_000,
      maxTransportRetries: 0
    }).catch((error) => {
      caught = error;
    });

    expect(caught).toMatchObject({
      statusCode: 401,
      code: "AI_PROVIDER_AUTH_FAILED",
      message: expect.stringContaining("Gemini")
    });
    const safeError = caught as Error & {
      code?: string;
      details?: unknown;
      cause?: unknown;
    };
    expect(safeError.message).not.toContain("gemini-test-secret");
    expect(safeError.code).not.toContain("gemini-test-secret");
    expect(JSON.stringify(safeError.details ?? null)).not.toContain(
      "gemini-test-secret"
    );
    expect(String(safeError.cause ?? "")).not.toContain("gemini-test-secret");
  });
});
