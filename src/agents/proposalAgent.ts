/**
 * Proposal Agent — generates tailored, high-quality applications.
 *
 * Produces both a full proposal and a short "hook" version.
 * Output is stored in the DB and linked to the opportunity.
 */

import { v4 as uuidv4 } from "uuid";
import type { Opportunity, Proposal, UserProfile } from "../types";
import { llmClient } from "../llm/client";
import { buildProposalSystemPrompt, buildProposalUserPrompt } from "../prompts/proposal";
import { db } from "../memory/database";
import { logger } from "../utils/logger";

interface RawProposalOutput {
  full_text: string;
  short_version: string;
  word_count: number;
}

export async function runProposalAgent(
  opportunity: Opportunity,
  profile: UserProfile
): Promise<Proposal> {
  logger.info(`[Proposal Agent] Drafting for: "${opportunity.title}"`);

  const systemPrompt = buildProposalSystemPrompt(profile.tone);
  const userPrompt = buildProposalUserPrompt(opportunity, profile);

  try {
    const raw = await llmClient.completeJSON<RawProposalOutput>({
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      temperature: 0.7, // Higher temp for creative writing
      max_tokens: 1024,
    });

    const proposal: Proposal = {
      id: uuidv4(),
      opportunity_id: opportunity.id,
      full_text: raw.full_text || "",
      short_version: raw.short_version || raw.full_text?.slice(0, 300) || "",
      word_count: raw.word_count || countWords(raw.full_text || ""),
      generated_at: new Date().toISOString(),
      version: 1,
    };

    db.saveProposal(proposal);

    // Update opportunity status
    db.upsertOpportunity({
      ...opportunity,
      status: "proposal_generated",
    });

    logger.info(
      `[Proposal Agent] Generated ${proposal.word_count} words for "${opportunity.title}"`
    );
    return proposal;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Proposal Agent] Failed for "${opportunity.title}": ${msg}`);
    throw err;
  }
}

/**
 * Generate proposals for a batch of approved opportunities.
 */
export async function generateProposalBatch(
  opportunities: Opportunity[],
  profile: UserProfile,
  concurrency = 2
): Promise<Proposal[]> {
  const results: Proposal[] = [];

  for (let i = 0; i < opportunities.length; i += concurrency) {
    const batch = opportunities.slice(i, i + concurrency);
    const proposals = await Promise.all(
      batch.map((opp) =>
        runProposalAgent(opp, profile).catch((err) => {
          logger.error(`[Proposal Batch] Failed for ${opp.id}: ${err}`);
          return null;
        })
      )
    );
    results.push(...(proposals.filter(Boolean) as Proposal[]));
  }

  return results;
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}
