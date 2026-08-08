import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  responsesCreate: vi.fn(),
  chatCreate: vi.fn(),
  clientOptions: [] as Array<{ timeout?: number }>
}));

vi.mock("openai", () => ({
  default: class OpenAIMock {
    responses: {
      create: (...args: unknown[]) => Promise<unknown>;
    };

    constructor(options: { timeout?: number }) {
      sdk.clientOptions.push(options);
      this.responses = {
        create: (...args: unknown[]) => {
          const providerResponse = Promise.resolve(
            sdk.responsesCreate(...args)
          );
          const timeoutMs = options.timeout ?? 600_000;
          const timeoutResponse = new Promise((_, reject) => {
            setTimeout(
              () =>
                reject(
                  Object.assign(new Error("Request timed out."), {
                    name: "APIConnectionTimeoutError",
                    code: "ETIMEDOUT"
                  })
                ),
              timeoutMs
            );
          });
          return Promise.race([providerResponse, timeoutResponse]);
        }
      };
    }

    chat = {
      completions: {
        create: (...args: unknown[]) => sdk.chatCreate(...args)
      }
    };
  }
}));

import { createChatCompletion } from "@/lib/ai-providers";
import type { AIProviderConfig } from "@/lib/types";

const arkConfig: AIProviderConfig = {
  providerId: "volcengine",
  apiKey: "test-key",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "doubao-seed-test",
  displayName: "火山方舟 Ark（服务端）"
};

const openAIConfig: AIProviderConfig = {
  providerId: "openai",
  apiKey: "test-key",
  baseURL: "https://api.openai.com/v1",
  model: "test-model",
  displayName: "测试供应商"
};

const request = {
  model: arkConfig.model,
  messages: [{ role: "user" as const, content: "返回 JSON" }],
  maxTokens: 800,
  timeoutMs: 20_000,
  maxTransportRetries: 1
};

const schemaRequest = {
  ...request,
  jsonSchema: {
    name: "timeout_budget_probe",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ok: { type: "boolean" }
      },
      required: ["ok"]
    },
    strict: true
  }
};

function timeoutError() {
  return Object.assign(new Error("Request timed out."), {
    name: "APIConnectionTimeoutError",
    code: "ETIMEDOUT"
  });
}

function upstreamTimeoutError() {
  return Object.assign(new Error("Gateway timeout: req-sensitive-value"), {
    name: "InternalServerError",
    status: 504,
    request_id: "req-sensitive-value"
  });
}

describe("Ark timeout recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sdk.responsesCreate.mockReset();
    sdk.chatCreate.mockReset();
    sdk.clientOptions.length = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("Ark 长图研使用 Responses 流式事件，避免非流式连接提前中断", async () => {
    sdk.responsesCreate.mockImplementation((body: unknown) => {
      if (!(body as { stream?: boolean }).stream) {
        return Promise.reject(timeoutError());
      }

      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "response.created",
            sequence_number: 0,
            response: { status: "in_progress", output: [] }
          };
          await new Promise((resolve) => setTimeout(resolve, 18_000));
          yield {
            type: "response.output_text.delta",
            sequence_number: 1,
            output_index: 0,
            content_index: 0,
            item_id: "item-1",
            delta: "{\"ok\":true}",
            logprobs: []
          };
          yield {
            type: "response.completed",
            sequence_number: 2,
            response: {
              status: "completed",
              output_text: "{\"ok\":true}",
              output: []
            }
          };
        }
      };
    });

    const resultPromise = expect(
      createChatCompletion(arkConfig, request)
    ).resolves.toMatchObject({
      text: "{\"ok\":true}"
    });
    await vi.advanceTimersByTimeAsync(25_000);

    await resultPromise;
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
    expect(sdk.responsesCreate.mock.calls[0]?.[0]).toMatchObject({
      stream: true
    });
  });

  it("图研图片的 high 细节级别会进入 Ark Responses 输入", async () => {
    sdk.responsesCreate.mockResolvedValue({
      status: "completed",
      output_text: "{\"ok\":true}",
      output: []
    });

    await createChatCompletion(arkConfig, {
      ...request,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "研究产品图" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/webp;base64,ZmFrZQ==",
                detail: "high"
              }
            }
          ]
        }
      ]
    });

    expect(sdk.responsesCreate.mock.calls[0]?.[0]).toMatchObject({
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "研究产品图" },
            {
              type: "input_image",
              image_url: "data:image/webp;base64,ZmFrZQ==",
              detail: "high"
            }
          ]
        }
      ]
    });
  });

  it("流式响应没有 completed 终态时拒绝半截 JSON", async () => {
    sdk.responsesCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "response.output_text.delta",
          delta: "{\"ok\":"
        };
      }
    });

    await expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "AI_RESPONSE_INCOMPLETE"
    });
  });

  it("流已开始后连接中断不自动重复付费调用", async () => {
    sdk.responsesCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "response.created",
          response: { status: "in_progress", output: [] }
        };
        yield {
          type: "response.output_text.delta",
          delta: "{\"ok\":"
        };
        throw timeoutError();
      }
    });

    await expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "AI_PROVIDER_STREAM_INTERRUPTED",
      details: {
        failureOrigin: "connection_timeout",
        retryable: true
      }
    });
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("流已开始后收到上游 error 事件也不自动重放请求", async () => {
    sdk.responsesCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "response.created",
          response: { status: "in_progress", output: [] }
        };
        yield {
          type: "error",
          code: "server_error",
          message: "temporary upstream failure"
        };
      }
    });

    const resultPromise = expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "AI_PROVIDER_STREAM_FAILED",
      details: {
        failureOrigin: "stream_event",
        retryable: true
      }
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await resultPromise;
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("流式 incomplete 长度截断不会返回 partial text", async () => {
    sdk.responsesCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "response.output_text.delta",
          delta: "{\"ok\":"
        };
        yield {
          type: "response.incomplete",
          response: {
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: []
          }
        };
      }
    });

    await expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "AI_RESPONSE_TRUNCATED"
    });
  });

  it("收到 completed 后立即采纳终态，不受连接关闭异常影响", async () => {
    sdk.responsesCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "response.completed",
          response: {
            status: "completed",
            output_text: "{\"ok\":true}",
            output: []
          }
        };
        throw Object.assign(new Error("connection reset after completed"), {
          code: "ECONNRESET"
        });
      }
    });

    await expect(
      createChatCompletion(arkConfig, request)
    ).resolves.toMatchObject({ text: "{\"ok\":true}" });
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("响应头已返回后仍受整次请求截止时间约束", async () => {
    sdk.responsesCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        yield {
          type: "response.completed",
          response: {
            status: "completed",
            output_text: "{\"ok\":true}",
            output: []
          }
        };
      }
    });

    const resultPromise = expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 504,
      code: "AI_PROVIDER_TIMEOUT",
      details: {
        failureOrigin: "sdk_timeout",
        attempt: 1,
        maxAttempts: 1
      }
    });
    await vi.advanceTimersByTimeAsync(35_000);

    await resultPromise;
  });

  it("重型多图请求保留完整首轮等待时间", async () => {
    sdk.responsesCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                status: "completed",
                output_text: "{\"ok\":true}",
                output: []
              }),
            18_000
          );
        })
    );

    const resultPromise = expect(
      createChatCompletion(arkConfig, request)
    ).resolves.toMatchObject({
      text: "{\"ok\":true}"
    });
    await vi.advanceTimersByTimeAsync(25_000);

    await resultPromise;
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
    expect(sdk.clientOptions[0]?.timeout).toBeGreaterThanOrEqual(19_500);
  });

  it("真实 SDK 等待预算耗尽后只记录实际发生的一次尝试", async () => {
    sdk.responsesCreate.mockImplementation(
      () => new Promise(() => undefined)
    );

    const resultPromise = expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 504,
      code: "AI_PROVIDER_TIMEOUT",
      details: {
        failureOrigin: "sdk_timeout",
        attempt: 1,
        maxAttempts: 1
      }
    });
    await vi.advanceTimersByTimeAsync(25_000);

    await resultPromise;
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("Ark 首事件前超时也不自动重放付费请求", async () => {
    sdk.responsesCreate
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce({
        status: "completed",
        output_text: "{\"ok\":true}",
        output: []
      });

    const resultPromise = expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 504,
      code: "AI_PROVIDER_TIMEOUT",
      details: {
        failureOrigin: "connection_timeout",
        attempt: 1,
        maxAttempts: 1
      }
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await resultPromise;
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
    expect(sdk.clientOptions[0]?.timeout).toBeGreaterThanOrEqual(19_500);
  });

  it("较晚收到上游 504 时不启动一个时间不足的付费重试", async () => {
    sdk.responsesCreate.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(upstreamTimeoutError()), 7_000);
        })
    );

    const resultPromise = expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 504,
      code: "AI_PROVIDER_TIMEOUT",
      details: {
        attempt: 1,
        maxAttempts: 1
      }
    });
    await vi.advanceTimersByTimeAsync(25_000);

    await resultPromise;
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("原生 JSON Schema 降级与首轮请求共享同一总预算", async () => {
    sdk.responsesCreate
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(
              () =>
                reject(
                  Object.assign(
                    new Error("json_schema response_format unsupported"),
                    { status: 400 }
                  )
                ),
              12_000
            );
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  status: "completed",
                  output_text: "{\"ok\":true}",
                  output: []
                }),
              9_000
            );
          })
      );

    const resultPromise = expect(
      createChatCompletion(arkConfig, schemaRequest)
    ).rejects.toMatchObject({
      statusCode: 504,
      code: "AI_PROVIDER_TIMEOUT"
    });
    await vi.advanceTimersByTimeAsync(25_000);

    await resultPromise;
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("等待预算到期前连接超时会标记为提前断连，不冒充 SDK 预算耗尽", async () => {
    sdk.responsesCreate.mockRejectedValue(timeoutError());

    const resultPromise = expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 504,
      code: "AI_PROVIDER_TIMEOUT",
      details: {
        retryable: true,
        failureOrigin: "connection_timeout",
        elapsedMs: 0,
        attempt: 1,
        maxAttempts: 1
      }
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await resultPromise;
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("区分 Ark 上游 504，但不暴露完整请求 ID", async () => {
    sdk.responsesCreate.mockRejectedValue(upstreamTimeoutError());

    let caught: unknown;
    const resultPromise = createChatCompletion(arkConfig, request).catch(
      (error) => {
        caught = error;
      }
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await resultPromise;

    expect(caught).toMatchObject({
      statusCode: 504,
      code: "AI_PROVIDER_TIMEOUT",
      details: {
        retryable: true,
        failureOrigin: "upstream_http",
        upstreamStatus: 504,
        hasUpstreamRequestId: true,
        attempt: 1,
        maxAttempts: 1
      }
    });
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(caught)).not.toContain("req-sensitive-value");
  });

  it("Ark 上游 503 只提供显式重试，不在后台自动重放", async () => {
    sdk.responsesCreate.mockRejectedValue(
      Object.assign(new Error("Service unavailable"), {
        status: 503
      })
    );

    await expect(
      createChatCompletion(arkConfig, request)
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "AI_PROVIDER_REQUEST_FAILED",
      details: {
        retryable: true,
        failureOrigin: "upstream_http",
        upstreamStatus: 503,
        attempt: 1,
        maxAttempts: 1
      }
    });
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("用户在通用供应商重试等待期中断时返回统一取消错误", async () => {
    sdk.chatCreate.mockRejectedValue(
      Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })
    );
    const controller = new AbortController();
    const resultPromise = expect(
      createChatCompletion(openAIConfig, {
        ...request,
        signal: controller.signal
      })
    ).rejects.toMatchObject({
      statusCode: 499,
      code: "AI_REQUEST_ABORTED"
    });

    await Promise.resolve();
    controller.abort();
    await vi.runAllTimersAsync();

    await resultPromise;
    expect(sdk.chatCreate).toHaveBeenCalledTimes(1);
  });

  it("未知 SDK 异常不冒充网络故障，也不诱导付费重试", async () => {
    sdk.responsesCreate.mockRejectedValue(
      new TypeError("unexpected SDK response shape")
    );

    let caught: unknown;
    await createChatCompletion(arkConfig, request).catch((error) => {
      caught = error;
    });

    expect(caught).toMatchObject({
      statusCode: 502,
      code: "AI_PROVIDER_REQUEST_FAILED",
      details: {
        retryable: false,
        failureOrigin: "unknown",
        attempt: 1,
        maxAttempts: 1
      }
    });
    expect(sdk.responsesCreate).toHaveBeenCalledTimes(1);
  });
});
