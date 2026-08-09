import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

function localSecurityHeaders(isDevelopment) {
  const scriptPolicy = isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";
  const connectPolicy = isDevelopment
    ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"
    : "connect-src 'self'";

  return [
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        scriptPolicy,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self' data:",
        connectPolicy,
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'"
      ].join("; ")
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()"
    },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }
  ];
}

/**
 * 开发服务与生产构建必须使用不同目录。
 * 否则在 next dev 运行期间执行 next build，会覆盖开发服务器正在读取的
 * CSS/JS 清单，导致页面只剩原始 HTML。
 *
 * @param {string} phase
 * @returns {import("next").NextConfig}
 */
export default function nextConfig(phase) {
  return {
    typedRoutes: true,
    outputFileTracingRoot: process.cwd(),
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    async headers() {
      return [
        {
          source: "/:path*",
          headers: localSecurityHeaders(phase === PHASE_DEVELOPMENT_SERVER)
        }
      ];
    }
  };
}
