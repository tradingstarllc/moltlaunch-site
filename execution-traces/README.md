# Execution Traces Module

> ⚠️ **Status: Deprecated (Hackathon Archive)**
>
> Built during Days 5-7 of the Colosseum Agent Hackathon (the "behavioral scoring" era). This module computes a behavioral score from agent execution traces using hand-picked weights. It has been superseded by the V3 composable signals architecture.
>
> See [MoltLaunch V3](https://github.com/tradingstarllc/moltlaunch) for the current architecture.

## What It Does

Stores agent execution traces (actions, time periods, success rates) and computes a behavioral score (0-25 points):

| Signal | Points | Condition |
|--------|--------|-----------|
| Has traces | +5 | Any trace submitted |
| Anchored on-chain | +5 | Commitment written to Solana memo |
| 7+ day history | +5 | Trace period spans 7+ days |
| High success rate | +3 | > 90% success rate |
| Low error rate | +2 | < 5% error rate |
| Consistent activity | +5 | 100+ total actions |

Trace integrity uses Merkle trees over action arrays, with commitments anchored to Solana via memo instructions.

## What We Learned

- **Hand-picked weights encode opinions.** Why is "7+ day history" worth exactly 5 points? Why is the success rate threshold 90% and not 85%? These are arbitrary. Different protocols need different thresholds.
- **The Merkle proof verification is incomplete.** `verifyActionProof()` returns `{ valid: true }` without checking Merkle paths. This was an honest gap we never closed.
- **Behavioral scoring ≠ composable signals.** The V3 insight: instead of us computing a 0-25 score, an attestation authority should examine traces and issue typed attestations (`{ signal_type: "behavioral", value: "consistent_7d", weight: 3, expiry: ... }`). The consuming protocol decides what that attestation is worth.
- **File persistence doesn't survive deploys.** `traces.json` disappears on Railway redeploy. Production would need a database or on-chain storage.

## What Survived

- **Merkle tree over actions** — `computeActionsMerkle()` is correct and reusable
- **Trace commitment pattern** — hash(actions_merkle + summary + agentId) is sound, same pattern SlotScribe uses
- **Anchoring flow** — commit hash → Solana memo → verifiable on-chain record

## V3 Replacement

In the V3 composable signals architecture, this module is replaced by attestation primitives:

```
Old: execution-traces computes score → returns { behavioralScore: 18 }
New: attestation authority examines traces → issues composable attestation:
     {
       signal_type: "behavioral",
       value: "consistent_7d",
       weight: 3,
       authority: <verifier_pubkey>,
       expiry: <30_days>
     }
```

Consuming protocols compose the signals they care about. No single module owns the definition of "good behavior."

## Files

- `index.js` — Trace storage, behavioral scoring, Merkle commitments
- `package.json` — Module metadata

## Related

- [MoltLaunch V3](https://github.com/tradingstarllc/moltlaunch) — Current architecture (4 PDAs, composable signals)
- [STARK Prover](../stark-prover/) — Privacy-preserving threshold proofs (rebuilt with real FRI protocol)
- [POA-Scorer](https://github.com/tradingstarllc/poa-scorer) — On-chain AI scoring via Cauldron VM (model deprecated, VM lives on)
