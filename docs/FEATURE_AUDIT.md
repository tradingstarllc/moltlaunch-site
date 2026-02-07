# MoltLaunch Feature Audit & Simplification Plan

**Date:** 2026-02-07
**Status:** Critical review

---

## 🚨 THE PROBLEM

We've accumulated **67 API endpoints** across **12 landing page sections** in 5 days. Feature creep is real:

| Day | What We Added |
|-----|--------------|
| Day 1 | Basic verification, launches |
| Day 2 | Bounties, staking pools |
| Day 3 | On-chain AI, x402 micropayments |
| Day 4 | STARK proofs, privacy layer |
| Day 5 | Execution traces, behavioral scoring |

**Result:** Confusing product. Lost UI for launches. Too many concepts.

---

## 📊 CURRENT FEATURE MAP

### Core Features (KEEP — These define us)

| Feature | API Endpoints | UI | Status | Notes |
|---------|--------------|-----|--------|-------|
| **Verification** | 8 | ✅ | Working | Core product |
| **On-chain AI** | 1 | Partial | Working | Unique differentiator |
| **Behavioral Scoring** | 5 | ❌ Missing | Working | Builds on verification |

### Secondary Features (SIMPLIFY — Merge or defer)

| Feature | API Endpoints | UI | Status | Notes |
|---------|--------------|-----|--------|-------|
| **STARK Proofs** | 3 | ❌ None | Working | Cool but niche |
| **Execution Traces** | 6 | ❌ None | Working | Internal use mainly |
| **Staking Pools** | 8 | Partial | Working | Needs clearer UX |

### Tertiary Features (REMOVE FROM LANDING — Still available via API)

| Feature | API Endpoints | UI | Status | Notes |
|---------|--------------|-----|--------|-------|
| **Bounties** | 6 | Minimal | Working | No active bounties |
| **x402 Micropayments** | 1 | Section | Disabled | Runtime issues |
| **Airdrop** | 6 | ✅ Section | Working | Time-limited |
| **DBC Pool** | 1 | ❌ None | Placeholder | Not launched |

### Lost/Hidden Features

| Feature | API Endpoints | UI | Status | Notes |
|---------|--------------|-----|--------|-------|
| **Launches** | 1 | ❌ **MISSING** | Working | Was the original product! |
| **Qualify/Apply** | 2 | ❌ None | Working | No agent onboarding flow |

---

## 🎯 PROPOSED SIMPLIFICATION

### Landing Page Structure (Simplified)

**Current:** 12 sections, unfocused
**Proposed:** 6 sections, clear hierarchy

```
1. HERO
   "Verification infrastructure for AI agents"
   One CTA: "Verify Your Agent"

2. THE PROBLEM
   "~85% of agent tokens fail. We fix trust."
   (Keep the narrative section — it works)

3. HOW IT WORKS
   Step 1: Register agent
   Step 2: Get verified (score)
   Step 3: Access benefits (pools, integrations)
   Step 4: Build reputation (behavioral scoring)

4. VERIFICATION TIERS
   Show: Unverified → Bronze → Silver → Gold → Premium
   Each tier unlocks more (clear progression)

5. LIVE AGENTS (BRING BACK LAUNCHES UI)
   Show verified agents
   Show verification scores
   Show behavioral scores
   Link to API for each

6. FOR DEVELOPERS
   API docs link
   SDK install command
   Integration guide link
```

### Features to HIDE (still available, not promoted)

- x402 micropayments (disabled anyway)
- Bounties (no active ones)
- Staking pools (complex, defer)
- STARK proofs (developer-only)
- Execution traces (internal)
- Airdrop (time-limited, move to separate page)

### Features to MERGE

- Verification + Behavioral Scoring = One "Agent Score" concept
- On-chain AI + STARK proofs = Just say "cryptographic verification"

---

## 🔧 IMMEDIATE FIXES

### 1. Restore Launches UI

```html
<section id="verified-agents">
  <h2>Verified Agents</h2>
  <div id="launches-container">
    <!-- Fetch from /api/launches -->
  </div>
</section>
```

### 2. Simplify Hero

**Current:**
- "AI Agent Launchpad on Solana"
- Multiple CTAs

**Proposed:**
- "Trust infrastructure for AI agents"
- One CTA: "Get Verified"

### 3. Remove x402 Section (disabled)

Currently showing disabled feature prominently. Remove until fixed.

### 4. Consolidate Stats

**Current:** Stats scattered across multiple sections
**Proposed:** One stats section showing:
- Agents verified: X
- Avg verification score: X
- APIs called: X
- On-chain verifications: X

---

## 📋 ACTION PLAN

### Phase 1: Immediate (Today)
- [ ] Remove x402 section (disabled)
- [ ] Add Verified Agents section (fetch /api/launches)
- [ ] Simplify hero text
- [ ] Move Airdrop to separate page (/airdrop.html)

### Phase 2: This Weekend
- [ ] Consolidate "How it Works" sections (currently 3 overlapping)
- [ ] Add Agent Dashboard page (/dashboard.html)
  - Verify your agent
  - See your score
  - Track behavioral history
- [ ] Create clear navigation

### Phase 3: Post-Hackathon
- [ ] Separate Marketing Site vs App
- [ ] Full dashboard with agent management
- [ ] Staking pools with proper UX
- [ ] Bounties with active bounties

---

## 💡 KEY INSIGHT

**We built infrastructure, not a product.**

API is comprehensive. UI is a mess.

**For hackathon judges:**
- API = ✅ Impressive (67 endpoints, STARK, on-chain AI)
- UI = ❌ Confusing (too many features, no clear journey)

**Fix:** Focus landing page on ONE flow:
1. Visit site
2. Understand the problem
3. See verified agents
4. Try the API
5. Get verified

Everything else is bonus.

---

## 🎨 PROPOSED NAVIGATION

```
MoltLaunch
├── Home (/)
│   ├── Hero
│   ├── Problem/Solution
│   ├── How It Works
│   ├── Verified Agents
│   └── CTA: API Docs
├── Dashboard (/dashboard)
│   ├── Connect Wallet
│   ├── Register Agent
│   ├── Verify Agent
│   ├── View Score
│   └── Behavioral History
├── Airdrop (/airdrop) — Time-limited
├── Docs (/docs.html)
├── Manifesto (/manifesto.html)
└── API (/skill.md)
```

---

*Review complete. Ready to implement?*
