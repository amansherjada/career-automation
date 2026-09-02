import { readFileSync } from "node:fs";

function loadDevVars(path) {
  const out = {};
  let text = readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const vars = loadDevVars(".dev.vars");
const token = vars.MCP_AUTH_TOKEN;
if (!token) {
  console.error("MISSING_MCP_AUTH_TOKEN");
  process.exit(1);
}

const CLIENT_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    name: "aman-prod-verify",
    version: "1.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function readJsonRpc(response) {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (contentType.includes("text/event-stream")) {
    const dataLines = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const last = dataLines.at(-1);
    if (!last) throw new Error("SSE_EMPTY");
    return JSON.parse(last);
  }
  return JSON.parse(raw);
}

async function postMcp(method, body, extraHeaders = {}) {
  const response = await fetch(
    "https://aman-career-mcp.aman-career-mcp.workers.dev/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": method,
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    },
  );
  const message = await readJsonRpc(response);
  return { status: response.status, message };
}

const discover = await postMcp("server/discover", {
  jsonrpc: "2.0",
  id: 1,
  method: "server/discover",
  params: { _meta: CLIENT_META },
});

const tools = await postMcp("tools/list", {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: { _meta: CLIENT_META },
});

const settings = await postMcp(
  "tools/call",
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
  { "Mcp-Name": "get_settings" },
);

function containsSecretLeak(value) {
  const text = JSON.stringify(value);
  return (
    text.includes(token) ||
    text.includes("APPS_SCRIPT_SECRET") ||
    text.includes("MCP_AUTH_TOKEN") ||
    /"apiKey"\s*:/.test(text)
  );
}

const toolNames = (tools.message?.result?.tools || [])
  .map((tool) => tool.name)
  .sort();
const settingsText = settings.message?.result?.content?.[0]?.text || "";
let settingsPreview = {};
try {
  const parsed = JSON.parse(settingsText);
  settingsPreview = {
    ok: parsed.ok,
    action: parsed.action,
    keys: Object.keys(parsed).sort(),
    hasSettingsObject:
      typeof parsed.settings === "object" && parsed.settings !== null,
  };
} catch {
  settingsPreview = {
    parseError: true,
    textLength: settingsText.length,
  };
}

const report = {
  discover: {
    status: discover.status,
    hasError: Boolean(discover.message.error),
    errorMessage: discover.message.error?.message,
    resultKeys: Object.keys(discover.message.result || {}).sort(),
    mentions2026: JSON.stringify(discover.message).includes("2026-07-28"),
  },
  toolsList: {
    status: tools.status,
    hasError: Boolean(tools.message.error),
    errorMessage: tools.message.error?.message,
    toolCount: toolNames.length,
    toolNames,
  },
  getSettings: {
    status: settings.status,
    hasError: Boolean(settings.message.error),
    errorMessage: settings.message.error?.message,
    preview: settingsPreview,
  },
  secretLeakDetected:
    containsSecretLeak(discover.message) ||
    containsSecretLeak(tools.message) ||
    containsSecretLeak(settings.message),
};

console.log(JSON.stringify(report, null, 2));

if (
  report.discover.hasError ||
  report.toolsList.hasError ||
  report.getSettings.hasError ||
  report.secretLeakDetected ||
  report.discover.status !== 200 ||
  report.toolsList.status !== 200 ||
  report.getSettings.status !== 200 ||
  report.toolsList.toolCount !== 10 ||
  !report.getSettings.preview.hasSettingsObject
) {
  process.exit(1);
}
