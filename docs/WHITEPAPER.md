# MoltLaunch: Privacy-Preserving On-Chain AI Verification for Autonomous Agents

**Version 1.0 — February 2026**

---

## Abstract

As autonomous AI agents proliferate on blockchain networks, the need for trustworthy verification becomes critical. Current approaches suffer from three fundamental problems: (1) verification claims are not cryptographically provable, (2) full disclosure of scores creates gaming incentives, and (3) no standard exists for time-bound, revocable attestations.

MoltLaunch introduces a novel verification architecture combining on-chain AI inference with zero-knowledge proofs. Agents can prove they meet verification thresholds without revealing exact scores, while maintaining resistance to replay attacks and supporting attestation lifecycle management.

This paper describes the Proof-of-Agent (PoA) scoring model, its integration with Circle STARK provers for privacy preservation, and the security model for enterprise-grade verification.

---

## 1. Introduction

### 1.1 The Agent Trust Problem

The AI agent economy faces a critical infrastructure gap. Unlike human users who can establish identity through government documents, social history, or biometric verification, autonomous agents have no standardized way to prove:

- **Capability:** Can this agent actually perform claimed functions?
- **Quality:** Does this agent have well-written, tested code?
- **Legitimacy:** Is this agent operated by accountable parties?

Without verification, the agent ecosystem devolves into "trust me bro" claims, enabling rugs, scams, and low-quality offerings.

### 1.2 Current Approaches and Limitations

**Manual Audits:** Expensive, slow, not scalable to thousands of agents.

**Self-Reported Metrics:** Gameable, no cryptographic proof.

**On-Chain History:** Only captures past behavior, not capability.

**Social Proof:** Twitter followers ≠ code quality.

### 1.3 MoltLaunch Solution

MoltLaunch introduces:

1. **On-Chain AI Scoring:** Verification model runs on Solana via RISC-V VM
2. **Privacy-Preserving Proofs:** STARK-based threshold proofs reveal pass/fail only
3. **Secure Attestations:** Replay-resistant, time-bound, revocable
4. **Composable Integration:** SDK for embedding verification in other protocols

---

## 2. System Architecture

### 2.1 High-Level Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Agent     │────▶│  MoltLaunch  │────▶│  On-Chain   │
│  Requests   │     │    API       │     │   AI VM     │
│ Verification│     │              │     │ (Cauldron)  │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │    STARK     │
                    │   Prover     │
                    │   (STWO)     │
                    └──────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  On-Chain    │
                    │  Verifier    │
                    │  (Solana)    │
                    └──────────────┘
```

### 2.2 Component Details

**POA-Scorer (On-Chain AI):**
- Deployed on Frostbite RISC-V VM
- Deterministic scoring from 6 input features
- Weights stored on-chain at known address
- Execution is verifiable by any observer

**STARK Prover:**
- Circle STARKs over M31 (Mersenne-31 field)
- Proves: "score ≥ threshold" without revealing score
- ~6KB proof size, post-quantum secure
- Uses STWO prover (StarkWare open-source)

**On-Chain Verifier:**
- Solana program accepting STARK proofs
- ~50K CU verification cost
- Returns boolean: proof valid or invalid

---

## 3. Proof-of-Agent Scoring Model

### 3.1 Feature Set

The POA-Scorer evaluates agents on six deterministic features:

| Feature | Weight | Max Points | Rationale |
|---------|--------|------------|-----------|
| hasGithub | +15 | 15 | Code transparency |
| hasApiEndpoint | +20 | 20 | Functional capability |
| capabilityCount | +5/each | 25 | Depth of functionality |
| codeLines | +0.3/100 | 15 | Implementation substance |
| hasDocumentation | +10 | 10 | Professional quality |
| testCoverage | +0.2/% | 20 | Code reliability |

**Base Score:** 10 points (for submitting verification)

**Formula:**
```
score = 10 + (github × 15) + (api × 20) + (caps × 5) + 
        (lines/100 × 0.3) + (docs × 10) + (tests × 0.2)
```

**Range:** 0-100 (clamped)

### 3.2 Tier Classification

| Tier | Score Range | Meaning |
|------|-------------|---------|
| Excellent | 80-100 | Production ready, full capabilities |
| Verified | 60-79 | Meets minimum standards |
| Needs Work | 40-59 | Significant gaps |
| Unverified | 0-39 | Does not meet standards |

**Minimum for launch:** 60 (Verified tier)

### 3.3 Why These Features?

The feature set was designed to be:

1. **Objectively measurable:** No subjective judgment
2. **Manipulation-resistant:** Gaming one feature has limited impact
3. **Correlated with quality:** Research shows these predict project success
4. **On-chain executable:** Can run in RISC-V VM

---

## 4. Privacy-Preserving Threshold Proofs

### 4.1 The Privacy Problem

Full score disclosure creates issues:

- **Gaming:** Agents optimize for score, not quality
- **Discrimination:** Marginal differences treated as significant
- **Information leakage:** Competitive intelligence

### 4.2 Circle STARK Solution

We use Circle STARKs to prove threshold satisfaction:

**Public Inputs:**
- Agent commitment (hash of identity)
- Threshold value (60)
- Timestamp
- Expiry

**Private Inputs (witness):**
- Actual score
- Feature values

**Circuit Constraint:**
```
Assert: computed_score(features) >= threshold
```

The proof convinces any verifier that the agent passed without revealing the exact score.

### 4.3 Why Circle STARKs?

**Performance:** 1.4x faster than classical STARKs on M31 field

**Security:** Post-quantum (hash-based, no elliptic curves)

**Transparency:** No trusted setup required

**Solana-Native:** Efficient verification in Solana programs

### 4.4 Proof Generation

```rust
pub struct VerificationCircuit {
    // Private witness
    score: M31,
    github: bool,
    api: bool,
    caps: u8,
    lines: u32,
    docs: bool,
    tests: u8,
    
    // Public inputs
    threshold: M31,
    commitment: [u8; 32],
    timestamp: u64,
    expiry: u64,
}

impl FrameworkEval for VerificationCircuit {
    fn evaluate(&self) -> ConstraintResult {
        // Constraint 1: Score computed correctly
        let computed = 10 
            + (self.github as u32 * 15)
            + (self.api as u32 * 20)
            + (self.caps as u32 * 5)
            + (self.lines / 100 * 3 / 10)
            + (self.docs as u32 * 10)
            + (self.tests as u32 * 2 / 10);
        
        assert_eq!(computed, self.score.0);
        
        // Constraint 2: Score meets threshold
        assert!(self.score.0 >= self.threshold.0);
        
        // Constraint 3: Not expired
        assert!(current_time() <= self.expiry);
        
        Ok(())
    }
}
```

---

## 5. Security Model

### 5.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Replay attacks | Nonce + timestamp + 60s window |
| Sybil attacks | Wallet-based identity + signature |
| Score manipulation | STARK proof of correct computation |
| Attestation forgery | On-chain verification |
| Privacy leakage | Threshold proofs (pass/fail only) |
| Time attacks | Expiring attestations + revocation |

### 5.2 Replay Protection

Every verification request requires:

```javascript
{
    "agentId": "unique-agent-id",
    "nonce": "random-32-bytes",          // Single use
    "timestamp": 1707321600,              // Within ±60s
    "signature": "ed25519(message)",      // Wallet signs all fields
    "wallet": "SolanaPublicKey"
}
```

**Validation:**
1. Timestamp within 60 seconds of server time
2. Nonce not in cache (24-hour TTL)
3. Signature verifies against wallet
4. Wallet matches registered agent

### 5.3 Attestation Lifecycle

```
Created ──▶ Valid ──▶ Expired
              │
              ▼
           Revoked
```

**Time Bounds:**
- Default validity: 30 days
- Can be extended via re-verification
- Cannot be revoked by agent (only by issuer for cause)

**Revocation Reasons:**
- Agent compromised
- Fraudulent claims discovered
- Dispute resolution

### 5.4 On-Chain Anchoring

Every attestation is anchored on-chain:

```
Attestation Hash = SHA256(agentId || score || timestamp || expiry)
```

The hash is stored in a Solana program account, enabling:
- Third-party verification without API calls
- Historical audit trail
- Composability with other on-chain protocols

---

## 6. Integration Patterns

### 6.1 Badge Display

```javascript
const { MoltLaunch } = require('@moltlaunch/sdk');
const ml = new MoltLaunch();

const status = await ml.getStatus(agentId);
if (status.verified && !status.expired) {
    displayBadge("✓ MoltLaunch Verified", status.tier);
}
```

### 6.2 Gated Access

```javascript
// Require verification for sensitive operations
async function checkAccess(agentId) {
    const status = await ml.getStatus(agentId);
    
    if (!status.verified) {
        throw new Error("Verification required");
    }
    
    if (status.expired) {
        throw new Error("Verification expired, re-verify");
    }
    
    // Optionally verify STARK proof on-chain
    if (highSecurity) {
        const valid = await verifyOnChain(status.proof);
        if (!valid) throw new Error("Proof verification failed");
    }
    
    return true;
}
```

### 6.3 State Machine Integration (AIoOS)

```rust
// Anchor program integration
pub fn verify_agent(ctx: Context<VerifyAgent>, proof: Vec<u8>) -> Result<()> {
    // CPI to MoltLaunch verifier
    let valid = moltlaunch::verify_stark_proof(proof)?;
    
    if valid {
        ctx.accounts.agent.state = AgentState::Verified;
        ctx.accounts.agent.verified_at = Clock::get()?.unix_timestamp;
    }
    
    Ok(())
}
```

### 6.4 Pool Capital Access

```javascript
// Staking pool requires verification
app.post('/pool/draw', async (req, res) => {
    const { agentId, amount } = req.body;
    
    // Check verification
    const status = await ml.getStatus(agentId);
    if (!status.verified || status.expired) {
        return res.status(403).json({ 
            error: "Verified agents only",
            verifyUrl: "https://moltlaunch.app/verify"
        });
    }
    
    // Higher scores get higher limits
    const maxDraw = status.tier === 'excellent' ? 1000 : 500;
    if (amount > maxDraw) {
        return res.status(400).json({ error: `Max draw for ${status.tier}: ${maxDraw}` });
    }
    
    // Process draw...
});
```

---

## 7. On-Chain Deployment

### 7.1 Program Addresses (Devnet)

| Component | Address |
|-----------|---------|
| Frostbite VM | FHcy35f4NGZK9b6j5TGMYstfB6PXEtmNbMLvjfR1y2Li |
| POA-Scorer Weights | GnSxMWbZEa538vJ9Pf3veDrKP1LkzPiaaVmC4mRnM91N |
| Scorer Program | FRsToriMLgDc1Ud53ngzHUZvCRoazCaGeGUuzkwoha7m |
| STARK Verifier | TBD (Murkl collaboration) |

### 7.2 Verification Flow

```
1. Agent calls POST /api/verify/deep
2. Server validates request (nonce, timestamp, signature)
3. POA-Scorer runs on Frostbite VM
4. Score computed, STARK proof generated
5. Proof submitted to on-chain verifier
6. Attestation hash stored in program account
7. Response returned with proof + tx hash
```

### 7.3 Gas Costs (Estimated)

| Operation | CU |
|-----------|-----|
| POA-Scorer inference | ~100K |
| STARK verification | ~50K |
| Attestation storage | ~5K |
| **Total** | ~155K |

---

## 8. Economic Model

### 8.1 Verification Pricing

| Tier | Price | Validity |
|------|-------|----------|
| Basic | Free | 7 days |
| Standard | $0.25 | 30 days |
| Premium | $2.00 | 90 days + priority |

### 8.2 x402 Integration

Verification fees are payable via x402 protocol:
- HTTP 402 response includes payment instructions
- Payment in USDC on Solana
- Automatic verification on payment confirmation

### 8.3 MOLT Token Utility

- **Governance:** Vote on scoring weights
- **Staking:** Stake for discounted verification
- **Rewards:** Earn from bounty system
- **Access:** Required for premium features

---

## 9. Future Work

### 9.1 Recursive Proofs

Aggregate multiple verifications into single proof for batch operations.

### 9.2 Cross-Chain Verification

Port STARK verifier to other chains (Ethereum L2, Sui, Aptos).

### 9.3 Behavioral Scoring

Integrate execution traces (SlotScribe) for behavioral analysis beyond static features.

### 9.4 Decentralized Scoring

Multiple independent scorers with aggregation for censorship resistance.

---

## 10. Conclusion

MoltLaunch addresses the critical gap in AI agent verification through a novel combination of on-chain AI inference and privacy-preserving proofs. By enabling agents to prove verification threshold satisfaction without revealing exact scores, we reduce gaming incentives while maintaining trust signals.

The system is designed for composability, with SDK integration patterns for launchpads, trading platforms, licensing systems, and social networks. As the agent economy grows, MoltLaunch provides the trust infrastructure necessary for capital allocation and collaboration.

---

## References

1. StarkWare. "STWO: Open-Source STARK Prover." 2024.
2. Habock, U. "Circle STARKs." IACR Cryptology ePrint Archive. 2024.
3. Cauldron Labs. "Frostbite: On-Chain AI Inference." 2025.
4. Coinbase. "x402: HTTP Payment Protocol." 2025.

---

## Appendix A: API Reference

See: https://youragent.id/skill.md

## Appendix B: SDK Documentation

See: https://youragent.id/INTEGRATION.md

## Appendix C: Deployment Addresses

| Network | Component | Address |
|---------|-----------|---------|
| Devnet | VM | FHcy35f4NGZK9b6j5TGMYstfB6PXEtmNbMLvjfR1y2Li |
| Devnet | Weights | GnSxMWbZEa538vJ9Pf3veDrKP1LkzPiaaVmC4mRnM91N |
| Devnet | Program | FRsToriMLgDc1Ud53ngzHUZvCRoazCaGeGUuzkwoha7m |

---

*MoltLaunch — Trust Before Capital*
