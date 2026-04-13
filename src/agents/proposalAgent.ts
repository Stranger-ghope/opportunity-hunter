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
    logger.warn(`[Proposal Agent] LLM unavailable, using template fallback for "${opportunity.title}": ${msg}`);

    const fullText = buildTemplatePropsal(opportunity, profile);
    const proposal: Proposal = {
      id: uuidv4(),
      opportunity_id: opportunity.id,
      full_text: fullText,
      short_version: fullText.slice(0, 300),
      word_count: countWords(fullText),
      generated_at: new Date().toISOString(),
      version: 1,
    };

    db.saveProposal(proposal);
    db.upsertOpportunity({ ...opportunity, status: "proposal_generated" });

    logger.info(`[Proposal Agent] Template proposal saved for "${opportunity.title}"`);
    return proposal;
  }
}

function buildTemplatePropsal(opportunity: Opportunity, profile: UserProfile): string {
  const relevantSkills = profile.skills
    .filter((s) => opportunity.raw_text.toLowerCase().includes(s.toLowerCase()))
    .slice(0, 4);
  const skillLine = relevantSkills.length
    ? relevantSkills.join(", ")
    : profile.skills.slice(0, 4).join(", ");

  return `Hi,

I'm ${profile.name}, a ${profile.title} with ${profile.experience_years} years of experience.

I'm very interested in the "${opportunity.title}" opportunity. ${profile.bio}

Relevant skills for this role: ${skillLine}.

My rate is $${profile.hourly_rate_min}–$${profile.hourly_rate_max}/hr. I'm available to start promptly and can commit to the project requirements.

I'd love to discuss how I can contribute. Please feel free to reach out.

Best regards,
${profile.name}`;
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
