import {
	createExecutionContext,
	env as cloudflareEnv,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import worker from "../src/index";
import { ensureGrokClient } from "../src/auth";
import { MCP_SCOPE } from "../src/env";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const TEST_ENV = {
	...cloudflareEnv,
	APPS_SCRIPT_URL: "https://example.com/apps-script-exec",
	APPS_SCRIPT_SECRET: "test-apps-script-secret",
	MCP_AUTH_TOKEN: "test-mcp-auth-token",
	OAUTH_APPROVAL_SECRET: "test-oauth-approval-secret",
	MCP_RESOURCE_URL: "https://example.com/mcp",
	OAUTH_CLIENT_ID: "grok-aman-career-mcp",
};

const CLIENT_META = {
	"io.modelcontextprotocol/protocolVersion": "2026-07-28",
	"io.modelcontextprotocol/clientInfo": {
		name: "aman-career-mcp-tests",
		version: "1.0.0",
	},
	"io.modelcontextprotocol/clientCapabilities": {},
};

const EXPECTED_TOOLS = [
	"add_opportunity",
	"find_company",
	"find_contact",
	"find_opportunity",
	"get_settings",
	"record_contact",
	"record_search",
	"update_opportunity",
	"upsert_company",
	"upsert_contact",
].sort();

const REDIRECT_URI = "https://grok.com/connectors-oauth-exchange-code/";

function assertNoSecrets(payload: string) {
	expect(payload).not.toContain(TEST_ENV.APPS_SCRIPT_SECRET);
	expect(payload).not.toContain(TEST_ENV.MCP_AUTH_TOKEN);
	expect(payload).not.toContain(TEST_ENV.OAUTH_APPROVAL_SECRET);
	expect(payload).not.toContain("APPS_SCRIPT_SECRET");
	expect(payload).not.toContain("MCP_AUTH_TOKEN");
	expect(payload).not.toContain("OAUTH_APPROVAL_SECRET");
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = "";
	for (const value of view) binary += String.fromCharCode(value);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pkcePair() {
	const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
	const verifier = base64Url(verifierBytes);
	const challenge = base64Url(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	);
	return { verifier, challenge };
}

async function fetchWorker(
	request: Request,
): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, TEST_ENV, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

function modernHeaders(method: string, token: string, extra: Record<string, string> = {}) {
	return {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
		"MCP-Protocol-Version": "2026-07-28",
		"Mcp-Method": method,
		Authorization: `Bearer ${token}`,
		...extra,
	};
}

async function postMcp(
	body: unknown,
	headers: Record<string, string>,
): Promise<Response> {
	return fetchWorker(
		new IncomingRequest("https://example.com/mcp", {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}),
	);
}

async function readJsonRpc(
	response: Response,
): Promise<Record<string, unknown>> {
	const contentType = response.headers.get("content-type") ?? "";
	const raw = await response.text();
	assertNoSecrets(raw);

	if (contentType.includes("text/event-stream")) {
		const dataLines = raw
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.filter(Boolean);
		const last = dataLines.at(-1);
		if (!last) {
			throw new Error(`SSE response had no data frames:\n${raw}`);
		}
		return JSON.parse(last) as Record<string, unknown>;
	}

	return JSON.parse(raw) as Record<string, unknown>;
}

function extractCookie(setCookie: string | null, name: string): string | null {
	if (!setCookie) return null;
	const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
	return match?.[1] ?? null;
}

async function completeOAuthFlow(): Promise<string> {
	await ensureGrokClient(TEST_ENV as never);
	const { verifier, challenge } = await pkcePair();
	const state = crypto.randomUUID();

	const authorizeUrl = new URL("https://example.com/authorize");
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("client_id", TEST_ENV.OAUTH_CLIENT_ID);
	authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
	authorizeUrl.searchParams.set("scope", MCP_SCOPE);
	authorizeUrl.searchParams.set("state", state);
	authorizeUrl.searchParams.set("code_challenge", challenge);
	authorizeUrl.searchParams.set("code_challenge_method", "S256");
	authorizeUrl.searchParams.set("resource", "https://example.com/mcp");

	const authorizeGet = await fetchWorker(
		new IncomingRequest(authorizeUrl.toString(), { method: "GET" }),
	);
	expect(authorizeGet.status).toBe(200);
	const html = await authorizeGet.text();
	assertNoSecrets(html);
	expect(html).toContain("Approve access");

	const csrf = extractCookie(
		authorizeGet.headers.get("Set-Cookie"),
		"__Host-CSRF_TOKEN",
	);
	expect(csrf).toBeTruthy();

	const consentId = html.match(/name="consent_id" value="([^"]+)"/)?.[1];
	expect(consentId).toBeTruthy();

	const form = new FormData();
	form.set("consent_id", consentId!);
	form.set("csrf_token", csrf!);
	form.set("approval_secret", TEST_ENV.OAUTH_APPROVAL_SECRET);

	const authorizePost = await fetchWorker(
		new IncomingRequest("https://example.com/authorize", {
			method: "POST",
			headers: {
				Cookie: `__Host-CSRF_TOKEN=${csrf}`,
			},
			body: form,
		}),
	);
	expect(authorizePost.status).toBe(302);
	const location = authorizePost.headers.get("Location");
	expect(location).toBeTruthy();
	assertNoSecrets(location ?? "");

	const redirect = new URL(location!);
	expect(redirect.href.startsWith(REDIRECT_URI.replace(/\/$/, ""))).toBe(true);
	const code = redirect.searchParams.get("code");
	expect(code).toBeTruthy();
	expect(redirect.searchParams.get("state")).toBe(state);

	const tokenResponse = await fetchWorker(
		new IncomingRequest("https://example.com/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: code!,
				redirect_uri: REDIRECT_URI,
				client_id: TEST_ENV.OAUTH_CLIENT_ID,
				code_verifier: verifier,
				resource: "https://example.com/mcp",
			}),
		}),
	);
	expect(tokenResponse.status).toBe(200);
	const tokenJson = (await tokenResponse.json()) as {
		access_token?: string;
		token_type?: string;
		error?: string;
	};
	assertNoSecrets(JSON.stringify(tokenJson));
	expect(tokenJson.error).toBeUndefined();
	expect(tokenJson.access_token).toBeTruthy();
	expect(tokenJson.token_type?.toLowerCase()).toBe("bearer");
	return tokenJson.access_token!;
}

describe("Aman Career MCP Worker with OAuth", () => {
	beforeEach(async () => {
		await ensureGrokClient(TEST_ENV as never);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("returns a healthy root response", async () => {
		const response = await fetchWorker(
			new IncomingRequest("https://example.com/"),
		);
		expect(response.status).toBe(200);
		const body = await response.text();
		assertNoSecrets(body);
		expect(JSON.parse(body)).toMatchObject({
			ok: true,
			service: "Aman Career MCP",
			status: "healthy",
			mcpEndpoint: "/mcp",
			authorizeEndpoint: "/authorize",
			tokenEndpoint: "/oauth/token",
		});
	});

	it("rejects unauthenticated MCP POSTs with 401", async () => {
		const response = await postMcp(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "server/discover",
				params: { _meta: CLIENT_META },
			},
			{
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				"MCP-Protocol-Version": "2026-07-28",
				"Mcp-Method": "server/discover",
			},
		);
		expect(response.status).toBe(401);
		const body = await response.text();
		assertNoSecrets(body);
		expect(response.headers.get("WWW-Authenticate") || body.toLowerCase()).toMatch(
			/bearer|unauthorized|invalid_token|oauth/i,
		);
	});

	it("rejects invalid bearer tokens with 401", async () => {
		const response = await postMcp(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "server/discover",
				params: { _meta: CLIENT_META },
			},
			modernHeaders("server/discover", "wrong-token"),
		);
		expect(response.status).toBe(401);
		assertNoSecrets(await response.text());
	});

	it("allows CORS preflight without a bearer token", async () => {
		const response = await fetchWorker(
			new IncomingRequest("https://example.com/mcp", {
				method: "OPTIONS",
				headers: {
					"Access-Control-Request-Method": "POST",
				},
			}),
		);
		expect([200, 204]).toContain(response.status);
	});

	it("exposes OAuth authorization server metadata", async () => {
		const response = await fetchWorker(
			new IncomingRequest(
				"https://example.com/.well-known/oauth-authorization-server",
			),
		);
		expect(response.status).toBe(200);
		const body = await response.text();
		assertNoSecrets(body);
		const json = JSON.parse(body) as Record<string, unknown>;
		expect(json.authorization_endpoint).toContain("/authorize");
		expect(json.token_endpoint).toContain("/oauth/token");
		expect(JSON.stringify(json)).toContain("S256");
	});

	it("serves the OAuth authorization endpoint", async () => {
		const { challenge } = await pkcePair();
		const url = new URL("https://example.com/authorize");
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", TEST_ENV.OAUTH_CLIENT_ID);
		url.searchParams.set("redirect_uri", REDIRECT_URI);
		url.searchParams.set("scope", MCP_SCOPE);
		url.searchParams.set("state", "abc");
		url.searchParams.set("code_challenge", challenge);
		url.searchParams.set("code_challenge_method", "S256");
		url.searchParams.set("resource", "https://example.com/mcp");

		const response = await fetchWorker(
			new IncomingRequest(url.toString(), { method: "GET" }),
		);
		expect(response.status).toBe(200);
		const html = await response.text();
		assertNoSecrets(html);
		expect(html).toContain("Authorize Grok");
		expect(html).toContain(TEST_ENV.OAUTH_CLIENT_ID);
	});

	it("rejects invalid OAuth authorization requests", async () => {
		const url = new URL("https://example.com/authorize");
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", "unknown-client");
		url.searchParams.set("redirect_uri", REDIRECT_URI);
		url.searchParams.set("code_challenge", "x");
		url.searchParams.set("code_challenge_method", "S256");

		const response = await fetchWorker(
			new IncomingRequest(url.toString(), { method: "GET" }),
		);
		expect(response.status).toBeGreaterThanOrEqual(400);
		assertNoSecrets(await response.text());
	});

	it("rejects token exchange without a valid code", async () => {
		const response = await fetchWorker(
			new IncomingRequest("https://example.com/oauth/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code: "invalid-code",
					redirect_uri: REDIRECT_URI,
					client_id: TEST_ENV.OAUTH_CLIENT_ID,
					code_verifier: "verifier",
				}),
			}),
		);
		expect(response.status).toBeGreaterThanOrEqual(400);
		const body = await response.text();
		assertNoSecrets(body);
	});

	it("rejects consent with the wrong approval secret", async () => {
		const { challenge } = await pkcePair();
		const authorizeUrl = new URL("https://example.com/authorize");
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("client_id", TEST_ENV.OAUTH_CLIENT_ID);
		authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
		authorizeUrl.searchParams.set("scope", MCP_SCOPE);
		authorizeUrl.searchParams.set("state", "deny");
		authorizeUrl.searchParams.set("code_challenge", challenge);
		authorizeUrl.searchParams.set("code_challenge_method", "S256");
		authorizeUrl.searchParams.set("resource", "https://example.com/mcp");

		const authorizeGet = await fetchWorker(
			new IncomingRequest(authorizeUrl.toString(), { method: "GET" }),
		);
		const html = await authorizeGet.text();
		const csrf = extractCookie(
			authorizeGet.headers.get("Set-Cookie"),
			"__Host-CSRF_TOKEN",
		);
		const consentId = html.match(/name="consent_id" value="([^"]+)"/)?.[1];

		const form = new FormData();
		form.set("consent_id", consentId!);
		form.set("csrf_token", csrf!);
		form.set("approval_secret", "wrong-secret");

		const authorizePost = await fetchWorker(
			new IncomingRequest("https://example.com/authorize", {
				method: "POST",
				headers: { Cookie: `__Host-CSRF_TOKEN=${csrf}` },
				body: form,
			}),
		);
		expect(authorizePost.status).toBe(401);
		const body = await authorizePost.text();
		assertNoSecrets(body);
		expect(body).toContain("Invalid approval secret");
	});

	it("completes authorization code + PKCE token exchange", async () => {
		const accessToken = await completeOAuthFlow();
		expect(accessToken.length).toBeGreaterThan(20);
	});

	it("allows MCP initialize with a valid OAuth access token", async () => {
		const accessToken = await completeOAuthFlow();
		const response = await postMcp(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "server/discover",
				params: { _meta: CLIENT_META },
			},
			modernHeaders("server/discover", accessToken),
		);
		expect(response.status).toBe(200);
		const message = await readJsonRpc(response);
		expect(message.error).toBeUndefined();
		expect(JSON.stringify(message.result)).toContain("2026-07-28");
	});

	it("lists tools with a valid OAuth access token", async () => {
		const accessToken = await completeOAuthFlow();
		const response = await postMcp(
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
				params: { _meta: CLIENT_META },
			},
			modernHeaders("tools/list", accessToken),
		);
		expect(response.status).toBe(200);
		const message = await readJsonRpc(response);
		const result = message.result as { tools: Array<{ name: string }> };
		expect(result.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
	});

	it("calls get_settings with OAuth token and reaches Apps Script", async () => {
		const accessToken = await completeOAuthFlow();
		const fetchMock = vi.fn(async () =>
			Response.json({
				ok: true,
				action: "get_settings",
				apiKey: TEST_ENV.APPS_SCRIPT_SECRET,
				settings: {
					dailyTarget: "10-15",
					minimumMatchScore: 75,
				},
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const response = await postMcp(
			{
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "get_settings",
					arguments: {},
					_meta: CLIENT_META,
				},
			},
			modernHeaders("tools/call", accessToken, {
				"Mcp-Name": "get_settings",
			}),
		);
		expect(response.status).toBe(200);
		const message = await readJsonRpc(response);
		const result = message.result as {
			content: Array<{ type: string; text: string }>;
		};
		expect(result.content[0]?.text).toContain("minimumMatchScore");
		expect(result.content[0]?.text).not.toContain("apiKey");
		assertNoSecrets(result.content[0]?.text ?? "");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, init] = fetchMock.mock.calls[0] as [
			string,
			{ body?: string },
		];
		const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
		expect(payload.action).toBe("get_settings");
		expect(payload.apiKey).toBe(TEST_ENV.APPS_SCRIPT_SECRET);
	});

	it("still accepts the legacy MCP_AUTH_TOKEN bearer for tooling", async () => {
		const response = await postMcp(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "server/discover",
				params: { _meta: CLIENT_META },
			},
			modernHeaders("server/discover", TEST_ENV.MCP_AUTH_TOKEN),
		);
		expect(response.status).toBe(200);
		const message = await readJsonRpc(response);
		expect(message.error).toBeUndefined();
	});

	it("rejects mixed modern headers with a legacy initialize body", async () => {
		const response = await postMcp(
			{
				jsonrpc: "2.0",
				id: 4,
				method: "initialize",
				params: {
					protocolVersion: "2026-07-28",
					capabilities: {},
					clientInfo: {
						name: "legacy-style-client",
						version: "1.0.0",
					},
				},
			},
			modernHeaders("initialize", TEST_ENV.MCP_AUTH_TOKEN),
		);
		expect(response.status).toBe(400);
		const body = await response.text();
		assertNoSecrets(body);
		expect(body.toLowerCase()).toMatch(/disagree|legacy|header/);
	});

	it("rejects PKCE token exchange when verifier is wrong", async () => {
		await ensureGrokClient(TEST_ENV as never);
		const { challenge } = await pkcePair();
		const authorizeUrl = new URL("https://example.com/authorize");
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("client_id", TEST_ENV.OAUTH_CLIENT_ID);
		authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
		authorizeUrl.searchParams.set("scope", MCP_SCOPE);
		authorizeUrl.searchParams.set("state", "pkce-fail");
		authorizeUrl.searchParams.set("code_challenge", challenge);
		authorizeUrl.searchParams.set("code_challenge_method", "S256");
		authorizeUrl.searchParams.set("resource", "https://example.com/mcp");

		const authorizeGet = await fetchWorker(
			new IncomingRequest(authorizeUrl.toString(), { method: "GET" }),
		);
		const html = await authorizeGet.text();
		const csrf = extractCookie(
			authorizeGet.headers.get("Set-Cookie"),
			"__Host-CSRF_TOKEN",
		);
		const consentId = html.match(/name="consent_id" value="([^"]+)"/)?.[1];
		const form = new FormData();
		form.set("consent_id", consentId!);
		form.set("csrf_token", csrf!);
		form.set("approval_secret", TEST_ENV.OAUTH_APPROVAL_SECRET);

		const authorizePost = await fetchWorker(
			new IncomingRequest("https://example.com/authorize", {
				method: "POST",
				headers: { Cookie: `__Host-CSRF_TOKEN=${csrf}` },
				body: form,
			}),
		);
		const location = authorizePost.headers.get("Location")!;
		const code = new URL(location).searchParams.get("code")!;

		const tokenResponse = await fetchWorker(
			new IncomingRequest("https://example.com/oauth/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code,
					redirect_uri: REDIRECT_URI,
					client_id: TEST_ENV.OAUTH_CLIENT_ID,
					code_verifier: "definitely-wrong-verifier",
					resource: "https://example.com/mcp",
				}),
			}),
		);
		expect(tokenResponse.status).toBeGreaterThanOrEqual(400);
		assertNoSecrets(await tokenResponse.text());
	});
});
