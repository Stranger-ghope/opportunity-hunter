/**
 * Manual Input Agent — accepts pasted or imported job/opportunity data.
 * Supports: raw text paste, JSON array import, or single JSON object.
 *
 * Use via CLI: ts-node src/agents/sources/manualAgent.ts --text "Job posting..."
 * Or via the dashboard's manual input form.
 */

import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import type { Opportunity } from "../../types";
import { logger } from "../../utils/logger";
import { db } from "../../memory/database";

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Parse raw text and create an opportunity.
 */
export function ingestRawText(
  text: string,
  source = "manual:paste"
): Opportunity {
  const opp: Opportunity = {
    id: uuidv4(),
    title: extractTitle(text),
    source,
    url: extractUrl(text) || `manual:${uuidv4()}`,
    budget: extractBudget(text),
    skills: extractSkills(text),
    timestamp: new Date().toISOString(),
    raw_text: text.slice(0, 8000),
    status: "new",
  };

  db.upsertOpportunity(opp);
  logger.info(`[Manual Agent] Ingested: "${opp.title}" (${opp.id})`);
  return opp;
}

/**
 * Parse a JSON file containing an array of raw opportunity-like objects.
 * Each object needs at minimum: { title, description/raw_text }
 */
export function ingestJSONFile(filePath: string): Opportunity[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  let items: Record<string, unknown>[];

  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error(`Invalid JSON in file: ${filePath}`);
  }

  const results: Opportunity[] = [];

  for (const item of items) {
    const text = String(item.raw_text || item.description || item.body || "");
    const title = String(item.title || extractTitle(text));
    const url = String(item.url || item.link || `manual:${uuidv4()}`);

    if (db.opportunityExistsByUrl(url)) continue;

    const opp: Opportunity = {
      id: uuidv4(),
      title,
      source: String(item.source || "manual:json_import"),
      url,
      budget: String(item.budget || extractBudget(text)),
      skills: Array.isArray(item.skills) ? item.skills : extractSkills(text),
      timestamp: String(item.timestamp || item.date || new Date().toISOString()),
      raw_text: text.slice(0, 8000),
      status: "new",
      company: item.company ? String(item.company) : undefined,
    };

    db.upsertOpportunity(opp);
    results.push(opp);
  }

  logger.info(`[Manual Agent] Ingested ${results.length} opportunities from ${filePath}`);
  return results;
}

/**
 * Ingest a single structured opportunity object directly.
 * Used by the dashboard API.
 */
export function ingestStructured(data: {
  title: string;
  url?: string;
  budget?: string;
  skills?: string[];
  raw_text: string;
  source?: string;
}): Opportunity {
  const opp: Opportunity = {
    id: uuidv4(),
    title: data.title,
    source: data.source || "manual:dashboard",
    url: data.url || `manual:${uuidv4()}`,
    budget: data.budget || extractBudget(data.raw_text),
    skills: data.skills || extractSkills(data.raw_text),
    timestamp: new Date().toISOString(),
    raw_text: data.raw_text.slice(0, 8000),
    status: "new",
  };

  db.upsertOpportunity(opp);
  logger.info(`[Manual Agent] Structured ingest: "${opp.title}"`);
  return opp;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function extractTitle(text: string): string {
  // Use first non-empty line that looks like a title (short, not a URL)
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (line.length > 5 && line.length < 120 && !line.startsWith("http")) {
      return line;
    }
  }
  return "Pasted Opportunity";
}

function extractUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0] : "";
}

function extractBudget(text: string): string {
  const m = text.match(/\$[\d,]+(?:\s*[-–\/]\s*(?:hr|hour|month|mo))?\b/i);
  return m ? m[0].trim() : "";
}

function extractSkills(text: string): string[] {
  const SKILLS = [
    // Accounting & Finance
    "Bookkeeping", "Accounting", "Tax Preparation", "Tax Filing", "Payroll",
    "QuickBooks", "Xero", "Sage", "Wave", "FreshBooks", "NetSuite",
    "GAAP", "IFRS", "Audit", "CPA", "Financial Reporting",
    "Accounts Payable", "Accounts Receivable", "Bank Reconciliation",
    "Financial Analysis", "Budgeting", "Forecasting", "Cash Flow",
    "Balance Sheet", "Income Statement", "P&L", "CFO", "Controller",
    "Excel", "Google Sheets", "Financial Modeling", "Variance Analysis",
    // Tech (keep for general matching)
    "TypeScript", "JavaScript", "Python", "React", "Node.js",
    "SQL", "PostgreSQL", "Excel VBA", "Power BI", "Tableau",
  ];
  const lower = text.toLowerCase();
  return SKILLS.filter((s) => lower.includes(s.toLowerCase()));
}
