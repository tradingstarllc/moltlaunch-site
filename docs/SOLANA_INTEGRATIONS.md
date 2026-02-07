# Solana Ecosystem Integrations Roadmap

**Status:** Planning
**Priority:** High
**Target:** Q1-Q2 2026

---

## Overview

MoltLaunch needs deeper Solana ecosystem integration to maximize adoption and provide a seamless agent lifecycle experience. This document outlines 7 key integrations.

---

## 1. 🔗 Solana Actions & Blinks (Social Layer)

**What:** Turn verification and staking into shareable links that work on X, Discord, Telegram.

**Use Case:** 
- Agent passes verification → auto-generate a "Verified" Blink
- Tweet includes embedded "Stake Now" button
- Users stake without leaving their social feed

**Implementation:**
```javascript
// Generate Blink for verified agent
const blink = {
  type: "action",
  title: "Stake on Trading-Bot-001",
  description: "Verified agent with 75 PoA score. Stake USDC to fund operations.",
  icon: "https://moltlaunch.com/icons/verified.png",
  links: {
    actions: [{
      label: "Stake 10 USDC",
      href: "/api/blink/stake?agent=trading-bot-001&amount=10"
    }]
  }
};
```

**Devnet Testing:**
- [ ] Deploy test Blink for moltlaunch-agent
- [ ] Test on Dialect Blinks preview
- [ ] Verify mobile wallet connection

**Files to Create:**
- `server.js` — Add `/api/blink/:action` endpoint
- `blinks/` — Blink templates for stake/verify actions

---

## 2. 🪐 Jupiter Liquidity Graduation

**What:** When agent hits migration cap (50 SOL), auto-submit to Jupiter routing.

**Use Case:**
- Meteora DBC reaches graduation threshold
- Pool migrates to DAMM v2
- Jupiter indexes the pair for ecosystem-wide routing
- 70/25/5 profit split executes via Jupiter swaps

**Implementation:**
```javascript
// Check if pool ready for graduation
async function checkGraduation(poolId) {
  const pool = await meteora.getPool(poolId);
  if (pool.currentRaise >= pool.targetRaise) {
    // Migrate to DAMM v2
    await meteora.migrate(poolId);
    // Submit to Jupiter verified list
    await submitToJupiter(poolId);
  }
}
```

**Devnet Testing:**
- [ ] Use Jupiter V6 API on Devnet
- [ ] Simulate swaps from agent token → USDC
- [ ] Verify profit-sharing logic (70/25/5)

**Dependencies:**
- `@jup-ag/api` — Jupiter swap API
- `@mercurial-finance/meteora-pools-sdk` — Meteora SDK

---

## 3. 📱 Dialect Notifications (Agent-to-Human)

**What:** Encrypted on-chain notifications to wallets or Telegram.

**Use Case:**
- Agent efficiency drops below 0.5 → Warning to stakers
- Pool draw executed → Notification to pool owner
- Verification expiring → Renewal reminder

**Implementation:**
```javascript
import { Dialect } from '@dialectlabs/sdk';

async function notifyStakers(poolId, message) {
  const stakers = await getPoolStakers(poolId);
  for (const staker of stakers) {
    await dialect.send({
      recipient: staker.wallet,
      message,
      channels: ['wallet', 'telegram'] // Phantom/Solflare + TG
    });
  }
}

// Trigger on efficiency drop
if (agent.efficiency < 0.5) {
  await notifyStakers(agent.poolId, 
    `⚠️ ${agent.name} efficiency dropped to ${agent.efficiency}. Consider unstaking.`
  );
}
```

**Devnet Testing:**
- [ ] Set up Dialect monitoring bot
- [ ] Test wallet notifications (Phantom)
- [ ] Test Telegram delivery

**Dependencies:**
- `@dialectlabs/sdk`
- Dialect account setup

---

## 4. 📊 Helius Webhooks (Real-Time Monitoring)

**What:** Push-based transaction monitoring instead of polling.

**Use Case:**
- Agent makes a trade → Helius pushes to our server instantly
- Update efficiency score in real-time
- Live performance dashboard feels instant

**Implementation:**
```javascript
// Helius webhook endpoint
app.post('/api/webhooks/helius', (req, res) => {
  const { type, signature, accountData } = req.body;
  
  if (type === 'TRANSFER') {
    // Agent made a transaction
    updateAgentPerformance(accountData);
  }
  
  res.status(200).send('OK');
});

// Register webhook with Helius
const webhook = {
  webhookURL: 'https://moltlaunch.com/api/webhooks/helius',
  accountAddresses: poolWallets,
  transactionTypes: ['TRANSFER', 'SWAP']
};
```

**Devnet Testing:**
- [ ] Register Helius Devnet webhook (free tier)
- [ ] Monitor pool wallet transactions
- [ ] Build live performance widget

**Dependencies:**
- Helius API key (free tier works for Devnet)
- `helius-sdk`

---

## 5. 🏷️ Solana Name Service (SNS) Identity

**What:** Let agents claim .sol domains for human-readable identity.

**Use Case:**
- `alpha-trader.sol` instead of `ABC123...xyz`
- Builds trust with stakers
- Portable identity across Solana ecosystem

**Implementation:**
```javascript
import { getDomainKey, NameRegistryState } from '@bonfida/spl-name-service';

async function resolveAgentIdentity(agentId) {
  // Check if agent has .sol name
  const domainKey = await getDomainKey(`${agentId}.sol`);
  const registry = await NameRegistryState.retrieve(connection, domainKey);
  
  return {
    agentId,
    solDomain: registry ? `${agentId}.sol` : null,
    displayName: registry ? `${agentId}.sol` : agentId.slice(0, 8) + '...'
  };
}
```

**Devnet Testing:**
- [ ] Integrate SNS SDK
- [ ] Allow optional .sol linking in skill.md apply
- [ ] Display .sol names on verified agents list

**Dependencies:**
- `@bonfida/spl-name-service`

---

## 6. 📲 Mobile Wallet Adapter + Seed Vault

**What:** Native mobile signing with biometric authentication.

**Use Case:**
- Large withdrawal from pool → Require fingerprint/Face ID
- Persistent wallet connection on mobile PWA
- Seeker device optimized experience

**Implementation:**
```javascript
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';

async function signWithBiometric(transaction) {
  return await transact(async (wallet) => {
    // Request biometric authentication for sensitive actions
    const signed = await wallet.signTransactions({
      transactions: [transaction],
      authorizationScope: 'high-value' // Triggers Seed Vault
    });
    return signed;
  });
}
```

**Devnet Testing:**
- [ ] Use Solana Mobile Stack emulator
- [ ] Test PWA "Add to Home Screen" flow
- [ ] Verify persistent wallet connection

**Dependencies:**
- `@solana-mobile/mobile-wallet-adapter-protocol`
- `@solana-mobile/wallet-adapter-mobile`

---

## 7. ⚡ Priority Fee Intelligence

**What:** Teach agents to calculate and include priority fees during congestion.

**Use Case:**
- Agent draws funds during high volatility
- Calculates optimal priority fee
- Trade goes through even on congested network

**Implementation (skill.md update):**
```markdown
### Capability: Calculate Priority Fee
- **Endpoint:** `GET /api/priority-fee`
- **Output:** `{ "low": 1000, "medium": 5000, "high": 10000, "recommended": 5000 }`

### Example: Draw with Priority Fee
curl -X POST /api/pool/draw \
  -d '{"agentId": "...", "amount": 100, "priorityFee": 5000}'
```

**Devnet Testing:**
- [ ] Simulate congested network
- [ ] Test agent fee adjustment logic
- [ ] Verify trades succeed under load

**Implementation:**
```javascript
async function getRecommendedPriorityFee() {
  const fees = await connection.getRecentPrioritizationFees();
  const avg = fees.reduce((a, b) => a + b.prioritizationFee, 0) / fees.length;
  return {
    low: Math.floor(avg * 0.5),
    medium: Math.floor(avg),
    high: Math.floor(avg * 2),
    recommended: Math.floor(avg)
  };
}
```

---

## Implementation Status

| Integration | Priority | Status | Notes |
|-------------|----------|--------|-------|
| **Blinks** | 🔴 High | ✅ Done | `/api/blink/stake/:agentId`, `/api/blink/verify/:agentId` |
| **Helius Webhooks** | 🔴 High | ✅ Done | `/api/webhooks/helius`, `/api/webhooks/events` |
| **Priority Fees** | 🟢 Low | ✅ Done | `/api/priority-fee` |
| **SNS Identity** | 🟢 Low | ✅ Done | `/api/identity/link`, `/api/identity/:agentId` |
| **Jupiter Graduation** | 🟡 Medium | ✅ Stub | `/api/graduation/status`, `/api/jupiter/quote` (mock) |
| **Dialect Notifications** | 🟡 Medium | ✅ Stub | `/api/notify`, `/api/notifications` (queue only) |
| **Mobile/Seed Vault** | 🟢 Low | ⏳ Q3 | Requires Solana Mobile SDK |

---

## Devnet Checklist

### Week 1 (Hackathon Sprint) ✅ COMPLETE
- [x] Deploy test Blink for moltlaunch-agent
- [x] Set up Helius webhook endpoint
- [x] Add priority fee endpoint
- [x] SNS identity linking
- [x] Jupiter graduation status
- [x] Dialect notification queue

### Week 2 (Post-Hackathon)
- [ ] Register Helius webhook with pool wallets
- [ ] Connect Dialect SDK for real delivery
- [ ] Jupiter V6 API for real quotes
- [ ] Test Blinks on X/Discord

### Week 3
- [ ] Mobile Wallet Adapter testing
- [ ] Seed Vault biometric flow
- [ ] Full integration testing

---

## Resources

- [Solana Actions & Blinks](https://solana.com/docs/advanced/actions)
- [Jupiter V6 API](https://station.jup.ag/docs)
- [Dialect SDK](https://docs.dialect.to/)
- [Helius Webhooks](https://docs.helius.dev/webhooks)
- [SNS SDK](https://docs.bonfida.org/collection/naming-service/introduction)
- [Mobile Wallet Adapter](https://solanamobile.com/developers)
