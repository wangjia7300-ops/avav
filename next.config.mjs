/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  typedRoutes: true,
  output: "standalone",
  outputFileTracingRoot: process.cwd()
};

export default nextConfig;
