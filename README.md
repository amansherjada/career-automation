# Career Automation

> Production-grade, **human-in-the-loop** AI career operating system for a UAE job search in AI and automation roles.

This repository contains the **Aman Career MCP server** (Cloudflare Worker) and the **Google Apps Script database API** that power a daily job-search pipeline. The system automates research, qualification, deduplication, contact verification, draft preparation, follow-ups, and reporting — while keeping every irreversible action under human control.

**Full system deep-dive:** [`AMAN_CAREER_SYSTEM_EXPLAINED.md`](./AMAN_CAREER_SYSTEM_EXPLAINED.md)

---

## Why this exists

Manual job searching is repetitive and easy to get wrong: duplicate outreach, missed follow-ups, inconsistent scoring, and hours spent on administrative work instead of evaluating fit and writing thoughtful emails.

Most “solutions” fail in one of two ways:

| Failure mode | Problem |
|---|---|
| Too passive | Spreadsheets still require full manual effort |
| Too aggressive | Mass-apply bots damage reputation and produce noise |

This system takes a third path: **automate preparation, never automate irreversible actions**.

---

## Design principles

1. **Human controls the irreversible** — sending email, submitting applications, and replying to recruiters are never automated.
2. **Never guess. Never fabricate** — unpublished salaries are not assumed; contact emails are never constructed from name patterns.
3. **Fewer, better opportunities** — there is no daily quota. Quality beats volume.

---

## Architecture

```text
Aman (human)
    │
    ▼
Grok Automations — 4 scheduled daily runs
    │
    ▼
Firecrawl — search, scrape, extract, monitor
    │
    ▼
Career MCP Server (this repo · Cloudflare Worker)
    │  OAuth 2.0 + PKCE · Bearer auth
    ▼
Google Apps Script — database API (this repo)
    │
    ▼
Google Sheets — 6 structured tabs

Side integrations:
  Google Drive → resumes
  Gmail        → draft creation & thread tracking only
```

| Layer | Responsibility |
|---|---|
| **Grok Automations** | Daily orchestration (outside this repo) |
| **Firecrawl** | Web intelligence — search, scrape, monitors |
| **MCP Worker** | Constrained career tool API (10 tools) |
| **Apps Script** | Business rules + Sheets access |
| **Google Sheets** | Human-auditable career database |

---

## Daily operating cycle

Four automations run every day:

| Automation | Time | Purpose |
|---|---|---|
| **Daily Hunter** | 08:30 | Discover, scrape, hard-filter, score, dedupe, monitor, create drafts |
| **Recheck** | 10:10 | Re-evaluate Needs Review + monitor alerts |
| **Follow-Ups** | 11:20 | Prepare follow-up drafts in existing threads only |
| **Daily Report** | 18:20 | Read-only scorecard and prioritized action list |

Details for each step live in [`AMAN_CAREER_SYSTEM_EXPLAINED.md`](./AMAN_CAREER_SYSTEM_EXPLAINED.md).

---

## What this repository includes

```text
.
├── src/
│   ├── index.ts          # Worker entry · OAuthProvider + MCP route
│   ├── auth.ts           # Consent UI · CSRF · Grok client registration
│   ├── mcp.ts            # 10 MCP tools · Apps Script proxy
│   └── env.ts            # Typed environment bindings
├── AppScript Code/
│   └── Code.gs           # Google Sheets database API
├── scripts/
│   └── verify-prod-mcp.mjs
├── test/
│   └── index.spec.ts
├── wrangler.jsonc
├── AMAN_CAREER_SYSTEM_EXPLAINED.md
└── README.md
```

### MCP tools (the contract)

The Worker exposes exactly **10** tools. The AI cannot delete records, send email through this layer, or operate outside this surface.

| Tool | Purpose |
|---|---|
| `get_settings` | Read live career-search rules |
| `find_opportunity` | Dedup lookup before create |
| `find_company` | Company history + cooldown |
| `find_contact` | Verified contacts only |
| `add_opportunity` | Create a qualified opportunity |
| `update_opportunity` | Update an existing opportunity |
| `upsert_company` | Create / update company |
| `upsert_contact` | Create / update verified contact |
| `record_search` | Log search / reject history |
| `record_contact` | Log **sent** outreach only (not drafts) |

### Database (Google Sheets)

| Tab | Stores |
|---|---|
| `OPPORTUNITIES` | Qualified, Needs Review, and rejected roles |
| `COMPANIES` | Company records + cooldown tracking |
| `CONTACTS` | Verified contacts with proof URLs |
| `CONTACT HISTORY` | Actual outreach log |
| `SEARCH HISTORY` | Search / reject / duplicate history |
| `SETTINGS` | Live rules (min salary, score, geography, cooldowns, …) |

---

## Automated vs human

| Task | Owner |
|---|---|
| Job search, scrape, monitor | Automated |
| Scoring, dedup, cooldowns | Automated |
| Contact verification from public pages | Automated |
| Resume selection | Automated |
| Gmail **draft** creation | Automated |
| **Sending** any email | **Human only** |
| Submitting applications | **Human only** |
| Replying to recruiters | **Human only** |
| Guessing contact emails | **Never** |

---

## Tech stack

| Component | Technology |
|---|---|
| MCP server | Cloudflare Workers (TypeScript) |
| MCP protocol | Streamable HTTP (`2026-07-28`) |
| Auth | OAuth 2.0 + PKCE (S256) + Bearer token |
| OAuth state | Cloudflare KV |
| Database API | Google Apps Script |
| Database | Google Sheets |
| Orchestration | Grok Automations (xAI) |
| Web intelligence | Firecrawl |
| Email | Gmail API (drafts only) |
| Tests | Vitest + `@cloudflare/vitest-plugin` |

---

## Prerequisites

- Node.js `>= 22.12.0`
- Cloudflare account + Wrangler
- Google Sheet with the six tabs above
- Deployed Google Apps Script web app (`Code.gs`)
- Secrets listed below

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/amansherjada/career-automation.git
cd career-automation
npm install
```

### 2. Configure local secrets

```bash
cp .dev.vars.example .dev.vars
```

Fill in:

| Secret | Purpose |
|---|---|
| `APPS_SCRIPT_SECRET` | Shared secret for Apps Script API auth |
| `MCP_AUTH_TOKEN` | Static bearer for tooling / verification |
| `OAUTH_APPROVAL_SECRET` | Required on the OAuth consent page |

Replace placeholders in `wrangler.jsonc` (do not commit real production values to a public repo if you can avoid it):

| Placeholder | Purpose |
|---|---|
| `APPS_SCRIPT_URL` | Deployed Apps Script `/exec` URL |
| `MCP_RESOURCE_URL` | Public MCP endpoint URL |
| `OAUTH_CLIENT_ID` | Grok OAuth public client id |
| `YOUR_OAUTH_KV_NAMESPACE_ID` | Cloudflare KV namespace id |
| `YOUR_OAUTH_KV_PREVIEW_ID` | Cloudflare KV preview id |

### 3. Configure Apps Script

1. Create the Google Sheet tabs listed above.
2. Paste `AppScript Code/Code.gs` into a Apps Script project bound to (or opening) that spreadsheet.
3. Set `CONFIG.SPREADSHEET_ID` to your Sheet ID (local Apps Script only — keep the repo placeholder).
4. Store `API_SECRET` in Script Properties (must match `APPS_SCRIPT_SECRET`).
5. Deploy as a Web App and put the `/exec` URL in `wrangler.jsonc` → `APPS_SCRIPT_URL` (or a Wrangler env/secret workflow).

### 4. Run locally

```bash
npm run dev
```

Health check: `GET /`  
MCP endpoint: `POST /mcp` (requires auth)

### 5. Test

```bash
npm test
```

Production smoke check (uses `.dev.vars`):

```bash
npm run verify:mcp
```

---

## Deploy (Cloudflare)

```bash
npx wrangler secret put APPS_SCRIPT_SECRET
npx wrangler secret put MCP_AUTH_TOKEN
npx wrangler secret put OAUTH_APPROVAL_SECRET
npm run deploy
```

After changing bindings in `wrangler.jsonc`:

```bash
npm run cf-typegen
```

Live MCP endpoint shape:

```text
https://<worker-name>.<subdomain>.workers.dev/mcp
```

---

## Security boundaries

This system is deliberately constrained:

- No auto-send Gmail
- No auto-submit applications
- No contact-email guessing
- No fabricated salary / location / work arrangement
- No duplicate creates (server-enforced)
- No cooldown bypass for Type B / Type C outreach
- No delete endpoints in the database API
- No secret leakage into MCP tool responses

Secrets must never be committed. `.dev.vars`, `.env*`, and `.wrangler/` are gitignored. Use Cloudflare Worker secrets in production.

---

## Scoring & rejection (system rules)

Opportunities that pass hard filters are scored out of **100** across 9 dimensions. Default qualification threshold: **≥ 75**.

Hard rejects use stable codes (`R01`–`R20`) — for example wrong geography, salary below minimum, UAE nationals only, expired listings, cooldown, and duplicates. Full tables are in the [system explanation](./AMAN_CAREER_SYSTEM_EXPLAINED.md).

---

## Documentation

| Document | Contents |
|---|---|
| [`AMAN_CAREER_SYSTEM_EXPLAINED.md`](./AMAN_CAREER_SYSTEM_EXPLAINED.md) | End-to-end product, architecture, scoring, rejection, auth, glossary |
| [`AGENTS.md`](./AGENTS.md) | Cloudflare Workers agent guidance for this repo |
| [`.dev.vars.example`](./.dev.vars.example) | Local secret template |

---

## Status

| Area | Status |
|---|---|
| Cloudflare Worker | Deployed |
| MCP endpoint | Live |
| OAuth 2.0 + PKCE | Active |
| Apps Script integration | Live |
| Local / OAuth test coverage | Passing |
| Human-in-the-loop enforcement | By design |

---

## Author

Built by **Aman Khan** — AI Automation Engineer, UAE.

> A system that automates the repetitive work so the skilled work gets more attention.
