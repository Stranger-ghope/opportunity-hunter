/**
 * Core type definitions for the Opportunity Hunter system.
 * All agents communicate through these shared contracts.
 */

// ─────────────────────────────────────────────
// OPPORTUNITY (canonical unified schema)
// ─────────────────────────────────────────────

export type OpportunityStatus =
  | "new"
  | "scored"
  | "proposal_generated"
  | "proposal_approved"
  | "applied"
  | "saved"
  | "ignored"
  | "accepted"
  | "rejected"
  | "no_response";

export type ActionDecision = "APPLY" | "SAVE" | "IGNORE";

export interface Opportunity {
  id: string;
  title: string;
  source: string;
  url: string;
  budget: string;
  skills: string[];
  timestamp: string;
  raw_text: string;
  // Enriched fields added during pipeline
  normalized_at?: string;
  score?: number;
  score_breakdown?: ScoreBreakdown;
  score_reasoning?: string;
  proposal?: Proposal;
  action?: ActionDecision;
  action_reasoning?: string;
  status: OpportunityStatus;
  tags?: string[];
  company?: string;
  location?: string;
  remote?: boolean;
  deadline?: string;
}

// ─────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────

export interface ScoreBreakdown {
  skill_match: number;       // 0–25
  budget_quality: number;    // 0–20
  urgency_signals: number;   // 0–15
  competition_likelihood: number; // 0–20  (inverse — low comp = high score)
  relevance: number;         // 0–20
}

export interface ScoringResult {
  opportunity_id: string;
  score: number;
  breakdown: ScoreBreakdown;
  reasoning: string;
  flags: string[];           // e.g. ["urgent", "high_budget", "low_competition"]
}

// ─────────────────────────────────────────────
// PROPOSALS
// ─────────────────────────────────────────────

export interface Proposal {
  id: string;
  opportunity_id: string;
  full_text: string;
  short_version: string;
  word_count: number;
  generated_at: string;
  version: number;
  critic_feedback?: string;
  improved_version?: string;
}

// ─────────────────────────────────────────────
// USER PROFILE
// ─────────────────────────────────────────────

export interface UserProfile {
  name: string;
  title: string;
  skills: string[];
  experience_years: number;
  niches: string[];
  hourly_rate_min: number;
  hourly_rate_max: number;
  preferred_project_types: string[];
  portfolio_url?: string;
  bio: string;
  tone: "professional" | "friendly" | "technical" | "casual";
  avoid_keywords: string[];
}

// ─────────────────────────────────────────────
// FEEDBACK & OUTCOMES
// ─────────────────────────────────────────────

export interface OutcomeRecord {
  id: string;
  opportunity_id: string;
  proposal_id: string;
  outcome: "accepted" | "rejected" | "no_response" | "pending";
  feedback_notes?: string;
  recorded_at: string;
  response_time_hours?: number;
}

export interface FeedbackInsights {
  total_applied: number;
  accepted_rate: number;
  rejected_rate: number;
  no_response_rate: number;
  top_winning_skills: string[];
  top_winning_sources: string[];
  avg_winning_score: number;
  scoring_bias_adjustment: Partial<ScoreBreakdown>;
  proposal_style_notes: string;
}

// ─────────────────────────────────────────────
// PIPELINE
// ─────────────────────────────────────────────

export interface PipelineRun {
  id: string;
  started_at: string;
  completed_at?: string;
  sources_checked: string[];
  opportunities_found: number;
  opportunities_scored: number;
  proposals_generated: number;
  actions_taken: Record<ActionDecision, number>;
  errors: PipelineError[];
  status: "running" | "completed" | "failed";
}

export interface PipelineError {
  agent: string;
  message: string;
  opportunity_id?: string;
  timestamp: string;
}

// ─────────────────────────────────────────────
// AGENT MESSAGES (ElizaOS-style inter-agent)
// ─────────────────────────────────────────────

export type AgentRole =
  | "rss_source"
  | "email_source"
  | "reddit_source"
  | "manual_source"
  | "normalizer"
  | "scorer"
  | "proposal_writer"
  | "critic"
  | "action_decider"
  | "feedback_tracker"
  | "orchestrator";

export interface AgentMessage<T = unknown> {
  id: string;
  from: AgentRole;
  to: AgentRole;
  type: string;
  payload: T;
  timestamp: string;
  pipeline_run_id: string;
}

// ─────────────────────────────────────────────
// LLM
// ─────────────────────────────────────────────

export interface LLMRequest {
  system_prompt: string;
  user_prompt: string;
  temperature?: number;
  max_tokens?: number;
  json_mode?: boolean;
}

export interface LLMResponse {
  content: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
}

// ─────────────────────────────────────────────
// RSS SOURCE CONFIG
// ─────────────────────────────────────────────

export interface RSSFeedConfig {
  name: string;
  url: string;
  category: string;
  enabled: boolean;
  skill_hints?: string[];
}

// ─────────────────────────────────────────────
// REDDIT SOURCE CONFIG
// ─────────────────────────────────────────────

export interface RedditSourceConfig {
  subreddit: string;
  flairs?: string[];
  keyword_filter?: string[];
  limit?: number;
  enabled: boolean;
}
