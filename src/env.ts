import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  APPS_SCRIPT_URL: string;
  APPS_SCRIPT_SECRET: string;
  MCP_AUTH_TOKEN: string;
  OAUTH_APPROVAL_SECRET: string;
  MCP_RESOURCE_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}

export const MCP_SCOPE = "mcp";

export const GROK_REDIRECT_URIS = [
  "https://grok.com/connectors-oauth-exchange-code/",
  "https://grok.com/connectors-oauth-exchange-code",
] as const;
