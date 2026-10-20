import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (DECISIONS #2); Next compiles them.
  transpilePackages: ["@hearth/contracts", "@hearth/design-tokens", "@hearth/host-sim-core"],
  // Widget HTML is fetched from the MCP server and rendered in sandboxed iframes; nothing to proxy.
  poweredByHeader: false,
  // The Next dev badge would sit on top of the mobile inspector and recordings.
  devIndicators: false,
};

export default config;
