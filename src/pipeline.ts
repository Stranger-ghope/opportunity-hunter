/**
 * Pipeline Orchestrator — coordinates all agents in sequence.
 *
 * Flow:
 *   Source Agents → Normalization → Scoring → Action → Proposal → Critic
 *
 * This is the main entry point for a single pipeline run.
 * Can be triggered manually (CLI), via cron, or via the dashboard.
 */

import "dotenv/config";
import { v4 as uuidv4 } from "uuid";
import type { Opportunity, PipelineRun, ActionDecision } from "./types";
import { logger } from "./utils/logger";
import { db } from "./memory/database";

// Source Agents
import { runRSSAgent } from "./agents/sources/rssAgent";
import { runRedditAgent } from "./agents/sources/redditAgent";
import { runEmailAgent } from "./agents/sources/emailAgent";

// Processing Agents
import { runNormalizationAgent } from "./agents/normalizationAgent";
import { scoreBatch } from "./agents/scoringAgent";
import { runProposalAgent } from "./agents/proposalAgent";
import { runCriticAgent } from "./agents/criticAgent";
import { runActionAgent } from "./agents/actionAgent";
import { runFeedbackAgent } from "./agents/feedbackAgent";
import { llmClient } from "./llm/client";
import { embeddingClient } from "./llm/embeddingClient";

// Config
import profileConfig from "../config/profile.json";
import type { UserProfile } from "./types";
import { generateDynamicSources } from "./agents/sources/dynamicSources";

const profile = profileConfig as UserProfile;
const APPLY_THRESHOLD = parseInt(process.env.SCORE_THRESHOLD || "60", 10);

// ─────────────────────────────────────────────
// MAIN PIPELINE
// ─────────────────────────────────────────────

let _pipelineRunning = false;

export async function runPipeline(options: {
  skipSources?: string[];
  dryRun?: boolean;
} = {}): Promise<PipelineRun> {
  if (_pipelineRunning) {
    logger.warn("[Pipeline] Already running — skipping duplicate trigger");
    return { id: "skipped", started_at: new Date().toISOString(), sources_checked: [], opportunities_found: 0, opportunities_scored: 0, proposals_generated: 0, actions_taken: { APPLY: 0, SAVE: 0, IGNORE: 0 }, errors: ["skipped: already running"], status: "skipped" } as unknown as PipelineRun;
  }
  _pipelineRunning = true;
  llmClient.resetCircuit();       // fresh LLM attempt each run
  embeddingClient.resetCircuit(); // fresh embedding attempt each run

  const runId = uuidv4();
  const startedAt = new Date().toISOString();

  const pipelineRun: PipelineRun = {
    id: runId,
    started_at: startedAt,
    sources_checked: [],
    opportunities_found: 0,
    opportunities_scored: 0,
    proposals_generated: 0,
    actions_taken: { APPLY: 0, SAVE: 0, IGNORE: 0 },
    errors: [],
    status: "running",
  };

  db.savePipelineRun(pipelineRun);
  logger.info(`\n${"═".repeat(60)}`);
  logger.info(`🚀 Pipeline run started: ${runId}`);
  logger.info(`${"═".repeat(60)}\n`);

  try {
    // ── PHASE 1: Ingest ─────────────────────────────────────────
    logger.info("📥 PHASE 1: Source ingestion");
    const rawOpportunities: Opportunity[] = [];

    const { rss_feeds, reddit_sources } = generateDynamicSources(profile);

    if (!options.skipSources?.includes("rss")) {
      const rssOpps = await runRSSAgent(rss_feeds);
      rawOpportunities.push(...rssOpps);
      pipelineRun.sources_checked.push("rss");
    }

    if (!options.skipSources?.includes("reddit")) {
      const redditOpps = await runRedditAgent(reddit_sources);
      rawOpportunities.push(...redditOpps);
      pipelineRun.sources_checked.push("reddit");
    }

    if (!options.skipSources?.includes("email")) {
      const emailOpps = await runEmailAgent();
      rawOpportunities.push(...emailOpps);
      pipelineRun.sources_checked.push("email");
    }

    logger.info(`\n  Raw opportunities collected: ${rawOpportunities.length}`);

    if (rawOpportunities.length === 0) {
      logger.info("No new opportunities found. Pipeline complete.");
      return completePipeline(pipelineRun);
    }

    // ── PHASE 2: Normalize ────────────────────────────────────────
    logger.info("\n🔄 PHASE 2: Normalization");
    const normalized = runNormalizationAgent(rawOpportunities, profile);
    pipelineRun.opportunities_found = normalized.length;
    logger.info(`  Normalized: ${normalized.length}`);

    if (normalized.length === 0) {
      return completePipeline(pipelineRun);
    }

    if (options.dryRun) {
      logger.info("\n🔍 DRY RUN mode — stopping after normalization");
      return completePipeline(pipelineRun);
    }

    // ── PHASE 3: Score ────────────────────────────────────────────
    logger.info("\n🎯 PHASE 3: Scoring");
    const scoringResults = await scoreBatch(normalized, profile, 3);
    pipelineRun.opportunities_scored = scoringResults.length;

    // Re-fetch scored opportunities from DB
    const scoredOpps = normalized
      .map((o) => db.getOpportunityById(o.id))
      .filter((o): o is Opportunity => o !== null);

    // Sort by score descending
    scoredOpps.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    logger.info(`  Scored: ${scoredOpps.length} opportunities`);
    logScoreSummary(scoredOpps);

    // ── PHASE 4: Action Decisions ─────────────────────────────────
    logger.info("\n⚡ PHASE 4: Action decisions");
    const insights = db.getLatestFeedbackInsights();

    const toApply: Opportunity[] = [];

    for (const opp of scoredOpps) {
      const { decision } = await runActionAgent(opp, profile, insights);

      const key = decision as ActionDecision;
      pipelineRun.actions_taken[key]++;

      if (decision === "APPLY") {
        toApply.push(opp);
      }
    }

    logger.info(
      `  APPLY: ${pipelineRun.actions_taken.APPLY} | SAVE: ${pipelineRun.actions_taken.SAVE} | IGNORE: ${pipelineRun.actions_taken.IGNORE}`
    );

    // ── PHASE 5: Proposal Generation ──────────────────────────────
    logger.info(`\n✍️  PHASE 5: Proposal generation (${toApply.length} opportunities)`);

    for (const opp of toApply) {
      try {
        const proposal = await runProposalAgent(opp, profile);

        // Run critic review
        logger.debug(`  Running critic on: "${opp.title}"`);
        const freshOpp = db.getOpportunityById(opp.id) ?? opp;
        await runCriticAgent(proposal, freshOpp);

        pipelineRun.proposals_generated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`  Proposal failed for "${opp.title}": ${msg}`);
        pipelineRun.errors.push({
          agent: "proposal",
          message: msg,
          opportunity_id: opp.id,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ── PHASE 6: Feedback Update ───────────────────────────────────
    logger.info("\n📊 PHASE 6: Feedback analysis");
    await runFeedbackAgent();

    return completePipeline(pipelineRun);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Pipeline] Fatal error: ${msg}`);
    pipelineRun.errors.push({
      agent: "orchestrator",
      message: msg,
      timestamp: new Date().toISOString(),
    });
    pipelineRun.status = "failed";
    pipelineRun.completed_at = new Date().toISOString();
    db.savePipelineRun(pipelineRun);
    throw err;
  } finally {
    _pipelineRunning = false;
  }
}

function completePipeline(run: PipelineRun): PipelineRun {
  run.status = "completed";
  run.completed_at = new Date().toISOString();
  db.savePipelineRun(run);

  const duration = Math.round(
    (new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000
  );

  logger.info(`\n${"═".repeat(60)}`);
  logger.info(`✅ Pipeline complete in ${duration}s`);
  logger.info(`   Found: ${run.opportunities_found}`);
  logger.info(`   Scored: ${run.opportunities_scored}`);
  logger.info(`   Proposals: ${run.proposals_generated}`);
  logger.info(`   Actions: APPLY=${run.actions_taken.APPLY} SAVE=${run.actions_taken.SAVE} IGNORE=${run.actions_taken.IGNORE}`);
  if (run.errors.length > 0) {
    logger.warn(`   Errors: ${run.errors.length}`);
  }
  logger.info(`${"═".repeat(60)}\n`);

  return run;
}

function logScoreSummary(opps: Opportunity[]): void {
  const top5 = opps.slice(0, 5);
  logger.info("\n  Top opportunities:");
  for (const opp of top5) {
    logger.info(`  [${opp.score ?? 0}] ${opp.title.slice(0, 60)} (${opp.source})`);
  }
}

// ─────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipSources = args
    .filter((a: string) => a.startsWith("--skip="))
    .map((a: string) => a.replace("--skip=", ""));

  runPipeline({ dryRun, skipSources })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(err);
      process.exit(1);
    });
}
