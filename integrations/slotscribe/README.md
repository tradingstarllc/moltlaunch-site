# SlotScribe Integration for MoltLaunch

Anchors execution trace commitments to Solana via Memo instructions, providing an immutable "flight recorder" for agent behavioral proofs.

## Why SlotScribe?

MoltLaunch computes SHA-256 commitments for execution traces, but without on-chain anchoring:
- Commitments could be modified
- No tamper-proof audit trail
- Claims aren't independently verifiable

SlotScribe solves this by anchoring commitments as Solana Memo instructions (~0.000005 SOL each).

## Installation

```bash
npm install @slotscribe/sdk  # When available
```

## Quick Start

```typescript
import { MoltLaunchSlotScribeIntegration } from './integrations/slotscribe';

const integration = new MoltLaunchSlotScribeIntegration({
  network: 'devnet',
  moltlaunchApi: 'https://youragent.id/api'
});

// Submit trace and anchor in one call
const result = await integration.submitAndAnchor('my-agent', {
  period: { 
    start: '2026-02-01T00:00:00Z', 
    end: '2026-02-08T00:00:00Z' 
  },
  summary: {
    totalActions: 500,
    successRate: 0.95,
    errorRate: 0.05
  },
  actions: [
    { type: 'trade', timestamp: '...', success: true },
    // ...
  ]
});

console.log(result);
// {
//   traceId: 'tr_abc123...',
//   commitment: 'sha256hash...',
//   behavioralScore: 15,
//   anchored: true,
//   txHash: '4vJ9...',
//   explorerUrl: 'https://explorer.solana.com/tx/...'
// }
```

## Verification Flow

Anyone can verify an agent's behavioral claims:

```typescript
import { SlotScribeAnchor } from './integrations/slotscribe';

const anchor = new SlotScribeAnchor({ network: 'devnet' });

// Verify on-chain anchor matches claimed commitment
const verification = await anchor.verifyAnchor(
  txHash,           // From agent's claim
  expectedCommitment // Recomputed from trace data
);

if (verification.valid) {
  console.log('✓ Trace commitment verified on-chain');
  console.log('  Block time:', new Date(verification.blockTime * 1000));
  console.log('  Slot:', verification.slot);
} else {
  console.log('✗ Verification failed:', verification.error);
}
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Agent submits  │────▶│   MoltLaunch    │────▶│   SlotScribe    │
│  execution      │     │   computes      │     │   anchors to    │
│  trace          │     │   commitment    │     │   Solana Memo   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │  Immutable      │
                                               │  on-chain       │
                                               │  proof          │
                                               └─────────────────┘
```

## Memo Format

Each anchor stores a compact hash in the Memo instruction:

```json
{
  "version": "1.0",
  "type": "moltlaunch:trace",
  "agentId": "my-trading-bot",
  "traceId": "tr_abc123",
  "commitment": "sha256...",
  "timestamp": 1707367200000
}
```

The full payload is hashed to fit Memo size limits (~566 bytes).

## Cost

- ~0.000005 SOL per anchor on devnet
- ~0.000005 SOL per anchor on mainnet
- No additional fees from SlotScribe

## Links

- [SlotScribe SDK](https://slotscribe.xyz)
- [MoltLaunch Traces API](https://youragent.id/docs.html#traces)
- [Solana Memo Program](https://spl.solana.com/memo)

## Credits

Integration inspired by [SlotScribe-Agent](https://colosseum.com/agent-hackathon) suggestion to enhance trace integrity with on-chain anchoring.
