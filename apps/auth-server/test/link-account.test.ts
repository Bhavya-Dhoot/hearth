import { TokenResponse } from "@hearth/contracts";
import { createLocalJWKSet, jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkAccount } from "../../../scripts/lib/link-account";
import { signAccessToken } from "../src/tokens";
import { MCP_RESOURCE, startServer, type TestServer } from "./helpers";

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  await server.close();
});

describe("linkAccount()", () => {
  it("completes the real flow end to end with the demo defaults", async () => {
    const response = await linkAccount({ issuer: server.issuer, resource: MCP_RESOURCE });
    expect(TokenResponse.safeParse(response).success).toBe(true);
    expect(response.scope).toBe("home:read home:write orders:write");
    const { payload } = await jwtVerify(response.access_token, createLocalJWKSet({ keys: [server.keys.publicJwk] }), {
      issuer: server.issuer,
      audience: MCP_RESOURCE,
      currentDate: new Date(server.clock.now()),
    });
    expect(payload.sub).toBe("usr_okafor");
  });

  it("honours a narrower scope", async () => {
    const response = await linkAccount({ issuer: server.issuer, scope: "home:read", resource: MCP_RESOURCE });
    expect(response.scope).toBe("home:read");
  });

  it("fails with a clear error for a wrong password", async () => {
    await expect(linkAccount({ issuer: server.issuer, password: "wrong-password" })).rejects.toThrow(/not accepted/);
  });
});

describe("dev token", () => {
  it("is a 1 hour RS256 token for usr_okafor carrying all scopes", async () => {
    const now = server.clock.now();
    const token = await signAccessToken(server.keys, {
      issuer: server.issuer,
      userId: "usr_okafor",
      audience: MCP_RESOURCE,
      scope: "home:read home:write orders:write",
      clientId: "hearth-dev-token",
      now,
    });
    const { payload } = await jwtVerify(token, createLocalJWKSet({ keys: [server.keys.publicJwk] }), {
      issuer: server.issuer,
      audience: MCP_RESOURCE,
      currentDate: new Date(now),
    });
    expect(payload.sub).toBe("usr_okafor");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);
  });
});
