import { describe, expect, it } from "vitest";
import {
  isImageProviderConfigComplete,
  parseImageProviderConfig
} from "@/lib/image-providers";
import type { ImageProviderConfig } from "@/lib/types";

function createValidConfig(
  overrides: Partial<ImageProviderConfig> = {}
): ImageProviderConfig {
  return {
    scope: "image_generation",
    providerId: "volcengine",
    apiKey: "test-api-key",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    imageModel: "test-image-model",
    ...overrides
  };
}

describe("parseImageProviderConfig 恶意与异常输入", () => {
  it("拒绝 null 与 undefined", () => {
    expect(parseImageProviderConfig(null)).toBeNull();
    expect(parseImageProviderConfig(undefined)).toBeNull();
  });

  it("拒绝字符串、数字与布尔等原始类型", () => {
    expect(parseImageProviderConfig("image_generation")).toBeNull();
    expect(parseImageProviderConfig(JSON.stringify(createValidConfig()))).toBeNull();
    expect(parseImageProviderConfig(42)).toBeNull();
    expect(parseImageProviderConfig(true)).toBeNull();
  });

  it("拒绝数组，即使数组元素本身是合法配置", () => {
    expect(parseImageProviderConfig([])).toBeNull();
    expect(parseImageProviderConfig([createValidConfig()])).toBeNull();
  });

  it("拒绝 scope 缺失或不是 image_generation 的对象", () => {
    const { scope: _scope, ...withoutScope } = createValidConfig();
    expect(parseImageProviderConfig(withoutScope)).toBeNull();
    expect(
      parseImageProviderConfig({ ...createValidConfig(), scope: "chat_completion" })
    ).toBeNull();
    expect(
      parseImageProviderConfig({ ...createValidConfig(), scope: "IMAGE_GENERATION" })
    ).toBeNull();
  });

  it("拒绝非法 providerId（未知字符串或非字符串类型）", () => {
    expect(
      parseImageProviderConfig({ ...createValidConfig(), providerId: "midjourney" })
    ).toBeNull();
    expect(
      parseImageProviderConfig({ ...createValidConfig(), providerId: "" })
    ).toBeNull();
    expect(
      parseImageProviderConfig({ ...createValidConfig(), providerId: 123 })
    ).toBeNull();
  });

  it("拒绝 apiKey / baseURL / imageModel 类型错误的对象", () => {
    expect(
      parseImageProviderConfig({ ...createValidConfig(), apiKey: 123456 })
    ).toBeNull();
    expect(
      parseImageProviderConfig({ ...createValidConfig(), baseURL: { host: "evil" } })
    ).toBeNull();
    expect(
      parseImageProviderConfig({ ...createValidConfig(), imageModel: null })
    ).toBeNull();
    expect(
      parseImageProviderConfig({ ...createValidConfig(), imageModel: ["model-a"] })
    ).toBeNull();
  });

  it("绿例：接受合法配置并裁剪首尾空白", () => {
    const parsed = parseImageProviderConfig({
      scope: "image_generation",
      providerId: "openai",
      apiKey: "  padded-key  ",
      baseURL: " https://api.openai.com/v1 ",
      imageModel: " gpt-image-2 "
    });

    expect(parsed).toEqual({
      scope: "image_generation",
      providerId: "openai",
      apiKey: "padded-key",
      baseURL: "https://api.openai.com/v1",
      imageModel: "gpt-image-2"
    });
  });

  it("对照：结构合法但 apiKey 为空白时 parse 仍返回对象，由完整性校验兜底拦截", () => {
    const parsed = parseImageProviderConfig(createValidConfig({ apiKey: "   " }));

    expect(parsed).not.toBeNull();
    expect(parsed!.apiKey).toBe("");
    expect(isImageProviderConfigComplete(parsed!)).toBe(false);
  });
});

describe("isImageProviderConfigComplete 完整性校验", () => {
  it("拒绝 apiKey 为空或全空白的配置", () => {
    expect(isImageProviderConfigComplete(createValidConfig({ apiKey: "" }))).toBe(false);
    expect(isImageProviderConfigComplete(createValidConfig({ apiKey: " \t " }))).toBe(false);
  });

  it("拒绝 imageModel 为空或全空白的配置", () => {
    expect(isImageProviderConfigComplete(createValidConfig({ imageModel: "" }))).toBe(false);
    expect(isImageProviderConfigComplete(createValidConfig({ imageModel: "   " }))).toBe(false);
  });

  it("拒绝 scope 被篡改的配置", () => {
    const tampered = {
      ...createValidConfig(),
      scope: "chat_completion"
    } as unknown as ImageProviderConfig;

    expect(isImageProviderConfigComplete(tampered)).toBe(false);
  });

  it("custom 供应商必须使用 https:// 开头的 baseURL", () => {
    const insecure = createValidConfig({
      providerId: "custom",
      baseURL: "http://internal.example.com/v1"
    });
    const blank = createValidConfig({ providerId: "custom", baseURL: "   " });
    const secure = createValidConfig({
      providerId: "custom",
      baseURL: "https://images.example.com/v1"
    });

    expect(isImageProviderConfigComplete(insecure)).toBe(false);
    expect(isImageProviderConfigComplete(blank)).toBe(false);
    expect(isImageProviderConfigComplete(secure)).toBe(true);
  });

  it("custom 供应商的 https 协议匹配不区分大小写", () => {
    const upper = createValidConfig({
      providerId: "custom",
      baseURL: "HTTPS://images.example.com/v1"
    });

    expect(isImageProviderConfigComplete(upper)).toBe(true);
  });

  it("绿例：预设供应商填齐密钥与模型即视为完整", () => {
    expect(isImageProviderConfigComplete(createValidConfig())).toBe(true);
    expect(
      isImageProviderConfigComplete(
        createValidConfig({ providerId: "openai", baseURL: "https://api.openai.com/v1" })
      )
    ).toBe(true);
    expect(
      isImageProviderConfigComplete(
        createValidConfig({ providerId: "volcengine", baseURL: "" })
      )
    ).toBe(true);
  });
});
