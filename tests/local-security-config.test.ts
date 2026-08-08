import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("本机服务安全配置", () => {
  it("开发与生产启动只监听 127.0.0.1", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.dev).toContain("--hostname 127.0.0.1");
    expect(packageJson.scripts.start).toContain("--hostname 127.0.0.1");
  });

  it("配置基础安全响应头且本机 HTTP 不启用 HSTS", () => {
    const config = readFileSync(
      resolve(process.cwd(), "next.config.mjs"),
      "utf8"
    );

    expect(config).toContain("Content-Security-Policy");
    expect(config).toContain("default-src 'self'");
    expect(config).toContain("connect-src 'self'");
    expect(config).toContain("img-src 'self' blob: data:");
    expect(config).toContain("frame-ancestors 'none'");
    expect(config).toContain("X-Content-Type-Options");
    expect(config).toContain("Cross-Origin-Opener-Policy");
    expect(config).not.toContain("Strict-Transport-Security");
  });
});
