# MoltLaunch STARK Prover Integration

Privacy-preserving threshold proofs for agent verification using Circle STARKs.

## Overview

This module integrates with Murkl/STWO to generate proofs that an agent passed verification (score ≥ 60) without revealing the exact score.

## Architecture

```
POA-Scorer → score (private) → STARK Circuit → Proof
                ↓
        threshold (public=60)
                ↓
        commitment (agent identity)
                ↓
        Proof verifies: score ≥ threshold
```

## Dependencies

- STWO Prover (StarkWare)
- M31 Field Arithmetic
- Poseidon Hash
- Solana Verifier Program (Murkl collaboration)

## Status

🚧 Integration in progress with @sable/Murkl

## Files

- `circuit.js` - Verification circuit definition
- `prover.js` - Proof generation
- `verifier.js` - Off-chain verification
- `types.js` - M31 field and circuit types
