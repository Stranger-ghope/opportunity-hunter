/**
 * CLI — quick commands for the Opportunity Hunter system.
 *
 * Usage:
 *   ts-node src/cli.ts run              — full pipeline
 *   ts-node src/cli.ts run --dry-run    — ingest only
 *   ts-node src/cli.ts ingest <file>    — import JSON file
 *   ts-node src/cli.ts ingest --text    — paste raw text
 *   ts-node src/cli.ts list             — show scored opportunities
 *   ts-node src/cli.ts list --apply     — show APPLY decisions only
 *   ts-node src/cli.ts outcome <id> <accepted|rejected|no_response>
 *   ts-node src/cli.ts stats            — show pipeline stats
 *   ts-node src/cli.ts feedback         — run feedback analysis
 */

import "dotenv/config";
import readline from "readline";
import { runPipeline } from "./pipeline";
import { ingestJSONFile, ingestRawText } from "./agents/sources/manualAgent";
import { recordOutcome, runFeedbackAgent } from "./agents/feedbackAgent";
import { db } from "./memory/database";
import { logger } from "./utils/logger";

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case "run": {
      const dryRun = args.includes("--dry-run");
      const skipSources = args
        .filter((a: string) => a.startsWith("--skip="))
        .map((a: string) => a.replace("--skip=", ""));
      await runPipeline({ dryRun, skipSources });
      break;
    }

    case "ingest": {
      const subCmd = args[1];
      if (subCmd === "--text") {
        const text = await readMultilineInput("Paste job description (Ctrl+D when done):\n");
        const opp = ingestRawText(text);
        console.log(`\n✅ Ingested: "${opp.title}" (${opp.id})`);
        console.log("Run 'ts-node src/cli.ts run --skip=rss --skip=reddit --skip=email' to process it.");
      } else if (subCmd) {
        const opps = ingestJSONFile(subCmd);
        console.log(`\n✅ Ingested ${opps.length} opportunities from ${subCmd}`);
      } else {
        console.error("Usage: ingest <file.json> | ingest --text");
      }
      break;
    }

    case "list": {
      const opps = db.getAllOpportunities(50);
      const filterApply = args.includes("--apply");
      const filtered = filterApply
        ? opps.filter((o) => o.action === "APPLY")
        : opps.slice(0, 20);

      console.log(`\n${"─".repeat(70)}`);
      console.log(
        `${"SCORE".padEnd(7)} ${"ACTION".padEnd(9)} ${"SOURCE".padEnd(20)} TITLE`
      );
      console.log("─".repeat(70));

      for (const opp of filtered) {
        const score = opp.score != null ? String(opp.score).padEnd(7) : "N/A    ";
        const action = (opp.action || opp.status || "").padEnd(9);
        const source = (opp.source || "").slice(0, 18).padEnd(20);
        const title = opp.title.slice(0, 40);
        console.log(`${score} ${action} ${source} ${title}`);
      }
      console.log("─".repeat(70));
      console.log(`Total: ${opps.length} | Showing: ${filtered.length}`);
      break;
    }

    case "outcome": {
      const oppId = args[1];
      const outcomeVal = args[2] as "accepted" | "rejected" | "no_response";
      if (!oppId || !outcomeVal) {
        console.error("Usage: outcome <opportunity-id> <accepted|rejected|no_response>");
        break;
      }
      recordOutcome(oppId, outcomeVal);
      console.log(`\n✅ Outcome recorded: ${oppId} → ${outcomeVal}`);
      break;
    }

    case "stats": {
      const stats = db.getStats();
      const runs = db.getRecentPipelineRuns(3);
      console.log("\n📊 STATS");
      console.log("─".repeat(40));
      console.log(`  Total opportunities:  ${stats.total}`);
      console.log(`  Scored:               ${stats.scored}`);
      console.log(`  Applied:              ${stats.applied}`);
      console.log(`  Accepted:             ${stats.accepted}`);
      if (runs.length > 0) {
        const last = runs[0];
        console.log(`\n  Last run: ${last.started_at}`);
        console.log(`  Status:   ${last.status}`);
        console.log(
          `  Actions:  A=${last.actions_taken.APPLY} S=${last.actions_taken.SAVE} I=${last.actions_taken.IGNORE}`
        );
      }
      break;
    }

    case "feedback": {
      console.log("\n📊 Running feedback analysis...");
      const insights = await runFeedbackAgent();
      console.log("\n✅ Feedback Insights:");
      console.log(`  Applied:          ${insights.total_applied}`);
      console.log(`  Accept rate:      ${Math.round(insights.accepted_rate * 100)}%`);
      console.log(`  Avg win score:    ${insights.avg_winning_score}`);
      console.log(`  Top skills:       ${insights.top_winning_skills.join(", ") || "N/A"}`);
      console.log(`  Top sources:      ${insights.top_winning_sources.join(", ") || "N/A"}`);
      console.log(`\n  Style notes:\n  ${insights.proposal_style_notes}`);
      break;
    }

    default: {
      console.log(`
🎯 Opportunity Hunter CLI

Commands:
  run [--dry-run] [--skip=rss] [--skip=reddit] [--skip=email]
  ingest <file.json>
  ingest --text
  list [--apply]
  outcome <id> <accepted|rejected|no_response>
  stats
  feedback
      `);
    }
  }
}

function readMultilineInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    const lines: string[] = [];
    console.log(prompt);
    rl.on("line", (line) => lines.push(line));
    rl.on("close", () => resolve(lines.join("\n")));
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(err);
    process.exit(1);
  });
