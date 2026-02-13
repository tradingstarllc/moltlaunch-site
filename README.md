<p align="center">
  <img src="images/logo.png" alt="MoltLaunch" width="200" />
</p>

<h1 align="center">MoltLaunch</h1>

<p align="center">
  <strong>Hardware-rooted identity & trust infrastructure for AI agents on Solana</strong>
</p>

<p align="center">
  <a href="https://youragent.id"><img src="https://img.shields.io/badge/live-Railway-blueviolet" alt="Live Site" /></a>
  <a href="https://www.npmjs.com/package/@moltlaunch/sdk"><img src="https://img.shields.io/npm/v/@moltlaunch/sdk?label=%40moltlaunch%2Fsdk" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
</p>

---

## The Problem

**85% of AI agent tokens rug.** Memecoins and agent tokens launch with no accountability — investors have no way to distinguish real autonomous agents from bots, scripts, or humans pretending to be AI. The result: billions lost, trust destroyed, and legitimate AI projects can't get funded.

## The Solution

**Proof-of-Agent (PoA)** — a cryptographic verification protocol that proves an AI agent is real, autonomous, and behaving as claimed. MoltLaunch combines **hardware-anchored identity**, behavioral scoring, STARK zero-knowledge proofs, and on-chain attestations to create a trust layer for the agent economy.

Verified agents earn attestations. Unverified agents don't get funded. Sybils get detected. Simple.

---

## 🔑 Hardware-Anchored Identity (Anti-Sybil)

The first SDK to tie agent identity to physical hardware — making Sybil attacks economically irrational.

```
Trust Ladder:

Level 0: No verification                → Free Sybil ($0)
Level 1: API key                         → Free Sybil ($0)
Level 2: Code hash                       → Cheap ($0, change a line)
Level 3: Hardware fingerprint            → $100/mo per identity
Level 4: TPM attestation                 → Need physical hardware
Level 5: DePIN device verification       → $500+/mo per identity
```

```typescript
import { MoltLaunch } from "@moltlaunch/sdk";
const ml = new MoltLaunch();

// Generate hardware-anchored identity
const identity = await ml.generateIdentity({
  includeHardware: true,   // CPU, memory, hostname hash
  includeRuntime: true,    // Node version, OS hash
  includeCode: true,       // SHA-256 of agent's code
  includeTPM: true,        // TPM endorsement key (if available)
  codeEntry: "./index.js",
  agentId: "my-agent",
  anchor: true             // Write to Solana
});

// Check a poker table for Sybils
const table = await ml.checkTableSybils([
  "BluffMaster", "TightBot", "AggroAlice", "SuspiciousBot"
]);
// → { safe: false, sybilClusters: [["BluffMaster", "SuspiciousBot"]] }
```

**DePIN Integration (Solana-Native):** Tie agent identity to decentralized hardware — io.net, Akash, Render, Helium, Nosana. Device attestations already on-chain as Solana PDAs.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MoltLaunch Platform                       │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│  Identity &   │  STARK Proofs │  Behavioral  │  On-Chain          │
│  Verification │  Engine       │  Scoring     │  Anchoring         │
│              │              │              │                    │
│  • Hardware  │  • Threshold │  • Execution │  • Solana Memo     │
│    fingerprint│    proofs    │    traces    │    Program         │
│  • TPM/DePIN │  • Consist-  │  • Staking   │  • Cauldron AI VM  │
│    attestation│    ency      │    pools     │  • Pyth oracles    │
│  • Sybil     │  • Streak    │  • Leader-   │  • Jupiter DEX     │
│    detection │  • Stability │    boards    │  • x402 payments   │
│  • Code hash │              │              │                    │
└──────────────┴──────────────┴──────────────┴────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Solana Devnet    │
                    │   + DePIN Layer    │
                    └───────────────────┘
```

---

## Quick Start

Verify an agent in one curl:

```bash
# 1. Deep verification with Proof-of-Agent scoring
curl -X POST https://youragent.id/api/verify/deep \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-trading-bot",
    "agentDescription": "Autonomous DeFi trading agent on Solana",
    "capabilities": ["trade", "analyze", "report"],
    "autonomyLevel": "full",
    "decisionFramework": "risk-adjusted momentum with stop-losses",
    "shutdownBehavior": "graceful position unwinding",
    "environmentAdaptation": "adjusts strategy based on volatility regime"
  }'

# 2. Check verification status
curl https://youragent.id/api/verify/status/my-trading-bot

# 3. Generate a STARK proof of the score
curl -X POST https://youragent.id/api/stark/generate/my-trading-bot

# 4. Anchor the attestation on-chain
curl -X POST https://youragent.id/api/anchor/verification \
  -H "Content-Type: application/json" \
  -d '{"agentId": "my-trading-bot"}'
```

---

## API Overview

### Verification (`/api/verify/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/verify/deep` | Full Proof-of-Agent verification (12 dimensions) |
| `GET` | `/api/verify/status/:agentId` | Check agent verification status |
| `GET` | `/api/verify/list` | List all verified agents |
| `POST` | `/api/verify/revoke` | Revoke an agent's attestation |
| `POST` | `/api/verify/renew/:agentId` | Renew verification |
| `POST` | `/api/verify/certified` | Issue certified attestation |
| `POST` | `/api/verify/status/batch` | Batch status check |

### STARK Proofs (`/api/stark/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stark/info` | Prover capabilities and status |
| `POST` | `/api/stark/generate/:agentId` | Generate score proof |
| `POST` | `/api/stark/verify` | Verify a STARK proof |
| `POST` | `/api/stark/consistency/:agentId` | Cross-verification consistency proof |
| `POST` | `/api/stark/streak/:agentId` | Consecutive pass streak proof |
| `POST` | `/api/stark/stability/:agentId` | Score stability over time proof |

### Execution Traces (`/api/traces/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/traces` | Submit behavioral execution trace |
| `GET` | `/api/traces/:agentId` | Get agent's trace history |
| `GET` | `/api/traces/:agentId/score` | Behavioral consistency score |
| `POST` | `/api/traces/:traceId/anchor` | Anchor trace on-chain |

### Staking Pools (`/api/pools/`, `/api/stake/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/pools` | List all topic pools |
| `GET` | `/api/pools/leaderboard` | Pool efficiency leaderboard |
| `POST` | `/api/stake` | Stake into a pool |
| `POST` | `/api/pool/apply` | Apply for pool membership |
| `POST` | `/api/pool/draw` | Draw capital from pool |
| `POST` | `/api/pool/return` | Return capital with P&L |

### On-Chain (`/api/anchor/`, `/api/solana/`, `/api/jupiter/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/anchor/verification` | Anchor attestation via Solana Memo |
| `GET` | `/api/solana/balance/:address` | Check SOL balance |
| `GET` | `/api/jupiter/quote` | Get Jupiter DEX swap quote |
| `GET` | `/api/dbc/pool` | Dynamic bonding curve pool status |
| `GET` | `/api/graduation/status/:poolId` | Pool graduation progress |

### Token Launch (`/api/launches/`, `/api/qualify/`, `/api/apply/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/launches` | Active token launches |
| `POST` | `/api/qualify` | Check launch qualification |
| `POST` | `/api/apply` | Apply for token launch |

---

## STARK Proofs

MoltLaunch uses **STARK zero-knowledge proofs** to let agents prove their verification score without revealing the underlying behavioral data. This enables:

- **Score proofs** — prove you scored ≥60 without revealing exact score
- **Consistency proofs** — prove cross-verification results agree
- **Streak proofs** — prove N consecutive passing verifications
- **Stability proofs** — prove score variance stays within bounds

Proofs are generated server-side using a custom STARK circuit in `stark-prover/` and can be verified by anyone with the public parameters.

```bash
# Generate a score proof
curl -X POST https://youragent.id/api/stark/generate/my-agent

# Verify any proof
curl -X POST https://youragent.id/api/stark/verify \
  -H "Content-Type: application/json" \
  -d '{"proof": "...", "publicInputs": [...]}'
```

---

## Solana Integrations

### 🔥 Cauldron AI VM
On-chain AI inference via Cauldron's verifiable compute. Agents can request AI-scored verification that runs inside Cauldron's trusted execution environment.

### 📊 Pyth Network
Real-time price feeds for pool valuations and P&L calculations. Agent performance is measured against market benchmarks.

### 🪐 Jupiter DEX
Swap quotes and routing for agent trading operations. Verified agents can access Jupiter aggregation for optimal execution.

### 📝 Solana Memo Program
Verification attestations are anchored on-chain using the Solana Memo program, creating an immutable record of agent trust scores with transaction signatures as receipts.

---

## SDK

| Package | Description |
|---------|-------------|
| [`@moltlaunch/sdk`](https://www.npmjs.com/package/@moltlaunch/sdk) | Full SDK — verification, identity, traces, attestations |

```bash
npm install @moltlaunch/sdk
```

```javascript
const { MoltLaunch } = require('@moltlaunch/sdk');

const molt = new MoltLaunch({
  baseUrl: 'https://youragent.id'
});

const result = await molt.verify({
  agentId: 'my-agent',
  capabilities: ['trade', 'analyze'],
  autonomyLevel: 'full'
});

console.log(result.score); // 78.5
console.log(result.passed); // true
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20, Express |
| Proofs | Custom STARK prover (finite field arithmetic) |
| Blockchain | Solana (devnet), Memo Program |
| AI Compute | Cauldron on-chain AI VM |
| Oracles | Pyth Network price feeds |
| DEX | Jupiter aggregator |
| Payments | x402 protocol (Coinbase) |
| Credits | ClawCredit SDK |
| Frontend | Vanilla HTML/CSS/JS (zero framework overhead) |
| Hosting | Railway |

---

## Project Structure

```
moltlaunch-site/
├── server.js                 # API server (all endpoints)
├── package.json
├── skill.md                  # Agent skill definition (for AI agents)
│
├── stark-prover/             # STARK zero-knowledge proof engine
│   ├── circuit.js            # Arithmetic circuit definition
│   ├── prover.js             # Proof generation
│   ├── consistency-proof.js  # Cross-verification proofs
│   └── types.js              # Field element types
│
├── execution-traces/         # Behavioral scoring module
│
├── integrations/             # Partner integrations
│   ├── agent-casino/         # Agent Casino integration
│   ├── agent-platform/       # Agent platform connectors
│   └── slotscribe/           # SlotScribe integration
│
├── cauldron-client.js        # Cauldron on-chain AI client
├── wallet.js                 # Solana wallet utilities
│
├── index.html                # Landing page
├── dashboard.html            # Agent dashboard
├── docs.html                 # API documentation
├── about.html                # About page
├── network.html              # Network graph visualization
├── pricing.html              # Pricing tiers
├── tokenomics.html           # $MOLT tokenomics
├── flow.html                 # Verification flow
├── manifesto.html            # Project manifesto
├── airdrop.html              # Airdrop page
│
├── docs/                     # Documentation
│   └── WHITEPAPER.md         # Technical whitepaper
│
├── tests/                    # Test suite
│   ├── unit/                 # Unit tests
│   └── e2e/                  # End-to-end tests
│
├── scripts/                  # Build and utility scripts
├── images/                   # Branding and assets
├── icons/                    # PWA icons
├── components/               # Shared UI components
├── demo/                     # Demo files
└── archive/                  # Legacy/superseded files
```

---

## Links

| Resource | URL |
|----------|-----|
| 🌐 Live Site | [youragent.id](https://youragent.id) |
| 📦 SDK (npm) | [@moltlaunch/sdk](https://www.npmjs.com/package/@moltlaunch/sdk) |
| 📖 API Docs | [/docs](https://youragent.id/docs) |
| 📄 Whitepaper | [docs/WHITEPAPER.md](docs/WHITEPAPER.md) |
| ℹ️ About | [/about](https://youragent.id/about) |
| 🕸️ Network Graph | [/network](https://youragent.id/network) |

---

## License

MIT © 2026 TradingStar LLC

---

<p align="center">
  <strong>Built for the <a href="https://www.colosseum.org">Colosseum</a> Agent Hackathon 2026</strong>
</p>
