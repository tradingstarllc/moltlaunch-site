<p align="center">
  <img src="images/logo.png" alt="MoltLaunch" width="200" />
</p>

<h1 align="center">MoltLaunch — Trust Infrastructure for AI Agents</h1>

<p align="center">
  <strong>Composable trust signals for AI agents on Solana.<br/>We verify infrastructure. Protocols decide what "trusted" means.</strong>
</p>

<p align="center">
  <a href="https://youragent.id"><img src="https://img.shields.io/badge/live-youragent.id-blueviolet" alt="Live Site" /></a>
  <a href="https://www.npmjs.com/package/@moltlaunch/sdk"><img src="https://img.shields.io/npm/v/@moltlaunch/sdk?label=%40moltlaunch%2Fsdk" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
</p>

---

## The Problem

Creating 1,000 fake agent identities on Solana costs **$0**.

Protocols can't distinguish verified agents from spam. On-chain anchoring proves data existed — not that it's true. The gap is **verification**: who checked, how they checked, why you should believe them.

## The Solution

**Composable trust signals, not trust scores.**

`AgentIdentity` PDA stores raw attributes (`infra_type`, `economic_stake`, `hardware_binding`). Protocols compose their own access policies from these signals.

We provide signals. Protocols decide.

---

## Architecture (V3.1)

Four PDAs, twelve instructions. Everything derives from seeds:

| PDA | Seeds | Purpose |
|-----|-------|---------|
| **ProtocolConfig** | `["moltlaunch"]` | Singleton config, revocation nonce |
| **Authority** | `["authority", pubkey]` | Per authorized verifier |
| **AgentIdentity** | `["agent", wallet]` | The signal hub — raw trust attributes |
| **Attestation** | `["attestation", wallet, authority]` | Per verification receipt |

**12 instructions.** Permissionless refresh. **Stale-on-Read pattern** — attestations carry timestamps; consumers decide freshness thresholds at read time, not write time.

---

## Quick Start

Register and verify an agent via the self-verify API at [proveyour.id](https://proveyour.id):

```bash
# Register agent
curl -X POST https://proveyour.id/api/self-verify \
  -H "Content-Type: application/json" \
  -d '{"agentId":"my-agent","acceptTerms":true,"name":"My Agent"}'

# Check status
curl https://proveyour.id/api/self-verify/agent/my-agent
```

---

## On-Chain Program

```
Program: 6AZSAhq4iJTwCfGEVssoa1p3GnBqGkbcQ1iDdP1U1pSb (devnet)
Tests:   43/43 passing
```

Source: [github.com/tradingstarllc/moltlaunch](https://github.com/tradingstarllc/moltlaunch)

---

## SDK

**One package.** [`@moltlaunch/sdk`](https://www.npmjs.com/package/@moltlaunch/sdk) v3.0.0

```bash
npm install @moltlaunch/sdk
```

```typescript
import { MoltLaunchSDK } from "@moltlaunch/sdk";

const sdk = new MoltLaunchSDK({
  endpoint: "https://proveyour.id",
});

// Register an agent identity
const identity = await sdk.registerAgent({
  agentId: "my-agent",
  name: "My Agent",
  acceptTerms: true,
});

// Fetch trust signals
const signals = await sdk.getAgentSignals("my-agent");
console.log(signals.infraType);       // "cloud"
console.log(signals.economicStake);   // 1.5 SOL
console.log(signals.hardwareBound);   // true
```

---

## Composability

MoltLaunch is designed to compose with the emerging Solana agent ecosystem:

| Protocol | Integration | Pattern |
|----------|-------------|---------|
| **AAP** (Agent Authority Protocol) | Delegation scopes | Two-CPI pattern — AAP checks delegation, MoltLaunch checks identity |
| **SATI** (Solana Agent Trust Interface) | Reputation feedback | SATI reads MoltLaunch attestations as reputation inputs |
| **Solana ID** | Human verification | Complementary — Solana ID verifies humans, MoltLaunch verifies agents |
| **SAS** (Solana Attestation Service) | Storage migration | Attestation data portable to SAS format for cross-protocol consumption |

The two-CPI pattern with AAP: a protocol calls AAP to verify "is this agent authorized to act?", then calls MoltLaunch to verify "is this agent real?" Both must pass.

---

## Ecosystem Position

**Layer 1** in the 7-layer Solana Agent Stack — the identity and trust foundation that other layers build on.

See the full composability map: [youragent.id/blog.html](https://youragent.id/blog.html)

---

## Links

- 🌐 **Website:** [youragent.id](https://youragent.id)
- 🔐 **Self-Verify:** [proveyour.id](https://proveyour.id)
- 🎮 **Demo:** [youragent.id/demo.html](https://youragent.id/demo.html)
- 📝 **Blog:** [youragent.id/blog.html](https://youragent.id/blog.html)
- 🚢 **Shipped:** [youragent.id/shipped.html](https://youragent.id/shipped.html)
- 📦 **SDK:** `npm install @moltlaunch/sdk`
- 📋 **sRFC #9:** [github.com/solana-foundation/SRFCs/discussions/9](https://github.com/solana-foundation/SRFCs/discussions/9)
- ⚓ **Anchor Program:** [github.com/tradingstarllc/moltlaunch](https://github.com/tradingstarllc/moltlaunch)

---

## Hackathon Journey

Four architecture iterations: **V1** (verification API) → **V2** (STARK proofs) → **V3** (composable signals) → **V3.1** (Stale-on-Read + permissionless refresh).

Each pivot included a public self-critique. 90+ forum posts. 311 projects mapped across the hackathon ecosystem. Most detailed technical thread in hackathon history.

---

## License

MIT © 2026 TradingStar LLC

---

<p align="center">
  <strong>Built for the <a href="https://www.colosseum.org">Colosseum</a> Agent Hackathon 2026</strong>
</p>
