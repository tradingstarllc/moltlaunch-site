# MoltLaunch Demo Script

**Duration:** ~3 minutes
**Format:** Terminal API walkthrough
**API Base:** https://youragent.id

---

## Scene 1: Introduction (15 sec)

**Narration:**
> "MoltLaunch is trust infrastructure for AI agents on Solana. 
> We verify that agents actually work before you trust them.
> Let me show you how it works."

---

## Scene 2: Quick Verify (30 sec)

```bash
# Quick verification - does this agent exist and respond?
curl -s -X POST "https://youragent.id/api/verify/quick" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "demo-agent", "apiEndpoint": "https://example.com/api"}' | jq '.'
```

**Narration:**
> "Quick verify takes about 10 seconds. It checks if the agent has an endpoint,
> if it responds, and gives a basic score. This demo agent scored 70 - tier verified."

---

## Scene 3: Deep Verify (45 sec)

```bash
# Deep verification - comprehensive analysis
curl -s -X POST "https://youragent.id/api/verify/deep" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "trading-bot-demo",
    "capabilities": ["trading", "analysis"],
    "codeUrl": "https://github.com/tradingstarllc/proof-of-agent",
    "documentation": true,
    "codeLines": 5000
  }' | jq '{verified, score, tier: .scoreTier, onChainAI}'
```

**Narration:**
> "Deep verify analyzes the agent's code, capabilities, and documentation.
> This trading bot scored 74 - tier good.
> Notice the onChainAI field - our verification runs on Solana via the Cauldron VM."

---

## Scene 4: Check Status (20 sec)

```bash
# Check verification status - instant lookup
curl -s "https://youragent.id/api/verify/status/trading-bot-demo" | jq '.'
```

**Narration:**
> "Results are cached for 30 days. Checking status is instant - under 100 milliseconds.
> Perfect for payment flows where you need to verify trust quickly."

---

## Scene 5: STARK Proof (45 sec)

```bash
# Generate privacy-preserving proof
curl -s -X POST "https://youragent.id/api/stark/generate/trading-bot-demo" \
  -H "Content-Type: application/json" \
  -d '{"threshold": 60}' | jq '{success, commitment: .commitment[0:32], publicInputs, privacyNote}'
```

**Narration:**
> "Here's the magic. This STARK proof shows the agent passed a score threshold of 60...
> without revealing the exact score.
> Trading agents can prove they're verified without exposing their edge.
> The proof uses M31 field arithmetic and Poseidon hashing."

---

## Scene 6: Ecosystem Bonuses (30 sec)

```bash
# Check Pyth oracle price
curl -s "https://youragent.id/api/oracles/pyth/price/SOL%2FUSD" | jq '.'

# Check Jito MEV tip
curl -s "https://youragent.id/api/mev/jito/tip-estimate" | jq '.'
```

**Narration:**
> "We reward agents that use quality infrastructure.
> Using Pyth oracles? Plus 10 points.
> Using Jito for MEV protection? Plus 15 points.
> We're aligning incentives with best practices."

---

## Scene 7: SDK Install (20 sec)

```bash
# Install the SDK
npm install @moltlaunch/proof-of-agent
```

```typescript
import { PoAClient } from '@moltlaunch/proof-of-agent';

const client = new PoAClient({ network: 'devnet' });
const status = await client.getStatus('my-agent');
console.log(status.verified); // true
```

**Narration:**
> "Integration is simple. Install our SDK, create a client, check status.
> One line to verify if an agent is trustworthy."

---

## Scene 8: Closing (15 sec)

**Narration:**
> "MoltLaunch: Verify before you trust.
> 85% of AI agent tokens rug. We're here to fix that.
> Try it at moltlaunch.com or install @moltlaunch/proof-of-agent from npm."

---

## Total: ~3 minutes 40 seconds

**Key Points Hit:**
- Problem: Agent trust gap
- Solution: Verification + STARK proofs
- Demo: Live API calls
- Integration: Simple SDK
- CTA: Try it
