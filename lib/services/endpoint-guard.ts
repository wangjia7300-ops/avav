import { lookup } from "node:dns/promises";
import { ServiceError } from "@/lib/services/errors";
import { PRESET_PROVIDERS } from "@/lib/ai-providers";
import type { AIProviderConfig } from "@/lib/types";

// 服务端专用（依赖 node:dns），禁止被客户端组件引用。
// 文本与生图两条链路共用同一套“仅允许公开 HTTPS 端点”的 SSRF 防护。

const ARK_ENDPOINT_ID_PATTERN = /^ep-[a-z0-9-]+$/i;

function mappedIPv4Address(hostname: string) {
  if (!hostname.startsWith("::ffff:")) return null;

  const mapped = hostname.slice("::ffff:".length);
  const dotted = mapped.split(":").at(-1);
  if (dotted?.includes(".")) return dotted;

  const groups = mapped.split(":").filter(Boolean);
  const high = Number.parseInt(groups.at(-2) ?? "", 16);
  const low = Number.parseInt(groups.at(-1) ?? "", 16);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return null;
  }

  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isNonPublicIPv4(hostname: string) {
  const ipv4 = hostname.split(".").map(Number);
  if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return (
    ipv4[0] === 0 ||
    ipv4[0] === 10 ||
    ipv4[0] === 127 ||
    (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127) ||
    (ipv4[0] === 169 && ipv4[1] === 254) ||
    (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
    (ipv4[0] === 192 && ipv4[1] === 0 && ipv4[2] === 0) ||
    (ipv4[0] === 192 && ipv4[1] === 0 && ipv4[2] === 2) ||
    (ipv4[0] === 192 && ipv4[1] === 168) ||
    (ipv4[0] === 198 && (ipv4[1] === 18 || ipv4[1] === 19)) ||
    (ipv4[0] === 198 && ipv4[1] === 51 && ipv4[2] === 100) ||
    (ipv4[0] === 203 && ipv4[1] === 0 && ipv4[2] === 113) ||
    ipv4[0] >= 224
  );
}

export function isPrivateEndpointHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv6 = normalized.includes(":");
  const mappedIPv4 = mappedIPv4Address(normalized);

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    (mappedIPv4 !== null && isNonPublicIPv4(mappedIPv4)) ||
    (isIpv6 &&
      (normalized === "::" ||
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        /^fe[89ab]/.test(normalized) ||
        normalized.startsWith("ff") ||
        normalized.startsWith("100:") ||
        normalized.startsWith("2001:db8:")))
  ) {
    return true;
  }

  return isNonPublicIPv4(normalized);
}

export type EndpointGuardMessages = {
  invalidMessage: string;
  invalidCode: string;
  unreachableMessage: string;
  unreachableCode: string;
};

export async function assertPublicEndpoint(baseURL: string, messages: EndpointGuardMessages) {
  const endpoint = new URL(baseURL);
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  let addresses: Array<{ address: string }>;

  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ServiceError(messages.unreachableMessage, {
      statusCode: 400,
      code: messages.unreachableCode
    });
  }

  if (!addresses.length || addresses.some(({ address }) => isPrivateEndpointHostname(address))) {
    throw new ServiceError(messages.invalidMessage, {
      statusCode: 400,
      code: messages.invalidCode
    });
  }
}

const CHAT_ENDPOINT_MESSAGES: EndpointGuardMessages = {
  invalidMessage: "文案模型 Endpoint 必须是可公开访问的 HTTPS 地址。",
  invalidCode: "API_ENDPOINT_INVALID",
  unreachableMessage: "无法解析文案模型 Endpoint，请检查地址后重试。",
  unreachableCode: "API_ENDPOINT_UNREACHABLE"
};

const officialProviderHosts = new Set(
  PRESET_PROVIDERS.filter((preset) => preset.baseURL).map(
    (preset) => new URL(preset.baseURL).hostname.toLowerCase()
  )
);

/**
 * 校验客户端提交的文案模型配置只指向可信端点：
 * - providerId 必须是预设之一；
 * - 预设官方域名直接放行；
 * - 其它自定义 baseURL 必须是 HTTPS、无内嵌凭据、解析到公网地址。
 * 服务端环境变量配置（管理员可控）不经过本函数。
 */
export async function assertTrustedChatProviderConfig(config: AIProviderConfig) {
  if (!PRESET_PROVIDERS.some((preset) => preset.id === config.providerId)) {
    throw new ServiceError("不支持当前 AI 供应商。", {
      statusCode: 400,
      code: "AI_PROVIDER_UNSUPPORTED"
    });
  }

  const rawBaseURL = config.baseURL.trim();

  if (!rawBaseURL) {
    if (config.providerId === "custom") {
      throw new ServiceError("自定义供应商必须填写 Endpoint 地址。", {
        statusCode: 400,
        code: CHAT_ENDPOINT_MESSAGES.invalidCode
      });
    }
    return;
  }

  // 误填在 Endpoint 字段的火山方舟接入点 ID 会被适配层转为模型 ID，
  // 实际请求仍指向官方 Ark 域名，无需 DNS 校验。
  if (ARK_ENDPOINT_ID_PATTERN.test(rawBaseURL)) {
    return;
  }

  let endpoint: URL;
  try {
    endpoint = new URL(rawBaseURL);
  } catch {
    throw new ServiceError(CHAT_ENDPOINT_MESSAGES.invalidMessage, {
      statusCode: 400,
      code: CHAT_ENDPOINT_MESSAGES.invalidCode
    });
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    isPrivateEndpointHostname(endpoint.hostname)
  ) {
    throw new ServiceError(CHAT_ENDPOINT_MESSAGES.invalidMessage, {
      statusCode: 400,
      code: CHAT_ENDPOINT_MESSAGES.invalidCode
    });
  }

  if (officialProviderHosts.has(endpoint.hostname.toLowerCase())) {
    return;
  }

  await assertPublicEndpoint(rawBaseURL, CHAT_ENDPOINT_MESSAGES);
}
