# MoltLaunch STARK Prover (`moltlaunch-stark-lite`)

Privacy-preserving threshold proofs for agent verification using simplified STARK proofs over the Mersenne-31 field.

## What It Proves

> "I can prove my score ≥ 60 without revealing my score."

Given a private score and a public threshold, this module generates a cryptographic proof that the score meets the threshold — and a verifier can confirm this independently, without ever learning the actual score.

## Architecture

```
Private: score (e.g. 78)     Public: threshold (e.g. 60)
         ↓                              ↓
   ┌─────────────────────────────────────────┐
   │  Circuit Trace (M31 field elements)     │
   │  • score, threshold, difference         │
   │  • bit decomposition of difference      │
   │  • bit decomposition of 100 - score     │
   └───────────────────┬─────────────────────┘
                       ↓
   ┌─────────────────────────────────────────┐
   │  Merkle Commitment (SHA-256)            │
   │  Trace rows → leaf hashes → tree → root │
   └───────────────────┬─────────────────────┘
                       ↓
   ┌─────────────────────────────────────────┐
   │  Composition Polynomial                 │
   │  Encodes ALL constraints as polynomial  │
   │  that vanishes iff constraints hold      │
   └───────────────────┬─────────────────────┘
                       ↓
   ┌─────────────────────────────────────────┐
   │  FRI Protocol (4 layers)                │
   │  Prove composition poly has low degree  │
   │  via iterative folding + Fiat-Shamir    │
   └───────────────────┬─────────────────────┘
                       ↓
   ┌─────────────────────────────────────────┐
   │  Query Phase (8 queries)                │
   │  Random positions with Merkle proofs    │
   │  FRI folding consistency checks         │
   └───────────────────┬─────────────────────┘
                       ↓
              Proof (~30KB JSON)
```

## What's Real

This is **not** a toy or simulation. The proofs are cryptographically verifiable:

- **Real polynomial commitment** — trace columns are interpolated into polynomials over M31, committed via Merkle tree over evaluations
- **Real FRI protocol** — iterative degree reduction via even/odd splitting and Fiat-Shamir challenges; verifier checks folding consistency
- **Real Merkle proofs** — SHA-256 based Merkle tree with domain-separated leaf/node hashing; all query positions include inclusion proofs
- **Real Fiat-Shamir transform** — all challenges are derived deterministically from prior commitments via SHA-256 transcript; verifier recomputes independently
- **Real constraint system** — arithmetic constraints (not boolean checks) enforce: `difference = score - threshold`, bit decomposition proves non-negativity

## What's Simplified

Honest about the limitations:

| Parameter | This Implementation | Production STARK |
|-----------|-------------------|-----------------|
| FRI layers | 4 | 15-20+ |
| Queries per layer | 8 | 30-50+ |
| Security level | ~32 bits | 128 bits |
| Hash function | SHA-256 | Poseidon (algebraic) |
| Trace length | 16 rows | Millions |
| Polynomial arithmetic | O(n²) schoolbook | FFT-based |
| Side-channel resistance | None | Required |

## Files

| File | Purpose |
|------|---------|
| `types.js` | M31 field, Polynomial (interpolate/evaluate/FRI fold), MerkleTree (SHA-256), FiatShamirTranscript |
| `circuit.js` | VerificationCircuit (constraint definition), CircuitTrace (execution trace with bit decomposition) |
| `prover.js` | STWOProver (trace→commitment→composition→FRI→queries), verifyProof (independent verification) |
| `consistency-proof.js` | Multi-period batch proofs, streak proofs, stability proofs |
| `index.js` | Public API (MoltLaunchStarkProver class) |
| `test.js` | 44 tests covering field arithmetic, polynomials, Merkle trees, proof generation/verification |

## Usage

```javascript
const { MoltLaunchStarkProver } = require('./stark-prover');

const prover = new MoltLaunchStarkProver();

// Generate proof (score is private — not included in output)
const result = await prover.generateProof({
    agentId: 'my-agent',
    score: 78,              // Private! Not revealed.
    features: { ... },
    threshold: 60,          // Public
    validityDays: 30
});

// result.proof contains the STARK proof
// result.proof.proof.traceCommitment — Merkle root of execution trace
// result.proof.proof.fri — FRI layer commitments + challenges
// result.proof.proof.queries — Merkle inclusion proofs at random positions

// Verify (works with ONLY the proof — no score needed)
const verification = await prover.verifyProof(result.proof);
console.log(verification.valid); // true
```

### Consistency Proofs

```javascript
const { generateConsistencyProof, verifyConsistencyProof } = require('./stark-prover');

// Prove: "score >= 60 for all 7 days"
const proof = generateConsistencyProof({
    periods: [
        { score: 72, timestamp: 1700000000 },
        { score: 68, timestamp: 1700086400 },
        // ...
    ],
    threshold: 60,
    agentId: 'my-agent'
});

const result = verifyConsistencyProof(proof);
```

## Testing

```bash
cd stark-prover && node test.js
```

Runs 44 tests:
- M31 field arithmetic (7 tests)
- Polynomial operations (7 tests)
- Merkle tree (5 tests)
- Fiat-Shamir transcript (2 tests)
- Circuit trace (3 tests)
- Full proof generation & verification (10 tests)
- Consistency proofs (4 tests)
- Streak proofs (2 tests)
- Stability proofs (2 tests)
- API tests (2 tests)

## Proof Structure

```json
{
    "type": "moltlaunch-stark-lite",
    "version": "2.0",
    "commitment": "<agent-id-hash>",
    "publicInputs": {
        "threshold": 60,
        "timestamp": 1700000000,
        "expiry": 1702592000
    },
    "proof": {
        "traceCommitment": "<merkle-root-of-trace>",
        "fri": {
            "layers": [
                { "commitment": "<merkle-root>", "evaluationCount": 32 },
                { "commitment": "<merkle-root>", "evaluationCount": 16 },
                { "commitment": "<merkle-root>", "evaluationCount": 8 },
                { "commitment": "<merkle-root>", "evaluationCount": 4 }
            ],
            "challenges": ["<fiat-shamir-m31>", ...],
            "finalConstant": "<m31-value>"
        },
        "queries": [
            {
                "layerOpenings": [
                    {
                        "index": 5,
                        "value": "<m31>",
                        "merkleProof": [{"hash": "...", "position": "left"}, ...],
                        "domain": "<m31>"
                    }, ...
                ]
            }, ...
        ],
        "traceQueries": [
            { "index": 3, "leafHash": "...", "merkleProof": [...] }, ...
        ]
    }
}
```

## Verification Process

The verifier performs these steps (all independently, no trusted setup):

1. **Rebuild Fiat-Shamir transcript** from the proof's commitments
2. **Recompute FRI challenges** and verify they match the proof's claimed challenges
3. **Verify Merkle inclusion proofs** at all query positions in all FRI layers
4. **Check FRI folding consistency** — at each layer, verify `f_folded = f_even + alpha * f_odd`
5. **Verify trace Merkle proofs** against the trace commitment root

If ANY check fails, the proof is rejected.

## Dependencies

None. Pure JavaScript, Node.js `crypto` module only.

## License

Part of MoltLaunch.
