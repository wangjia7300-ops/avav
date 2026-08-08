import { describe, expect, it } from "vitest";
import {
  API_BODY_LIMITS,
  assertLocalApiRequest,
  readJsonRequestBody
} from "@/lib/security/request-guard";
import { ServiceError } from "@/lib/services/errors";

function localRequest(
  overrides: {
    url?: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
  } = {}
) {
  const url = overrides.url ?? "http://127.0.0.1:3000/api/skill-suite";
  const method = overrides.method ?? "POST";
  const body = method === "POST" ? (overrides.body ?? "{}") : undefined;
  const headers = {
    host: new URL(url).host,
    ...(method === "POST"
      ? {
          origin: new URL(url).origin,
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body ?? "")),
          "sec-fetch-site": "same-origin"
        }
      : {}),
    ...overrides.headers
  };

  return new Request(url, { method, headers, body });
}

function expectGuardError(callback: () => void, statusCode: number, code: string) {
  let thrown: unknown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ServiceError);
  expect(thrown).toMatchObject({ statusCode, code });
}

describe("assertLocalApiRequest", () => {
  it("允许 127.0.0.1 与 localhost 的同源 JSON 请求", () => {
    expect(() =>
      assertLocalApiRequest(localRequest(), {
        method: "POST",
        requireJson: true,
        maxContentLength: API_BODY_LIMITS.skillSuite
      })
    ).not.toThrow();

    expect(() =>
      assertLocalApiRequest(
        localRequest({ url: "http://localhost:3000/api/skill-suite" }),
        {
          method: "POST",
          requireJson: true,
          maxContentLength: API_BODY_LIMITS.skillSuite
        }
      )
    ).not.toThrow();
  });

  it("GET 只做本机 Host 校验，不强制浏览器提供 Origin", () => {
    expect(() =>
      assertLocalApiRequest(
        localRequest({
          url: "http://localhost:3000/api/ai-model/test",
          method: "GET"
        }),
        { method: "GET" }
      )
    ).not.toThrow();
  });

  it("拒绝局域网、公网与伪 localhost Host", () => {
    for (const host of ["192.168.1.8:3000", "example.com", "localhost.example.com"]) {
      expectGuardError(
        () =>
          assertLocalApiRequest(
            localRequest({ headers: { host } }),
            { method: "POST" }
          ),
        403,
        "REQUEST_HOST_FORBIDDEN"
      );
    }
  });

  it("允许 Next.js 将内部 Request.url 规范化为另一种本机主机名", () => {
    expect(() =>
      assertLocalApiRequest(
        localRequest({
          headers: {
            host: "localhost:3000",
            origin: "http://localhost:3000"
          }
        }),
        { method: "POST" }
      )
    ).not.toThrow();
  });

  it("拒绝 Origin 与 Host 端口不一致", () => {
    expectGuardError(
      () =>
        assertLocalApiRequest(
          localRequest({ headers: { origin: "http://127.0.0.1:3001" } }),
          { method: "POST" }
        ),
      403,
      "REQUEST_ORIGIN_FORBIDDEN"
    );
  });

  it("POST 缺少 Origin 或 Origin 跨站时在读取正文前拒绝", () => {
    expectGuardError(
      () =>
        assertLocalApiRequest(
          localRequest({ headers: { origin: "" } }),
          { method: "POST" }
        ),
      403,
      "REQUEST_ORIGIN_REQUIRED"
    );
    expectGuardError(
      () =>
        assertLocalApiRequest(
          localRequest({ headers: { origin: "https://evil.example" } }),
          { method: "POST" }
        ),
      403,
      "REQUEST_ORIGIN_FORBIDDEN"
    );
  });

  it("拒绝浏览器标记为 cross-site 的请求", () => {
    expectGuardError(
      () =>
        assertLocalApiRequest(
          localRequest({ headers: { "sec-fetch-site": "cross-site" } }),
          { method: "POST" }
        ),
      403,
      "REQUEST_ORIGIN_FORBIDDEN"
    );
  });

  it("仅接受 JSON 与 +json 媒体类型", () => {
    expect(() =>
      assertLocalApiRequest(
        localRequest({
          headers: { "content-type": "application/problem+json; charset=utf-8" }
        }),
        { method: "POST", requireJson: true }
      )
    ).not.toThrow();

    expectGuardError(
      () =>
        assertLocalApiRequest(
          localRequest({ headers: { "content-type": "text/plain" } }),
          { method: "POST", requireJson: true }
        ),
      415,
      "REQUEST_CONTENT_TYPE_INVALID"
    );
  });

  it("允许无 Content-Length 的分块请求，并拒绝非法或超过上限的声明", () => {
    expect(
      () =>
        assertLocalApiRequest(
          localRequest({ headers: { "content-length": "" } }),
          { method: "POST", maxContentLength: 10 }
        )
    ).not.toThrow();
    expectGuardError(
      () =>
        assertLocalApiRequest(
          localRequest({ headers: { "content-length": "1e6" } }),
          { method: "POST", maxContentLength: 10 }
        ),
      400,
      "REQUEST_CONTENT_LENGTH_INVALID"
    );
    expectGuardError(
      () =>
        assertLocalApiRequest(
          localRequest({ headers: { "content-length": "11" } }),
          { method: "POST", maxContentLength: 10 }
        ),
      413,
      "REQUEST_BODY_TOO_LARGE"
    );
  });
});

describe("readJsonRequestBody", () => {
  it("parses a JSON body that is within the real byte limit", async () => {
    const request = localRequest({ body: '{"stage":"research"}' });

    await expect(readJsonRequestBody(request, 64)).resolves.toEqual({
      stage: "research"
    });
  });

  it("rejects real bytes that exceed the limit even if Content-Length is forged", async () => {
    const request = localRequest({
      body: '{"payload":"1234567890"}',
      headers: { "content-length": "2" }
    });

    await expect(readJsonRequestBody(request, 8)).rejects.toMatchObject({
      statusCode: 413,
      code: "REQUEST_BODY_TOO_LARGE"
    });
  });

  it("rejects invalid JSON with a curated error", async () => {
    const request = localRequest({ body: "{not-json}" });

    await expect(readJsonRequestBody(request, 64)).rejects.toMatchObject({
      statusCode: 400,
      code: "REQUEST_JSON_INVALID"
    });
  });
});
