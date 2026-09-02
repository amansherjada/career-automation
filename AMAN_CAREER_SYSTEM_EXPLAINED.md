# Aman Career Automation System — Complete Project Explanation

> What it is, why it exists, how it works, and every decision behind it.
> Written for anyone — technical or non-technical — to understand end to end.

---

## Table of Contents

1. The Problem
2. The Solution — What This System Is
3. The Philosophy Behind It
4. The Full Architecture
5. The Four Automations
6. The MCP Server — The Brain
7. Firecrawl — The Eyes
8. The Database
9. The Scoring Engine
10. The Rejection System
11. The Deduplication Engine
12. The Anti-Spam System
13. The Contact Verification Rules
14. The Resume Selection Logic
15. The Authentication Layer
16. The Daily Report
17. What Is Automated vs What Is Human
18. Security Boundaries
19. The Tech Stack
20. Test Results and Production Status
21. Glossary

---

---

## 1. The Problem

Job searching manually is repetitive, inconsistent, and error-prone.

Every day the same cycle repeats:
- Open job boards
- Search the same keywords
- Read dozens of listings
- Copy information into a spreadsheet
- Check if the company was already contacted
- Check when to follow up
- Write an outreach email from scratch
- Forget to follow up
- Lose track of what stage each application is at

This is not skilled work. It is administrative overhead that gets in the way of the actual skilled work — evaluating whether a role is genuinely right, writing a thoughtful email, preparing for an interview.

The existing "solutions" to this problem fall into two failure modes:

**Failure mode 1 — Too passive.** A spreadsheet with a status column. Still manual. Still inconsistent. Still forgetting things.

**Failure mode 2 — Too aggressive.** Bots that blast resumes to hundreds of companies automatically, send generic emails, optimise for volume over quality. This damages your professional reputation, gets your email address flagged as spam, and produces no useful signal about what is working.

Neither is acceptable.

---

## 2. The Solution — What This System Is

The Aman Career Automation System is a **production-grade, human-in-the-loop AI career operating system** built specifically for a UAE job search in AI and automation roles.

It automates every repetitive research and preparation task:
- Searching for jobs
- Scraping and reading full job descriptions
- Scoring each opportunity against a defined profile
- Checking for duplicates
- Verifying contacts
- Selecting the right resume
- Creating outreach email drafts
- Managing follow-ups
- Generating daily reports

It does **not** automate the decisions that matter:
- Sending any email
- Submitting any application
- Replying to recruiters

Every irreversible action stays under Aman's personal control.

The result: dramatically more consistent job search activity, zero missed follow-ups, zero duplicate outreach, and a complete daily picture of what is happening — with only the things that genuinely require human judgement left for the human.

---

## 3. The Philosophy Behind It

Three principles govern every design decision in this system.

**Principle 1 — Human controls the irreversible.**
Sending an email cannot be undone. Submitting an application cannot be undone. These actions have real consequences for professional reputation. The system prepares everything. The human decides what goes out.

**Principle 2 — Never guess. Never fabricate.**
If a salary is not published on the listing, the system does not assume it meets the minimum. If a contact's email is not findable on a public page, the system does not construct one from a name pattern. Guessing produces unreliable data that corrupts the entire pipeline downstream.

**Principle 3 — Fewer, better opportunities over more, worse ones.**
The system has no daily quota. If only 2 opportunities genuinely qualify today, 2 is the right answer. Inflating numbers by lowering standards defeats the purpose.

---

## 4. The Full Architecture

```
Aman (human)
    ↓
Grok Automations — 4 scheduled daily runs
    ↓
Firecrawl — web search, full page scraping, structured extraction, live monitoring
    ↓
Aman Career MCP Server (Cloudflare Worker)
    ↓  protected by OAuth 2.0 + PKCE and Bearer authentication
Google Apps Script — database API layer
    ↓
Google Sheets — career database (6 structured tabs)

Side integrations:
Google Drive → resume files
Gmail → draft creation and thread tracking
```

Every component has a single clear responsibility. Nothing overlaps. Nothing is redundant.

---

## 5. The Four Automations

Four Grok Automations run every day in sequence. Together they form a complete daily operating cycle.

---

### Automation 1 — Daily Hunter
**Runs at: 8:30 AM**

This is the discovery engine. It runs first, every morning, before anything else.

**What it does:**

Step 1 — Loads live settings from the MCP server. Every rule — minimum salary, minimum score, geography restrictions, cooldown periods — comes from a live database read, not hardcoded values. This means rules can be changed without touching the automation.

Step 2 — Reads Aman's career profile and all resume files from Google Drive. These are used for scoring and resume selection. No qualifications are invented.

Step 3 — Uses Firecrawl to search for current UAE job listings across AI and automation role families. Runs 10 targeted search queries covering different role titles and geographies. Collects all promising URLs.

Step 4 — For each promising URL, calls Firecrawl to scrape the full page content. Reads the complete job description — not a snippet. Maps the company careers page to find the official source. Attempts to extract contact information from the company's about or team page using structured extraction.

Step 5 — Runs a hard filter before scoring. Any listing that fails an absolute disqualifier (wrong geography, salary below minimum, too senior, UAE nationals only, expired) is immediately rejected with a specific rejection code. This saves scoring time on clear rejects.

Step 6 — Scores each surviving opportunity out of 100 using a 9-dimension formula. Only listings scoring 75 or above proceed.

Step 7 — Checks the MCP database for duplicates before creating anything. If the opportunity already exists, no duplicate is created.

Step 8 — Creates a Firecrawl monitor on every qualified listing URL. This means the system watches those pages 24/7 and knows immediately when anything changes — a salary is added, the listing closes, the JD is updated.

Step 9 — Creates database records for all new qualified opportunities.

Step 10 — Creates Gmail draft emails for opportunities that have a verified contact. Drafts are never sent automatically.

---

### Automation 2 — Recheck
**Runs at: 10:10 AM**

This automation processes all opportunities currently in "Needs Review" status — ones that partially qualified but had a specific unresolved issue, usually an unpublished salary or unverifiable work arrangement.

**What it does:**

First checks Firecrawl monitors. If any monitored page changed overnight, those are processed first — a salary may have been added, or the listing may have closed.

For each Needs Review opportunity, it re-scrapes the live page with Firecrawl, rechecks salary, location, work arrangement, and JD requirements against the current live content — not cached data. Rescores against the live profile.

Makes one of three decisions:
- **Promote to Qualified** — if everything now checks out
- **Reject** — if a hard disqualifier is now clearly confirmed
- **Leave as Needs Review** — if the specific uncertainty remains unresolved

Updates the database record accordingly. Never creates a new record. Never creates a draft. Read, evaluate, decide, update.

---

### Automation 3 — Follow-Ups
**Runs at: 11:20 AM**

This automation manages all due and overdue follow-ups on applications and outreach.

**What it does:**

Checks the MCP contact history and the War Room spreadsheet for items due today or overdue.

For each due item, it checks Gmail first to see if the company has already replied. If they have, the item is flagged as HUMAN HANDOFF — Aman needs to reply personally, no automation touches it.

If the role is still open (confirmed by a fresh Firecrawl scrape) and a verified email thread exists in Gmail, it creates a reply draft within that existing thread. Never a new cold email. Never a second outreach to someone who hasn't replied yet.

If no verified thread exists, it flags the item as MANUAL CHANNEL REQUIRED so Aman knows to handle it through another channel.

---

### Automation 4 — Daily Report
**Runs at: 6:20 PM**

This is the command centre summary. It is read-only — it creates nothing, sends nothing, changes nothing.

It reads the MCP database, the War Room spreadsheet, and Gmail, then produces a structured report covering:

- A scorecard with all day's numbers at a glance
- Every new qualified opportunity, ordered by score
- Every Needs Review item with the exact unresolved issue
- Every rejection, grouped by rejection code
- Monitor alerts — any page changes Firecrawl detected
- Pipeline changes for the day
- Gmail activity
- A prioritised action list — specific, actionable items only, with exact next steps

The action list is the most important section. It contains only things that genuinely require Aman's decision, ordered by urgency, with specific instructions like "send the ACME draft to careers@example.com" rather than vague suggestions like "review your drafts."

---

## 6. The MCP Server — The Brain

MCP stands for Model Context Protocol. It is an open standard that allows AI systems to interact with external tools and data sources in a structured, controllable way.

The Aman Career MCP server is a custom-built Cloudflare Worker that exposes exactly 10 career tools to the Grok automations. Nothing more, nothing less. Every database operation goes through these tools.

**Why this matters:** By constraining the AI to exactly 10 defined tools, the system is predictable. The AI cannot do things that aren't in the tool list. It cannot delete records, send emails through the database layer, or access data outside the defined scope. The tool list is the contract.

| Tool | What it does |
|---|---|
| `get_settings` | Reads all live career-search rules from the database |
| `find_opportunity` | Checks if an opportunity already exists — prevents duplicates |
| `find_company` | Checks company history and active cooldown status |
| `find_contact` | Retrieves verified contact information |
| `add_opportunity` | Creates a new qualified opportunity record |
| `update_opportunity` | Updates an existing opportunity (never duplicates) |
| `upsert_company` | Creates or updates company information |
| `upsert_contact` | Creates or updates verified contact information |
| `record_search` | Logs a search activity for history and deduplication |
| `record_contact` | Logs actual outreach — only after a human sends |

The MCP server is hosted at:
```
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/mcp
```

It is protected by bearer authentication. Unauthorised requests receive a 401 response. Secrets are stored as Cloudflare Worker secrets — never in source code.

---

## 7. Firecrawl — The Eyes

Firecrawl is the web intelligence layer. It handles everything related to reading the live web.

**Why Firecrawl instead of basic web search?**

Basic web search returns snippets — 150–200 word extracts from pages. This is enough to know a page exists, but not enough to:
- Read the full job description
- Find salary buried in the middle of a JD
- Confirm a listing is still accepting applications
- Extract a recruiter's contact details from a team page
- Know when a listing changes

Firecrawl gives the system full access to web content. The difference between scoring a job from a snippet and scoring it from the complete JD is significant — the system makes better decisions with more information.

**Tools used in this system:**

| Firecrawl Tool | Purpose in the system |
|---|---|
| `firecrawl_search` | Discovers job listings across UAE job sites |
| `firecrawl_developer_search` | Targeted technical role search |
| `firecrawl_scrape` | Extracts full content from job listing URLs |
| `firecrawl_map` | Maps a company careers site to find all openings |
| `firecrawl_parse` | Extracts structured data (name, email, title) from pages |
| `firecrawl_interact` | Handles pages that require JavaScript interaction |
| `firecrawl_monitor_create` | Creates a 24/7 watcher on a job listing page |
| `firecrawl_monitor_check` | Checks whether a monitored page has changed |

**The monitor system** is particularly valuable. When the Daily Hunter qualifies an opportunity but the salary is unpublished, it creates a Firecrawl monitor on that listing URL. The next time the Recheck automation runs, it checks that monitor first. If the company updated the listing with a salary overnight, the system knows immediately and can promote or reject the opportunity without waiting for Aman to check manually.

---

## 8. The Database

The career database lives in Google Sheets, structured into 6 tabs. Google Apps Script serves as the API layer between the MCP server and the Sheets data.

**Why Google Sheets?** It is readable, auditable, and editable by a human. Aman can open the spreadsheet at any time, see exactly what the system has recorded, and manually correct anything if needed. There is no black-box database.

**The 6 database tabs:**

| Tab | What it stores |
|---|---|
| OPPORTUNITIES | Every job opportunity — qualified, needs review, rejected |
| COMPANIES | Every company encountered — with cooldown tracking |
| CONTACTS | Every verified contact — name, email, source URL |
| CONTACT HISTORY | Every outreach attempt logged |
| SEARCH HISTORY | Every search run logged |
| SETTINGS | All live career-search rules |

**The SETTINGS tab** is the most important for daily operation. It controls every rule the automations follow. Changing a value here changes the behaviour of all four automations immediately — no code changes required.

Settings controlled here include:
- Minimum salary (AED 6,000/month)
- Minimum match score (75/100)
- Geography rules (all UAE, UAE-remote allowed, worldwide remote not allowed)
- Seniority rules (Junior/Mid allowed, Senior only if exceptional)
- Cooldown durations (60 days cold outreach, 90 days automation outreach)
- Maximum drafts per day (15)
- Contact guessing rule (NEVER)
- Auto-send rule (NEVER)

---

## 9. The Scoring Engine

Every opportunity that passes the hard filter is scored out of 100 across 9 dimensions. Only opportunities scoring 75 or above qualify for the database and draft creation.

Scoring happens against the **full scraped JD text** — not a search snippet.

| Dimension | Points | What it measures |
|---|---|---|
| A. Technical / functional match | 25 | Does Aman have real evidence of doing this specific type of work? |
| B. Production experience match | 20 | Has he built comparable systems in production, not just as exercises? |
| C. AI / automation career alignment | 15 | Does this role move his career in the right direction? |
| D. Experience / seniority fit | 10 | Is the role realistic for ~2 years of AI/automation experience? |
| E. Location / work arrangement | 10 | UAE-based, work arrangement explicitly confirmed? |
| F. Industry / company relevance | 5 | Is this a credible, relevant company in a relevant industry? |
| G. Evidence strength | 5 | Can a truthful, specific email be written using real resume evidence? |
| H. Freshness | 5 | Is this a current, actively accepting listing? |
| I. Contactability | 5 | Is there a verified, legitimate contact path? |

**Score bands and actions:**

| Score | Band | Action |
|---|---|---|
| 90–100 | Exceptional | Qualify — TOP TIER flag |
| 85–89 | Excellent | Qualify |
| 80–84 | Very strong | Qualify |
| 75–79 | Strong | Qualify if all other checks pass |
| 70–74 | Potential | Report only — do not qualify |
| 60–69 | Weak | Reject |
| Below 60 | Poor | Immediate reject |

**Important:** If Contactability (dimension I) scores 0, the opportunity still qualifies and appears in the report — but no draft is ever created. You cannot draft an email with no verified recipient.

---

## 10. The Rejection System

When an opportunity fails any check, it is rejected with a specific code. Codes are standardised so rejection patterns can be analysed over time.

| Code | Reason |
|---|---|
| R01 | Location outside UAE / not explicitly UAE-based remote |
| R02 | Published salary below AED 6,000/month |
| R03 | Mandatory seniority requirement too high |
| R04 | Pure ML research / model training from scratch |
| R05 | Pure sysadmin / helpdesk / networking, no AI component |
| R06 | Pure sales / business development |
| R07 | Poor technical fit (score too low on dimension A) |
| R08 | Poor career alignment (score too low on dimension C) |
| R09 | Expired listing / closed to applications (confirmed by scrape) |
| R10 | Company is unverifiable |
| R11 | Contact is unverifiable — but this alone does not reject the opportunity |
| R12 | Duplicate — already exists in the database |
| R13 | Company is within the outreach cooldown period |
| R14 | Mandatory qualification the candidate does not have |
| R15 | UAE National only |
| R16 | No evidence path for outreach |
| R17 | Suspicious or potentially fraudulent listing |
| R18 | Wrong remote geography (worldwide remote claimed as UAE-remote) |
| R19 | Completely unrelated role |
| R20 | Other — with specific reason noted |

Rejected records are never deleted. They remain in the database as a permanent log. This prevents the system from re-discovering and re-evaluating the same rejected opportunity repeatedly.

---

## 11. The Deduplication Engine

Before any new record is created, the system runs a duplicate check. This is mandatory — no exceptions.

There are 5 levels of duplicate detection:

| Level | Condition | Action |
|---|---|---|
| L1 | Exact same job URL | Merge — same listing |
| L2 | Same vacancy, different job board source | One record only |
| L3 | Probable same role, same JD content | Merge |
| L4 | Different vacancy, same company | Keep both — these are different openings |
| L5 | Different opportunity type at same company | Check cooldown |

Every opportunity, company, and contact gets a stable, permanent ID:
- Opportunities: `OPP-YYYYMMDD-####`
- Companies: `CMP-####`
- Contacts: `CON-####`

These IDs never change. They survive URL changes, source changes, and status changes. This means the system can always find an existing record even if the job listing moved from LinkedIn to the company's own website.

---

## 12. The Anti-Spam System

The system enforces strict limits on outreach to protect Aman's professional reputation.

**Cooldown periods:**
- Cold outreach to a company: 60-day cooldown after last contact
- Automation-initiated outreach: 90-day cooldown
- These are stored per company and enforced before any draft is created

**Draft limits:**
- Maximum 15 drafts created per day — regardless of how many opportunities qualify

**One draft per opportunity:**
- The system checks Gmail drafts before creating anything
- If a draft already exists for this opportunity, no second draft is created

**Draft ≠ Sent:**
- Creating a draft never sets Contacted = YES
- Contacted = YES only after a human manually sends
- record_contact is only logged after an actual send

**DO_NOT_CONTACT flag:**
- Any contact or company can be permanently flagged
- The system respects this flag unconditionally

---

## 13. The Contact Verification Rules

Contact verification is one of the strictest rules in the system.

**A contact is verified ONLY if:**
- A name or role is found on an actual public page
- An email address is explicitly present on that page
- A real source URL can be cited as proof

**Contact is NEVER verified by:**
- Constructing an email from a name pattern (e.g. john.smith@company.com)
- Inferring an email from a company domain
- Treating a LinkedIn profile URL as a verified email contact
- Saying "probably" or "likely" — only confirmed counts

**If no verified contact exists:**
- The opportunity still qualifies and is recorded
- No draft is created
- The opportunity appears in the report flagged "NO CONTACT — REPORT ONLY"
- Aman can find a contact manually and trigger a draft separately

Firecrawl's structured extraction tool (`firecrawl_parse`) is used to attempt contact extraction from company about and team pages. It searches for `{name, title, email}` — if an email is not explicitly on the page, the extraction returns nothing and no contact is created.

---

## 14. The Resume Selection Logic

Aman has 4 resumes in Google Drive, each targeting a different role type. The system selects the most appropriate one per opportunity.

| Situation | Resume selected |
|---|---|
| AI automation / agents / n8n / workflow / agentic AI | Aman_Khan_AI_Agent.pdf |
| AI developer / GenAI / LLM / full-stack AI | Aman_Khan_AI_Developer_Resume |
| IT officer / systems / support | Aman_Khan_IT_Officer_Resume |
| General UAE AI (doesn't fit above) | Aman Khan Resume UAE.pdf |

Only one resume is selected per opportunity. Multiple resumes are never attached to a single draft. If the correct resume file cannot be confirmed as attached, the draft notes `ATTACHMENT_REQUIRED: [filename]` for Aman to add manually.

---

## 15. The Authentication Layer

**Bearer Authentication — protects the MCP endpoint**

The `/mcp` endpoint requires a valid bearer token on every request. Requests without a token or with an invalid token receive a 401 Unauthorized response. The token (`MCP_AUTH_TOKEN`) is stored as a Cloudflare secret — it never appears in source code or configuration files.

**OAuth 2.0 + PKCE — allows Grok to connect**

Grok requires OAuth to connect to custom MCP servers. The Cloudflare Worker includes a complete OAuth implementation.

Configuration:
- Flow: Authorization Code
- PKCE: S256 (the more secure variant)
- Client type: Public (no client secret needed)
- Scope: mcp

The OAuth flow:
```
1. Grok sends an authorization request with a PKCE code challenge
2. Worker stores the OAuth state in Cloudflare KV
3. Worker shows Aman a consent page
4. Aman approves
5. Worker issues an authorization code
6. Grok exchanges the code + PKCE verifier for an access token
7. Grok uses the access token for all subsequent MCP requests
```

This means Aman explicitly authorized the connection, and the authorization can be revoked at any time. Cloudflare KV stores all OAuth state — clients, tokens, grants, consent.

---

## 16. The Daily Report

The 6:20 PM Daily Report is the output that Aman actually reads every day. It is produced by a read-only automation — it creates nothing, changes nothing, sends nothing.

The report has 7 sections:

**Scorecard** — A table of all day's numbers: jobs discovered, scraped, qualified, needs review, rejected, duplicates blocked, cooldown blocked, monitors created, monitor alerts, drafts created, emails sent (always 0 for automation), responses received, follow-ups due.

**New Qualified Opportunities** — Each qualified opportunity with company, role, location, salary, score, why Aman fits (1–2 specific evidence points), resume selected, contact details, draft status, monitor status, and Opportunity ID.

**Needs Review** — Each partially qualifying opportunity with the exact unresolved issue and what would resolve it.

**Rejected Today** — All rejections grouped by rejection code. Makes patterns visible.

**Monitor Alerts** — Any Firecrawl page changes detected today. A salary update on a Needs Review listing appears here.

**Pipeline Changes** — Any opportunity that changed status today.

**Gmail Activity** — Drafts created, emails Aman sent, responses received, threads needing attention.

**Action Required from Aman** — The most important section. Specific, prioritised, actionable items only. Ordered HIGH → MEDIUM → LOW. Each item has an exact next step. No vague suggestions.

**System Health** — Status of every component: MCP, War Room, Gmail, Firecrawl, and whether each automation ran successfully.

---

## 17. What Is Automated vs What Is Human

| Task | Who does it |
|---|---|
| Searching for jobs | Automated (Firecrawl) |
| Scraping full JD content | Automated (Firecrawl) |
| Monitoring listings for changes | Automated (Firecrawl) |
| Scoring opportunities | Automated (scoring engine) |
| Checking for duplicates | Automated (MCP dedup) |
| Checking cooldowns | Automated (MCP) |
| Verifying contacts from public pages | Automated (Firecrawl extract) |
| Selecting the right resume | Automated (matching logic) |
| Creating Gmail drafts | Automated (Gmail API) |
| Detecting company replies | Automated (Gmail search) |
| Preparing follow-up drafts | Automated (in existing threads) |
| Sending any email | **Human — Aman only** |
| Submitting any application | **Human — Aman only** |
| Replying to recruiters | **Human — Aman only** |
| Deciding to contact a new company | **Human — Aman only** |
| Guessing contact emails | **Never — nobody** |

---

## 18. Security Boundaries

The system deliberately does not do the following — and this is enforced at the prompt level, not just as a request:

- Auto-send Gmail
- Auto-submit job applications
- Guess, construct, or infer email addresses
- Invent salary, location, or work arrangement
- Create duplicate records
- Bypass cooldown periods
- Execute arbitrary Google Apps Script
- Delete any data
- Expose MCP_AUTH_TOKEN, APPS_SCRIPT_SECRET, OAUTH_APPROVAL_SECRET, or any API key
- Automatically message on LinkedIn or WhatsApp

Secrets are stored as Cloudflare Worker secrets. They are not in source code, not in wrangler.jsonc, not in any configuration file that could be accidentally committed to a public repository.

---

## 19. The Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Orchestration | Grok Automations (xAI) | 4 scheduled daily automations |
| Web intelligence | Firecrawl | Search, scrape, extract, monitor |
| MCP server | Cloudflare Workers (TypeScript) | Career tool API |
| MCP protocol | Streamable HTTP, 2026-07-28 spec | AI-to-tool communication |
| Authentication | OAuth 2.0 + PKCE (S256) | Grok authorization |
| Bearer auth | Cloudflare Worker secret | MCP endpoint protection |
| State storage | Cloudflare KV | OAuth state management |
| Database API | Google Apps Script | Business logic and Sheets access |
| Database | Google Sheets (6 tabs) | Career data store |
| Resumes | Google Drive | Resume files |
| Email | Gmail API | Draft creation only |

---

## 20. Test Results and Production Status

**Local MCP test suite:** 8/8 passed
- Healthy root response
- Unauthenticated MCP request → 401
- Invalid bearer token → 401
- CORS preflight without auth → allowed
- Modern MCP initialization
- tools/list → all 10 tools returned
- get_settings → live data returned
- Mixed legacy/modern handshake → correctly rejected

**OAuth implementation:** 16/16 passed

**TypeScript validation:** PASS

**Production verification:** PASS
- No secret leakage detected
- No unintended Sheets changes
- No emails sent during verification
- All 10 MCP tools verified live

**Current production status:**
- Cloudflare Worker: DEPLOYED AND LIVE
- MCP endpoint: LIVE
- OAuth + PKCE: ACTIVE
- Cloudflare KV: CONFIGURED
- Apps Script integration: LIVE
- Firecrawl connector: CONNECTED
- All 4 automations: ACTIVE
- Run history: 34 runs in last 30 days

---

## 21. Glossary

**MCP (Model Context Protocol)** — An open standard that lets AI systems interact with external tools and data in a structured, safe way. Like a controlled API contract between an AI and the outside world.

**Cloudflare Worker** — A serverless function that runs at Cloudflare's edge. Fast, globally distributed, no server to manage.

**OAuth 2.0 + PKCE** — An authorization standard that lets one application (Grok) access another (the MCP server) on behalf of a user, without the user sharing passwords. PKCE (Proof Key for Code Exchange) makes it more secure for public clients.

**Bearer Token** — A secret string used to authenticate API requests. The caller proves they are authorized by including the token in the request header.

**Cloudflare KV** — A key-value data store provided by Cloudflare. Used here to store OAuth state between authorization steps.

**Firecrawl** — A web scraping and data extraction service. Can search the web, scrape full page content, extract structured data, and monitor pages for changes.

**Grok Automations** — A scheduling and orchestration feature of Grok (xAI's AI assistant) that runs instructions on a defined schedule using connected tools and data sources.

**Human-in-the-loop** — A system design pattern where a human must approve or take action before any irreversible step occurs. The AI prepares; the human decides.

**Deduplication** — The process of detecting and preventing duplicate records. In this system, every opportunity is checked against the database before a new record is created.

**Cooldown** — A mandatory waiting period before the system can contact a company again. Prevents spamming the same recruiter.

**NEEDS REVIEW** — A status assigned to opportunities that partially qualify but have a specific unresolved issue, usually an unpublished salary or unverifiable work arrangement.

**Draft** — A Gmail email that has been prepared but not sent. Creating a draft does not mean the company has been contacted.

**record_contact** — The MCP tool that logs an actual outreach event. It is only called after a human manually sends an email — never when a draft is created.

---

*Built by Aman Khan — AI Automation Engineer, UAE*
*A system that automates the repetitive work so the skilled work gets more attention.*