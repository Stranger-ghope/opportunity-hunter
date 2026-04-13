/**
 * Main Entry Point — starts both the dashboard server and the pipeline scheduler.
 *
 * Usage:
 *   npm run dev       — starts dashboard + scheduler
 *   npm run pipeline  — runs pipeline once (CLI)
 *   npm run dashboard — starts dashboard only
 */

import "dotenv/config";
import cron from "node-cron";
import { logger } from "./utils/logger";
import { runPipeline } from "./pipeline";
import { initializeElizaAgent } from "./eliza/agent";

// Dashboard server
import { io } from "./dashboard/server";

// ─────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────

const INTERVAL_MINUTES = parseInt(
  process.env.PIPELINE_INTERVAL_MINUTES || "30",
  10
);

logger.info(`\n🤖 Opportunity Hunter — Starting up`);
logger.info(`   Framework: ElizaOS v2 (@elizaos/core)`);
logger.info(`   Model:    ${process.env.MODEL_NAME || "Qwen/Qwen3.5-27B-Instruct-AWQ"}`);
logger.info(`   Provider: ${process.env.INFERENCE_PROVIDER || "nosana"}`);
logger.info(`   Interval: every ${INTERVAL_MINUTES} minutes`);
logger.info(`   Threshold: ${process.env.SCORE_THRESHOLD || "60"}/100\n`);

// ─────────────────────────────────────────────
// ElizaOS Agent Runtime
// PipelineSchedulerService inside the plugin handles autonomous scheduling.
// Falls back to standalone cron if ElizaOS init fails.
// ─────────────────────────────────────────────

initializeElizaAgent()
  .then(() => {
    logger.info("✅ ElizaOS AgentRuntime active — PipelineSchedulerService running");
    logger.info("🖥️  Dashboard at http://localhost:3000\n");
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️  ElizaOS runtime unavailable (${msg}) — using standalone scheduler`);

    // Standalone fallback: run once + cron
    runPipeline()
      .then((run) => io.emit("pipeline:complete", run))
      .catch((e: unknown) =>
        logger.error(`❌ Initial pipeline failed: ${e instanceof Error ? e.message : e}`)
      );

    cron.schedule(`*/${INTERVAL_MINUTES} * * * *`, async () => {
      logger.info(`\n⏰ Scheduled pipeline run (every ${INTERVAL_MINUTES} min)`);
      try {
        const run = await runPipeline();
        io.emit("pipeline:complete", run);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`❌ Scheduled pipeline failed: ${msg}`);
        io.emit("pipeline:error", { message: msg });
      }
    });

    logger.info(`⏰ Standalone scheduler active — every ${INTERVAL_MINUTES} minutes`);
    logger.info("🖥️  Dashboard at http://localhost:3000\n");
  });

// ─────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────

function shutdown(signal: string): void {
  logger.info(`\n${signal} received. Shutting down gracefully...`);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err: Error) => {
  logger.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason: unknown) => {
  logger.error(`Unhandled rejection: ${reason}`);
});
