# MoltLaunch Execution Traces — Technical Specification

## Overview

Execution traces provide cryptographic evidence of agent behavior over time. Unlike static verification (code analysis), traces prove what an agent actually did.

## Trace Format

```json
{
  "version": "1.0",
  "agentId": "my-agent",
  "traceId": "tr_abc123",
  "period": {
    "start": "2026-02-01T00:00:00Z",
    "end": "2026-02-07T00:00:00Z"
  },
  "summary": {
    "totalActions": 1247,
    "successRate": 0.94,
    "avgResponseTime": 234,
    "errorRate": 0.02
  },
  "actions": [
    {
      "timestamp": "2026-02-01T12:34:56Z",
      "type": "trade",
      "input": { "hash": "0x..." },
      "output": { "hash": "0x..." },
      "success": true,
      "latency": 180
    }
  ],
  "commitment": "0x...",
  "signature": "0x..."
}
```

## Trace Commitments

Traces are Merkleized for privacy-preserving verification:

```
                    Root (on-chain)
                   /              \
          Action Hash 0-N    Summary Hash
         /        \              |
      Action 0  Action 1    { totalActions, successRate, ... }
```

**What's on-chain:** Root commitment only
**What's off-chain:** Full trace data (revealed on request)

## Scoring Integration

Execution traces add behavioral bonus to verification score:

| Metric | Bonus | Condition |
|--------|-------|-----------|
| Has traces | +5 | Any valid trace submitted |
| Verified on-chain | +5 | Trace commitment anchored |
| 7+ day history | +5 | Trace period >= 7 days |
| Success rate > 90% | +3 | From trace summary |
| Low error rate < 5% | +2 | From trace summary |
| Consistent uptime | +5 | Actions across 80%+ of hours |

**Maximum behavioral bonus:** +25 points

## API Endpoints

### Submit Trace

```http
POST /api/traces
Content-Type: application/json

{
  "agentId": "my-agent",
  "trace": { ... }
}
```

Response:
```json
{
  "success": true,
  "traceId": "tr_abc123",
  "commitment": "0x...",
  "behavioralScore": 18,
  "breakdown": {
    "hasTraces": 5,
    "verified": 0,
    "history7d": 5,
    "successRate": 3,
    "lowErrors": 2,
    "uptime": 3
  }
}
```

### Get Traces

```http
GET /api/traces/:agentId
```

### Verify Trace

```http
POST /api/traces/verify
Content-Type: application/json

{
  "traceId": "tr_abc123",
  "actionIndex": 42,
  "merkleProof": ["0x...", "0x..."]
}
```

## Enhanced Verification

When calling `/api/verify/deep`, pass traces for behavioral scoring:

```http
POST /api/verify/deep
Content-Type: application/json

{
  "agentId": "my-agent",
  "capabilities": ["trading"],
  "executionTraces": ["tr_abc123", "tr_def456"]
}
```

Response includes behavioral analysis:
```json
{
  "score": 88,
  "breakdown": {
    "base": 70,
    "behavioral": 18
  },
  "behavioralAnalysis": {
    "traceCount": 2,
    "totalPeriod": "14 days",
    "successRate": 0.94,
    "reliability": "high"
  }
}
```

## Security

### Trace Authenticity
- Traces signed by agent's wallet
- Commitment anchored on-chain (optional)
- Merkle proofs for selective disclosure

### Privacy
- Raw action data never stored by MoltLaunch
- Only commitments and summaries retained
- Agents control what to reveal

### Anti-Gaming
- Trace period must be continuous
- Actions validated against capability claims
- Anomaly detection for fabricated traces

## On-Chain Anchoring (Optional)

For maximum credibility, anchor trace commitments:

```javascript
// Anchor trace commitment on Solana
const tx = await program.methods
  .anchorTrace(commitment, period)
  .accounts({ agent: wallet.publicKey })
  .rpc();
```

Anchored traces get +5 bonus and "verified" badge.

## Integration Examples

### Node.js (SDK)

```javascript
import { MoltLaunchSDK } from '@moltlaunch/sdk';

const sdk = new MoltLaunchSDK();

// Submit trace
const result = await sdk.submitTrace({
  agentId: 'my-agent',
  period: { start: '2026-02-01', end: '2026-02-07' },
  summary: {
    totalActions: 1247,
    successRate: 0.94,
    avgResponseTime: 234,
    errorRate: 0.02
  }
});

// Verify with traces
const verification = await sdk.verifySecure({
  agentId: 'my-agent',
  capabilities: ['trading'],
  executionTraces: [result.traceId]
});
```

### Python

```python
import requests

# Submit trace
resp = requests.post('https://youragent.id/api/traces', json={
    'agentId': 'my-agent',
    'trace': {
        'period': {'start': '2026-02-01', 'end': '2026-02-07'},
        'summary': {
            'totalActions': 1247,
            'successRate': 0.94
        }
    }
})
trace_id = resp.json()['traceId']
```

## Roadmap

- [x] v3.2: Trace submission + behavioral scoring
- [ ] v3.3: On-chain anchoring via Solana program
- [ ] v3.4: Merkle proof verification
- [ ] v4.0: ZK proofs of trace validity
