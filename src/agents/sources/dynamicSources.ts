/**
 * Dynamic Source Generator — builds RSS feeds and Reddit sources at runtime
 * from the user's profile. No hardcoded sources needed. Change the profile,
 * the next pipeline run automatically hunts in the right places.
 */

import type { UserProfile, RSSFeedConfig, RedditSourceConfig } from "../../types";
import { logger } from "../../utils/logger";

// ─────────────────────────────────────────────
// RemoteOK supports category-based RSS:
//   https://remoteok.com/remote-{category}-jobs.rss
// Map profile keywords → RemoteOK category slugs
// ─────────────────────────────────────────────
const REMOTEOK_CATEGORY_MAP: [RegExp, string][] = [
  [/account|bookkeep|cpa|ledger/i, "accounting"],
  [/financ|invest|budget|forecast/i, "finance"],
  [/tax|audit|compliance/i, "accounting"],
  [/payroll|hr\b|human.resource/i, "hr"],
  [/software|developer|programming|engineer.*tech|full.?stack|front.?end|back.?end/i, "dev"],
  [/data.?sci|machine.learn|ml\b|ai\b|nlp/i, "data-science"],
  [/design|ui\b|ux\b|figma|graphic/i, "design"],
  [/market|seo|content|copywrite|social.media/i, "marketing"],
  [/sales|business.dev|crm/i, "sales"],
  [/legal|attorney|paralegal|contract.law/i, "legal"],
  [/civil.eng|structural|construction|architect/i, "engineering"],
  [/mech.*eng|manufacturing|cad\b|solidworks/i, "engineering"],
  [/writ|edit|journalism|content.creat/i, "writing"],
  [/customer.support|customer.service|helpdesk/i, "customer-support"],
  [/devops|sre|cloud|aws|gcp|azure|kubernetes|docker/i, "devops"],
  [/project.manag|scrum|agile|product.manag/i, "product"],
];

// ─────────────────────────────────────────────
// WeWorkRemotely category RSS feeds
// ─────────────────────────────────────────────
// WWR category feeds 301-redirect — disabled, using broad all-feed instead
const WWR_CATEGORIES: [RegExp, string, string][] = [];

// ─────────────────────────────────────────────
// Niche subreddit mapping
// ─────────────────────────────────────────────
// Only include subreddits that are actual job boards (not Q&A/discussion communities)
const NICHE_SUBREDDITS: [RegExp, string[]][] = [
  [/software|developer|programming|engineer/i, ["forhire"]],
  [/design|graphic|ui\b|ux\b/i, ["forhire"]],
  [/writ|content|copywrite/i, ["forhire"]],
  [/market|seo/i, ["forhire"]],
];

// ─────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────

export function generateDynamicSources(profile: UserProfile): {
  rss_feeds: RSSFeedConfig[];
  reddit_sources: RedditSourceConfig[];
} {
  const profileText = buildProfileText(profile);
  const keywords = extractKeywords(profile);

  const rss_feeds = buildRSSFeeds(profileText, profile);
  const reddit_sources = buildRedditSources(profileText, keywords);

  logger.info(`[DynamicSources] Profile: "${profile.title}" → ${rss_feeds.length} RSS feeds, ${reddit_sources.length} subreddits`);
  logger.info(`[DynamicSources] Keywords: ${keywords.slice(0, 8).join(", ")}`);

  return { rss_feeds, reddit_sources };
}

// ─────────────────────────────────────────────
// RSS feed builder
// ─────────────────────────────────────────────

function buildRSSFeeds(profileText: string, profile: UserProfile): RSSFeedConfig[] {
  const feeds: RSSFeedConfig[] = [];

  // Always include the broad all-remote feed
  feeds.push({
    name: "We Work Remotely - All",
    url: "https://weworkremotely.com/remote-jobs.rss",
    category: "remote",
    enabled: true,
    skill_hints: profile.skills.slice(0, 12),
  });

  // Match RemoteOK category feeds
  const matchedROK = new Set<string>();
  for (const [pattern, category] of REMOTEOK_CATEGORY_MAP) {
    if (pattern.test(profileText) && !matchedROK.has(category)) {
      matchedROK.add(category);
      feeds.push({
        name: `RemoteOK - ${category}`,
        url: `https://remoteok.com/remote-${category}-jobs.rss`,
        category,
        enabled: true,
        skill_hints: profile.skills.slice(0, 12),
      });
    }
  }

  // Cap at 6 feeds to avoid long pipeline runs
  return feeds.slice(0, 6);
}

// ─────────────────────────────────────────────
// Reddit source builder
// ─────────────────────────────────────────────

function buildRedditSources(profileText: string, keywords: string[]): RedditSourceConfig[] {
  // Hiring-intent words ensure we get job posts, not discussions
  const hiringIntent = ["hiring", "looking for", "need a", "need an", "want a", "seeking", "help wanted", "paying", "budget", "contract", "freelance", "$"];

  const sources: RedditSourceConfig[] = [
    {
      subreddit: "forhire",
      flairs: ["Hiring"],
      keyword_filter: keywords,
      limit: 25,
      enabled: true,
    },
    {
      subreddit: "slavelabour",
      flairs: [],
      keyword_filter: [...hiringIntent, ...keywords.slice(0, 8)],
      limit: 20,
      enabled: true,
    },
    {
      subreddit: "freelance",
      flairs: [],
      keyword_filter: keywords,
      limit: 20,
      enabled: true,
    },
  ];

  // Add niche subreddits based on profile
  const nicheAdded = new Set<string>();
  for (const [pattern, subs] of NICHE_SUBREDDITS) {
    if (pattern.test(profileText)) {
      for (const sub of subs) {
        if (!nicheAdded.has(sub)) {
          nicheAdded.add(sub);
          sources.push({
            subreddit: sub,
            flairs: [],
            keyword_filter: [
              ...hiringIntent,
              ...keywords.slice(0, 6),
            ],
            limit: 15,
            enabled: true,
          });
        }
      }
    }
  }

  // Cap at 7 subreddits
  return sources.slice(0, 7);
}

// ─────────────────────────────────────────────
// Keyword extraction from profile
// ─────────────────────────────────────────────

function extractKeywords(profile: UserProfile): string[] {
  const keywords = new Set<string>();

  // Title words (meaningful ones)
  profile.title.split(/[\s,&\/]+/).forEach((w) => {
    if (w.length > 2) keywords.add(w);
  });

  // All skills directly
  profile.skills.forEach((s) => keywords.add(s));

  // Niche keywords (whole phrases + split words)
  profile.niches.forEach((niche) => {
    keywords.add(niche);
    niche.split(/\s+/).forEach((w) => {
      if (w.length > 3) keywords.add(w);
    });
  });

  return [...keywords].slice(0, 25);
}

function buildProfileText(profile: UserProfile): string {
  return [
    profile.title,
    ...profile.niches,
    ...profile.skills,
    profile.bio,
  ].join(" ");
}
