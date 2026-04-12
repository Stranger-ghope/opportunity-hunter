/**
 * Critic Agent — reviews and improves generated proposals.
 *
 * This is part of the proposal optimization loop — a key differentiator.
 * The Critic evaluates proposals against the job requirements and produces
 * an improved version with explicit change explanations.
 */

import type { Opportunity, Proposal } from "../types";
import { llmClient } from "../llm/client";
import { buildCriticSystemPrompt, buildCriticUserPrompt } from "../prompts/critic";
import { db } from "../memory/database";
import { logger } from "../utils/logger";

interface RawCriticOutput {
  score: number;
  issues: string[];
  improved_version: string;
  key_changes: string[];
  explanation: string;
}

/**
 * Run critic review on a proposal.
 * Returns the same proposal object with critic_feedback and improved_version filled in.
 */
export async function runCriticAgent(
  proposal: Proposal,
  opportunity: Opportunity
): Promise<Proposal> {
  // Skip criticism for already-high-quality proposals (score threshold)
  const opportunityScore = opportunity.score ?? 0;
  const skipThreshold = parseInt(process.env.AUTO_APPLY_THRESHOLD || "85", 10);

  logger.info(`[Critic Agent] Reviewing proposal for: "${opportunity.title}"`);

  const systemPrompt = buildCriticSystemPrompt();
  const userPrompt = buildCriticUserPrompt(proposal.full_text, opportunity);

  try {
    const raw = await llmClient.completeJSON<RawCriticOutput>({
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      temperature: 0.3,
      max_tokens: 1024,
    });

    const criticScore = raw.score ?? 5;
    const issues = Array.isArray(raw.issues) ? raw.issues : [];
    const keyChanges = Array.isArray(raw.key_changes) ? raw.key_changes : [];

    const updatedProposal: Proposal = {
      ...proposal,
      critic_feedback: [
        `Quality score: ${criticScore}/10`,
        `Issues: ${issues.join("; ")}`,
        `Changes made: ${keyChanges.join("; ")}`,
        `Summary: ${raw.explanation}`,
      ].join("\n"),
      improved_version: raw.improved_version || proposal.full_text,
      version: proposal.version + 1,
    };

    db.saveProposal(updatedProposal);

    logger.info(
      `[Critic Agent] "${opportunity.title}" — critic score: ${criticScore}/10, ${issues.length} issues fixed`
    );

    return updatedProposal;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Critic Agent] Failed for "${opportunity.title}": ${msg}`);
    // Return original proposal on failure
    return proposal;
  }
}
