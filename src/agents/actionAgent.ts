/**
 * Action Agent — makes the final APPLY / SAVE / IGNORE decision.
 *
 * Combines score thresholds with LLM reasoning for intelligent decisions.
 * High-confidence auto-applies are logged for the feedback loop.
 * All decisions require human confirmation unless AUTO_APPLY is enabled.
 */

import type {
  Opportunity,
  UserProfile,
  ActionDecision,
  FeedbackInsights,
} from "../types";
import { llmClient } from "../llm/client";
import { buildActionSystemPrompt, buildActionUserPrompt } from "../prompts/action";
import { db } from "../memory/database";
import { logger } from "../utils/logger";

interface RawActionOutput {
  decision: ActionDecision;
  confidence: number;
  reasoning: string;
  risk_factors: string[];
}

export async function runActionAgent(
  opportunity: Opportunity,
  profile: UserProfile,
  insights: FeedbackInsights | null = null
): Promise<{ decision: ActionDecision; reasoning: string; confidence: number }> {
  const score = opportunity.score ?? 0;
  const applyThreshold = parseInt(process.env.SCORE_THRESHOLD || "60", 10);
  const ignoreThreshold = Math.floor(applyThreshold * 0.6);

  // Fast-path decisions for clear cases (no LLM needed)
  if (score < ignoreThreshold) {
    logger.debug(`[Action Agent] IGNORE (fast path, score ${score} < ${ignoreThreshold})`);
    persistDecision(opportunity, "IGNORE", `Score ${score} below ignore threshold ${ignoreThreshold}`);
    return { decision: "IGNORE", reasoning: `Score ${score} below ignore threshold.`, confidence: 95 };
  }

  // Check for avoid keywords — hard block
  const rawLower = (opportunity.title + " " + opportunity.raw_text).toLowerCase();
  const hitAvoid = profile.avoid_keywords.find((kw) => rawLower.includes(kw.toLowerCase()));
  if (hitAvoid) {
    logger.debug(`[Action Agent] IGNORE (avoid keyword: "${hitAvoid}")`);
    persistDecision(opportunity, "IGNORE", `Avoid keyword matched: "${hitAvoid}"`);
    return {
      decision: "IGNORE",
      reasoning: `Contains avoid keyword: "${hitAvoid}"`,
      confidence: 99,
    };
  }

  // LLM-based decision for ambiguous cases
  logger.debug(`[Action Agent] Consulting LLM for: "${opportunity.title}"`);

  const systemPrompt = buildActionSystemPrompt();
  const userPrompt = buildActionUserPrompt(opportunity, profile, applyThreshold, insights);

  try {
    const raw = await llmClient.completeJSON<RawActionOutput>({
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      temperature: 0.2,
      max_tokens: 300,
      no_retry: true,
    });

    const decision = validateDecision(raw.decision);
    const confidence = Math.min(100, Math.max(0, raw.confidence ?? 70));
    const reasoning = raw.reasoning || `Score: ${score}/100`;

    persistDecision(opportunity, decision, reasoning);

    logger.info(
      `[Action Agent] "${opportunity.title}" → ${decision} (${confidence}% confidence)`
    );

    return { decision, reasoning, confidence };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Action Agent] LLM failed, using threshold fallback: ${msg}`);

    // Threshold-based fallback
    const decision: ActionDecision = score >= applyThreshold ? "APPLY" : "SAVE";
    persistDecision(opportunity, decision, `Threshold fallback: score ${score}`);
    return { decision, reasoning: `Threshold fallback: score ${score}/${applyThreshold}`, confidence: 60 };
  }
}

/**
 * Process a batch of scored opportunities with the action agent.
 */
export async function processActionBatch(
  opportunities: Opportunity[],
  profile: UserProfile
): Promise<Map<string, ActionDecision>> {
  const decisions = new Map<string, ActionDecision>();
  const insights = db.getLatestFeedbackInsights();

  for (const opp of opportunities) {
    const { decision } = await runActionAgent(opp, profile, insights);
    decisions.set(opp.id, decision);
  }

  return decisions;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function persistDecision(
  opportunity: Opportunity,
  decision: ActionDecision,
  reasoning: string
): void {
  db.upsertOpportunity({
    ...opportunity,
    action: decision,
    action_reasoning: reasoning,
    status:
      decision === "APPLY"
        ? "proposal_approved"
        : decision === "SAVE"
        ? "saved"
        : "ignored",
  });
}

function validateDecision(raw: unknown): ActionDecision {
  const valid: ActionDecision[] = ["APPLY", "SAVE", "IGNORE"];
  if (typeof raw === "string" && valid.includes(raw as ActionDecision)) {
    return raw as ActionDecision;
  }
  return "SAVE"; // Default to SAVE if LLM returns invalid value
}
