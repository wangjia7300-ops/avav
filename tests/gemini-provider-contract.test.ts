import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const geminiSdk = vi.hoisted(() => ({
  interactionsCreate: vi.fn(),
  clientOptions: [] as Array<{ apiKey?: string }>
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class GoogleGenAIMock {
    interactions = {
      create: (...args: unknown[]) => geminiSdk.interactionsCreate(...args)
    };

    constructor(options: { apiKey?: string }) {
      geminiSdk.clientOptions.push(options);
    }
  }
}));

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

function geminiConfig(): AIProviderConfig {
  return {
    providerId: GEMINI_PROVIDER_ID,
    apiKey: "gemini-test-secret",
    baseURL: GEMINI_NATIVE_BASE_URL,
    model: "gemini-3.6-flash"
  };
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

describe("Google Gemini native Interactions provider contract", () => {
  beforeEach(() => {
    geminiSdk.interactionsCreate.mockReset();
    geminiSdk.clientOptions.length = 0;
    // 当前生产代码尚未实现 Gemini 原生适配器时，阻止它误走旧的
    // OpenAI-compatible 网络路径；真正的外部系统边界由上面的
    // @google/genai mock 提供。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("unexpected legacy provider transport");
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
    expect(preset?.models.length).toBeGreaterThan(0);

    const draft = createProviderDraft(GEMINI_PROVIDER_ID);
    expect(draft).toEqual({
      providerId: "gemini",
      apiKey: "",
      baseURL: GEMINI_NATIVE_BASE_URL,
      model: preset?.models[0]
    });
    expect(
      isProviderConfigComplete({ ...draft, apiKey: "session-only-key" })
    ).toBe(true);
  });

  it("通过统一 provider seam 把 system 指令、文字与 base64 产品图转换为原生 Interaction", async () => {
    geminiSdk.interactionsCreate.mockResolvedValueOnce({
      id: "interaction-1",
      status: "completed",
      output_text: '{"category":"拖把","visibleFact":"灰白双槽桶"}'
    });

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
    expect(geminiSdk.clientOptions).toEqual([
      { apiKey: "gemini-test-secret" }
    ]);
    const [payload, options] = geminiSdk.interactionsCreate.mock.calls[0];
    expect(payload).toEqual({
      model: "gemini-3.6-flash",
      stream: false,
      store: false,
      system_instruction: "只提取图片中可见事实。",
      input: [
        { type: "text", text: "研究这张产品图" },
        {
          type: "image",
          data: "ZmFrZQ==",
          mime_type: "image/webp"
        }
      ],
      generation_config: {
        max_output_tokens: 1_200
      }
    });
    expect(options).toMatchObject({ maxRetries: 0 });
    expect(options.timeout).toBeGreaterThanOrEqual(19_000);
    expect(options.timeout).toBeLessThanOrEqual(20_000);
  });

  it("Gemini 结构化输出使用原生 response_format JSON Schema", async () => {
    geminiSdk.interactionsCreate.mockResolvedValueOnce({
      id: "interaction-2",
      status: "completed",
      output_text: '{"category":"拖把","visibleFact":"灰白双槽桶"}'
    });

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

    expect(geminiSdk.interactionsCreate).toHaveBeenCalledWith({
      model: "gemini-3.6-flash",
      stream: false,
      store: false,
      input: [{ type: "text", text: "返回产品事实 JSON" }],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: responseSchema
      },
      generation_config: {
        max_output_tokens: 800
      }
    }, {
      timeout: 20_000,
      maxRetries: 0
    });
  });

  it("只有 completed 终态才接受文本，incomplete 半截 JSON 必须丢弃", async () => {
    geminiSdk.interactionsCreate.mockResolvedValueOnce({
      id: "interaction-incomplete",
      status: "incomplete",
      output_text: '{"category":"拖把"'
    });

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

  it("上传的 https 参考图使用原生 uri，取消信号透传给 SDK", async () => {
    geminiSdk.interactionsCreate.mockResolvedValueOnce({
      id: "interaction-remote-image",
      status: "completed",
      output_text: "ok"
    });
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

    expect(geminiSdk.interactionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        store: false,
        input: [
          {
            type: "image",
            uri: "https://assets.example.com/product.jpg"
          }
        ]
      }),
      expect.objectContaining({
        maxRetries: 0,
        fetchOptions: { signal: expect.anything() }
      })
    );
    const requestOptions = geminiSdk.interactionsCreate.mock.calls[0]?.[1] as {
      timeout?: number;
      fetchOptions?: { signal?: AbortSignal };
    };
    expect(requestOptions.timeout).toBeGreaterThanOrEqual(19_900);
    expect(requestOptions.timeout).toBeLessThanOrEqual(20_000);
    expect(requestOptions.fetchOptions?.signal).not.toBe(controller.signal);
    expect(requestOptions.fetchOptions?.signal?.aborted).toBe(false);
    controller.abort();
    expect(requestOptions.fetchOptions?.signal?.aborted).toBe(false);
  });

  it("即使存在父取消信号，Gemini 请求仍会在 timeoutMs 截止时取消", async () => {
    vi.useFakeTimers();
    const parentController = new AbortController();
    let sdkSignal: AbortSignal | undefined;

    geminiSdk.interactionsCreate.mockImplementationOnce(
      (_request: unknown, options: unknown) => {
        sdkSignal = (
          options as { fetchOptions?: { signal?: AbortSignal } }
        ).fetchOptions?.signal;

        return new Promise((_resolve, reject) => {
          if (!sdkSignal) return;
          const rejectAborted = () => {
            reject(
              sdkSignal?.reason ??
                Object.assign(new Error("The operation was aborted."), {
                  name: "AbortError"
                })
            );
          };
          if (sdkSignal.aborted) {
            rejectAborted();
            return;
          }
          sdkSignal.addEventListener("abort", rejectAborted, { once: true });
        });
      }
    );

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
    expect(geminiSdk.interactionsCreate).toHaveBeenCalledTimes(1);
    expect(sdkSignal).toBeDefined();
    expect(sdkSignal).not.toBe(parentController.signal);

    await vi.advanceTimersByTimeAsync(10_000);
    const caught = await outcome;

    expect(caught).toMatchObject({
      code: "AI_PROVIDER_TIMEOUT",
      statusCode: 504
    });
    expect(parentController.signal.aborted).toBe(false);
    expect(sdkSignal?.aborted).toBe(true);
    expect(geminiSdk.interactionsCreate).toHaveBeenCalledTimes(1);
  });

  it("Gemini 付费请求不在统一传输层静默重放", async () => {
    geminiSdk.interactionsCreate.mockRejectedValue(
      Object.assign(new Error("gateway timeout"), {
        name: "ApiError",
        status: 504
      })
    );

    await expect(
      createChatCompletion(geminiConfig(), {
        model: "gemini-3.6-flash",
        messages: [{ role: "user", content: "连接测试" }],
        maxTokens: 80,
        timeoutMs: 20_000,
        maxTransportRetries: 2
      })
    ).rejects.toMatchObject({ code: "AI_PROVIDER_TIMEOUT" });

    expect(geminiSdk.interactionsCreate).toHaveBeenCalledTimes(1);
  });

  it("Gemini SDK 鉴权失败映射为统一安全错误且不会泄露 API Key", async () => {
    geminiSdk.interactionsCreate.mockRejectedValueOnce(
      Object.assign(new Error("API key rejected: gemini-test-secret"), {
        name: "ApiError",
        status: 401
      })
    );

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
    // Error.message 默认不可枚举，单独 JSON.stringify(error) 无法证明
    // 供应商原始报错中的密钥已经被净化。逐个检查所有可暴露表面。
    expect(safeError.message).not.toContain("gemini-test-secret");
    expect(safeError.code).not.toContain("gemini-test-secret");
    expect(JSON.stringify(safeError.details ?? null)).not.toContain(
      "gemini-test-secret"
    );
    expect(String(safeError.cause ?? "")).not.toContain("gemini-test-secret");
  });
});
