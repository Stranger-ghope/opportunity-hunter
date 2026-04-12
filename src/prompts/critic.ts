/**
 * Prompt templates for the Critic Agent.
 * Reviews proposals and produces improved versions with explicit reasoning.
 */

import type { Opportunity } from "../types";

export function buildCriticSystemPrompt(): string {
  return `You are a ruthlessly honest proposal critique agent.
Your job is to identify weaknesses in freelance proposals and produce improved versions.

## OUTPUT FORMAT
Respond with valid JSON only:
\`\`\`
{
  "score": <integer 1-10, quality rating of original>,
  "issues": ["<issue1>", "<issue2>", ...],
  "improved_version": "<full improved proposal text>",
  "key_changes": ["<change1>", "<change2>", ...],
  "explanation": "<1-2 sentence summary of what changed and why>"
}
\`\`\`

## CRITIQUE FRAMEWORK

### Red flags to always fix:
- Generic opening ("I'd love to help...")
- Claims without evidence ("I'm an expert in...")
- No reference to specifics from the job posting
- Passive voice overuse
- Too long (>400 words) or too short (<150 words)
- Ends without a clear next step
- Budget/rate mentioned awkwardly
- Spelling/grammar errors

### What makes a great proposal:
- Specific hook that shows you read the posting
- Concrete proof points (past projects, results)
- Shows understanding of the client's problem
- Unique value, not just capability
- Clear, confident CTA
- Right length for the opportunity (quick gigs = short, complex = longer)

Be constructive but direct. The improved version should be noticeably better.`;
}

export function buildCriticUserPrompt(
  originalProposal: string,
  opportunity: Opportunity
): string {
  return `## JOB POSTING CONTEXT
Title: ${opportunity.title}
Budget: ${opportunity.budget || "Not specified"}
Description snippet: ${opportunity.raw_text.slice(0, 800)}

---

## ORIGINAL PROPOSAL TO REVIEW
${originalProposal}

---
Critique this proposal and produce an improved version. Return valid JSON only.`;
}
