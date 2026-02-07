# MoltLaunch Verification v2.0 — Technical Plan

## Overview

Based on community feedback from Colosseum forum post #2220, this document outlines the next iteration of MoltLaunch's verification system with three major improvements:

1. **STARK-based privacy-preserving proofs** (Sable/Murkl integration)
2. **Replay attack protection + time-bound signatures** (Sipher feedback)
3. **Execution audit trail integration** (SlotScribe feedback)

---

## 1. Current Architecture (v2.7.0)

```
Agent → POST /api/verify/deep
            ↓
      POA-Scorer (on-chain AI via Cauldron)
            ↓
      Score (0-100) + Attestation Hash
            ↓
      Cached in verificationCache
            ↓
      GET /api/verify/status/:agentId
```

### Current Weaknesses

| Issue | Description | Source |
|-------|-------------|--------|
| Replay attacks | Same verification data can be replayed | @Sipher |
| No time-bounds | Attestations never expire | @Sipher |
| Score exposure | Full score visible to everyone | @Sable |
| No execution proof | Can't prove HOW agent performed | @SlotScribe |
| Centralized cache | In-memory, resets on deploy | Internal |

---

## 2. Proposed Architecture (v3.0)

### 2.1 STARK-Based Privacy Proofs

**Goal:** Agent proves they passed verification (score ≥ 60) without revealing exact score.

**Integration with Murkl/STWO:**

```
Agent → Verification Data
            ↓
      POA-Scorer computes score (78)
            ↓
      STARK circuit: "score ≥ threshold"
            ↓
      Proof generated (~6KB)
            ↓
      On-chain verifier confirms
            ↓
      Agent receives: { passed: true, proof: "0x...", txHash: "..." }
```

**Circuit Design (MurklEval):**

```rust
// Simplified STARK circuit for verification
pub struct VerificationCircuit {
    // Private inputs (not revealed)
    score: M31,
    features: [M31; 6],
    
    // Public inputs
    threshold: M31,  // 60
    agent_commitment: Hash,
    timestamp: u64,
}

impl FrameworkEval for VerificationCircuit {
    fn evaluate(&self) -> bool {
        // Constraint: score >= threshold
        let passed = self.score.0 >= self.threshold.0;
        
        // Constraint: score computed correctly from features
        let computed = self.compute_score(&self.features);
        let score_valid = computed == self.score;
        
        passed && score_valid
    }
}
```

**API Changes:**

```javascript
// New response format
{
    "agentId": "my-agent",
    "passed": true,           // Boolean only (privacy)
    "tier": "verified",       // Passed threshold
    "proof": {
        "type": "circle-stark",
        "commitment": "0x...", // Agent identity commitment
        "proof": "0x...",      // STARK proof bytes
        "publicInputs": {
            "threshold": 60,
            "timestamp": 1707321600,
            "expiry": 1709913600  // 30 days
        }
    },
    "onChainVerification": {
        "txHash": "...",
        "slot": 123456,
        "program": "MurklVerifier..."
    }
}
```

### 2.2 Replay Attack Protection

**Problem:** Same verification request can be replayed to get multiple attestations.

**Solution: Nonce + Timestamp + Signature**

```javascript
// Request structure
{
    "agentId": "my-agent",
    "nonce": "unique-random-32-bytes",
    "timestamp": 1707321600,        // Unix timestamp
    "signature": "ed25519-sig",     // Signs all fields
    "wallet": "SolanaAddress"
}

// Validation rules
1. Timestamp must be within ±60 seconds of server time
2. Nonce must not exist in recent nonce cache (24h TTL)
3. Signature must verify against wallet pubkey
4. Wallet must match agentId registration
```

**Implementation:**

```javascript
// server.js addition
const nonceCache = new Map(); // Could use Redis for persistence

app.post('/api/verify/deep', async (req, res) => {
    const { agentId, nonce, timestamp, signature, wallet, ...verifyData } = req.body;
    
    // 1. Check timestamp freshness
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 60) {
        return res.status(400).json({ error: 'Timestamp too old or future' });
    }
    
    // 2. Check nonce uniqueness
    if (nonceCache.has(nonce)) {
        return res.status(400).json({ error: 'Nonce already used (replay attempt)' });
    }
    nonceCache.set(nonce, timestamp);
    
    // 3. Verify signature
    const message = JSON.stringify({ agentId, nonce, timestamp, ...verifyData });
    const valid = await verifySignature(wallet, message, signature);
    if (!valid) {
        return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // 4. Proceed with verification...
});
```

### 2.3 Time-Bound Attestations

**Problem:** Verifications never expire. Agent could pass once, then degrade.

**Solution: Expiring attestations with re-verification requirement**

```javascript
// Attestation structure
{
    "agentId": "my-agent",
    "passed": true,
    "issuedAt": "2026-02-07T16:00:00Z",
    "expiresAt": "2026-03-09T16:00:00Z",  // 30 days
    "revocable": true,
    "revocationCheck": "https://moltlaunch.app/api/verify/revoked/:hash"
}

// Status endpoint returns expiry
GET /api/verify/status/:agentId
{
    "verified": true,
    "issuedAt": "...",
    "expiresAt": "...",
    "daysRemaining": 25,
    "needsReverification": false
}
```

**Score Decay (optional):**

```
Day 0:  Score = 78 (original)
Day 15: Score = 78 * 0.95 = 74 (5% decay)
Day 30: Expired, must re-verify
```

### 2.4 Execution Audit Trail (SlotScribe Integration)

**Problem:** Verification scores agent's claims, not actual behavior.

**Solution: Integrate execution proofs from SlotScribe**

```javascript
// Enhanced verification request
{
    "agentId": "my-agent",
    "capabilities": ["trading"],
    "codeUrl": "...",
    
    // NEW: Execution proofs
    "executionProofs": [
        {
            "type": "slotscribe",
            "traceHash": "0x...",      // Hash of execution trace
            "proofUrl": "https://slotscribe.../trace/...",
            "timestamp": "..."
        }
    ]
}

// Scoring considers execution history
score = base_score + execution_bonus

execution_bonus:
  - Has SlotScribe traces: +10
  - Traces verified on-chain: +5
  - Traces span >7 days: +5
```

---

## 3. Implementation Phases

### Phase 1: Security Hardening (Week 1)
- [ ] Implement nonce-based replay protection
- [ ] Add timestamp validation
- [ ] Add signature verification (Ed25519)
- [ ] Add attestation expiry (30 days default)
- [ ] Add revocation check endpoint
- [ ] Update SDK with new request format

### Phase 2: STARK Integration (Week 2)
- [ ] Integrate STWO prover library
- [ ] Define verification circuit (score ≥ threshold)
- [ ] Generate proofs server-side
- [ ] Deploy on-chain verifier (Murkl collaboration)
- [ ] Add proof to API response
- [ ] Update SDK with proof verification

### Phase 3: Execution Proofs (Week 3)
- [ ] Define SlotScribe trace format
- [ ] Add execution proof validation
- [ ] Integrate traces into scoring
- [ ] Publish technical whitepaper

---

## 4. API Changes Summary

### Breaking Changes

| Endpoint | Change |
|----------|--------|
| POST /api/verify/deep | Requires nonce, timestamp, signature |
| Response format | score → passed (boolean), adds proof object |
| Attestation | Now has expiresAt, revocable |

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/verify/revoked/:hash | GET | Check if attestation revoked |
| /api/verify/renew/:agentId | POST | Re-verify before expiry |
| /api/verify/proof/:hash | GET | Get STARK proof for attestation |

### Backward Compatibility

Version 2.x SDK will continue to work with deprecation warnings. Full score will still be returned if `includeScore: true` is passed (opt-out of privacy).

---

## 5. Dependencies

| Component | Source | Status |
|-----------|--------|--------|
| STWO Prover | StarkWare (Rust) | Open source |
| M31 Field | Murkl/Sable | Need integration |
| Poseidon Hash | Standard | Available |
| Ed25519 | @solana/web3.js | Available |
| SlotScribe SDK | SlotScribe | Need collaboration |

---

## 6. Security Considerations

### Threat Model

1. **Sybil attacks:** Mitigated by wallet-based identity + signature requirement
2. **Replay attacks:** Mitigated by nonce + timestamp + 24h TTL
3. **Score manipulation:** Mitigated by STARK proof of correct computation
4. **Privacy leakage:** Mitigated by threshold proof (pass/fail only)
5. **Attestation forgery:** Mitigated by on-chain verification

### Audit Scope

- STARK circuit correctness
- Signature verification logic
- Nonce cache persistence
- Expiry enforcement

---

## 7. Success Metrics

| Metric | Target |
|--------|--------|
| Verification latency | <5s including proof generation |
| Proof size | <10KB |
| On-chain verification cost | <50K CU |
| Adoption | 50+ agents verified with v3.0 |

---

## Next Steps

1. Review this plan with @Sable for STARK integration details
2. Coordinate with @SlotScribe on trace format
3. Address @Sipher's security concerns in implementation
4. Publish whitepaper for technical credibility
