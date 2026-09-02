import {
  AuthorizationError,
  type AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import {
  GROK_REDIRECT_URIS,
  MCP_SCOPE,
  type Env,
} from "./env";

const CONSENT_STATE_PREFIX = "oauth:consent:";
const CSRF_COOKIE = "__Host-CSRF_TOKEN";

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    return trimmed.slice(name.length + 1);
  }
  return null;
}

function csrfSetCookie(token: string): string {
  return `${CSRF_COOKIE}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`;
}

function csrfClearCookie(): string {
  return `${CSRF_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
}

/**
 * Pre-register the public Grok client under a stable client_id.
 *
 * workers-oauth-provider's createClient() always generates a random id, so the
 * fixed Grok UI client is written directly to OAUTH_KV in the provider's
 * client record format.
 */
export async function ensureGrokClient(env: Env): Promise<void> {
  const clientId = env.OAUTH_CLIENT_ID;
  const key = `client:${clientId}`;
  const redirectUris = [...GROK_REDIRECT_URIS];
  const existing = (await env.OAUTH_KV.get(key, "json")) as {
    clientId?: string;
    redirectUris?: string[];
    tokenEndpointAuthMethod?: string;
    clientName?: string;
    grantTypes?: string[];
    responseTypes?: string[];
    registrationDate?: number;
    authMethodExplicit?: boolean;
  } | null;

  const mergedRedirects = [
    ...new Set([...(existing?.redirectUris ?? []), ...redirectUris]),
  ];

  const record = {
    clientId,
    redirectUris: mergedRedirects,
    clientName: existing?.clientName ?? "Grok Custom Connector",
    grantTypes: existing?.grantTypes ?? [
      "authorization_code",
      "refresh_token",
    ],
    responseTypes: existing?.responseTypes ?? ["code"],
    registrationDate:
      existing?.registrationDate ?? Math.floor(Date.now() / 1000),
    tokenEndpointAuthMethod: "none",
    authMethodExplicit: true,
  };

  await env.OAUTH_KV.put(key, JSON.stringify(record));
}

function healthResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "Aman Career MCP",
      status: "healthy",
      mcpEndpoint: "/mcp",
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function consentPage(input: {
  clientName: string;
  clientId: string;
  scopes: string[];
  consentId: string;
  csrfToken: string;
  error?: string;
}): string {
  const errorHtml = input.error
    ? `<p style="color:#b00020;">${htmlEscape(input.error)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Authorize Aman Career MCP</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 560px; margin: 40px auto; padding: 16px; line-height: 1.5; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 24px; }
      label { display: block; margin-top: 16px; font-weight: 600; }
      input[type="password"] { width: 100%; padding: 10px; margin-top: 6px; box-sizing: border-box; }
      button { margin-top: 20px; padding: 10px 16px; border: 0; border-radius: 6px; background: #111; color: #fff; cursor: pointer; }
      .meta { background: #f6f6f6; padding: 12px; border-radius: 6px; margin-top: 16px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Authorize Grok</h1>
      <p><strong>${htmlEscape(input.clientName)}</strong> is requesting access to Aman Career MCP tools only.</p>
      <div class="meta">
        <div><strong>Client ID:</strong> ${htmlEscape(input.clientId)}</div>
        <div><strong>Scopes:</strong> ${htmlEscape(input.scopes.join(" ") || MCP_SCOPE)}</div>
      </div>
      ${errorHtml}
      <form method="POST" action="/authorize">
        <input type="hidden" name="consent_id" value="${htmlEscape(input.consentId)}" />
        <input type="hidden" name="csrf_token" value="${htmlEscape(input.csrfToken)}" />
        <label for="approval_secret">Approval secret</label>
        <input id="approval_secret" name="approval_secret" type="password" autocomplete="current-password" required />
        <button type="submit">Approve access</button>
      </form>
    </div>
  </body>
</html>`;
}

async function handleAuthorizeGet(
  request: Request,
  env: Env,
): Promise<Response> {
  await ensureGrokClient(env);

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (!error.redirectUri) {
      return new Response(error.description, { status: 400 });
    }
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set("error", error.code);
    redirect.searchParams.set("error_description", error.description);
    if (error.state) redirect.searchParams.set("state", error.state);
    if (error.issuer) redirect.searchParams.set("iss", error.issuer);
    return Response.redirect(redirect.toString(), 302);
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
  if (!client) {
    return new Response("Unknown OAuth client", { status: 400 });
  }

  const consentId = crypto.randomUUID();
  const csrfToken = crypto.randomUUID();
  await env.OAUTH_KV.put(
    `${CONSENT_STATE_PREFIX}${consentId}`,
    JSON.stringify(oauthReqInfo),
    { expirationTtl: 600 },
  );

  return new Response(
    consentPage({
      clientName: client.clientName ?? "MCP Client",
      clientId: client.clientId,
      scopes: oauthReqInfo.scope,
      consentId,
      csrfToken,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": csrfSetCookie(csrfToken),
      },
    },
  );
}

async function handleAuthorizePost(
  request: Request,
  env: Env,
): Promise<Response> {
  await ensureGrokClient(env);

  const form = await request.formData();
  const consentId = String(form.get("consent_id") ?? "");
  const csrfToken = String(form.get("csrf_token") ?? "");
  const approvalSecret = String(form.get("approval_secret") ?? "");
  const cookieToken = readCookie(request, CSRF_COOKIE);

  if (!consentId || !csrfToken || !cookieToken || csrfToken !== cookieToken) {
    return new Response("Invalid CSRF token", {
      status: 400,
      headers: { "Set-Cookie": csrfClearCookie() },
    });
  }

  if (
    !env.OAUTH_APPROVAL_SECRET ||
    !(await sha256Equal(approvalSecret, env.OAUTH_APPROVAL_SECRET))
  ) {
    const raw = await env.OAUTH_KV.get(`${CONSENT_STATE_PREFIX}${consentId}`);
    if (!raw) {
      return new Response("Consent expired. Restart authorization.", {
        status: 400,
        headers: { "Set-Cookie": csrfClearCookie() },
      });
    }
    const oauthReqInfo = JSON.parse(raw) as AuthRequest;
    const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
    return new Response(
      consentPage({
        clientName: client?.clientName ?? "MCP Client",
        clientId: oauthReqInfo.clientId,
        scopes: oauthReqInfo.scope,
        consentId,
        csrfToken,
        error: "Invalid approval secret.",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": csrfSetCookie(csrfToken),
        },
      },
    );
  }

  const raw = await env.OAUTH_KV.get(`${CONSENT_STATE_PREFIX}${consentId}`);
  if (!raw) {
    return new Response("Consent expired. Restart authorization.", {
      status: 400,
      headers: { "Set-Cookie": csrfClearCookie() },
    });
  }

  await env.OAUTH_KV.delete(`${CONSENT_STATE_PREFIX}${consentId}`);
  const oauthReqInfo = JSON.parse(raw) as AuthRequest;
  const grantedScopes = oauthReqInfo.scope.includes(MCP_SCOPE)
    ? [MCP_SCOPE]
    : oauthReqInfo.scope.length === 0
      ? [MCP_SCOPE]
      : oauthReqInfo.scope.filter((scope) => scope === MCP_SCOPE);

  if (grantedScopes.length === 0) {
    return new Response("Requested scopes are not supported.", { status: 400 });
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: "aman-career-owner",
    metadata: {
      label: "Aman Career MCP",
      clientName:
        (await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId))
          ?.clientName ?? "MCP Client",
    },
    scope: grantedScopes,
    props: {
      userId: "aman-career-owner",
      authType: "oauth",
      service: "aman-career-mcp",
    },
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectTo,
      "Set-Cookie": csrfClearCookie(),
    },
  });
}

export const AuthHandler = {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return healthResponse();
    }

    if (url.pathname === "/authorize") {
      if (request.method === "GET") {
        return handleAuthorizeGet(request, env);
      }
      if (request.method === "POST") {
        return handleAuthorizePost(request, env);
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
