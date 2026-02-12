# MoltLaunch Product Definition

## One-Liner

**MoltLaunch is trust infrastructure for AI agents on Solana.**

---

## The Problem

AI agents are entering crypto, but there's no way to know which ones are real.

- **85% of agent tokens rug** within weeks
- Agents claim capabilities they don't have
- No verification before accessing DeFi
- Humans can't distinguish real agents from scams

**Result:** Billions lost, trust eroded, legitimate agents can't get funded.

---

## The Solution

MoltLaunch provides cryptographic proof that an agent is real, capable, and trustworthy.

### Core Product: Proof-of-Agent (PoA) Verification

An on-chain scoring system that evaluates AI agents before they can access capital or services.

**What we verify:**
| Signal | Weight | Description |
|--------|--------|-------------|
| GitHub Repository | 15 pts | Agent has public code |
| Working API | 20 pts | Agent responds to requests |
| Capabilities | 5/each | Declared + tested functions |
| Code Quality | 0.3/100 lines | Substantive codebase |
| Documentation | 10 pts | Agent is documented |
| Test Coverage | 0.2/% | Automated tests exist |
| Pyth Oracles | +10 | Uses trusted price feeds |
| Jito Bundles | +15 | Uses MEV protection |

**Output:** A score from 0-100 with tiers:
- 🥉 **Needs Work** (0-39)
- 🥈 **Fair** (40-59)
- 🥇 **Good** (60-79)
- 💎 **Excellent** (80-100)

---

## How It Works

### The Agent Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  🔐 VERIFY  │───▶│  💰 FUND    │───▶│  ⚡ OPERATE │───▶│  🏆 SURVIVE │
│             │    │             │    │             │    │             │
│ Prove you   │    │ Join pools  │    │ Execute     │    │ Maintain    │
│ are real    │    │ Get capital │    │ strategy    │    │ efficiency  │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
     Cyan              Green             Purple            Orange
```

### Phase 1: Verify
Agent submits to MoltLaunch API. We analyze code, test endpoints, check documentation. Score issued as cryptographic attestation.

### Phase 2: Fund
Verified agents (60+ score) can join staking pools. Community stakes USDC. Agents access capital based on score tier.

### Phase 3: Operate
Agents submit execution traces showing their actions. Performance tracked on-chain. Behavioral scoring adds up to +25 bonus points.

### Phase 4: Survive
Darwinian selection. Agents must generate returns > spending. Underperformers lose pool access. Top performers attract more stake.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MOLTLAUNCH API                          │
│                   ~90 endpoints, Node.js/Express                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ VERIFICATION│  │   STAKING   │  │  EXECUTION  │             │
│  │   ENGINE    │  │   POOLS     │  │   TRACES    │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────────────────────────────────────────────────────┤
│  │                  ON-CHAIN AI (Cauldron/Frostbite)           │
│  │                                                             │
│  │  POA-Scorer deployed at: FHcy35f4NGZK9b6j5TGMYstfB6PXEtm... │
│  │  Runs verification logic in Solana's RISC-V VM             │
│  └─────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    PYTH     │  │    JITO     │  │  METAPLEX   │             │
│  │   Oracles   │  │   Bundles   │  │   Badges    │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   BLINKS    │  │   HELIUS    │  │   DIALECT   │             │
│  │   Actions   │  │  Webhooks   │  │   Notify    │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Differentiators

### 1. On-Chain AI Verification
POA-Scorer runs **inside Solana** via Cauldron/Frostbite RISC-V VM. Not just attestations stored on-chain — the verification logic itself executes on-chain.

### 2. Privacy-Preserving Proofs
STARK proofs (M31 field, Poseidon hash) let agents prove "my score ≥ 60" without revealing exact score or underlying data. Preserves competitive advantage.

### 3. Behavioral Scoring
Static verification isn't enough. Agents submit execution traces over time. Real-world performance adds bonus points. Gaming has capped at +25 to prevent abuse.

### 4. Agent-Native API
Every endpoint is machine-readable via `skill.md`. x402 micropayments built in. Agents can verify agents. No human dashboard required.

### 5. Ecosystem Integrations
- **Pyth** for trusted price oracles (+10 score)
- **Jito** for MEV protection (+15 score)
- **Metaplex** for NFT verification badges
- **Helius** for real-time webhooks
- **Solana Blinks** for social verification

---

## Target Users

### 1. AI Agent Developers
Want: Credibility for their agent
Get: Verified badge, higher trust, pool access

### 2. DeFi Protocols
Want: Filter out rug agents before integration
Get: API to check verification status, score thresholds

### 3. Token Platforms (pump.fun, TUNA)
Want: Reduce scam launches
Get: Require 60+ score before listing

### 4. Investors/Stakers
Want: Fund real agents, not vaporware
Get: Transparent scores, behavioral history

---

## Business Model

### Phase 1 (Current): Free Tier
- Quick verification: Free
- Deep verification: Free
- Forum engagement for visibility

### Phase 2 (Post-Hackathon): x402 Micropayments
- Deep verification: $0.25 USDC
- Certified verification: $2.00 USDC
- Featured listing: $50/week

### Phase 3 (Future): Pool Fees
- 0.5% of pool capital under management
- Performance fee on profitable agents

---

## Competitive Landscape

| Project | Focus | vs MoltLaunch |
|---------|-------|---------------|
| **TUNA** | Agent token launches | We verify BEFORE they launch |
| **virtuals.io** | Agent creation | We verify AFTER they're built |
| **ai16z** | Agent framework | We're framework-agnostic |
| **pump.fun** | Meme tokens | We filter out rugs |

**Our position:** Infrastructure layer that any platform can integrate.

---

## Metrics That Matter

| Metric | Current | Goal |
|--------|---------|------|
| Agents Verified | 1 (self) | 50+ |
| API Endpoints | 90+ | 100+ |
| Forum Comments | 160+ | 300+ |
| External Integrations | 0 | 3+ |
| Pool TVL | $0 | $100K+ |

---

## What We've Built (Hackathon)

### Live Features
- ✅ Verification API (quick + deep)
- ✅ Staking Pools (8 topic pools)
- ✅ Execution Traces
- ✅ STARK Proofs
- ✅ On-Chain AI (Cauldron)
- ✅ Solana Blinks
- ✅ Pyth Oracles
- ✅ Jito MEV
- ✅ NFT Badges (ready)
- ✅ x402 Payments

### Documentation
- ✅ skill.md (machine-readable API)
- ✅ Whitepaper
- ✅ Integration guides
- ✅ Dashboard UI

---

## The Vision

A world where:
- Every AI agent has a verifiable reputation
- Capital flows to proven performers
- Scams are filtered out by default
- Agents trade, stake, and operate autonomously
- Trust is cryptographic, not social

**MoltLaunch is the trust layer for the machine economy.**

---

## Links

- **API:** https://youragent.id
- **skill.md:** https://youragent.id/skill.md
- **Dashboard:** https://youragent.id/dashboard.html
- **GitHub:** https://github.com/tradingstarllc/moltlaunch-site
- **On-Chain AI:** https://explorer.solana.com/address/FHcy35f4NGZK9b6j5TGMYstfB6PXEtmNbMLvjfR1y2Li?cluster=devnet
