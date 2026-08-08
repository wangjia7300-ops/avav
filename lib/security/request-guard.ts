import { ServiceError } from "@/lib/services/errors";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const JSON_MEDIA_TYPE = /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/i;

export const API_BODY_LIMITS = {
  modelTest: 256 * 1024,
  // 24 MiB 原图转为 base64 后约为 32 MiB；额外空间留给 JSON 结构和策划产物。
  skillSuite: 36 * 1024 * 1024,
  imageGeneration: 36 * 1024 * 1024
} as const;

export type LocalApiRequestGuardOptions = {
  method: "GET" | "POST";
  maxContentLength?: number;
  requireJson?: boolean;
  requireOrigin?: boolean;
};

type LocalAuthority = {
  hostname: string;
  host: string;
};

function forbidden(message: string, code: string): never {
  throw new ServiceError(message, {
    statusCode: 403,
    code
  });
}

function parseLocalAuthority(value: string | null): LocalAuthority {
  if (!value || /[\s/@\\]/.test(value)) {
    forbidden("请求来源不是受信任的本机应用。", "REQUEST_HOST_FORBIDDEN");
  }

  let parsed: URL;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    forbidden("请求来源不是受信任的本机应用。", "REQUEST_HOST_FORBIDDEN");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    !LOCAL_HOSTNAMES.has(hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    forbidden("请求来源不是受信任的本机应用。", "REQUEST_HOST_FORBIDDEN");
  }

  return {
    hostname,
    host: parsed.host.toLowerCase()
  };
}

function assertLocalHost(request: Request) {
  // Next.js 在部分开发服务器路径中会把 Request.url 规范化为 localhost，
  // 即使客户端实际通过 127.0.0.1 访问；安全边界以原始 Host 头为准。
  return parseLocalAuthority(request.headers.get("host"));
}

function assertSameOrigin(request: Request, authority: LocalAuthority) {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin || rawOrigin === "null") {
    forbidden("缺少本机同源凭据，已阻止模型调用。", "REQUEST_ORIGIN_REQUIRED");
  }

  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    forbidden("请求 Origin 无效。", "REQUEST_ORIGIN_FORBIDDEN");
  }

  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.host.toLowerCase() !== authority.host
  ) {
    forbidden("仅允许本机工作台发起同源请求。", "REQUEST_ORIGIN_FORBIDDEN");
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite.toLowerCase() !== "same-origin") {
    forbidden("已阻止跨站模型请求。", "REQUEST_ORIGIN_FORBIDDEN");
  }
}

function assertJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim() ?? "";

  if (!JSON_MEDIA_TYPE.test(mediaType)) {
    throw new ServiceError("请求体必须使用 application/json。", {
      statusCode: 415,
      code: "REQUEST_CONTENT_TYPE_INVALID"
    });
  }
}

function assertContentLength(request: Request, maxContentLength: number) {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) {
    // HTTP/2、chunked 请求和部分 AI 测试客户端不会提供该头。
    // Content-Length 仅用于提前拒绝；真实安全边界由
    // readJsonRequestBody 的流式字节计数负责。
    return;
  }

  if (!/^\d+$/.test(rawLength)) {
    throw new ServiceError("Content-Length 格式无效。", {
      statusCode: 400,
      code: "REQUEST_CONTENT_LENGTH_INVALID"
    });
  }

  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength) || contentLength > maxContentLength) {
    throw new ServiceError("请求体超过允许大小。", {
      statusCode: 413,
      code: "REQUEST_BODY_TOO_LARGE"
    });
  }
}

/**
 * 本机单用户版 API 的第一层门禁。
 *
 * 它只验证网络来源和请求元数据，不读取请求体，也不替代后续字段校验、
 * 图片解码校验、速率限制、预算或真正的用户身份认证。
 */
export function assertLocalApiRequest(
  request: Request,
  options: LocalApiRequestGuardOptions
) {
  if (request.method.toUpperCase() !== options.method) {
    throw new ServiceError("请求方法不受支持。", {
      statusCode: 405,
      code: "REQUEST_METHOD_INVALID"
    });
  }

  const authority = assertLocalHost(request);

  if (options.requireOrigin ?? options.method !== "GET") {
    assertSameOrigin(request, authority);
  }

  if (options.requireJson) {
    assertJsonContentType(request);
  }

  if (options.maxContentLength !== undefined) {
    assertContentLength(request, options.maxContentLength);
  }
}

/**
 * Streams and counts the real body bytes before parsing JSON.
 *
 * Content-Length is an early rejection hint, not a trust boundary: a local
 * process can forge it. Reading through this helper prevents a forged small
 * header from bypassing the application-level body limit.
 */
export async function readJsonRequestBody(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  if (!request.body) {
    throw new ServiceError("请求体不能为空。", {
      statusCode: 400,
      code: "REQUEST_BODY_REQUIRED"
    });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ServiceError("请求体超过允许大小。", {
          statusCode: 413,
          code: "REQUEST_BODY_TOO_LARGE"
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (!totalBytes) {
    throw new ServiceError("请求体不能为空。", {
      statusCode: 400,
      code: "REQUEST_BODY_REQUIRED"
    });
  }

  const body = Buffer.concat(
    chunks.map((chunk) =>
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    ),
    totalBytes
  );
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text) as unknown;
  } catch {
    throw new ServiceError("请求体必须是合法 UTF-8 JSON。", {
      statusCode: 400,
      code: "REQUEST_JSON_INVALID"
    });
  }
}
