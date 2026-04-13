/**
 * RSS Source Agent — ingests job feeds from RSS/Atom endpoints.
 * Converts raw feed items into raw Opportunity objects for normalization.
 */

import Parser from "rss-parser";
import { v4 as uuidv4 } from "uuid";
import type { Opportunity, RSSFeedConfig } from "../../types";
import { logger } from "../../utils/logger";
import { db } from "../../memory/database";

interface CustomItem {
  title?: string;
  link?: string;
  content?: string;
  contentSnippet?: string;
  pubDate?: string;
  creator?: string;
  categories?: string[];
}

const parser = new Parser<Record<string, unknown>, CustomItem>({
  customFields: {
    item: ["content", "contentSnippet", "categories", "creator"],
  },
  timeout: 15_000,
  headers: {
    "User-Agent": "OpportunityHunterBot/1.0 (+https://github.com/yourusername/opportunity-hunter)",
  },
});

export async function runRSSAgent(feeds: RSSFeedConfig[]): Promise<Opportunity[]> {
  const results: Opportunity[] = [];
  const enabledFeeds = feeds.filter((f) => f.enabled);

  logger.info(`[RSS Agent] Processing ${enabledFeeds.length} feeds`);

  for (const feed of enabledFeeds) {
    try {
      logger.debug(`[RSS Agent] Fetching: ${feed.name} — ${feed.url}`);
      const parsed = await parser.parseURL(feed.url);

      let newCount = 0;
      for (const item of parsed.items) {
        const url = item.link || "";

        // Skip if already in DB
        if (url && db.opportunityExistsByUrl(url)) continue;

        const rawText = [
          item.title || "",
          item.contentSnippet || item.content || "",
        ]
          .join("\n\n")
          .slice(0, 5000);

        const opp: Opportunity = {
          id: uuidv4(),
          title: item.title || "Untitled",
          source: `rss:${feed.name}`,
          url,
          budget: extractBudget(rawText),
          skills: extractSkillHints(rawText, feed.skill_hints),
          timestamp: item.pubDate || new Date().toISOString(),
          raw_text: rawText,
          status: "new",
          company: item.creator,
          tags: item.categories,
        };

        results.push(opp);
        newCount++;
      }
      logger.info(`[RSS Agent] ${feed.name}: ${newCount} new opportunities`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[RSS Agent] Failed to fetch ${feed.name}: ${msg}`);
    }
  }

  logger.info(`[RSS Agent] Total new: ${results.length}`);
  return results;
}

// ─────────────────────────────────────────────
// Heuristic extraction helpers
// ─────────────────────────────────────────────

function extractBudget(text: string): string {
  // Match patterns like $500, $50/hr, $1,000–$5,000, 0.5 ETH, etc.
  const patterns = [
    /\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*\/\s*(?:hr|hour|mo|month))?/i,
    /(?:budget|rate|pay|compensation|salary)[:\s]*\$?[\d,]+/i,
    /[\d.]+\s*ETH/i,
    /[\d,]+\s*USDC/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return "";
}

function extractSkillHints(text: string, hints?: string[]): string[] {
  const KNOWN_SKILLS = [
    // Finance & Accounting
    "Bookkeeping", "Accounting", "QuickBooks", "Xero", "Sage", "Wave",
    "GAAP", "IFRS", "Payroll", "Tax", "Audit", "CPA", "CFO",
    "Accounts Payable", "Accounts Receivable", "Financial Reporting",
    "Financial Analysis", "Budgeting", "Forecasting", "Excel",
    // Engineering & Technical
    "AutoCAD", "SolidWorks", "Civil", "Structural", "Mechanical",
    // Tech
    "TypeScript", "JavaScript", "Python", "Rust", "Go", "Solidity",
    "React", "Next.js", "Vue", "Node.js", "Express", "GraphQL",
    "Docker", "Kubernetes", "AWS", "GCP", "PostgreSQL", "MongoDB",
    "Web3", "Ethereum", "DeFi", "AI", "ML", "LLM", "SQL",
  ];

  const combined = [...KNOWN_SKILLS, ...(hints || [])];
  const lower = text.toLowerCase();
  return combined.filter((skill) => lower.includes(skill.toLowerCase()));
}
