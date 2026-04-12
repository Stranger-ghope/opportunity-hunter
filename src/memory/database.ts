/**
 * SQLite persistence layer using node-sqlite3-wasm (pure WASM, no native build tools needed).
 * Stores opportunities, proposals, outcomes, pipeline runs, and feedback state.
 */

import { Database } from "node-sqlite3-wasm";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";
import type {
  Opportunity,
  Proposal,
  OutcomeRecord,
  PipelineRun,
  FeedbackInsights,
} from "../types";

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = path.join(DATA_DIR, "opportunities.db");

class OpportunityDatabase {
  private db: InstanceType<typeof Database>;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    this.db = new Database(DB_PATH);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initSchema();
    logger.info(`[DB] Connected to ${DB_PATH}`);
  }

  // ─────────────────────────────────────────────
  // SCHEMA
  // ─────────────────────────────────────────────

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        url TEXT,
        budget TEXT,
        skills TEXT,          -- JSON array
        timestamp TEXT,
        raw_text TEXT,
        normalized_at TEXT,
        score INTEGER,
        score_breakdown TEXT, -- JSON
        score_reasoning TEXT,
        action TEXT,
        action_reasoning TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        tags TEXT,            -- JSON array
        company TEXT,
        location TEXT,
        remote INTEGER,
        deadline TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        full_text TEXT NOT NULL,
        short_version TEXT NOT NULL,
        word_count INTEGER,
        generated_at TEXT,
        version INTEGER DEFAULT 1,
        critic_feedback TEXT,
        improved_version TEXT,
        FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
      );

      CREATE TABLE IF NOT EXISTS outcomes (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        proposal_id TEXT,
        outcome TEXT NOT NULL,
        feedback_notes TEXT,
        recorded_at TEXT,
        response_time_hours REAL,
        FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
      );

      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT,
        completed_at TEXT,
        sources_checked TEXT,  -- JSON
        opportunities_found INTEGER DEFAULT 0,
        opportunities_scored INTEGER DEFAULT 0,
        proposals_generated INTEGER DEFAULT 0,
        actions_taken TEXT,    -- JSON
        errors TEXT,           -- JSON
        status TEXT DEFAULT 'running'
      );

      CREATE TABLE IF NOT EXISTS feedback_insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_at TEXT,
        data TEXT             -- JSON blob
      );

      CREATE INDEX IF NOT EXISTS idx_opp_status ON opportunities(status);
      CREATE INDEX IF NOT EXISTS idx_opp_score ON opportunities(score);
      CREATE INDEX IF NOT EXISTS idx_opp_source ON opportunities(source);
      CREATE INDEX IF NOT EXISTS idx_opp_url ON opportunities(url);
    `);
  }

  // ─────────────────────────────────────────────
  // STATEMENT HELPERS (node-sqlite3-wasm requires manual finalize)
  // ─────────────────────────────────────────────

  private stmtRun(sql: string, params?: unknown[] | Record<string, unknown>): void {
    const stmt = this.db.prepare(sql);
    stmt.run(params as never);
    stmt.finalize();
  }

  private stmtGet<T>(sql: string, params?: unknown[] | Record<string, unknown>): T | undefined {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(params as never) as T | undefined;
    stmt.finalize();
    return row;
  }

  private stmtAll<T>(sql: string, params?: unknown[] | Record<string, unknown>): T[] {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params as never) as T[];
    stmt.finalize();
    return rows;
  }

  // ─────────────────────────────────────────────
  // OPPORTUNITIES
  // ─────────────────────────────────────────────

  upsertOpportunity(opp: Opportunity): void {
    this.stmtRun(`
      INSERT INTO opportunities (
        id, title, source, url, budget, skills, timestamp, raw_text,
        normalized_at, score, score_breakdown, score_reasoning,
        action, action_reasoning, status, tags, company, location, remote, deadline
      ) VALUES (
        @id, @title, @source, @url, @budget, @skills, @timestamp, @raw_text,
        @normalized_at, @score, @score_breakdown, @score_reasoning,
        @action, @action_reasoning, @status, @tags, @company, @location, @remote, @deadline
      )
      ON CONFLICT(id) DO UPDATE SET
        score = excluded.score,
        score_breakdown = excluded.score_breakdown,
        score_reasoning = excluded.score_reasoning,
        action = excluded.action,
        action_reasoning = excluded.action_reasoning,
        status = excluded.status,
        normalized_at = excluded.normalized_at,
        tags = excluded.tags
    `, {
      ...opp,
      skills: JSON.stringify(opp.skills || []),
      score_breakdown: opp.score_breakdown ? JSON.stringify(opp.score_breakdown) : null,
      tags: JSON.stringify(opp.tags || []),
      remote: opp.remote ? 1 : 0,
    } as Record<string, unknown>);
  }

  getOpportunityById(id: string): Opportunity | null {
    const row = this.stmtGet<Record<string, unknown>>(
      "SELECT * FROM opportunities WHERE id = ?",
      [id]
    );
    return row ? this.deserializeOpportunity(row) : null;
  }

  getOpportunitiesByStatus(status: Opportunity["status"]): Opportunity[] {
    const rows = this.stmtAll<Record<string, unknown>>(
      "SELECT * FROM opportunities WHERE status = ? ORDER BY score DESC, created_at DESC",
      [status]
    );
    return rows.map(this.deserializeOpportunity);
  }

  getAllOpportunities(limit = 200): Opportunity[] {
    const rows = this.stmtAll<Record<string, unknown>>(
      "SELECT * FROM opportunities ORDER BY score DESC, created_at DESC LIMIT ?",
      [limit]
    );
    return rows.map(this.deserializeOpportunity);
  }

  opportunityExistsByUrl(url: string): boolean {
    const row = this.stmtGet<{ id: string }>("SELECT id FROM opportunities WHERE url = ?", [url]);
    return !!row;
  }

  updateOpportunityStatus(id: string, status: Opportunity["status"]): void {
    this.stmtRun("UPDATE opportunities SET status = ? WHERE id = ?", [status, id]);
  }

  // ─────────────────────────────────────────────
  // PROPOSALS
  // ─────────────────────────────────────────────

  saveProposal(proposal: Proposal): void {
    this.stmtRun(`
      INSERT OR REPLACE INTO proposals
        (id, opportunity_id, full_text, short_version, word_count, generated_at, version, critic_feedback, improved_version)
      VALUES
        (@id, @opportunity_id, @full_text, @short_version, @word_count, @generated_at, @version, @critic_feedback, @improved_version)
    `, proposal as unknown as Record<string, unknown>);
  }

  getProposalByOpportunityId(opportunityId: string): Proposal | null {
    const row = this.stmtGet<Proposal>(
      "SELECT * FROM proposals WHERE opportunity_id = ? ORDER BY version DESC LIMIT 1",
      [opportunityId]
    );
    return row ?? null;
  }

  // ─────────────────────────────────────────────
  // OUTCOMES
  // ─────────────────────────────────────────────

  saveOutcome(outcome: OutcomeRecord): void {
    this.stmtRun(`
      INSERT OR REPLACE INTO outcomes
        (id, opportunity_id, proposal_id, outcome, feedback_notes, recorded_at, response_time_hours)
      VALUES
        (@id, @opportunity_id, @proposal_id, @outcome, @feedback_notes, @recorded_at, @response_time_hours)
    `, outcome as unknown as Record<string, unknown>);
  }

  getOutcomes(): OutcomeRecord[] {
    return this.stmtAll<OutcomeRecord>("SELECT * FROM outcomes ORDER BY recorded_at DESC");
  }

  // ─────────────────────────────────────────────
  // PIPELINE RUNS
  // ─────────────────────────────────────────────

  savePipelineRun(run: PipelineRun): void {
    this.stmtRun(`
      INSERT OR REPLACE INTO pipeline_runs
        (id, started_at, completed_at, sources_checked, opportunities_found, opportunities_scored, proposals_generated, actions_taken, errors, status)
      VALUES
        (@id, @started_at, @completed_at, @sources_checked, @opportunities_found, @opportunities_scored, @proposals_generated, @actions_taken, @errors, @status)
    `, {
      ...run,
      sources_checked: JSON.stringify(run.sources_checked),
      actions_taken: JSON.stringify(run.actions_taken),
      errors: JSON.stringify(run.errors),
    });
  }

  getRecentPipelineRuns(limit = 10): PipelineRun[] {
    const rows = this.stmtAll<Record<string, unknown>>(
      "SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT ?",
      [limit]
    );
    return rows.map((r) => ({
      ...(r as unknown as PipelineRun),
      sources_checked: JSON.parse(r.sources_checked as string || "[]"),
      actions_taken: JSON.parse(r.actions_taken as string || "{}"),
      errors: JSON.parse(r.errors as string || "[]"),
    }));
  }

  // ─────────────────────────────────────────────
  // FEEDBACK INSIGHTS
  // ─────────────────────────────────────────────

  saveFeedbackInsights(insights: FeedbackInsights): void {
    this.stmtRun(
      "INSERT INTO feedback_insights (snapshot_at, data) VALUES (datetime('now'), ?)",
      [JSON.stringify(insights)]
    );
  }

  getLatestFeedbackInsights(): FeedbackInsights | null {
    const row = this.stmtGet<{ data: string }>(
      "SELECT data FROM feedback_insights ORDER BY snapshot_at DESC LIMIT 1"
    );
    return row ? (JSON.parse(row.data) as FeedbackInsights) : null;
  }

  // ─────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────

  getStats(): Record<string, number> {
    const total = (this.stmtGet<{ c: number }>("SELECT COUNT(*) as c FROM opportunities") ?? { c: 0 }).c;
    const scored = (this.stmtGet<{ c: number }>("SELECT COUNT(*) as c FROM opportunities WHERE score IS NOT NULL") ?? { c: 0 }).c;
    const applied = (this.stmtGet<{ c: number }>("SELECT COUNT(*) as c FROM opportunities WHERE action = 'APPLY'") ?? { c: 0 }).c;
    const accepted = (this.stmtGet<{ c: number }>("SELECT COUNT(*) as c FROM outcomes WHERE outcome = 'accepted'") ?? { c: 0 }).c;
    return { total, scored, applied, accepted };
  }

  // ─────────────────────────────────────────────
  // DESERIALIZER
  // ─────────────────────────────────────────────

  private deserializeOpportunity(row: Record<string, unknown>): Opportunity {
    return {
      ...(row as unknown as Opportunity),
      skills: JSON.parse(row.skills as string || "[]"),
      score_breakdown: row.score_breakdown
        ? JSON.parse(row.score_breakdown as string)
        : undefined,
      tags: JSON.parse(row.tags as string || "[]"),
      remote: row.remote === 1,
    };
  }

  close(): void {
    this.db.close();
  }
}

// Singleton
export const db = new OpportunityDatabase();
