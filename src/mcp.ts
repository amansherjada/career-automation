import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./env";

type JsonObject = Record<string, unknown>;

const SENSITIVE_RESPONSE_KEYS = new Set([
  "apiKey",
  "api_key",
  "APPS_SCRIPT_SECRET",
  "MCP_AUTH_TOKEN",
  "appsScriptSecret",
  "mcpAuthToken",
  "authorization",
  "Authorization",
]);

function sanitizeForClient(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForClient(item));
  }

  if (value && typeof value === "object") {
    const input = value as JsonObject;
    const output: JsonObject = {};

    for (const [key, nested] of Object.entries(input)) {
      if (SENSITIVE_RESPONSE_KEYS.has(key)) {
        continue;
      }
      output[key] = sanitizeForClient(nested);
    }

    return output;
  }

  return value;
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(sanitizeForClient(data), null, 2),
      },
    ],
  };
}

/**
 * Calls the already-tested Google Apps Script database API.
 *
 * IMPORTANT:
 * - APPS_SCRIPT_SECRET never goes to Grok.
 * - Grok only sees the MCP tool inputs/outputs.
 */
async function callDatabase(
  env: Env,
  action: string,
  payload: JsonObject = {},
): Promise<JsonObject> {
  const response = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey: env.APPS_SCRIPT_SECRET,
      action,
      ...payload,
    }),
  });

  const raw = await response.text();

  let data: JsonObject;

  try {
    data = JSON.parse(raw) as JsonObject;
  } catch {
    throw new Error(
      `Database API returned non-JSON response (${response.status}).`,
    );
  }

  if (!response.ok || data.ok === false) {
    throw new Error(
      String(data.error ?? `Database API error (${response.status}).`),
    );
  }

  return sanitizeForClient(data) as JsonObject;
}

/**
 * Create a fresh stateless MCP server for each request.
 *
 * This is the current Cloudflare-recommended pattern.
 */
function createServer(env: Env) {
  const server = new McpServer({
    name: "Aman Career Database",
    version: "1.0.0",
  });

  // ==========================================================
  // SETTINGS
  // ==========================================================

  server.registerTool(
    "get_settings",
    {
      description:
        "Read the current AMAN career automation settings from the Google Sheet. " +
        "Use this before making search, qualification, outreach, or cooldown decisions. " +
        "This tool is read-only.",
      inputSchema: {},
    },
    async () => {
      const result = await callDatabase(
        env,
        "get_settings",
      );

      return textResult(result);
    },
  );

  // ==========================================================
  // OPPORTUNITY LOOKUP
  // ==========================================================

  server.registerTool(
    "find_opportunity",
    {
      description:
        "Search the opportunity database for an existing opportunity. " +
        "Use this BEFORE recording a job so duplicate jobs are not created. " +
        "Search by opportunityId, jobUrl, or company + jobTitle.",
      inputSchema: {
        opportunityId: z
          .string()
          .optional()
          .describe("Existing Opportunity ID if known."),
        jobUrl: z
          .string()
          .url()
          .optional()
          .describe("Canonical job URL if known."),
        company: z
          .string()
          .optional()
          .describe("Company name."),
        jobTitle: z
          .string()
          .optional()
          .describe("Exact or near-exact job title."),
      },
    },
    async (input) => {
      const result = await callDatabase(
        env,
        "find_opportunity",
        input,
      );

      return textResult(result);
    },
  );

  // ==========================================================
  // COMPANY LOOKUP
  // ==========================================================

  server.registerTool(
    "find_company",
    {
      description:
        "Look up a company in the career opportunity database. " +
        "Use this before Type B or Type C outreach to check previous contact, " +
        "cooldown, relationship status, and company information.",
      inputSchema: {
        company: z
          .string()
          .optional()
          .describe("Company name."),
        website: z
          .string()
          .url()
          .optional()
          .describe("Official company website."),
      },
    },
    async (input) => {
      const result = await callDatabase(
        env,
        "find_company",
        input,
      );

      return textResult(result);
    },
  );

  // ==========================================================
  // CONTACT LOOKUP
  // ==========================================================

  server.registerTool(
    "find_contact",
    {
      description:
        "Look up previously verified contacts. " +
        "Never guess an email address. Prefer a named recruiter, hiring manager, " +
        "technical lead, official careers email, official HR email, or verified generic company contact.",
      inputSchema: {
        email: z
          .string()
          .email()
          .optional()
          .describe("Email address if known."),
        company: z
          .string()
          .optional()
          .describe("Company name."),
        contactName: z
          .string()
          .optional()
          .describe("Contact's name."),
      },
    },
    async (input) => {
      const result = await callDatabase(
        env,
        "find_contact",
        input,
      );

      return textResult(result);
    },
  );

  // ==========================================================
  // ADD OPPORTUNITY
  // ==========================================================

  server.registerTool(
    "add_opportunity",
    {
      description:
        "Add ONE qualified opportunity to the database. " +
        "Use only after researching and qualifying the opportunity. " +
        "The database enforces minimum match score, duplicate protection, " +
        "company cooldowns, and verified-contact rules. " +
        "This does NOT send email and does NOT create a Gmail draft.",
      inputSchema: {
        opportunityId: z
          .string()
          .describe("Unique stable opportunity ID."),
        dateFound: z
          .string()
          .describe("Date found in ISO format, e.g. 2026-08-27."),
        company: z
          .string()
          .describe("Company name."),
        opportunityType: z
          .enum(["Type A", "Type B", "Type C"])
          .describe(
            "Type A = active job; Type B = speculative employment; Type C = AI/automation business opportunity.",
          ),
        jobTitle: z
          .string()
          .describe("Job title or opportunity title."),
        location: z
          .string()
          .describe("UAE location."),
        workArrangement: z
          .string()
          .describe("On-site, Hybrid, Remote, or UAE Remote."),
        jobUrl: z
          .string()
          .url()
          .describe("Verified job/opportunity URL."),
        companyUrl: z
          .string()
          .url()
          .optional()
          .describe("Official company website."),
        source: z
          .string()
          .describe("Where the opportunity was found."),
        datePosted: z
          .string()
          .optional()
          .describe("Posting date if verified."),
        contactName: z
          .string()
          .optional()
          .describe("Verified contact name."),
        contactRole: z
          .string()
          .optional()
          .describe("Verified contact role."),
        contactEmail: z
          .string()
          .email()
          .optional()
          .describe("Verified contact email only. Never guess."),
        resumeSelected: z
          .string()
          .optional()
          .describe("Exact resume filename selected."),
        matchScore: z
          .number()
          .min(0)
          .max(100)
          .describe("Overall match score."),
        technicalMatch: z
          .string()
          .optional(),
        experienceMatch: z
          .string()
          .optional(),
        locationMatch: z
          .string()
          .optional(),
        industryMatch: z
          .string()
          .optional(),
        whyAmanFits: z
          .string()
          .describe("Specific evidence-based explanation."),
        evidence: z
          .string()
          .describe("Evidence supporting the opportunity and match."),
        status: z
          .string()
          .optional(),
        draftCreated: z
          .string()
          .optional(),
        contacted: z
          .string()
          .optional(),
        contactDate: z
          .string()
          .optional(),
        cooldownUntil: z
          .string()
          .optional(),
        notes: z
          .string()
          .optional(),
      },
    },
    async (input) => {
      const result = await callDatabase(
        env,
        "add_opportunity",
        input,
      );

      return textResult(result);
    },
  );

  // ==========================================================
  // UPDATE OPPORTUNITY
  // ==========================================================

  server.registerTool(
    "update_opportunity",
    {
      description:
        "Update an existing opportunity by Opportunity ID. " +
        "Use this to record changes such as selected resume, status, Gmail draft creation, " +
        "contact information, notes, or other database fields. " +
        "This does NOT send email.",
      inputSchema: {
        opportunityId: z
          .string()
          .describe("Existing Opportunity ID."),
        dateFound: z.string().optional(),
        company: z.string().optional(),
        opportunityType: z
          .enum(["Type A", "Type B", "Type C"])
          .optional(),
        jobTitle: z.string().optional(),
        location: z.string().optional(),
        workArrangement: z.string().optional(),
        jobUrl: z.string().url().optional(),
        companyUrl: z.string().url().optional(),
        source: z.string().optional(),
        datePosted: z.string().optional(),
        contactName: z.string().optional(),
        contactRole: z.string().optional(),
        contactEmail: z.string().email().optional(),
        resumeSelected: z.string().optional(),
        matchScore: z.number().min(0).max(100).optional(),
        technicalMatch: z.string().optional(),
        experienceMatch: z.string().optional(),
        locationMatch: z.string().optional(),
        industryMatch: z.string().optional(),
        whyAmanFits: z.string().optional(),
        evidence: z.string().optional(),
        status: z.string().optional(),
        draftCreated: z.string().optional(),
        contacted: z.string().optional(),
        contactDate: z.string().optional(),
        cooldownUntil: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (input) => {
      const result = await callDatabase(
        env,
        "update_opportunity",
        input,
      );

      return textResult(result);
    },
  );

  // ==========================================================
  // COMPANY UPSERT
  // ==========================================================

  server.registerTool(
    "upsert_company",
    {
      description:
        "Create or update a company record. " +
        "Use this to maintain company research, previous-contact status, cooldowns, and relationship state.",
      inputSchema: {
        company: z.string(),
        website: z.string().url().optional(),
        industry: z.string().optional(),
        uaeLocations: z.string().optional(),
        companyType: z.string().optional(),
        contactedBefore: z.string().optional(),
        lastContactDate: z.string().optional(),
        cooldownUntil: z.string().optional(),
        response: z.string().optional(),
        relationshipStatus: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (input) => {
      const result = await callDatabase(
        env,
        "upsert_company",
        input,
      );

      return textResult(result);
    },
  );

  // ==========================================================
  // CONTACT UPSERT
  // ==========================================================

  server.registerTool(
    "upsert_contact",
    {
      description:
        "Create or update a verified contact. " +
        "Never invent or guess email addresses. " +
        "A verification URL and verification date are mandatory.",
      inputSchema: {
        company: z.string(),
        contactName: z.string(),
        position: z.string().optional(),
        email: z.string().email(),
        source: z.string(),
        verificationUrl: z.string().url(),
        contactType: z.enum([
          "Named Recruiter",
          "Hiring Manager",
          "Technical/Department Lead",
          "Careers",
          "HR",
          "Generic Company Contact",
          "Other",
        ]),
        dateVerified: z.string(),
        notes: z.string().optional(),
      },
    },
    async (input) => {
      const result = await callDatabase(
        env,
        "upsert_contact",
        input,
      );

      return textResult(result);
    },
  );

  // ==========================================================
  // SEARCH HISTORY
  // ==========================================================

  server.registerTool(
    "record_search",
    {
      description:
        "Record a search result in SEARCH HISTORY. " +
        "Use this to preserve research history, rejected opportunities, duplicates, and sources.",
      inputSchema: {
        date: z.string(),
        company: z.string().optional(),
        job: z.string().optional(),
        url: z.string().url().optional(),
        searchCategory: z.string(),
        result: z.string(),
        reasonRejected: z.string().optional(),
        duplicateOf: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (input) => {
      const result = await callDatabase(
        env,
        "record_search",
        input,
      );

      return textResult(result);
    },
  );

  // ==========================================================
  // CONTACT HISTORY
  // ==========================================================

  server.registerTool(
    "record_contact",
    {
      description:
        "Record an actual outreach event in CONTACT HISTORY. " +
        "Only use this after an email has genuinely been sent. " +
        "Creating a Gmail draft is NOT the same as sending.",
      inputSchema: {
        company: z.string(),
        contact: z.string(),
        email: z.string().email(),
        opportunity: z.string(),
        emailType: z.string(),
        dateSent: z.string().optional(),
        response: z.string().optional(),
        followUpDate: z.string().optional(),
        result: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (input) => {
      const result = await callDatabase(
        env,
        "record_contact",
        input,
      );

      return textResult(result);
    },
  );

  return server;
}

export { createServer };