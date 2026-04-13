/**
 * Reddit Source Agent — uses the official Reddit JSON API (no auth required for public posts).
 * Respects rate limits and filters by keyword/flair.
 */

import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import type { Opportunity, RedditSourceConfig } from "../../types";
import { logger } from "../../utils/logger";
import { db } from "../../memory/database";

interface RedditPost {
  data: {
    id: string;
    title: string;
    url: string;
    selftext: string;
    permalink: string;
    link_flair_text?: string;
    created_utc: number;
    author: string;
    score: number;
    is_self: boolean;
  };
}

interface RedditListingResponse {
  data: {
    children: RedditPost[];
  };
}

// Reddit's public JSON API — no OAuth needed for public subs
const REDDIT_BASE = "https://www.reddit.com";

// Track last fetch time per subreddit to avoid re-processing
const lastFetchTimes: Map<string, number> = new Map();

export async function runRedditAgent(
  sources: RedditSourceConfig[]
): Promise<Opportunity[]> {
  const results: Opportunity[] = [];
  const enabledSources = sources.filter((s) => s.enabled);

  logger.info(`[Reddit Agent] Processing ${enabledSources.length} subreddits`);

  for (const source of enabledSources) {
    try {
      const opps = await fetchSubreddit(source);
      results.push(...opps);
      // Polite delay between subreddits
      await sleep(1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Reddit Agent] r/${source.subreddit} failed: ${msg}`);
    }
  }

  logger.info(`[Reddit Agent] Total new: ${results.length}`);
  return results;
}

async function fetchSubreddit(source: RedditSourceConfig): Promise<Opportunity[]> {
  const url = `${REDDIT_BASE}/r/${source.subreddit}/new.json`;
  const limit = source.limit ?? 25;

  const response = await axios.get<RedditListingResponse>(url, {
    params: { limit, t: "week" },
    headers: {
      "User-Agent":
        process.env.REDDIT_USER_AGENT ||
        "OpportunityHunterBot/1.0",
    },
    timeout: 15_000,
  });

  const posts = response.data.data.children;
  const results: Opportunity[] = [];
  let newCount = 0;

  for (const post of posts) {
    const { data } = post;
    const postUrl = `https://www.reddit.com${data.permalink}`;

    // Skip if already seen
    if (db.opportunityExistsByUrl(postUrl)) continue;

    // Flair filter
    if (source.flairs && source.flairs.length > 0) {
      const flair = data.link_flair_text || "";
      if (!source.flairs.some((f) => flair.toLowerCase().includes(f.toLowerCase()))) {
        continue;
      }
    }

    // Keyword filter
    if (source.keyword_filter && source.keyword_filter.length > 0) {
      const combined = `${data.title} ${data.selftext}`.toLowerCase();
      const matches = source.keyword_filter.some((kw) =>
        combined.includes(kw.toLowerCase())
      );
      if (!matches) continue;
    }

    const rawText = `${data.title}\n\n${data.selftext}`.slice(0, 5000);

    const opp: Opportunity = {
      id: uuidv4(),
      title: data.title,
      source: `reddit:r/${source.subreddit}`,
      url: postUrl,
      budget: extractBudget(rawText),
      skills: extractSkills(rawText),
      timestamp: new Date(data.created_utc * 1000).toISOString(),
      raw_text: rawText,
      status: "new",
      tags: data.link_flair_text ? [data.link_flair_text] : [],
    };

    results.push(opp);
    newCount++;
  }

  lastFetchTimes.set(source.subreddit, Date.now());
  logger.info(`[Reddit Agent] r/${source.subreddit}: ${newCount} new`);
  return results;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function extractBudget(text: string): string {
  const patterns = [
    /\$[\d,]+(?:\s*[-–\/]\s*(?:hr|hour|month|mo))?\b/i,
    /(?:paying|budget|rate|compensation)[:\s]*\$?[\d,]+/i,
    /[\d.]+\s*ETH\b/i,
    /[\d,]+\s*USDC\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].trim();
  }
  return "";
}

function extractSkills(text: string): string[] {
  const SKILLS = [
    // Finance & Accounting
    "Bookkeeping", "Accounting", "QuickBooks", "Xero", "Sage", "Wave",
    "GAAP", "IFRS", "Payroll", "Tax", "Audit", "CPA", "CFO",
    "Accounts Payable", "Accounts Receivable", "Financial Reporting",
    "Financial Analysis", "Budgeting", "Forecasting", "Excel",
    "Financial Modeling", "NetSuite", "FreshBooks",
    // Engineering
    "AutoCAD", "SolidWorks", "Civil Engineering", "Structural",
    // Tech
    "TypeScript", "JavaScript", "Python", "Rust", "Go", "Solidity",
    "React", "Next.js", "Vue", "Node.js", "GraphQL", "REST",
    "Docker", "AWS", "Web3", "Ethereum", "DeFi", "AI", "ML", "LLM", "SQL",
  ];
  const lower = text.toLowerCase();
  return SKILLS.filter((s) => lower.includes(s.toLowerCase()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
