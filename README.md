# 🎯 Opportunity Hunter — Autonomous Multi-Agent System

An autonomous AI agent system built on **ElizaOS v2** that discovers, scores, and applies to freelance opportunities, jobs, bounties, and contracts — with minimal human intervention.

Runs on **Nosana** (decentralized GPU network) using **Qwen2.5-72B-AWQ-4bit** for inference.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PIPELINE ORCHESTRATOR                        │
└──────────┬──────────────────────────────────────────────────────┘
           │
    ┌──────▼──────────────────────────────────────────┐
    │              PHASE 1: SOURCE AGENTS              │
    │  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────┐ │
    │  │ RSS Agent│ │ Reddit   │ │ Email  │ │Manual│ │
    │  │ (7 feeds)│ │ (5 subs) │ │ (IMAP) │ │Input │ │
    │  └──────────┘ └──────────┘ └────────┘ └──────┘ │
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
    │  + Self-improvement from feedback history       │
    └──────────────────────┬──────────────────────────┘
                           │ scored Opportunity[]
    ┌──────────────────────▼──────────────────────────┐
    │           PHASE 4: ACTION AGENT                  │
    │  APPLY (score ≥ threshold) │ SAVE │ IGNORE      │
    │  LLM reasoning + fast-path rules                │
    └──────────────────────┬──────────────────────────┘
                           │ APPLY list
    ┌──────────────────────▼──────────────────────────┐
    │    PHASE 5: PROPOSAL AGENT + CRITIC AGENT        │
    │  ProposalAgent: writes tailored application     │
    │  CriticAgent: reviews, scores, improves         │
    │  → Proposal v2 stored, ready for human review   │
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

## Project Structure

```
opportunity-hunter/
├── src/
│   ├── agents/
│   │   ├── sources/
│   │   │   ├── rssAgent.ts          # RSS/Atom feed ingestion
│   │   │   ├── redditAgent.ts       # Reddit API ingestion
│   │   │   ├── emailAgent.ts        # IMAP email parsing
│   │   │   └── manualAgent.ts       # Manual text/JSON import
│   │   ├── normalizationAgent.ts    # Schema enforcement + dedup
│   │   ├── scoringAgent.ts          # LLM-powered 5-dim scoring
│   │   ├── proposalAgent.ts         # Tailored proposal generation
│   │   ├── criticAgent.ts           # Proposal review + improvement
│   │   ├── actionAgent.ts           # APPLY/SAVE/IGNORE decisions
│   │   └── feedbackAgent.ts         # Outcome tracking + insights
│   ├── dashboard/
│   │   └── server.ts                # Express + Socket.IO API
│   ├── eliza/
│   │   └── characters.ts            # ElizaOS agent character defs
│   ├── llm/
│   │   └── client.ts                # Unified LLM client (Nosana/Ollama/OpenAI)
│   ├── memory/
│   │   └── database.ts              # SQLite persistence layer
│   ├── prompts/
│   │   ├── scoring.ts               # Scoring prompt templates
│   │   ├── proposal.ts              # Proposal prompt templates
│   │   ├── critic.ts                # Critic prompt templates
│   │   └── action.ts                # Action decision prompts
│   ├── types/
│   │   └── index.ts                 # Shared TypeScript types
│   ├── utils/
│   │   └── logger.ts                # Winston logger
│   ├── pipeline.ts                  # Main pipeline orchestrator
│   └── index.ts                     # Entry point + scheduler
├── config/
│   ├── profile.json                 # YOUR profile (edit this!)
│   └── sources.json                 # Feed/subreddit configuration
├── public/
│   └── index.html                   # Web dashboard
├── Dockerfile
├── docker-compose.yml
├── nosana.yml                        # Nosana job definition
└── .env.example
```

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/yourusername/opportunity-hunter
cd opportunity-hunter
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Required: pick one inference provider
INFERENCE_PROVIDER=nosana
NOSANA_API_KEY=your_key_here
MODEL_NAME=Qwen/Qwen2.5-72B-Instruct-AWQ

# Optional: Reddit API (public posts work without auth)
REDDIT_CLIENT_ID=your_id
REDDIT_CLIENT_SECRET=your_secret

# Optional: Email alerts (Gmail app password)
EMAIL_USER=you@gmail.com
EMAIL_PASSWORD=your_app_password
EMAIL_HOST=imap.gmail.com
```

**Edit your profile** at `config/profile.json`:

```json
{
  "name": "Your Name",
  "title": "Your Title",
  "skills": ["TypeScript", "Python", "React"],
  "niches": ["AI development", "Web3"],
  "hourly_rate_min": 75,
  "hourly_rate_max": 150,
  "bio": "Your 2-3 sentence pitch..."
}
```

### 3. Run

```bash
# Start dashboard + auto-scheduler
npm run dev

# Run pipeline once (CLI)
npm run pipeline

# Dry run (ingest only, no LLM calls)
npm run pipeline -- --dry-run

# Dashboard only (no pipeline)
npm run dashboard
```

Open **http://localhost:3000** to see the dashboard.

---

## Inference Providers

### Option A: Nosana (recommended — decentralized GPU)
```env
INFERENCE_PROVIDER=nosana
NOSANA_API_URL=https://inference.nosana.io/v1
NOSANA_API_KEY=your_nosana_api_key
MODEL_NAME=Qwen/Qwen2.5-72B-Instruct-AWQ
```

### Option B: Local Ollama
```bash
ollama pull qwen2.5:72b
```
```env
INFERENCE_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
MODEL_NAME=qwen2.5:72b
```

### Option C: OpenAI (fallback)
```env
INFERENCE_PROVIDER=openai
OPENAI_API_KEY=sk-...
MODEL_NAME=gpt-4o-mini
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
| **Opportunities list** | All discovered opps with scores, source, budget, skills |
| **Score breakdown** | Per-dimension scores + LLM reasoning |
| **Proposal viewer** | Full proposal + critic-improved version |
| **Approve/Reject** | Human-in-the-loop action confirmation |
| **Outcome recording** | Mark accepted/rejected to train the feedback loop |
| **Pipeline runner** | Trigger runs manually |
| **Insights tab** | Feedback agent's learning report |
| **Manual ingest** | Paste any job posting for immediate processing |

### Opportunity Actions

- **✅ Approve** — marks as applied, ready for outcome tracking
- **🗑️ Ignore** — removes from active pipeline
- **🏆 Accepted** — records positive outcome, feeds learning loop
- **❌ Rejected** — records negative outcome, adjusts scoring bias

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
- `SCORE_THRESHOLD=60` → APPLY if score ≥ 60
- `IGNORE_THRESHOLD` → auto-computed as 60% of SCORE_THRESHOLD

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
[RSS Agent] HackerNews Hiring: 3 new opportunities
[RSS Agent] RemoteOK RSS: 7 new opportunities
[RSS Agent] Crypto Jobs List RSS: 4 new opportunities
[Reddit Agent] r/forhire: 6 new
[Reddit Agent] r/ethereum: 2 new
  Raw opportunities collected: 22

🔄 PHASE 2: Normalization
[Normalizer] 18 normalized | 3 duplicates | 1 filtered

🎯 PHASE 3: Scoring
[Scorer] "Senior Solidity Dev - DeFi Protocol" → 89/100 (web3,high_budget,low_competition)
[Scorer] "TypeScript API Engineer" → 74/100 (strong_match)
[Scorer] "React Frontend Dev" → 61/100 (remote_friendly)

  Top opportunities:
  [89] Senior Solidity Dev - DeFi Protocol (rss:Crypto Jobs List RSS)
  [84] ElizaOS Agent Builder - Remote (reddit:r/ethereum)
  [74] TypeScript API Engineer (rss:HackerNews Hiring)

⚡ PHASE 4: Action decisions
  APPLY: 3 | SAVE: 8 | IGNORE: 7

✍️  PHASE 5: Proposal generation (3 opportunities)
[Proposal Agent] Generated 312 words for "Senior Solidity Dev"
[Critic Agent] "Senior Solidity Dev" — critic score: 8/10, 1 issue fixed
[Proposal Agent] Generated 287 words for "ElizaOS Agent Builder"
[Critic Agent] "ElizaOS Agent Builder" — critic score: 9/10, 0 issues

📊 PHASE 6: Feedback analysis
[Feedback Agent] Insights: 4/12 accepted (33%)

════════════════════════════════════════════════════════════
✅ Pipeline complete in 47s
   Found: 18 | Scored: 18 | Proposals: 3
   Actions: APPLY=3 SAVE=8 IGNORE=7
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
| `MODEL_NAME` | `Qwen/Qwen2.5-72B-Instruct-AWQ` | LLM model |
| `PIPELINE_INTERVAL_MINUTES` | `30` | How often to run |
| `SCORE_THRESHOLD` | `60` | Min score to APPLY |
| `DASHBOARD_PORT` | `3000` | Dashboard server port |
| `DATA_DIR` | `./data` | SQLite + logs directory |
| `LOG_LEVEL` | `info` | debug / info / warn / error |

---

## Differentiation Features

### 1. Self-Improving Scoring System
The Feedback Agent analyzes outcomes and adjusts scoring context:
- Identifies which dimensions predict wins
- Passes historical insights to the Scoring Agent on every run
- Computes scoring bias adjustments from accepted vs rejected ratios

### 2. Proposal Optimization Loop (Critic Agent)
Every generated proposal goes through a second LLM pass:
- Scores the proposal quality 1–10
- Lists specific issues (generic opener, weak CTA, etc.)
- Produces an improved version with explicit change log
- Dashboard shows both original and improved versions

### 3. Human-in-the-Loop Approval System
The Action Agent recommends but doesn't auto-send:
- Dashboard lets you review proposals before marking "applied"
- Outcome recording feeds directly into feedback loop
- Transparent reasoning log for every decision

### 4. Transparent Reasoning Logs
Every score and decision includes:
- Per-dimension score breakdown
- LLM reasoning in plain English
- Flags (urgent, high_budget, low_competition, etc.)
- Decision confidence percentage

---

## License

MIT
