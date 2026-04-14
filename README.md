# 🎯 Opportunity Hunter — Autonomous Multi-Agent System

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![ElizaOS](https://img.shields.io/badge/ElizaOS-v2-blueviolet)
![Nosana](https://img.shields.io/badge/Deployed%20on-Nosana-00C896?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PC9zdmc+)
![Node](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

**Opportunity Hunter** is a production-grade autonomous multi-agent system that continuously discovers, evaluates, and applies to freelance accounting and finance opportunities — operating with minimal human intervention on **Nosana's decentralized GPU infrastructure**.

The system provides **end-to-end reliability** through a dual-endpoint architecture, circuit breaker fault tolerance, and semantic fallback scoring — ensuring continuous operation even when individual infrastructure components experience degradation.

**Nosana Inference Stack:**
- **Qwen3.5-27B-AWQ-4bit** — LLM inference for scoring, action decisions, and proposal generation
- **Qwen3-Embedding-0.6B (1024-dim)** — Semantic similarity scoring and RAG-style relevance fallback

🌐 **Live Demo:** https://3fz2feoev2kkqvdrc4fjelzthqyuklyxceozuqp48fvq.node.k8s.prd.nos.ci/
📦 **GitHub:** https://github.com/Stranger-ghope/opportunity-hunter

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PIPELINE ORCHESTRATOR                        │
└──────────┬──────────────────────────────────────────────────────┘
           │
    ┌──────▼──────────────────────────────────────────┐
    │              PHASE 1: SOURCE AGENTS              │
    │  ┌──────────┐ ┌──────────┐ ┌──────┐            │
    │  │ RSS Agent│ │ Reddit   │ │Manual│            │
    │  │(category)│ │(niche)   │ │Input │            │
    │  └──────────┘ └──────────┘ └──────┘            │
    └──────────────────────┬──────────────────────────┘
                           │ raw Opportunity[]
    ┌──────────────────────▼──────────────────────────┐
    │          PHASE 2: NORMALIZATION AGENT            │
    │  • Deduplication  • Keyword filtering            │
    │  • Schema enforcement  • Tag enrichment          │
    └──────────────────────┬──────────────────────────┘
                           │ clean Opportunity[]
    ┌──────────────────────▼──────────────────────────┐
    │            PHASE 3: SCORING AGENT               │
    │  LLM scores on 5 dimensions (0-100):            │
    │  skill_match | budget | urgency |               │
    │  competition | relevance                        │
    │  + Embedding fallback when LLM unavailable      │
    └──────────────────────┬──────────────────────────┘
                           │ scored Opportunity[]
    ┌──────────────────────▼──────────────────────────┐
    │           PHASE 4: ACTION AGENT                  │
    │  APPLY (score ≥ 55) │ SAVE │ IGNORE              │
    │  LLM reasoning + fast-path rules                │
    └──────────────────────┬──────────────────────────┘
                           │ APPLY list
    ┌──────────────────────▼──────────────────────────┐
    │    PHASE 5: PROPOSAL AGENT + CRITIC LOOP          │
    │                                                 │
    │  ┌────────────────────────────────────┐        │
    │  │ ProposalAgent → draft              │        │
    │  │       ↓                            │        │
    │  │ CriticAgent → score (1-10)         │        │
    │  │       ↓                            │        │
    │  │ If score < 8 → improve + re-score  │        │
    │  │       ↓                            │        │
    │  │ Final proposal → human review      │        │
    │  └────────────────────────────────────┘        │
    └──────────────────────┬──────────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────────┐
    │           PHASE 6: FEEDBACK AGENT                │
    │  Tracks outcomes → Derives insights             │
    │  Adjusts scoring bias, proposal style           │
    │  → Self-improving loop                          │
    └─────────────────────────────────────────────────┘
```

---

## Deep Nosana Integration

This project demonstrates comprehensive integration with Nosana's decentralized infrastructure:

### Dual-Endpoint Architecture
| Endpoint | Model | Use Case |
|----------|-------|----------|
| LLM Inference | Qwen3.5-27B-AWQ-4bit | Scoring, proposals, actions |
| Embeddings | Qwen3-Embedding-0.6B (1024-dim) | Semantic similarity fallback |

### Circuit Breaker Pattern

Both the LLM and embedding clients implement a **three-state circuit breaker** — a standard distributed systems pattern for fault isolation:

```
  ┌──────────────────────────────────────────────────────┐
  │                CIRCUIT BREAKER STATE MACHINE          │
  │                                                       │
  │   Requests OK       5 consecutive failures            │
  │  ┌──────────┐  ─────────────────────────►  ┌───────┐ │
  │  │  CLOSED  │                              │  OPEN │ │
  │  │(healthy) │  ◄─────────────────────────  │(fail) │ │
  │  └──────────┘   reset at pipeline start    └───────┘ │
  │        ▲                                       │      │
  │        │         probe after timeout           │      │
  │        │    ┌─────────────┐                   │      │
  │        └────│  HALF-OPEN  │◄──────────────────┘      │
  │             │  (1 probe)  │                           │
  │             └─────────────┘                           │
  └──────────────────────────────────────────────────────┘
```

| State | Behaviour |
|-------|-----------|
| **CLOSED** | Requests pass through normally, failure counter tracked |
| **OPEN** | All requests fast-fail immediately — no network overhead |
| **HALF-OPEN** | One probe request allowed; success → CLOSED, failure → OPEN |

- Threshold: **5 consecutive failures** → circuit opens
- Recovery: **resets at each pipeline run** (probe attempt)
- Observable: live state visible on Infrastructure dashboard tab

### Graceful Degradation — Competitive Advantage on Decentralized Infra

Decentralized GPU networks are inherently less predictable than centralized cloud providers — nodes can be reassigned, over-capacity, or mid-reboot. This makes **graceful degradation a first-class requirement**, not an afterthought.

When the LLM endpoint becomes unavailable:

```
  LLM Endpoint → 503   →   Circuit Opens (OPEN state)
        │
        ▼
  Scoring Agent detects circuit is open
        │
        ▼
  Falls back to EmbeddingClient (Qwen3-Embedding-0.6B)
        │
        ▼
  Cosine similarity: embed(profile) · embed(job_description)
        │
        ▼
  Relevance dimension scored via semantic distance
        │
        ▼
  Pipeline continues at full throughput — zero downtime
```

**The system never crashes, hangs, or surfaces raw errors to the user.** Scoring quality degrades gracefully; operational continuity is preserved.

### Infrastructure Monitoring
Live dashboard tab shows:
- Endpoint health (healthy/unavailable)
- Circuit breaker state (open/closed)
- Consecutive failure count
- Profile embedding cache status
- Exact Nosana node URLs

---

## Project Structure

```
opportunity-hunter/
├── characters/
│   └── agent.character.json         # ElizaOS agent character definition
├── src/
│   ├── agents/
│   │   ├── sources/
│   │   │   ├── rssAgent.ts          # RSS/Atom feed ingestion (profile-specific)
│   │   │   ├── redditAgent.ts       # Reddit API ingestion (niche subreddits)
│   │   │   └── manualAgent.ts       # Manual text/JSON import
│   │   ├── normalizationAgent.ts    # Schema enforcement + dedup
│   │   ├── scoringAgent.ts          # LLM-powered 5-dim scoring + embedding fallback
│   │   ├── proposalAgent.ts         # Tailored proposal generation
│   │   ├── criticAgent.ts           # Proposal review + improvement
│   │   ├── actionAgent.ts           # APPLY/SAVE/IGNORE decisions
│   │   └── feedbackAgent.ts         # Outcome tracking + insights
│   ├── dashboard/
│   │   └── server.ts                # Express + Socket.IO API
│   ├── eliza/
│   │   ├── agent.ts                 # Main ElizaOS agent setup
│   │   ├── characters.ts            # Character orchestrator
│   │   └── plugin.ts                # Plugin actions (RUN_OPPORTUNITY_PIPELINE, etc.)
│   ├── llm/
│   │   ├── client.ts                # LLM client with circuit breaker (Nosana/Ollama/OpenAI)
│   │   └── embeddingClient.ts       # Embedding client for semantic similarity (Nosana)
│   ├── memory/
│   │   └── database.ts              # SQLite persistence layer
│   ├── pipeline.ts                  # Main pipeline orchestrator
│   └── index.ts                     # Entry point + scheduler
├── config/
│   ├── profile.json                 # User profile (accountant, 8 years exp)
│   └── sources.json                 # Feed/subreddit configuration
├── public/
│   └── index.html                   # Web dashboard (real-time updates)
├── nos_job_def/
│   └── nosana_eliza_job_definition.json  # Official Nosana deployment config
├── Dockerfile
├── docker-compose.yml
├── nosana.yml                        # Nosana job definition (YAML format)
└── .env.example
```

---

## Quick Start

> ⏱️ **Judge fast-path: 60 seconds to running dashboard**

### 1. Clone & Install

```bash
git clone https://github.com/Stranger-ghope/opportunity-hunter
cd opportunity-hunter
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

The `.env.example` includes pre-configured Nosana endpoints — **no changes needed to run immediately.** Optionally edit:

```env
# Required: Nosana inference endpoints
INFERENCE_PROVIDER=nosana
NOSANA_API_URL=https://6vq2bcqphcansrs9b88ztxfs88oqy7etah2ugudytv2x.node.k8s.prd.nos.ci/v1
OPENAI_API_URL=https://6vq2bcqphcansrs9b88ztxfs88oqy7etah2ugudytv2x.node.k8s.prd.nos.ci/v1
OPENAI_API_KEY=nosana
MODEL_NAME=Qwen3.5-27B-AWQ-4bit

# Required: Nosana embedding endpoint (semantic similarity scoring)
OPENAI_EMBEDDING_URL=https://4yiccatpyxx773jtewo5ccwhw1s2hezq5pehndb6fcfq.node.k8s.prd.nos.ci/v1
OPENAI_EMBEDDING_API_KEY=nosana
OPENAI_EMBEDDING_MODEL=Qwen3-Embedding-0.6B
OPENAI_EMBEDDING_DIMENSIONS=1024

# Optional: Reddit API (public posts work without auth)
REDDIT_CLIENT_ID=your_id
REDDIT_CLIENT_SECRET=your_secret
```

**Edit your profile** at `config/profile.json` (default: Freelance Accountant):

```json
{
  "name": "Jordan Mitchell",
  "title": "Freelance Accountant & Financial Analyst",
  "bio": "CPA-certified accountant with 8 years of experience serving startups and growing businesses...",
  "skills": [
    "Accounting", "QuickBooks", "GAAP", "Financial Reporting",
    "Budgeting", "Forecasting", "Tax Preparation", "Bookkeeping",
    "Financial Analysis", "Payroll", "Excel", "Cash Flow Management"
  ],
  "experience_years": 8,
  "niches": ["Startup Accounting", "Financial Analysis", "Remote Bookkeeping"],
  "hourly_rate_min": 45,
  "hourly_rate_max": 85,
  "tone": "professional",
  "avoid_keywords": ["unpaid", "equity only", "intern"]
}
```

### 3. Run

```bash
# Start dashboard + auto-scheduler (recommended)
npm run dev
```

Open **http://localhost:3000** — dashboard is live.

Click **"▶ Run Pipeline"** to immediately ingest, score, and generate proposals.

```bash
# Alternative: pipeline once (CLI only)
npm run pipeline

# Dry run (ingest only, no LLM calls)
npm run pipeline -- --dry-run

# Dashboard only (no pipeline)
npm run dashboard
```

### 4. Deploy to Nosana (CLI)

```bash
# Install Nosana CLI
npm install -g @nosana/cli

# Deploy using the included job definition
nosana job post \
  --file ./nos_job_def/nosana_eliza_job_definition.json \
  --market nvidia-3080 \
  --timeout 300 \
  --api <YOUR_NOSANA_API_KEY>

# Monitor deployment
nosana job status <job-id>
nosana job logs <job-id>
```

---

## Inference Providers

### Nosana Decentralized GPU (Required for Competition)

```env
INFERENCE_PROVIDER=nosana
NOSANA_API_URL=https://6vq2bcqphcansrs9b88ztxfs88oqy7etah2ugudytv2x.node.k8s.prd.nos.ci/v1
OPENAI_API_URL=https://6vq2bcqphcansrs9b88ztxfs88oqy7etah2ugudytv2x.node.k8s.prd.nos.ci/v1
OPENAI_API_KEY=nosana
MODEL_NAME=Qwen3.5-27B-AWQ-4bit
```

**Dual Endpoint Setup:**
| Variable | Endpoint | Purpose |
|----------|----------|---------|
| `NOSANA_API_URL` | LLM inference | Scoring, proposals, action decisions |
| `OPENAI_EMBEDDING_URL` | Embedding inference | Semantic similarity fallback |

The embedding endpoint (`Qwen3-Embedding-0.6B`) provides 1024-dimensional vectors for cosine similarity scoring when the LLM is unavailable due to circuit breaker or 503 errors.

### Local Development (Ollama)
```bash
ollama pull qwen2.5:72b
```
```env
INFERENCE_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
MODEL_NAME=qwen2.5:72b
```

---

## Docker Deployment

### Local Docker
```bash
# Build and run
docker-compose up --build

# Background
docker-compose up -d
```

### Nosana Deployment
```bash
# 1. Build and push image
docker build -t yourusername/opportunity-hunter:latest .
docker push yourusername/opportunity-hunter:latest

# 2. Update nosana.yml with your image name

# 3. Deploy via Nosana CLI
nosana job post --file nosana.yml --market <market-address>

# 4. Check status
nosana job get <job-id>
```

---

## Dashboard Guide

The web dashboard at **http://localhost:3000** provides:

| Feature | Description |
|---------|-------------|
| **Opportunities** | All discovered opps with scores, source, budget, skills. Filter by status. |
| **Score breakdown** | Per-dimension scores + LLM reasoning |
| **Proposal viewer** | Full proposal + human-in-the-loop actions (APPLY/SAVE/IGNORE) |
| **Pipeline Runs** | History of all pipeline runs with found/scored/proposal counts |
| **Manual Ingest** | Paste any job posting for immediate scoring and processing |
| **Insights** | Feedback agent's learning report from recorded outcomes |
| **Infrastructure** | **Live Nosana endpoint health** — circuit breaker status, LLM/embedding availability |
| **Profile** | Edit your skills, experience, niches, avoid keywords |

### Opportunity Actions

- **✅ Approve** — marks as applied, ready for outcome tracking
- **🗑️ Ignore** — removes from active pipeline  
- **🏆 Accepted** — records positive outcome, feeds learning loop
- **❌ Rejected** — records negative outcome, adjusts scoring bias

### Infrastructure Monitoring

The **Infrastructure** tab shows real-time status:

```
┌─────────────────────────────────────────────────────┐
│  LLM Inference (Qwen3.5-27B-AWQ-4bit)               │
│  Status: ⚠️ CIRCUIT OPEN                             │
│  Failures: 5/5 threshold                           │
│  Endpoint: 6vq2...node.k8s.prd.nos.ci               │
├─────────────────────────────────────────────────────┤
│  Semantic Embeddings (Qwen3-Embedding-0.6B)          │
│  Status: ✅ HEALTHY                                  │
│  Dimensions: 1024                                  │
│  Profile cached: Yes                                │
│  Endpoint: 4yicc...node.k8s.prd.nos.ci            │
└─────────────────────────────────────────────────────┘
```

This demonstrates **graceful degradation**: when LLM is unavailable, scoring falls back to embedding-based cosine similarity.

---

## Scoring System

Each opportunity receives a score of **0–100** from 5 dimensions:

| Dimension | Max | What it measures |
|-----------|-----|-----------------|
| `skill_match` | 25 | Overlap with your skills profile |
| `budget_quality` | 20 | Budget stated, meets your rate, well-scoped |
| `urgency_signals` | 15 | Recency, urgency language, active posting |
| `competition_likelihood` | 20 | Niche requirements → lower competition = higher score |
| `relevance` | 20 | Alignment with your niches and preferences |

**Thresholds** (configurable via env):
- `SCORE_THRESHOLD=55` → APPLY if score ≥ 55
- `IGNORE_THRESHOLD` → auto-computed as 60% of SCORE_THRESHOLD (~33)

---

## Self-Improvement Loop

The **Feedback Agent** closes the learning loop:

```
Apply → Outcome recorded → Feedback Agent analyzes →
  Insights: top winning skills, avg win score,
            proposal style notes, scoring bias adjustments →
  Next pipeline run uses adjusted context →
  Better scores, better proposals
```

After ~5-10 outcomes, the system starts adapting:
- Boosts `skill_match` weight if it correlates with wins
- Identifies proposal length/style patterns in accepted applications
- Warns when competition likelihood is routinely misscored

---

## Sample Pipeline Run Output

```
════════════════════════════════════════════════════════════
🚀 Pipeline run started: a3f2c1d0-...
════════════════════════════════════════════════════════════

📥 PHASE 1: Source ingestion
[DynamicSources] Matched categories: finance
[RSS Agent] RemoteOK - finance: 55 new opportunities
[Reddit Agent] r/Accounting: 3 new
[Reddit Agent] r/taxpros: 2 new
  Raw opportunities collected: 60

🔄 PHASE 2: Normalization
[Normalizer] 60 normalized | 0 duplicates | 0 filtered

🎯 PHASE 3: Scoring
[Scorer] "Freelance Accountant - Monthly Bookkeeping" → 78/100 (accounting,remote,ongoing)
[Scorer] "CPA Needed - Tax Preparation (Q1 2026)" → 82/100 (cpa,tax,high_budget)
[Scorer] "Financial Analyst - Startup" → 75/100 (analysis,forecasting)

  Top opportunities:
  [82] CPA Needed - Tax Preparation (rss:RemoteOK)
  [78] Freelance Accountant - Monthly Bookkeeping (rss:RemoteOK)
  [75] Financial Analyst - Startup (reddit:r/Accounting)

⚡ PHASE 4: Action decisions
[Action Agent] "CPA Needed" → APPLY (82% confidence)
[Action Agent] "Freelance Accountant" → APPLY (78% confidence)
  APPLY: 21 | SAVE: 37 | IGNORE: 2

✍️  PHASE 5: Proposal generation (21 opportunities)
[Proposal Agent] Generated 298 words for "CPA Needed"
[Critic Agent] Reviewed, score: 8/10 → passes

📊 PHASE 6: Feedback analysis
[Feedback Agent] Running insight analysis...
[Feedback Agent] Not enough outcomes yet (need 3+). Returning defaults.

════════════════════════════════════════════════════════════
✅ Pipeline complete in 59s
   Found: 60 | Scored: 60 | Proposals: 21
   Actions: APPLY=21 SAVE=37 IGNORE=2
════════════════════════════════════════════════════════════
```

---

## Configuration Reference

### `config/profile.json`
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Your display name |
| `title` | string | Professional title |
| `skills` | string[] | Your tech skills (used for scoring) |
| `niches` | string[] | Specialization areas |
| `hourly_rate_min/max` | number | Rate range for budget scoring |
| `tone` | enum | `professional\|friendly\|technical\|casual` |
| `avoid_keywords` | string[] | Hard blockers (equity only, unpaid, etc.) |

### `config/sources.json`
- **`rss_feeds`** — add/remove RSS feed URLs and set `enabled: true/false`
- **`reddit_sources`** — subreddits with flair and keyword filters

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `INFERENCE_PROVIDER` | `nosana` | nosana / ollama / openai |
| `MODEL_NAME` | `Qwen3.5-27B-AWQ-4bit` | LLM model for inference |
| `OPENAI_EMBEDDING_MODEL` | `Qwen3-Embedding-0.6B` | Embedding model for semantic similarity |
| `OPENAI_EMBEDDING_DIMENSIONS` | `1024` | Embedding vector dimensions |
| `PIPELINE_INTERVAL_MINUTES` | `30` | How often to run |
| `SCORE_THRESHOLD` | `55` | Min score to APPLY |
| `DASHBOARD_PORT` | `3000` | Dashboard server port |
| `DATA_DIR` | `./data` | SQLite + logs directory |
| `LOG_LEVEL` | `info` | debug / info / warn / error |

---

## Differentiation Features

### 1. Deep Nosana Integration (Competition Focus)

**Dual-Endpoint Architecture:** Uses both Nosana-hosted endpoints:
- **Qwen3.5-27B-AWQ-4bit** for LLM inference (scoring, proposals)
- **Qwen3-Embedding-0.6B** for semantic similarity (RAG fallback)

**Circuit Breaker Pattern:** Production-grade resilience:
- Tracks consecutive failures per endpoint
- Opens circuit after 5 failures → stops hanging requests
- Resets at each pipeline run for fresh attempts
- Live dashboard shows open/closed status

**Graceful Degradation:** When LLM is unavailable:
- Circuit opens → fast fail, no retries
- Scoring falls back to **embedding-based cosine similarity**
- Pipeline continues with semantic relevance scoring
- Judges can see real-time infrastructure health

### 2. Self-Improving Scoring System
The Feedback Agent analyzes outcomes and adjusts scoring context:
- Identifies which dimensions predict wins
- Passes historical insights to the Scoring Agent on every run
- Computes scoring bias adjustments from accepted vs rejected ratios

### 3. Proposal Optimization Loop (Critic Agent)
Every generated proposal goes through a second LLM pass:
- Scores the proposal quality 1–10
- Lists specific issues (generic opener, weak CTA, etc.)
- Produces an improved version with explicit change log
- Dashboard shows both original and improved versions

### 4. Human-in-the-Loop Approval System
The Action Agent recommends but doesn't auto-send:
- Dashboard lets you review proposals before marking "applied"
- Outcome recording feeds directly into feedback loop
- Transparent reasoning log for every decision

### 5. Infrastructure Observability
Live dashboard tab showing:
- Endpoint health (healthy/circuit open)
- Consecutive failure count
- Profile embedding cache status
- Exact Nosana node URLs
- Circuit breaker threshold status

---

## License

MIT
