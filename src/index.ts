import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { AuthHandler, ensureGrokClient } from "./auth";
import { MCP_SCOPE, type Env } from "./env";
import { createServer } from "./mcp";

async function sha256Equal(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < leftBytes.length; i += 1) {
    diff |= leftBytes[i]! ^ rightBytes[i]!;
  }
  return diff === 0;
}

const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createMcpHandler(() => createServer(env), {
      route: "/mcp",
    })(request, env, ctx);
  },
};

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler,
  defaultHandler: AuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: [MCP_SCOPE],
  // Resource URI is derived from the request host so production workers.dev and
  // local test hosts both validate token audiences correctly.
  resourceMetadata: {
    scopes_supported: [MCP_SCOPE],
    resource_name: "Aman Career MCP",
    bearer_methods_supported: ["header"],
  },
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
  // Keep MCP_AUTH_TOKEN working for local tooling without exposing it to Grok OAuth UI.
  resolveExternalToken: async ({ token, request, env }) => {
    if (!env.MCP_AUTH_TOKEN) {
      return null;
    }
    if (!(await sha256Equal(token, env.MCP_AUTH_TOKEN))) {
      return null;
    }
    const url = new URL(request.url);
    return {
      props: {
        userId: "static-bearer",
        authType: "static_bearer",
        service: "aman-career-mcp",
      },
      audience: `${url.origin}/mcp`,
    };
  },
});

// Ensure the Grok public client exists when the isolate handles auth routes.
export { ensureGrokClient };
