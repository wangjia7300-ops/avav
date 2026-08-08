import { describe, expect, it } from "vitest";
import {
  sanitizeApiErrorDetails,
  serializeApiError,
  ServiceError
} from "@/lib/services/errors";

describe("sanitizeApiErrorDetails", () => {
  it("保留合法的 screen-01..screen-15 编号并去重", () => {
    const details = sanitizeApiErrorDetails({
      screenIds: ["screen-01", "screen-15", "screen-07", "screen-01"]
    });
    expect(details).toEqual({
      screenIds: ["screen-01", "screen-15", "screen-07"]
    });
  });

  it("丢弃 main-01/detail-02 等非 screen 前缀以及非法格式的编号", () => {
    const details = sanitizeApiErrorDetails({
      screenIds: [
        "main-01",
        "detail-02",
        "screen-1",
        "screen-016",
        "screen-ab",
        "SCREEN-01",
        42,
        null,
        "screen-03"
      ]
    });
    expect(details).toEqual({ screenIds: ["screen-03"] });
  });

  it("normalizedValue 含 sk-/Bearer/api_key 等密钥特征时被丢弃", () => {
    expect(
      sanitizeApiErrorDetails({ normalizedValue: "sk-abc123def456" })
    ).toBeUndefined();
    expect(
      sanitizeApiErrorDetails({ normalizedValue: "Bearer some-token-value" })
    ).toBeUndefined();
    expect(
      sanitizeApiErrorDetails({ normalizedValue: "api_key=whatever" })
    ).toBeUndefined();
  });

  it("normalizedValue 超过 160 字符时被丢弃", () => {
    expect(
      sanitizeApiErrorDetails({ normalizedValue: "长".repeat(161) })
    ).toBeUndefined();
    // 对照绿例：160 字符以内的普通文本保留
    expect(
      sanitizeApiErrorDetails({ normalizedValue: "长".repeat(160) })
    ).toEqual({ normalizedValue: "长".repeat(160) });
  });

  it("normalizedValue 合法时压缩空白后保留（对照绿例）", () => {
    expect(
      sanitizeApiErrorDetails({ normalizedValue: "净重  500g\n含包装" })
    ).toEqual({ normalizedValue: "净重 500g 含包装" });
  });

  it("stage/code 等 token 字段只接受受限字符集", () => {
    expect(
      sanitizeApiErrorDetails({ stage: "generate_copy", code: "COPY_TIMEOUT" })
    ).toEqual({ stage: "generate_copy", code: "COPY_TIMEOUT" });
    expect(
      sanitizeApiErrorDetails({ stage: "含 空格与中文", code: "bad code!" })
    ).toBeUndefined();
  });

  it("仅保留范围合法且交叉一致的尝试次数和上游状态", () => {
    expect(
      sanitizeApiErrorDetails({
        failureOrigin: "upstream_http",
        attempt: 2,
        maxAttempts: 3,
        upstreamStatus: 504
      })
    ).toEqual({
      failureOrigin: "upstream_http",
      attempt: 2,
      maxAttempts: 3,
      upstreamStatus: 504
    });

    expect(
      sanitizeApiErrorDetails({ attempt: 0, maxAttempts: 2 })
    ).toBeUndefined();
    expect(
      sanitizeApiErrorDetails({ attempt: 3, maxAttempts: 2 })
    ).toBeUndefined();
    expect(sanitizeApiErrorDetails({ attempt: 1 })).toBeUndefined();
    expect(sanitizeApiErrorDetails({ maxAttempts: 2 })).toBeUndefined();
    expect(
      sanitizeApiErrorDetails({
        failureOrigin: "sdk_timeout",
        upstreamStatus: 504
      })
    ).toEqual({ failureOrigin: "sdk_timeout" });
    expect(
      sanitizeApiErrorDetails({ failureOrigin: "unknown" })
    ).toEqual({ failureOrigin: "unknown" });
    expect(
      sanitizeApiErrorDetails({ failureOrigin: "connection_timeout" })
    ).toEqual({ failureOrigin: "connection_timeout" });
    expect(
      sanitizeApiErrorDetails({ failureOrigin: "stream_event" })
    ).toEqual({ failureOrigin: "stream_event" });
  });

  it("非对象输入或清洗后为空对象时返回 undefined", () => {
    expect(sanitizeApiErrorDetails(undefined)).toBeUndefined();
    expect(sanitizeApiErrorDetails(null)).toBeUndefined();
    expect(sanitizeApiErrorDetails("text")).toBeUndefined();
    expect(sanitizeApiErrorDetails([])).toBeUndefined();
    expect(sanitizeApiErrorDetails({ screenIds: ["main-01"] })).toBeUndefined();
  });
});

describe("ServiceError", () => {
  it("构造时 details 已被清洗，密钥特征字段不落入实例", () => {
    const error = new ServiceError("生成失败", {
      statusCode: 422,
      code: "COPY_INVALID",
      details: {
        screenIds: ["screen-02", "main-01"],
        normalizedValue: "sk-leaked-secret-value",
        stage: "generate_copy"
      }
    });

    expect(error.statusCode).toBe(422);
    expect(error.code).toBe("COPY_INVALID");
    expect(error.details).toEqual({
      stage: "generate_copy",
      screenIds: ["screen-02"]
    });
    expect(JSON.stringify(error.details)).not.toContain("sk-leaked");
  });

  it("缺省选项时使用 500/SERVICE_ERROR 兜底且无 details", () => {
    const error = new ServiceError("出错了");
    expect(error.name).toBe("ServiceError");
    expect(error.message).toBe("出错了");
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe("SERVICE_ERROR");
    expect(error.details).toBeUndefined();
  });
});

describe("serializeApiError", () => {
  it("请求 ID 不会通过 ServiceError.message 或 details 进入 API 响应", () => {
    const error = new ServiceError(
      "上游请求失败，requestId=req-sensitive-value，x-request-id: trace-private-value，api_key=ark-private-secret-value，/Users/private/customer.json",
      {
        statusCode: 502,
        code: "AI_PROVIDER_REQUEST_FAILED",
        details: {
          failureOrigin: "unknown",
          requestId: "req-sensitive-value",
          request_id: "req-sensitive-value-2",
          "x-request-id": "trace-private-value"
        } as never
      }
    );

    const result = serializeApiError(error, "模型供应商暂时不可用。");

    expect(error.message).not.toContain("req-sensitive-value");
    expect(error.message).not.toContain("trace-private-value");
    expect(error.message).not.toContain("ark-private-secret-value");
    expect(error.message).not.toContain("/Users/private");
    expect(result.body.error).not.toContain("req-sensitive-value");
    expect(result.body.error).not.toContain("trace-private-value");
    expect(result.body.error).not.toContain("ark-private-secret-value");
    expect(result.body.error).not.toContain("/Users/private");
    expect(result.body.details).toEqual({
      code: "AI_PROVIDER_REQUEST_FAILED",
      failureOrigin: "unknown"
    });
  });

  it("对 ServiceError 保留 message/code/状态码并合并清洗后的 details", () => {
    const error = new ServiceError("文案模型响应超时", {
      statusCode: 504,
      code: "COPY_TIMEOUT",
      details: { stage: "generate_copy", screenIds: ["screen-05"] }
    });

    const result = serializeApiError(error, "兜底文案", { batchId: "batch-1" });

    expect(result.status).toBe(504);
    expect(result.body).toEqual({
      success: false,
      error: "文案模型响应超时",
      code: "COPY_TIMEOUT",
      details: {
        stage: "generate_copy",
        code: "COPY_TIMEOUT",
        batchId: "batch-1",
        screenIds: ["screen-05"]
      }
    });
  });

  it("对未知 Error 只返回兜底文案与 UNKNOWN_ERROR，不泄露原始消息", () => {
    const raw = new Error("Authorization: Bearer sk-live-12345 内部堆栈信息");
    const result = serializeApiError(raw, "服务暂时不可用，请稍后重试。");

    expect(result.status).toBe(500);
    expect(result.body.success).toBe(false);
    expect(result.body.error).toBe("服务暂时不可用，请稍后重试。");
    expect(result.body.code).toBe("UNKNOWN_ERROR");
    expect(result.body.details).toEqual({ code: "UNKNOWN_ERROR" });

    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("sk-live-12345");
    expect(serialized).not.toContain("内部堆栈信息");
    expect(serialized).not.toContain("Bearer");
  });

  it("未知错误的兜底文案也经过敏感信息清洗", () => {
    const result = serializeApiError(
      new Error("raw provider failure"),
      "请求失败 request_id=req-fallback-private api_key=ark-fallback-private-value"
    );

    expect(result.body.error).not.toContain("req-fallback-private");
    expect(result.body.error).not.toContain("ark-fallback-private-value");
  });

  it("对非 Error 的抛出值（字符串/undefined）同样走兜底分支", () => {
    expect(serializeApiError("raw string failure", "兜底文案").body).toEqual({
      success: false,
      error: "兜底文案",
      code: "UNKNOWN_ERROR",
      details: { code: "UNKNOWN_ERROR" }
    });
    expect(serializeApiError(undefined, "兜底文案").status).toBe(500);
  });
});
