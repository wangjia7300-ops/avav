import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LookupAddress } from "node:dns";

// 公网非官方域名会触发真实 DNS 解析，这里统一打桩 node:dns/promises，
// 既避免测试发出真实网络请求，也能断言官方域名 / Ark 接入点不触发 DNS。
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn()
}));

import { lookup } from "node:dns/promises";
import {
  assertTrustedChatProviderConfig,
  isNonPublicIPv4,
  isPrivateEndpointHostname
} from "@/lib/services/endpoint-guard";
import { ServiceError } from "@/lib/services/errors";
import type { AIProviderConfig, AIProviderId } from "@/lib/types";

// node:dns/promises 的 lookup 是重载函数，vi.mocked 只会取到单地址重载；
// 被测代码固定以 { all: true } 调用，这里按数组返回值显式标注 mock 类型。
const mockedLookup = lookup as unknown as Mock<
  (
    hostname: string,
    options: { all: boolean; verbatim: boolean }
  ) => Promise<LookupAddress[]>
>;

function chatConfig(overrides: Partial<AIProviderConfig> = {}): AIProviderConfig {
  return {
    providerId: "custom",
    apiKey: "test-api-key-placeholder",
    baseURL: "",
    model: "test-model",
    ...overrides
  };
}

async function expectServiceError(promise: Promise<unknown>, code: string) {
  const thrown = await promise.then(
    () => null,
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(ServiceError);
  const serviceError = thrown as ServiceError;
  expect(serviceError.code).toBe(code);
  expect(serviceError.statusCode).toBe(400);
  return serviceError;
}

beforeEach(() => {
  mockedLookup.mockReset();
});

describe("isNonPublicIPv4", () => {
  it("识别各类保留/私有 IPv4 段为非公网地址", () => {
    expect(isNonPublicIPv4("10.0.0.1")).toBe(true);
    expect(isNonPublicIPv4("127.0.0.1")).toBe(true);
    expect(isNonPublicIPv4("127.255.255.254")).toBe(true);
    expect(isNonPublicIPv4("169.254.169.254")).toBe(true);
    expect(isNonPublicIPv4("172.16.0.1")).toBe(true);
    expect(isNonPublicIPv4("172.31.255.255")).toBe(true);
    expect(isNonPublicIPv4("192.168.1.5")).toBe(true);
    expect(isNonPublicIPv4("0.0.0.0")).toBe(true);
    expect(isNonPublicIPv4("100.64.0.1")).toBe(true);
    expect(isNonPublicIPv4("224.0.0.1")).toBe(true);
  });

  it("公网 IPv4 地址判定为可公开访问（对照绿例）", () => {
    expect(isNonPublicIPv4("8.8.8.8")).toBe(false);
    expect(isNonPublicIPv4("1.1.1.1")).toBe(false);
    expect(isNonPublicIPv4("104.18.32.7")).toBe(false);
    // 与私有段仅一位之差的边界值
    expect(isNonPublicIPv4("172.15.0.1")).toBe(false);
    expect(isNonPublicIPv4("172.32.0.1")).toBe(false);
    expect(isNonPublicIPv4("192.169.0.1")).toBe(false);
    expect(isNonPublicIPv4("11.0.0.1")).toBe(false);
  });

  it("非 IPv4 格式的输入直接返回 false", () => {
    expect(isNonPublicIPv4("localhost")).toBe(false);
    expect(isNonPublicIPv4("example.com")).toBe(false);
    expect(isNonPublicIPv4("::1")).toBe(false);
    expect(isNonPublicIPv4("10.0.0")).toBe(false);
    expect(isNonPublicIPv4("10.0.0.256")).toBe(false);
  });
});

describe("isPrivateEndpointHostname", () => {
  it("localhost 及 .local/.localhost 域名判定为私有", () => {
    expect(isPrivateEndpointHostname("localhost")).toBe(true);
    expect(isPrivateEndpointHostname("LOCALHOST")).toBe(true);
    expect(isPrivateEndpointHostname("api.localhost")).toBe(true);
    expect(isPrivateEndpointHostname("printer.local")).toBe(true);
  });

  it("私有 IPv4 与回环/链路本地 IPv6 判定为私有", () => {
    expect(isPrivateEndpointHostname("10.1.2.3")).toBe(true);
    expect(isPrivateEndpointHostname("127.0.0.1")).toBe(true);
    expect(isPrivateEndpointHostname("192.168.1.5")).toBe(true);
    expect(isPrivateEndpointHostname("::1")).toBe(true);
    expect(isPrivateEndpointHostname("[::1]")).toBe(true);
    expect(isPrivateEndpointHostname("::")).toBe(true);
    expect(isPrivateEndpointHostname("fd00::1")).toBe(true);
    expect(isPrivateEndpointHostname("fe80::1")).toBe(true);
  });

  it("IPv4-mapped IPv6 私网地址（::ffff:10.0.0.1）判定为私有", () => {
    expect(isPrivateEndpointHostname("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateEndpointHostname("::ffff:192.168.1.5")).toBe(true);
    expect(isPrivateEndpointHostname("::ffff:127.0.0.1")).toBe(true);
  });

  it("公网域名与公网 IP 判定为公开（对照绿例）", () => {
    expect(isPrivateEndpointHostname("api.openai.com")).toBe(false);
    expect(isPrivateEndpointHostname("example.com")).toBe(false);
    expect(isPrivateEndpointHostname("8.8.8.8")).toBe(false);
    expect(isPrivateEndpointHostname("2606:4700::1111")).toBe(false);
    expect(isPrivateEndpointHostname("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("assertTrustedChatProviderConfig", () => {
  it("providerId 不在预设列表内时抛出 AI_PROVIDER_UNSUPPORTED", async () => {
    const config = chatConfig({
      providerId: "not-a-real-provider" as AIProviderId,
      baseURL: "https://api.openai.com/v1"
    });
    await expectServiceError(
      assertTrustedChatProviderConfig(config),
      "AI_PROVIDER_UNSUPPORTED"
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("custom 供应商未填写 baseURL 时抛出 API_ENDPOINT_INVALID", async () => {
    await expectServiceError(
      assertTrustedChatProviderConfig(chatConfig({ providerId: "custom", baseURL: "" })),
      "API_ENDPOINT_INVALID"
    );
    await expectServiceError(
      assertTrustedChatProviderConfig(chatConfig({ providerId: "custom", baseURL: "   " })),
      "API_ENDPOINT_INVALID"
    );
  });

  it("http 明文协议端点被拒绝（即使是公网域名）", async () => {
    await expectServiceError(
      assertTrustedChatProviderConfig(chatConfig({ baseURL: "http://example.com" })),
      "API_ENDPOINT_INVALID"
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("回环与内网 IP 端点被拒绝，且不触发 DNS", async () => {
    await expectServiceError(
      assertTrustedChatProviderConfig(chatConfig({ baseURL: "https://127.0.0.1/v1" })),
      "API_ENDPOINT_INVALID"
    );
    await expectServiceError(
      assertTrustedChatProviderConfig(chatConfig({ baseURL: "https://192.168.1.5/v1" })),
      "API_ENDPOINT_INVALID"
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("URL 内嵌用户名密码时被拒绝", async () => {
    await expectServiceError(
      assertTrustedChatProviderConfig(
        chatConfig({ baseURL: "https://user:pass@example.com/v1" })
      ),
      "API_ENDPOINT_INVALID"
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("无法解析成 URL 的字符串被拒绝", async () => {
    await expectServiceError(
      assertTrustedChatProviderConfig(chatConfig({ baseURL: "不是一个合法地址" })),
      "API_ENDPOINT_INVALID"
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("官方预设域名直接放行，不触发 DNS 解析（对照绿例）", async () => {
    await expect(
      assertTrustedChatProviderConfig(
        chatConfig({ providerId: "openai", baseURL: "https://api.openai.com/v1" })
      )
    ).resolves.toBeUndefined();
    await expect(
      assertTrustedChatProviderConfig(
        chatConfig({
          providerId: "volcengine",
          baseURL: "https://ark.cn-beijing.volces.com/api/v3"
        })
      )
    ).resolves.toBeUndefined();
    await expect(
      assertTrustedChatProviderConfig(
        chatConfig({
          providerId: "gemini",
          baseURL: "https://generativelanguage.googleapis.com/v1beta"
        })
      )
    ).resolves.toBeUndefined();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("误填在 Endpoint 字段的火山方舟 ep-... 接入点 ID 放行，不触发 DNS", async () => {
    await expect(
      assertTrustedChatProviderConfig(
        chatConfig({ providerId: "volcengine", baseURL: "ep-20240101" })
      )
    ).resolves.toBeUndefined();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("非 custom 预设留空 baseURL 时放行（走服务端默认端点）", async () => {
    await expect(
      assertTrustedChatProviderConfig(chatConfig({ providerId: "openai", baseURL: "" }))
    ).resolves.toBeUndefined();
    await expect(
      assertTrustedChatProviderConfig(chatConfig({ providerId: "zhipu", baseURL: "" }))
    ).resolves.toBeUndefined();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("公网非官方域名解析到公网地址时放行", async () => {
    mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    await expect(
      assertTrustedChatProviderConfig(
        chatConfig({ baseURL: "https://llm.example.com/v1" })
      )
    ).resolves.toBeUndefined();
    expect(mockedLookup).toHaveBeenCalledWith("llm.example.com", {
      all: true,
      verbatim: true
    });
  });

  it("公网非官方域名解析到私网地址时抛出 API_ENDPOINT_INVALID（DNS rebinding 防护）", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 }
    ]);

    await expectServiceError(
      assertTrustedChatProviderConfig(
        chatConfig({ baseURL: "https://rebind.example.com/v1" })
      ),
      "API_ENDPOINT_INVALID"
    );
  });

  it("DNS 解析失败时抛出 API_ENDPOINT_UNREACHABLE", async () => {
    mockedLookup.mockRejectedValue(new Error("ENOTFOUND"));

    await expectServiceError(
      assertTrustedChatProviderConfig(
        chatConfig({ baseURL: "https://no-such-host.example.com/v1" })
      ),
      "API_ENDPOINT_UNREACHABLE"
    );
  });
});
