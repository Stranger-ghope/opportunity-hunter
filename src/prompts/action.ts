/**
 * Prompt templates for the Action Agent.
 * Decides APPLY / SAVE / IGNORE with transparent reasoning.
 */

import type { Opportunity, UserProfile, FeedbackInsights } from "../types";

export function buildActionSystemPrompt(): string {
  return `You are a decision-making agent for a senior freelance developer.
Given a scored opportunity and context, decide the best action to take.

## OUTPUT FORMAT
Respond with valid JSON only:
\`\`\`
{
  "decision": "APPLY" | "SAVE" | "IGNORE",
  "confidence": <integer 1-100>,
  "reasoning": "<2-3 sentence justification>",
  "risk_factors": ["<risk1>", "<risk2>"]
}
\`\`\`

## DECISION RULES

### APPLY (score >= threshold, act now)
- Score meets or exceeds the configured apply threshold
- No critical blockers (avoid keywords, spec work, etc.)
- Opportunity is recent (< 7 days old ideally)
- Confidence in fit is high

### SAVE (interesting but not ready to apply)
- Score is moderate (below apply threshold but above ignore threshold)
- Needs more information before applying
- Budget unclear but opportunity looks good
- Apply deadline is in the future

### IGNORE (not worth pursuing)
- Score is low (below ignore threshold)
- Contains avoid keywords
- Extremely high competition with no differentiation
- Already applied to similar from same client
- Spam/irrelevant post

Be decisive. When in doubt between APPLY and SAVE, lean toward APPLY for high scores.`;
}

export function buildActionUserPrompt(
  opportunity: Opportunity,
  profile: UserProfile,
  applyThreshold: number,
  insights: FeedbackInsights | null
): string {
  const historyNote = insights
    ? `\nHistorical context: ${insights.total_applied} total applications, ${Math.round(insights.accepted_rate * 100)}% acceptance rate. Avg winning score: ${insights.avg_winning_score}.`
    : "";

  return `## THRESHOLDS
Apply threshold: ${applyThreshold}/100
Ignore below: ${Math.floor(applyThreshold * 0.6)}/100
${historyNote}

## OPPORTUNITY
Title: ${opportunity.title}
Source: ${opportunity.source}
Score: ${opportunity.score}/100
Score breakdown: ${JSON.stringify(opportunity.score_breakdown)}
Score reasoning: ${opportunity.score_reasoning}
Budget: ${opportunity.budget || "Not specified"}
Skills: ${opportunity.skills.join(", ")}
Flags: ${(opportunity.tags || []).join(", ")}
Posted: ${opportunity.timestamp}

## USER AVOID KEYWORDS
${profile.avoid_keywords.join(", ")}

---
Make a decision. Return valid JSON only.`;
}
