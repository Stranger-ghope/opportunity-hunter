/**
 * Dashboard API Server — Express + Socket.IO.
 *
 * Provides REST endpoints and real-time updates for the web dashboard.
 * Human-in-the-loop: approve/reject actions, record outcomes, ingest manually.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import type { Request, Response, NextFunction } from "express";

import { db } from "../memory/database";
import { runPipeline } from "../pipeline";
import { ingestStructured } from "../agents/sources/manualAgent";
import { runScoringAgent } from "../agents/scoringAgent";
import { runActionAgent } from "../agents/actionAgent";
import { runProposalAgent } from "../agents/proposalAgent";
import { recordOutcome, runFeedbackAgent } from "../agents/feedbackAgent";
import { logger } from "../utils/logger";
import profileConfig from "../../config/profile.json";
import type { UserProfile, Opportunity } from "../types";

const profile = profileConfig as UserProfile;
const PORT = parseInt(process.env.DASHBOARD_PORT || "3000", 10);

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "../../public")));

// ─────────────────────────────────────────────
// REAL-TIME: broadcast pipeline progress via Socket.IO
// ─────────────────────────────────────────────

export function broadcastEvent(event: string, data: unknown): void {
  io.emit(event, data);
}

io.on("connection", (socket) => {
  logger.debug(`[Dashboard] Client connected: ${socket.id}`);
  // Send current stats on connect
  socket.emit("stats", db.getStats());
});

// ─────────────────────────────────────────────
// REST API
// ─────────────────────────────────────────────

// ── Opportunities ────────────────────────────

app.get("/api/opportunities", (_req: Request, res: Response) => {
  const opps = db.getAllOpportunities(200);
  res.json({ success: true, data: opps, count: opps.length });
});

app.get("/api/opportunities/:id", (req: Request, res: Response) => {
  const opp = db.getOpportunityById(req.params.id);
  if (!opp) return res.status(404).json({ success: false, error: "Not found" });
  const proposal = db.getProposalByOpportunityId(req.params.id);
  res.json({ success: true, data: { ...opp, proposal } });
});

app.get("/api/opportunities/status/:status", (req: Request, res: Response) => {
  const opps = db.getOpportunitiesByStatus(
    req.params.status as Opportunity["status"]
  );
  res.json({ success: true, data: opps });
});

// ── Pipeline ─────────────────────────────────

app.post("/api/reset", (_req: Request, res: Response) => {
  try {
    db.clearAll();
    io.emit("stats", db.getStats());
    res.json({ success: true, message: "All data cleared. Ready for a fresh pipeline run." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

app.post("/api/pipeline/run", async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, message: "Pipeline started. Check /api/pipeline/runs for progress." });
    // Run async so response is immediate
    runPipeline()
      .then((run) => {
        io.emit("pipeline:complete", run);
        io.emit("stats", db.getStats());
      })
      .catch((err) => io.emit("pipeline:error", { message: err.message }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

app.post("/api/pipeline/run/dry", async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, message: "Dry run started." });
    runPipeline({ dryRun: true })
      .then((run) => {
        io.emit("pipeline:complete", run);
        io.emit("stats", db.getStats());
      })
      .catch((err) => io.emit("pipeline:error", { message: err.message }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

app.get("/api/pipeline/runs", (_req: Request, res: Response) => {
  const runs = db.getRecentPipelineRuns(20);
  res.json({ success: true, data: runs });
});

// ── Human-in-the-Loop Actions ─────────────────

app.post("/api/opportunities/:id/approve", (req: Request, res: Response) => {
  const opp = db.getOpportunityById(req.params.id);
  if (!opp) return res.status(404).json({ success: false, error: "Not found" });

  db.upsertOpportunity({ ...opp, status: "applied", action: "APPLY" });
  io.emit("opportunity:updated", db.getOpportunityById(req.params.id));
  res.json({ success: true, message: "Marked as applied" });
});

app.post("/api/opportunities/:id/reject", (req: Request, res: Response) => {
  const opp = db.getOpportunityById(req.params.id);
  if (!opp) return res.status(404).json({ success: false, error: "Not found" });

  db.upsertOpportunity({ ...opp, status: "ignored", action: "IGNORE" });
  io.emit("opportunity:updated", db.getOpportunityById(req.params.id));
  res.json({ success: true, message: "Marked as ignored" });
});

// ── Outcome Recording ─────────────────────────

app.post("/api/outcomes", (req: Request, res: Response) => {
  const { opportunity_id, outcome, feedback_notes, response_time_hours } = req.body as {
    opportunity_id: string;
    outcome: "accepted" | "rejected" | "no_response" | "pending";
    feedback_notes?: string;
    response_time_hours?: number;
  };

  if (!opportunity_id || !outcome) {
    return res.status(400).json({ success: false, error: "opportunity_id and outcome are required" });
  }

  const record = recordOutcome(opportunity_id, outcome, feedback_notes, response_time_hours);
  io.emit("outcome:recorded", record);

  // Re-run feedback analysis asynchronously
  runFeedbackAgent().catch((err) => logger.error(`[Dashboard] Feedback run failed: ${err}`));

  res.json({ success: true, data: record });
});

// ── Manual Ingest ─────────────────────────────

app.post("/api/ingest", (req: Request, res: Response) => {
  const { title, url, budget, skills, raw_text, source } = req.body as {
    title: string;
    url?: string;
    budget?: string;
    skills?: string[];
    raw_text: string;
    source?: string;
  };

  if (!title || !raw_text) {
    return res.status(400).json({ success: false, error: "title and raw_text are required" });
  }

  const opp = ingestStructured({ title, url, budget, skills, raw_text, source });
  io.emit("opportunity:new", opp);
  res.json({ success: true, data: opp });

  // Score and decide asynchronously — no_retry so it fails fast
  setImmediate(async () => {
    try {
      await runScoringAgent(opp, profile);
      const scored = db.getOpportunityById(opp.id)!;
      const { decision } = await runActionAgent(scored, profile, null);
      const decided = db.getOpportunityById(opp.id)!;
      io.emit("opportunity:updated", decided);
      io.emit("stats", db.getStats());
      if (decision === "APPLY") {
        await runProposalAgent(decided, profile);
        io.emit("opportunity:updated", db.getOpportunityById(opp.id));
      }
    } catch (err) {
      logger.warn(`[Ingest] Scoring failed for "${opp.title}": ${err}`);
    }
  });
});

// ── Stats & Insights ──────────────────────────

app.get("/api/stats", (_req: Request, res: Response) => {
  const stats = db.getStats();
  const insights = db.getLatestFeedbackInsights();
  res.json({ success: true, data: { stats, insights } });
});

app.get("/api/feedback/insights", async (_req: Request, res: Response) => {
  try {
    const insights = await runFeedbackAgent();
    res.json({ success: true, data: insights });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ── Profile ───────────────────────────────────

const PROFILE_PATH = path.resolve(__dirname, "../../config/profile.json");

app.get("/api/profile", (_req: Request, res: Response) => {
  try {
    const data = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf-8"));
    res.json({ success: true, data });
  } catch {
    res.json({ success: true, data: profile });
  }
});

app.put("/api/profile", (req: Request, res: Response) => {
  try {
    const updated = req.body as UserProfile;
    if (!updated.name || !updated.skills) {
      return res.status(400).json({ success: false, error: "name and skills are required" });
    }
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(updated, null, 2), "utf-8");
    logger.info("[Dashboard] Profile updated via UI");
    res.json({ success: true, message: "Profile saved. Changes apply on next pipeline run." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─────────────────────────────────────────────
// Error handler
// ─────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(`[Dashboard] Unhandled error: ${err.message}`);
  res.status(500).json({ success: false, error: err.message });
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────

server.listen(PORT, () => {
  logger.info(`\n🖥️  Dashboard running at http://localhost:${PORT}`);
  logger.info(`📡 Socket.IO ready`);
});

setInterval(() => {
  io.emit("stats", db.getStats());
}, 15_000);

export { app, server, io };
