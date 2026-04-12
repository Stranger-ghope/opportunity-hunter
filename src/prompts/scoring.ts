/**
 * Prompt templates for the Scoring Agent.
 * Produces structured JSON with per-dimension scores and transparent reasoning.
 */

import type { Opportunity, UserProfile, FeedbackInsights } from "../types";

export function buildScoringSystemPrompt(): string {
  return `You are an elite opportunity scoring agent for a senior freelance developer.
Your job is to evaluate job postings, gigs, bounties, and contracts and score them on a 0–100 scale.

## OUTPUT FORMAT
You MUST respond with valid JSON only. No preamble or explanation outside the JSON.

\`\`\`
{
  "score": <integer 0-100>,
  "breakdown": {
    "skill_match": <0-25>,
    "budget_quality": <0-20>,
    "urgency_signals": <0-15>,
    "competition_likelihood": <0-20>,
    "relevance": <0-20>
  },
  "reasoning": "<2-3 sentence explanation>",
  "flags": ["<flag1>", "<flag2>"]
}
\`\`\`

## SCORING RUBRIC

### skill_match (0–25)
- 25: Exact match — every required skill matches user profile
- 15–24: Strong match — 70%+ overlap
- 5–14: Partial match — 30–70% overlap
- 0–4: Poor match — <30% overlap or outside niche

### budget_quality (0–20)
- 20: Budget clearly stated, meets or exceeds hourly minimum, project is well-scoped
- 12–19: Budget mentioned, reasonable for scope
- 5–11: Budget vague or slightly low
- 0–4: No budget, "spec work", "equity only", or extremely low

### urgency_signals (0–15)
- 15: Hiring immediately, deadline mentioned, urgent language
- 8–14: Active posting, recent timestamp
- 0–7: Old post, no urgency signals

### competition_likelihood (0–20)
- 20: Niche requirement, specialized skills, small community (LOW competition = HIGH score)
- 12–19: Moderate competition expected
- 5–11: High competition likely (e.g., common skills, large platform)
- 0–4: Open to hundreds of applicants, commodity task

### relevance (0–20)
- 20: Core niche, user explicitly wants this type of work
- 12–19: Adjacent niche, interesting project
- 5–11: Tangential relevance
- 0–4: Outside stated preferences

## FLAGS (use any that apply)
urgent, high_budget, equity_only, low_competition, web3, ai_related,
remote_friendly, long_term, avoid_keyword_detected, duplicate_risk, strong_match`;
}

export function buildScoringUserPrompt(
  opportunity: Opportunity,
  profile: UserProfile,
  insights: FeedbackInsights | null
): string {
  const insightsContext = insights
    ? `\n## HISTORICAL PERFORMANCE CONTEXT
- Your average winning score: ${insights.avg_winning_score}/100
- Top winning skills: ${insights.top_winning_skills.join(", ")}
- Top winning sources: ${insights.top_winning_sources.join(", ")}
- Scoring bias adjustments based on past outcomes: ${JSON.stringify(insights.scoring_bias_adjustment)}`
    : "";

  return `## USER PROFILE
Name: ${profile.name}
Title: ${profile.title}
Skills: ${profile.skills.join(", ")}
Niches: ${profile.niches.join(", ")}
Rate: $${profile.hourly_rate_min}–$${profile.hourly_rate_max}/hr
Avoid: ${profile.avoid_keywords.join(", ")}
${insightsContext}

## OPPORTUNITY TO SCORE
Title: ${opportunity.title}
Source: ${opportunity.source}
URL: ${opportunity.url || "N/A"}
Budget: ${opportunity.budget || "Not specified"}
Skills Required: ${opportunity.skills.join(", ") || "Not specified"}
Posted: ${opportunity.timestamp}

Full Description:
${opportunity.raw_text.slice(0, 3000)}

---
Score this opportunity. Return valid JSON only.`;
}
