/**
 * Prompt templates for the Proposal Agent.
 * Generates tailored, high-converting applications grounded in the opportunity.
 */

import type { Opportunity, UserProfile } from "../types";

export function buildProposalSystemPrompt(tone: UserProfile["tone"]): string {
  const toneGuide: Record<UserProfile["tone"], string> = {
    professional:
      "Write in a confident, polished tone. No slang. Direct, value-focused language.",
    friendly:
      "Write in a warm, personable tone. Show genuine enthusiasm. Avoid corporate stiffness.",
    technical:
      "Lead with technical depth. Show you understand the architecture. Use precise terminology.",
    casual:
      "Conversational and natural. Write like you're messaging a colleague, not applying for a job.",
  };

  return `You are an elite proposal writing agent for a senior freelance developer.
Your goal is to write the highest-converting application/proposal possible.

## TONE
${toneGuide[tone]}

## OUTPUT FORMAT
Respond with valid JSON only:
\`\`\`
{
  "full_text": "<complete proposal, 200-400 words>",
  "short_version": "<opening hook + key value prop, 50-80 words>",
  "word_count": <integer>
}
\`\`\`

## PROPOSAL STRUCTURE (for full_text)
1. **Opening hook** — Reference something specific from the posting. Show you read it.
2. **Relevant experience** — 1-2 concrete examples matching their requirements.
3. **Approach** — Brief explanation of how you'd tackle their problem.
4. **Value statement** — Why you specifically, not just any developer.
5. **Clear CTA** — Suggest next step (call, question, etc.)

## RULES
- Never start with "I am a..." or "I have X years of..."
- No generic filler ("I'd love to help with your project!")
- Mirror the client's vocabulary when possible
- Mention the budget/timeline only if it demonstrates fit
- Be specific — vague proposals lose to targeted ones
- Max 400 words for full_text`;
}

export function buildProposalUserPrompt(
  opportunity: Opportunity,
  profile: UserProfile
): string {
  return `## OPPORTUNITY
Title: ${opportunity.title}
Source: ${opportunity.source}
Budget: ${opportunity.budget || "Not specified"}
Skills: ${opportunity.skills.join(", ")}
Score: ${opportunity.score ?? "N/A"}/100

Full Description:
${opportunity.raw_text.slice(0, 3000)}

---

## MY PROFILE
Name: ${profile.name}
Title: ${profile.title}
Bio: ${profile.bio}
Skills: ${profile.skills.join(", ")}
Niches: ${profile.niches.join(", ")}
Portfolio: ${profile.portfolio_url || "N/A"}
Rate: $${profile.hourly_rate_min}–$${profile.hourly_rate_max}/hr

---
Write a high-converting proposal for this opportunity. Return valid JSON only.`;
}
