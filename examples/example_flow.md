# Example Data Flow

This document traces a single opportunity through the full agent pipeline.

## Input: Raw RSS Item

```json
{
  "title": "Senior Solidity Developer for DeFi Yield Protocol",
  "link": "https://cryptojobslist.com/example-1",
  "pubDate": "2024-01-15T10:30:00Z",
  "contentSnippet": "We need a senior Solidity developer... $120-150/hr... remote... immediate start"
}
```

---

## After RSS Agent

```json
{
  "id": "c3f2a1b0-9d8e-4f7c-8e2d-1a3b5c7d9e0f",
  "title": "Senior Solidity Developer for DeFi Yield Protocol",
  "source": "rss:Crypto Jobs List RSS",
  "url": "https://cryptojobslist.com/example-1",
  "budget": "$120-150/hr",
  "skills": ["Solidity", "TypeScript", "DeFi"],
  "timestamp": "2024-01-15T10:30:00.000Z",
  "raw_text": "Senior Solidity Developer for DeFi Yield Protocol\n\nWe are looking for...",
  "status": "new"
}
```

---

## After Normalization Agent

```json
{
  "...": "same as above, plus:",
  "normalized_at": "2024-01-15T12:00:00.000Z",
  "remote": true,
  "tags": ["web3", "urgent"],
  "status": "new"
}
```
> Filtered: 0 avoid keywords matched. Duplicate check: URL not in DB. Passed.

---

## After Scoring Agent (Qwen2.5-72B via Nosana)

```json
{
  "score": 89,
  "score_breakdown": {
    "skill_match": 23,
    "budget_quality": 19,
    "urgency_signals": 13,
    "competition_likelihood": 18,
    "relevance": 16
  },
  "score_reasoning": "Exceptional match — Solidity is a primary skill with 3+ years experience. Budget of $120-150/hr exceeds minimum rate. 'Immediate start' signals urgency. DeFi Solidity contracts are a niche requirement reducing competition pool significantly. Core niche alignment.",
  "flags": ["web3", "high_budget", "urgent", "low_competition"],
  "status": "scored"
}
```

---

## After Action Agent

```json
{
  "action": "APPLY",
  "action_reasoning": "Score 89 exceeds threshold 60. High budget, low competition, immediate start. No avoid keywords detected. Confidence: 94%.",
  "status": "proposal_approved"
}
```

---

## After Proposal Agent

```json
{
  "id": "p1a2b3c4-...",
  "opportunity_id": "c3f2a1b0-...",
  "full_text": "The reentrancy pattern in your yield strategy spec is exactly why I start every DeFi contract audit with Slither + manual CEI analysis — and it's saved clients from $2M+ in potential losses.\n\nI've spent the last 4 years building DeFi infrastructure: a custom yield aggregator on Ethereum (currently managing $8M TVL), a staking contract audited by Certik, and a flash loan arbitrage bot that's operated without incident through multiple market events.\n\nFor your yield protocol, I'd approach the smart contract architecture as follows: [architecture sketch]...\n\nI'm available to start Monday. Would a 20-minute call this week work to walk through the architecture together?",
  "short_version": "Caught reentrancy issues in 3 DeFi contracts last quarter. Built a yield aggregator with $8M TVL. Can start Monday — 20-min call to walk through architecture?",
  "word_count": 287,
  "version": 1
}
```

---

## After Critic Agent

```json
{
  "critic_score": 9,
  "issues": ["Opening hook could reference their specific tech (Hardhat) more directly"],
  "key_changes": ["Added Hardhat/Foundry reference in second paragraph"],
  "improved_version": "The reentrancy pattern in your Hardhat test suite spec...",
  "explanation": "Minor improvement — added tech stack specificity. Original was already strong."
}
```

---

## Dashboard View

The opportunity now appears in the dashboard as:

```
[89] ✅ APPLY  Senior Solidity Developer for DeFi Yield Protocol
     📡 rss:Crypto Jobs List RSS  💰 $120-150/hr  🕐 2h ago
     Skills: [Solidity] [TypeScript] [DeFi]
     Tags: [web3] [high_budget] [urgent] [low_competition]

     → Click to view 287-word proposal (critic-improved v2)
     → Buttons: [✅ Mark Applied] [🗑️ Ignore] [🏆 Accepted] [❌ Rejected]
```

---

## After Human Records Outcome

User clicks **🏆 Accepted**:

```
Feedback Agent records:
  outcome: "accepted"
  opportunity_id: "c3f2a1b0-..."
  recorded_at: "2024-01-22T09:00:00Z"
  response_time_hours: 168

Next pipeline run context adjustment:
  - Boosts skill_match and low_competition signal weight
  - Notes "DeFi + reentrancy hook" proposal style as high-converting
  - Updates avg_winning_score from 72 → 78
```
