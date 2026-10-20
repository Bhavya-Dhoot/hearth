/** Browser-visible configuration. NEXT_PUBLIC_* must be referenced literally so Next can inline them. */
const trim = (s: string) => s.replace(/\/+$/, "");

export const AUTH_ISSUER = trim(process.env.NEXT_PUBLIC_HEARTH_AUTH_ISSUER ?? "http://localhost:4100");
export const MCP_BASE = trim(process.env.NEXT_PUBLIC_HEARTH_MCP_BASE ?? "http://localhost:4200");
export const HOST_BASE = trim(process.env.NEXT_PUBLIC_HEARTH_HOST_BASE ?? "http://localhost:3000");

export const MCP_URL = `${MCP_BASE}/mcp`;
export const CLIENT_ID = "alexa-plus-host-sim";
export const REDIRECT_URI = `${HOST_BASE}/link/callback`;
export const SCOPE = "home:read home:write orders:write";
export const CLIENT_NAME = "alexa-plus-host-sim";
