/**
 * Normalization Agent — receives raw opportunities from all source agents
 * and ensures they conform to the canonical Opportunity schema.
 *
 * This agent also deduplicates, enriches metadata, and filters out
 * opportunities that match the user's avoid keywords.
 */

import type { Opportunity, UserProfile } from "../types";
import { logger } from "../utils/logger";
import { db } from "../memory/database";

/**
 * Normalize and persist a batch of raw opportunities.
 * Returns only net-new, clean opportunities.
 */
export function runNormalizationAgent(
  rawOpportunities: Opportunity[],
  profile: UserProfile
): Opportunity[] {
  const results: Opportunity[] = [];
  let filtered = 0;
  let duplicates = 0;

  const MAX_AGE_DAYS = 14;
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let stale = 0;

  const total = rawOpportunities.length;
  for (let idx = 0; idx < total; idx++) {
    const raw = rawOpportunities[idx];
    if (idx > 0 && idx % 25 === 0) {
      logger.info(`[Normalizer] Progress: ${idx}/${total} processed...`);
    }

    // 1. Skip stale opportunities (older than 14 days)
    const dateStr = raw.timestamp;
    if (dateStr) {
      const posted = new Date(dateStr).getTime();
      if (!isNaN(posted) && posted < cutoff) {
        stale++;
        continue;
      }
    }

    // 2. Skip if URL already exists in DB
    if (raw.url && raw.url.startsWith("http") && db.opportunityExistsByUrl(raw.url)) {
      duplicates++;
      continue;
    }

    const titleLower = raw.title.toLowerCase();

    // 3. For Reddit sources, require hiring-intent signals in title
    if (raw.source?.startsWith("reddit:")) {
      const HIRING_SIGNALS = ["hiring", "looking for", "need a", "need an", "want a", "seeking", "help wanted", "paying", "[for hire]", "[hiring]", "budget", "freelancer needed", "contractor needed"];
      const hasHiringIntent = HIRING_SIGNALS.some((s) => titleLower.includes(s));
      if (!hasHiringIntent) {
        filtered++;
        continue;
      }
    }

    // 4. Apply avoid-keyword filter (word-boundary match to prevent "intern" matching "internal")
    const hitAvoidWord = profile.avoid_keywords.some((kw) => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "i");
      return pattern.test(titleLower);
    });
    if (hitAvoidWord) {
      logger.debug(`[Normalizer] Filtered (avoid keyword): ${raw.title}`);
      filtered++;
      continue;
    }

    // 3. Clean and enrich
    const normalized: Opportunity = {
      ...raw,
      title: cleanText(raw.title),
      budget: normalizeBudget(raw.budget || ""),
      skills: dedupeSkills(raw.skills || []),
      timestamp: normalizeDate(raw.timestamp),
      raw_text: raw.raw_text.trim(),
      normalized_at: new Date().toISOString(),
      status: "new",
      remote: detectRemote(raw.raw_text),
      tags: buildTags(raw),
    };

    // 4. Persist to DB
    db.upsertOpportunity(normalized);
    results.push(normalized);
  }

  logger.info(
    `[Normalizer] ${results.length} normalized | ${duplicates} duplicates | ${filtered} filtered | ${stale} stale (>14d)`
  );
  return results;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E\n]/g, "")
    .trim()
    .slice(0, 200);
}

function normalizeBudget(budget: string): string {
  if (!budget) return "";
  // Trim and normalize currency symbols
  return budget.replace(/\s+/g, " ").trim();
}

function dedupeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  return skills.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function detectRemote(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("remote") ||
    lower.includes("work from home") ||
    lower.includes("wfh") ||
    lower.includes("worldwide") ||
    lower.includes("anywhere")
  );
}

function buildTags(opp: Opportunity): string[] {
  const tags = new Set<string>(opp.tags || []);
  const lower = (opp.title + " " + opp.raw_text).toLowerCase();

  if (lower.includes("urgent") || lower.includes("asap") || lower.includes("immediately")) {
    tags.add("urgent");
  }
  if (lower.includes("long-term") || lower.includes("ongoing") || lower.includes("retainer")) {
    tags.add("long_term");
  }
  if (lower.includes("web3") || lower.includes("blockchain") || lower.includes("defi")) {
    tags.add("web3");
  }
  if (lower.includes("ai") || lower.includes("llm") || lower.includes("machine learning")) {
    tags.add("ai_related");
  }
  if (lower.includes("bounty")) {
    tags.add("bounty");
  }
  if (lower.includes("bookkeep") || lower.includes("quickbooks") || lower.includes("xero") ||
      lower.includes("accounting") || lower.includes("accounts payable") || lower.includes("accounts receivable")) {
    tags.add("bookkeeping");
  }
  if (lower.includes("tax") || lower.includes("cpa") || lower.includes("irs") || lower.includes("filing")) {
    tags.add("tax");
  }
  if (lower.includes("payroll") || lower.includes("salary") || lower.includes("compensation")) {
    tags.add("payroll");
  }
  if (lower.includes("cfo") || lower.includes("controller") || lower.includes("financial analysis") ||
      lower.includes("financial planning") || lower.includes("budgeting") || lower.includes("forecasting")) {
    tags.add("finance");
  }
  if (lower.includes("audit") || lower.includes("compliance") || lower.includes("gaap") || lower.includes("ifrs")) {
    tags.add("audit");
  }

  return [...tags];
}
