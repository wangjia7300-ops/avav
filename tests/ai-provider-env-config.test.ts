import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnvProviderConfig } from "@/lib/ai-providers";

const PROVIDER_ENV_KEYS = [
  "AI_PROVIDER",
  "ARK_API_KEY",
  "ARK_BASE_URL",
  "ARK_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL"
] as const;

const originalEnvironment = Object.fromEntries(
  PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof PROVIDER_ENV_KEYS)[number], string | undefined>;

function clearProviderEnvironment() {
  for (const key of PROVIDER_ENV_KEYS) {
    delete process.env[key];
  }
}

beforeEach(() => {
  clearProviderEnvironment();
});

afterEach(() => {
  clearProviderEnvironment();
  for (const key of PROVIDER_ENV_KEYS) {
    const originalValue = originalEnvironment[key];
    if (originalValue !== undefined) {
      process.env[key] = originalValue;
    }
  }
});

describe("getEnvProviderConfig", () => {
  it("仅配置 Gemini Key 时返回官方 generateContent API 配置", () => {
    process.env.GEMINI_API_KEY = "  gemini-test-key  ";

    expect(getEnvProviderConfig()).toEqual({
      providerId: "gemini",
      apiKey: "gemini-test-key",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-flash-latest",
      displayName: "Google Gemini（服务端）"
    });
  });

  it("允许通过 GEMINI_MODEL 覆盖默认模型并清理首尾空白", () => {
    process.env.GEMINI_API_KEY = "gemini-test-key";
    process.env.GEMINI_MODEL = "  gemini-3.5-flash  ";

    expect(getEnvProviderConfig()?.model).toBe("gemini-3.5-flash");
  });

  it("保持 Ark > Gemini > OpenAI 的服务端回退优先级", () => {
    process.env.ARK_API_KEY = "ark-test-key";
    process.env.GEMINI_API_KEY = "gemini-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";

    expect(getEnvProviderConfig()?.providerId).toBe("volcengine");

    delete process.env.ARK_API_KEY;
    expect(getEnvProviderConfig()?.providerId).toBe("gemini");

    delete process.env.GEMINI_API_KEY;
    expect(getEnvProviderConfig()?.providerId).toBe("openai");
  });

  it("同时配置 Ark 与 Gemini 时允许明确选择 Gemini 作为当前服务端供应商", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.ARK_API_KEY = "ark-test-key";
    process.env.GEMINI_API_KEY = "gemini-test-key";
    process.env.GEMINI_MODEL = "gemini-flash-latest";

    expect(getEnvProviderConfig()).toEqual({
      providerId: "gemini",
      apiKey: "gemini-test-key",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-flash-latest",
      displayName: "Google Gemini（服务端）"
    });
  });
});
