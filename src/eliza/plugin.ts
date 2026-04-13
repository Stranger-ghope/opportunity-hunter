/**
 * ElizaOS v2 Plugin — Opportunity Hunter
 *
 * Registers the full multi-agent pipeline as a first-class ElizaOS plugin:
 *  - Actions  : on-demand pipeline control via natural language
 *  - Service  : autonomous background scheduler (runs pipeline every N minutes)
 *  - Routes   : REST API endpoints served by the ElizaOS HTTP layer
 *  - Models   : bridges ElizaOS model calls → Nosana inference (OpenAI-compatible)
 */

import {
  Service,
  ModelType,
  type Action,
  type Plugin,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  type Route,
} from "@elizaos/core";

import { runPipeline } from "../pipeline";
import { db } from "../memory/database";
import { runFeedbackAgent } from "../agents/feedbackAgent";
import { ingestRawText } from "../agents/sources/manualAgent";
import { llmClient } from "../llm/client";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────
// PIPELINE SCHEDULER SERVICE
// Autonomous background task — runs pipeline on a configurable interval.
// Registered in the plugin so ElizaOS lifecycle manages start/stop.
// ─────────────────────────────────────────────

export class PipelineSchedulerService extends Service {
  static serviceType = "opportunity-pipeline-scheduler";
  capabilityDescription =
    "Autonomously discovers, scores, and proposes responses to new opportunities on a configurable schedule";

  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const svc = new PipelineSchedulerService(runtime);
    svc.beginSchedule();
    return svc;
  }

  private beginSchedule(): void {
    const mins = parseInt(process.env.PIPELINE_INTERVAL_MINUTES || "60", 10);
    logger.info(`[ElizaOS:Scheduler] Pipeline will run every ${mins} min`);

    setTimeout(() => {
      runPipeline().catch((e: unknown) =>
        logger.error("[ElizaOS:Scheduler] Startup run error", e)
      );
    }, 5_000);

    this.intervalHandle = setInterval(
      () => {
        runPipeline().catch((e: unknown) =>
          logger.error("[ElizaOS:Scheduler] Scheduled run error", e)
        );
      },
      mins * 60 * 1000
    );
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    logger.info("[ElizaOS:Scheduler] Stopped");
  }
}

// ─────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────

const runPipelineAction: Action = {
  name: "RUN_OPPORTUNITY_PIPELINE",
  similes: ["HUNT_OPPORTUNITIES", "FIND_JOBS", "SCAN_FOR_OPPORTUNITIES", "FIND_GIGS"],
  description:
    "Run the full autonomous opportunity pipeline: ingest from RSS feeds and Reddit; normalize, score with multi-dimensional LLM analysis, generate tailored proposals, and make APPLY/SAVE/IGNORE decisions.",
  validate: async (): Promise<boolean> => true,
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[ElizaOS:Action] RUN_OPPORTUNITY_PIPELINE triggered");
      const run = await runPipeline();
      const summary =
        `Pipeline complete ✅ — Found: ${run.opportunities_found} | ` +
        `Proposals: ${run.proposals_generated} | ` +
        `Apply: ${run.actions_taken.APPLY ?? 0} | ` +
        `Save: ${run.actions_taken.SAVE ?? 0} | ` +
        `Ignore: ${run.actions_taken.IGNORE ?? 0}`;
      void callback?.({ text: summary });
      return { success: true, text: summary, data: { run } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void callback?.({ text: `Pipeline failed: ${msg}` });
      return { success: false, error: msg };
    }
  },
  examples: [
    [
      { name: "user", content: { text: "Find me new opportunities" } },
      {
        name: "OpportunityHunter",
        content: {
          text: "Running full pipeline — scanning RSS feeds and Reddit for opportunities...",
          actions: ["RUN_OPPORTUNITY_PIPELINE"],
        },
      },
    ],
    [
      { name: "user", content: { text: "Hunt for freelance gigs" } },
      {
        name: "OpportunityHunter",
        content: {
          text: "Pipeline complete ✅ — Found: 12 | Proposals: 3 | Apply: 3 | Save: 7 | Ignore: 2",
          actions: ["RUN_OPPORTUNITY_PIPELINE"],
        },
      },
    ],
  ],
};

const getOpportunitiesAction: Action = {
  name: "GET_TOP_OPPORTUNITIES",
  similes: ["SHOW_OPPORTUNITIES", "LIST_JOBS", "WHAT_SHOULD_I_APPLY_TO", "SHOW_BEST_GIGS"],
  description:
    "Retrieve the top scored opportunities currently flagged APPLY, with proposal text ready to review.",
  validate: async (): Promise<boolean> => true,
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const opps = db.getAllOpportunities(20);
      const apply = opps.filter((o) => o.action === "APPLY").slice(0, 5);
      if (apply.length === 0) {
        const msg = "No APPLY-recommended opportunities yet. Run the pipeline first.";
        void callback?.({ text: msg });
        return { success: true, text: msg };
      }
      const list = apply
        .map((o, i) => `${i + 1}. [Score: ${o.score ?? "?"}] ${o.title} — ${o.source}`)
        .join("\n");
      const msg = `Top opportunities to apply to:\n\n${list}\n\nFull proposals available in the dashboard at http://localhost:3000`;
      void callback?.({ text: msg });
      return { success: true, text: msg, data: { opportunities: apply } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  },
  examples: [
    [
      { name: "user", content: { text: "What should I apply to?" } },
      {
        name: "OpportunityHunter",
        content: {
          text: "Top opportunities:\n\n1. [Score: 89] Senior Solidity Dev — Crypto Jobs List",
          actions: ["GET_TOP_OPPORTUNITIES"],
        },
      },
    ],
  ],
};

const ingestOpportunityAction: Action = {
  name: "INGEST_OPPORTUNITY",
  similes: ["ADD_JOB", "PASTE_JOB_POSTING", "MANUALLY_ADD_OPPORTUNITY", "EVALUATE_THIS"],
  description:
    "Manually ingest a raw job posting or opportunity text for normalization, scoring, and proposal generation.",
  validate: async (
    _runtime: IAgentRuntime,
    message: Memory
  ): Promise<boolean> =>
    typeof message.content?.text === "string" &&
    (message.content.text?.length ?? 0) > 30,
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const text = message.content?.text ?? "";
      const opp = ingestRawText(text);
      const msg = `Ingested: "${opp.title}" (ID: ${opp.id}). Run the pipeline to score and generate a proposal.`;
      void callback?.({ text: msg });
      return { success: true, text: msg, values: { opportunityId: opp.id } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  },
  examples: [
    [
      {
        name: "user",
        content: { text: "We need a Solidity dev, 3-month contract, $150/hr, fully remote." },
      },
      {
        name: "OpportunityHunter",
        content: {
          text: 'Ingested: "Solidity Developer" (ID: abc123). Run the pipeline to score it.',
          actions: ["INGEST_OPPORTUNITY"],
        },
      },
    ],
  ],
};

const getFeedbackInsightsAction: Action = {
  name: "GET_FEEDBACK_INSIGHTS",
  similes: ["SHOW_INSIGHTS", "HOW_AM_I_DOING", "PERFORMANCE_REPORT", "WHAT_WORKS"],
  description:
    "Analyze application outcomes and surface insights on winning skills, score patterns, and proposal style improvements.",
  validate: async (): Promise<boolean> => true,
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const insights = await runFeedbackAgent();
      const report = [
        "📊 Performance Report",
        `Applications: ${insights.total_applied}`,
        `Accept rate:  ${Math.round(insights.accepted_rate * 100)}%`,
        `Avg score (wins): ${insights.avg_winning_score}`,
        `Top skills: ${insights.top_winning_skills.join(", ") || "N/A"}`,
        `\nStyle notes: ${insights.proposal_style_notes}`,
      ].join("\n");
      void callback?.({ text: report });
      return { success: true, text: report, data: { insights } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  },
  examples: [
    [
      { name: "user", content: { text: "How are my job applications doing?" } },
      {
        name: "OpportunityHunter",
        content: {
          text: "📊 Performance Report\nApplications: 12\nAccept rate: 33%\nTop skills: Solidity, TypeScript",
          actions: ["GET_FEEDBACK_INSIGHTS"],
        },
      },
    ],
  ],
};

// ─────────────────────────────────────────────
// ROUTES
// ElizaOS HTTP routes exposing the pipeline API.
// These are served alongside the Express dashboard.
// ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRes = { json: (d: unknown) => void; status: (c: number) => any };

const apiRoutes: Route[] = [
  {
    type: "GET",
    path: "/api/opportunities",
    name: "List Opportunities",
    public: true,
    handler: async (_req, res) => {
      (res as unknown as AnyRes).json(db.getAllOpportunities(100));
    },
  },
  {
    type: "GET",
    path: "/api/stats",
    name: "Pipeline Stats",
    public: true,
    handler: async (_req, res) => {
      (res as unknown as AnyRes).json(db.getStats());
    },
  },
  {
    type: "POST",
    path: "/api/pipeline/run",
    name: "Trigger Pipeline",
    public: false,
    handler: async (_req, res) => {
      runPipeline().catch((e: unknown) =>
        logger.error("[ElizaOS:Route] Pipeline trigger error", e)
      );
      (res as unknown as AnyRes).json({ status: "started" });
    },
  },
  {
    type: "GET",
    path: "/api/insights",
    name: "Feedback Insights",
    public: true,
    handler: async (_req, res) => {
      (res as unknown as AnyRes).json(db.getLatestFeedbackInsights());
    },
  },
];

// ─────────────────────────────────────────────
// PLUGIN EXPORT
// ─────────────────────────────────────────────

export const opportunityHunterPlugin: Plugin = {
  name: "opportunity-hunter",
  description:
    "Autonomous opportunity discovery: scans RSS feeds and Reddit; scores with multi-dimensional LLM analysis; generates tailored proposals; self-improves via outcome feedback. Powered by Nosana GPU inference.",

  actions: [
    runPipelineAction,
    getOpportunitiesAction,
    ingestOpportunityAction,
    getFeedbackInsightsAction,
  ],

  services: [PipelineSchedulerService],

  routes: apiRoutes,

  // Bridge ElizaOS model calls to our Nosana-backed LLM client (Qwen3.5-27B-AWQ-4bit)
  models: {
    [ModelType.TEXT_LARGE]: async (
      _runtime: IAgentRuntime,
      params: { prompt: string; [key: string]: unknown }
    ) => {
      const res = await llmClient.complete({
        system_prompt:
          "You are OpportunityHunter, an autonomous AI agent that discovers and pursues freelance opportunities. Powered by Nosana decentralized GPU inference.",
        user_prompt: params.prompt,
      });
      return res.content;
    },
    [ModelType.TEXT_SMALL]: async (
      _runtime: IAgentRuntime,
      params: { prompt: string; [key: string]: unknown }
    ) => {
      const res = await llmClient.complete({
        system_prompt: "You are OpportunityHunter, a helpful and precise AI assistant.",
        user_prompt: params.prompt,
      });
      return res.content;
    },
  },

  init: async (_config, runtime) => {
    logger.info(
      `[ElizaOS:Plugin] opportunity-hunter initialized for agent "${runtime.character.name}"`
    );
  },
};
