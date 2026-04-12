/**
 * Feedback Agent — tracks outcomes and drives self-improvement.
 *
 * This is a key differentiator. The agent:
 * 1. Records application outcomes (accepted/rejected/no_response)
 * 2. Analyzes patterns in successful vs failed applications
 * 3. Generates bias adjustments for the scoring agent
 * 4. Provides proposal style recommendations
 *
 * This creates the feedback loop: outcomes → insights → better scoring → better proposals
 */

import { v4 as uuidv4 } from "uuid";
import type { OutcomeRecord, FeedbackInsights } from "../types";
import { llmClient } from "../llm/client";
import { db } from "../memory/database";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────
// OUTCOME RECORDING
// ─────────────────────────────────────────────

/**
 * Record the outcome of an application.
 * Called by the human (via dashboard) or automated tracking.
 */
export function recordOutcome(
  opportunityId: string,
  outcome: OutcomeRecord["outcome"],
  feedbackNotes?: string,
  responseTimeHours?: number
): OutcomeRecord {
  const proposal = db.getProposalByOpportunityId(opportunityId);

  const record: OutcomeRecord = {
    id: uuidv4(),
    opportunity_id: opportunityId,
    proposal_id: proposal?.id || "",
    outcome,
    feedback_notes: feedbackNotes,
    recorded_at: new Date().toISOString(),
    response_time_hours: responseTimeHours,
  };

  db.saveOutcome(record);
  const oppStatus = outcome === "pending" ? "applied" : outcome;
  db.updateOpportunityStatus(opportunityId, oppStatus);

  logger.info(`[Feedback Agent] Outcome recorded: ${opportunityId} → ${outcome}`);
  return record;
}

// ─────────────────────────────────────────────
// INSIGHT GENERATION
// ─────────────────────────────────────────────

/**
 * Analyze historical outcomes and generate scoring/proposal improvements.
 * Should be run periodically (e.g., after every 5+ new outcomes).
 */
export async function runFeedbackAgent(): Promise<FeedbackInsights> {
  logger.info("[Feedback Agent] Running insight analysis...");

  const outcomes = db.getOutcomes();
  const allOpps = db.getAllOpportunities(500);

  if (outcomes.length < 3) {
    logger.info("[Feedback Agent] Not enough outcomes yet (need 3+). Returning defaults.");
    return buildDefaultInsights();
  }

  // Build stats
  const accepted = outcomes.filter((o) => o.outcome === "accepted");
  const rejected = outcomes.filter((o) => o.outcome === "rejected");
  const noResponse = outcomes.filter((o) => o.outcome === "no_response");
  const total = outcomes.length;

  // Get winning opportunities (those that were accepted)
  const acceptedOppIds = new Set(accepted.map((o) => o.opportunity_id));
  const acceptedOpps = allOpps.filter((o) => acceptedOppIds.has(o.id));

  // Extract winning skills
  const skillFrequency = new Map<string, number>();
  for (const opp of acceptedOpps) {
    for (const skill of opp.skills || []) {
      skillFrequency.set(skill, (skillFrequency.get(skill) || 0) + 1);
    }
  }
  const topSkills = [...skillFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([skill]) => skill);

  // Extract winning sources
  const sourceFrequency = new Map<string, number>();
  for (const opp of acceptedOpps) {
    const src = opp.source.split(":")[0];
    sourceFrequency.set(src, (sourceFrequency.get(src) || 0) + 1);
  }
  const topSources = [...sourceFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([src]) => src);

  // Average winning score
  const avgWinningScore =
    acceptedOpps.length > 0
      ? acceptedOpps.reduce((sum, o) => sum + (o.score ?? 0), 0) / acceptedOpps.length
      : 60;

  // LLM-powered pattern analysis
  const styleNotes = await generateProposalStyleNotes(accepted, rejected, allOpps);

  // Compute score bias adjustments
  // If winning opps have high skill_match, boost that dimension's weight
  const scoringBias = computeScoringBias(acceptedOpps, allOpps);

  const insights: FeedbackInsights = {
    total_applied: total,
    accepted_rate: total > 0 ? accepted.length / total : 0,
    rejected_rate: total > 0 ? rejected.length / total : 0,
    no_response_rate: total > 0 ? noResponse.length / total : 0,
    top_winning_skills: topSkills,
    top_winning_sources: topSources,
    avg_winning_score: Math.round(avgWinningScore),
    scoring_bias_adjustment: scoringBias,
    proposal_style_notes: styleNotes,
  };

  db.saveFeedbackInsights(insights);
  logger.info(
    `[Feedback Agent] Insights: ${accepted.length}/${total} accepted | avg score: ${insights.avg_winning_score}`
  );

  return insights;
}

// ─────────────────────────────────────────────
// LLM-powered style analysis
// ─────────────────────────────────────────────

async function generateProposalStyleNotes(
  accepted: OutcomeRecord[],
  rejected: OutcomeRecord[],
  allOpps: ReturnType<typeof db.getAllOpportunities>
): Promise<string> {
  if (accepted.length === 0) return "No accepted applications yet to analyze.";

  // Build a summary for the LLM
  const acceptedSummary = accepted.slice(0, 5).map((o) => {
    const opp = allOpps.find((a) => a.id === o.opportunity_id);
    const proposal = db.getProposalByOpportunityId(o.opportunity_id);
    return {
      title: opp?.title || "Unknown",
      source: opp?.source || "Unknown",
      score: opp?.score,
      proposal_snippet: proposal?.full_text?.slice(0, 200),
      notes: o.feedback_notes,
    };
  });

  const rejectedSummary = rejected.slice(0, 3).map((o) => {
    const opp = allOpps.find((a) => a.id === o.opportunity_id);
    return {
      title: opp?.title || "Unknown",
      score: opp?.score,
      notes: o.feedback_notes,
    };
  });

  try {
    const response = await llmClient.complete({
      system_prompt:
        "You are a proposal performance analyst. Analyze accepted vs rejected proposals and provide actionable writing advice in 2-3 sentences.",
      user_prompt: `Accepted applications (${acceptedSummary.length}):\n${JSON.stringify(acceptedSummary, null, 2)}\n\nRejected/ignored (${rejectedSummary.length}):\n${JSON.stringify(rejectedSummary, null, 2)}\n\nWhat proposal strategies are working? Be specific.`,
      temperature: 0.4,
      max_tokens: 256,
    });
    return response.content.trim();
  } catch {
    return "Insufficient data for pattern analysis.";
  }
}

function computeScoringBias(
  acceptedOpps: ReturnType<typeof db.getAllOpportunities>,
  allOpps: ReturnType<typeof db.getAllOpportunities>
): FeedbackInsights["scoring_bias_adjustment"] {
  if (acceptedOpps.length < 2) return {};

  // Compare average breakdown dimensions of accepted vs all
  const avgAccepted = averageBreakdown(acceptedOpps);
  const avgAll = averageBreakdown(allOpps);

  // If accepted opps score consistently higher on a dimension, that dimension is predictive
  const bias: FeedbackInsights["scoring_bias_adjustment"] = {};

  if (avgAccepted.skill_match - avgAll.skill_match > 3) {
    bias.skill_match = 2; // Slight upward adjustment
  }
  if (avgAccepted.budget_quality - avgAll.budget_quality > 2) {
    bias.budget_quality = 1;
  }

  return bias;
}

function averageBreakdown(opps: ReturnType<typeof db.getAllOpportunities>) {
  const withBreakdown = opps.filter((o) => o.score_breakdown);
  if (withBreakdown.length === 0) {
    return { skill_match: 0, budget_quality: 0, urgency_signals: 0, competition_likelihood: 0, relevance: 0 };
  }
  const sum = withBreakdown.reduce(
    (acc, o) => ({
      skill_match: acc.skill_match + (o.score_breakdown?.skill_match ?? 0),
      budget_quality: acc.budget_quality + (o.score_breakdown?.budget_quality ?? 0),
      urgency_signals: acc.urgency_signals + (o.score_breakdown?.urgency_signals ?? 0),
      competition_likelihood: acc.competition_likelihood + (o.score_breakdown?.competition_likelihood ?? 0),
      relevance: acc.relevance + (o.score_breakdown?.relevance ?? 0),
    }),
    { skill_match: 0, budget_quality: 0, urgency_signals: 0, competition_likelihood: 0, relevance: 0 }
  );
  const n = withBreakdown.length;
  return {
    skill_match: sum.skill_match / n,
    budget_quality: sum.budget_quality / n,
    urgency_signals: sum.urgency_signals / n,
    competition_likelihood: sum.competition_likelihood / n,
    relevance: sum.relevance / n,
  };
}

function buildDefaultInsights(): FeedbackInsights {
  return {
    total_applied: 0,
    accepted_rate: 0,
    rejected_rate: 0,
    no_response_rate: 0,
    top_winning_skills: [],
    top_winning_sources: [],
    avg_winning_score: 65,
    scoring_bias_adjustment: {},
    proposal_style_notes: "No outcomes recorded yet. Apply to opportunities to start learning.",
  };
}
