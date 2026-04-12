/**
 * Scoring Agent — LLM-powered opportunity evaluation.
 *
 * Uses Qwen3.5 (via Nosana) to score each opportunity on 5 dimensions.
 * Includes a self-improvement loop: past feedback adjusts scoring context.
 */

import type {
  Opportunity,
  UserProfile,
  ScoringResult,
  FeedbackInsights,
} from "../types";
import { llmClient } from "../llm/client";
import {
  buildScoringSystemPrompt,
  buildScoringUserPrompt,
} from "../prompts/scoring";
import { db } from "../memory/database";
import { logger } from "../utils/logger";

interface RawScoringOutput {
  score: number;
  breakdown: {
    skill_match: number;
    budget_quality: number;
    urgency_signals: number;
    competition_likelihood: number;
    relevance: number;
  };
  reasoning: string;
  flags: string[];
}

export async function runScoringAgent(
  opportunity: Opportunity,
  profile: UserProfile,
  insights: FeedbackInsights | null = null
): Promise<ScoringResult> {
  logger.debug(`[Scorer] Scoring: "${opportunity.title}"`);

  const systemPrompt = buildScoringSystemPrompt();
  const userPrompt = buildScoringUserPrompt(opportunity, profile, insights);

  try {
    const raw = await llmClient.completeJSON<RawScoringOutput>({
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      temperature: 0.2, // Low temp for consistent scoring
      max_tokens: 512,
    });

    // Clamp and validate all scores
    const breakdown = {
      skill_match: clamp(raw.breakdown?.skill_match ?? 0, 0, 25),
      budget_quality: clamp(raw.breakdown?.budget_quality ?? 0, 0, 20),
      urgency_signals: clamp(raw.breakdown?.urgency_signals ?? 0, 0, 15),
      competition_likelihood: clamp(raw.breakdown?.competition_likelihood ?? 0, 0, 20),
      relevance: clamp(raw.breakdown?.relevance ?? 0, 0, 20),
    };

    // Recalculate total from breakdown (prevents hallucinated totals)
    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);

    const result: ScoringResult = {
      opportunity_id: opportunity.id,
      score,
      breakdown,
      reasoning: raw.reasoning || "No reasoning provided.",
      flags: Array.isArray(raw.flags) ? raw.flags : [],
    };

    // Persist score back to the opportunity
    const updated: Opportunity = {
      ...opportunity,
      score,
      score_breakdown: breakdown,
      score_reasoning: result.reasoning,
      status: "scored",
      tags: [...new Set([...(opportunity.tags || []), ...result.flags])],
    };

    db.upsertOpportunity(updated);

    logger.info(`[Scorer] "${opportunity.title}" → ${score}/100 (${result.flags.join(", ")})`);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Scorer] Failed for "${opportunity.title}": ${msg}`);

    // Graceful degradation — fallback heuristic score
    return heuristicScore(opportunity, profile);
  }
}

/**
 * Score a batch of opportunities in parallel (with concurrency limit).
 */
export async function scoreBatch(
  opportunities: Opportunity[],
  profile: UserProfile,
  concurrency = 3
): Promise<ScoringResult[]> {
  const results: ScoringResult[] = [];
  const insights = db.getLatestFeedbackInsights();

  for (let i = 0; i < opportunities.length; i += concurrency) {
    const batch = opportunities.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((opp) => runScoringAgent(opp, profile, insights))
    );
    results.push(...batchResults);
  }

  return results;
}

// ─────────────────────────────────────────────
// Heuristic fallback (when LLM fails)
// ─────────────────────────────────────────────

function heuristicScore(opp: Opportunity, profile: UserProfile): ScoringResult {
  const rawLower = (opp.title + " " + opp.raw_text).toLowerCase();

  const skill_match = Math.min(
    25,
    profile.skills.filter((s) => rawLower.includes(s.toLowerCase())).length * 4
  );

  const budget_quality = opp.budget
    ? rawLower.includes("$") ? 12 : 8
    : 3;

  const urgency_signals =
    rawLower.includes("urgent") || rawLower.includes("asap") ? 12 : 5;

  const competition_likelihood = opp.skills.some((s) =>
    ["solidity", "eliza", "nosana", "rust"].includes(s.toLowerCase())
  )
    ? 18
    : 10;

  const relevance = profile.niches.some((n) =>
    rawLower.includes(n.toLowerCase())
  )
    ? 16
    : 8;

  const breakdown = {
    skill_match,
    budget_quality,
    urgency_signals,
    competition_likelihood,
    relevance,
  };

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  const updated: Opportunity = {
    ...opp,
    score,
    score_breakdown: breakdown,
    score_reasoning: "Heuristic fallback scoring (LLM unavailable).",
    status: "scored",
  };
  db.upsertOpportunity(updated);

  return {
    opportunity_id: opp.id,
    score,
    breakdown,
    reasoning: "Heuristic fallback scoring (LLM unavailable).",
    flags: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
