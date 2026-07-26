import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

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
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next"
  };
}
