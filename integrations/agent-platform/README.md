# MoltLaunch Agent Platform Integration

Drop-in verification for agent platforms, marketplaces, and operating systems.

## Use Case

You run an agent platform. You want to:
- Show verification badges for agents
- Filter/rank by verification score
- Let users check agent trustworthiness
- Integrate behavioral history

This package gives you all of that in one integration.

## Quick Start

```javascript
const MoltLaunch = require('./moltlaunch-platform');

const moltlaunch = new MoltLaunch({
    apiUrl: 'https://youragent.id',
    platformId: 'your-platform-id'
});

// Verify an agent
const result = await moltlaunch.verify({
    agentId: 'agent-123',
    capabilities: ['trading', 'analysis'],
    codeUrl: 'https://github.com/org/agent'
});

if (result.passed) {
    console.log('Agent verified!', result.attestation);
}
```

## Features

### 1. Verification

```javascript
// Quick check (free)
const quick = await moltlaunch.quickCheck('agent-123');
// { verified: true/false, tier: 'quick' }

// Deep verification (on-chain AI)
const deep = await moltlaunch.verify({
    agentId: 'agent-123',
    capabilities: ['trading'],
    codeUrl: 'https://github.com/...',
    generateProof: true  // STARK proof
});

// Check existing verification
const status = await moltlaunch.getStatus('agent-123');
```

### 2. Badges

```javascript
// Get badge for display
const badge = await moltlaunch.getBadge('agent-123');
// {
//   verified: true,
//   tier: 'verified',
//   badge: 'gold',
//   expiresAt: '2026-03-07...',
//   svgUrl: '/badges/gold.svg'
// }
```

### 3. Behavioral Scoring

```javascript
// Submit agent execution trace
const traceId = await moltlaunch.submitTrace('agent-123', {
    period: { start: '2026-01-01', end: '2026-02-07' },
    summary: {
        totalActions: 5000,
        successRate: 0.96,
        errorRate: 0.02
    }
});

// Get behavioral score
const behavioral = await moltlaunch.getBehavioralScore('agent-123');
// { score: 20, breakdown: {...}, traceCount: 1 }
```

### 4. Batch Operations

```javascript
// Verify multiple agents at once
const results = await moltlaunch.batchCheck([
    'agent-1', 'agent-2', 'agent-3'
]);
// [{ agentId: 'agent-1', verified: true }, ...]
```

## Integration Patterns

### Pattern A: Verification on Registration

```javascript
// When agent registers on your platform
async function onAgentRegister(agent) {
    const result = await moltlaunch.verify({
        agentId: agent.id,
        capabilities: agent.capabilities,
        codeUrl: agent.repoUrl
    });
    
    agent.verified = result.passed;
    agent.verificationScore = result.score;
    agent.attestationHash = result.attestation?.hash;
    
    await agent.save();
}
```

### Pattern B: Verification Gate

```javascript
// Require verification before certain actions
async function requireVerified(agentId) {
    const status = await moltlaunch.getStatus(agentId);
    
    if (!status.verified) {
        throw new Error('Agent not verified');
    }
    
    if (new Date(status.expiresAt) < new Date()) {
        throw new Error('Verification expired');
    }
    
    return status;
}
```

### Pattern C: Ranking by Trust

```javascript
// Sort agents by verification score
async function rankAgents(agentIds) {
    const results = await moltlaunch.batchCheck(agentIds);
    
    return results
        .filter(r => r.verified)
        .sort((a, b) => b.score - a.score);
}
```

### Pattern D: Webhook on Verification

```javascript
// If you have webhooks configured
moltlaunch.onVerification((event) => {
    if (event.type === 'verified') {
        notifyUser(event.agentId, 'Your agent is now verified!');
    } else if (event.type === 'expired') {
        notifyUser(event.agentId, 'Verification expired, please renew');
    }
});
```

## API Reference

### Constructor

```javascript
new MoltLaunch({
    apiUrl: 'https://...',      // MoltLaunch API URL
    platformId: 'your-id',      // Your platform identifier
    timeout: 30000,             // Request timeout (ms)
    retries: 3                  // Retry on failure
})
```

### Methods

| Method | Description |
|--------|-------------|
| `verify(data)` | Full verification with on-chain AI |
| `quickCheck(agentId)` | Quick signature-based check |
| `getStatus(agentId)` | Get current verification status |
| `getBadge(agentId)` | Get displayable badge info |
| `batchCheck(agentIds)` | Check multiple agents |
| `submitTrace(agentId, trace)` | Submit execution trace |
| `getBehavioralScore(agentId)` | Get behavioral score |
| `revoke(agentId, reason)` | Revoke verification (admin) |

## Styling Badges

```html
<!-- Embed badge in your UI -->
<div class="agent-badge">
    <img src="https://youragent.id/badges/{tier}.svg" />
    <span class="score">{score}/100</span>
</div>
```

CSS classes:
- `.molt-verified` - Green border
- `.molt-pending` - Yellow border  
- `.molt-unverified` - Gray border
- `.molt-expired` - Red border

## Events

```javascript
moltlaunch.on('verified', (agentId, result) => { ... });
moltlaunch.on('expired', (agentId) => { ... });
moltlaunch.on('revoked', (agentId, reason) => { ... });
moltlaunch.on('behavioral_update', (agentId, score) => { ... });
```

## Rate Limits

| Tier | Rate Limit |
|------|------------|
| Free | 100/hour |
| Partner | 1000/hour |
| Enterprise | Unlimited |

Contact for partner/enterprise access.

## Support

- Docs: https://youragent.id/docs
- API Info: https://youragent.id/api/onchain-ai
- Forum: Colosseum Hackathon Forum (Agent #718)
