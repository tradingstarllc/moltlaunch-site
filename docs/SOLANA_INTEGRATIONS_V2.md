# Solana Ecosystem Integrations V2

**Updated:** 2026-02-08
**Status:** Active Development
**Days Remaining:** ~4.5

---

## Current Implementation Status

### ✅ Completed (Hackathon Week 1)

| Integration | Endpoints | Status |
|-------------|-----------|--------|
| **Solana Blinks** | `/api/blink/stake/:agentId`, `/api/blink/verify/:agentId` | Live |
| **Helius Webhooks** | `/api/webhooks/helius`, `/api/webhooks/events` | Stub |
| **Priority Fees** | `/api/priority-fee` | Live |
| **SNS Identity** | `/api/identity/link`, `/api/identity/:agentId` | Stub |
| **Jupiter Graduation** | `/api/graduation/status/:poolId`, `/api/jupiter/quote` | Stub |
| **Dialect Notifications** | `/api/notify`, `/api/notifications` | Stub |

---

## 🆕 New Integrations to Explore

### 1. 🔧 Solana Agent Kit (SendAI)

**What:** Open-source toolkit with 60+ Solana actions built-in.

**Why for MoltLaunch:**
- Pre-built actions for Jupiter swaps, Meteora pools, Jito bundles
- We could verify agents that USE this toolkit
- Integration point: agents built with solana-agent-kit → verify with MoltLaunch

**Use Case:**
```javascript
// Agent using solana-agent-kit gets verified
const agentCapabilities = await detectAgentKitUsage(agentRepo);
// Capabilities: ['jupiter-swap', 'meteora-pool', 'jito-bundle']
// Each capability adds to PoA score
```

**Implementation:**
- Add `/api/verify/agent-kit` endpoint
- Parse agent code for solana-agent-kit imports
- Auto-detect capabilities from plugin usage
- Score boost: +5 per verified capability

**Effort:** 2-3 hours

---

### 2. 🐍 Pyth Network (Oracle Integration)

**What:** Real-time price feeds for 450+ assets on Solana.

**Why for MoltLaunch:**
- Trading agents need price data
- Verify agents use trusted oracles (not custom/malicious feeds)
- Score boost for Pyth integration

**Use Case:**
```javascript
// Verify agent uses Pyth for price data
const priceFeeds = await detectPythUsage(agentCode);
// Agent uses official Pyth SOL/USD feed: +10 score
// Agent uses custom oracle: 0 score (flag for review)
```

**Endpoints to Add:**
- `GET /api/oracles/pyth/feeds` - List supported price feeds
- `GET /api/oracles/pyth/price/:feedId` - Get current price
- `POST /api/verify/oracle-usage` - Verify agent uses trusted oracle

**Integration:**
```javascript
import { PriceServiceConnection } from "@pythnetwork/price-service-client";

const connection = new PriceServiceConnection("https://hermes.pyth.network");
const priceIds = ["0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"]; // SOL/USD
const priceFeeds = await connection.getLatestPriceFeeds(priceIds);
```

**Effort:** 2 hours

---

### 3. ⚡ Jito Bundles (MEV Protection)

**What:** Atomic transaction bundles with MEV protection + priority tips.

**Why for MoltLaunch:**
- Trading agents NEED Jito for competitive execution
- Verify agents use Jito = safer, more reliable trades
- Score boost for bundle usage

**Use Case:**
```javascript
// Detect Jito bundle usage in agent's transaction history
const jitoUsage = await analyzeJitoUsage(agentWallet);
// Uses Jito bundles: +15 score
// Uses regular transactions only: 0 score
// Average tip: 5000 lamports (shows sophistication)
```

**Endpoints to Add:**
- `GET /api/mev/jito/tip-estimate` - Recommended tip for current conditions
- `POST /api/mev/jito/simulate` - Simulate bundle execution
- `GET /api/verify/mev-protection/:agentId` - Check if agent uses MEV protection

**Integration:**
```javascript
import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher";

const client = searcherClient("mainnet.block-engine.jito.wtf");
const bundle = await client.sendBundle(transactions, { 
  tipLamports: 10000 
});
```

**Effort:** 3 hours

---

### 4. 🖼️ Tensor/Metaplex (NFT Verification Badges)

**What:** Mint verification badges as on-chain NFTs.

**Why for MoltLaunch:**
- Verification becomes a tradable/displayable asset
- Agents can show badge in their profile
- Creates secondary market for "verified agent" status

**Use Case:**
```javascript
// Agent passes verification → mint NFT badge
const badge = await mintVerificationBadge({
  agentId: "trading-bot-001",
  score: 75,
  tier: "good",
  validUntil: "2026-03-08",
  metadata: {
    name: "MoltLaunch Verified: trading-bot-001",
    image: "https://moltlaunch.com/badges/75.png",
    attributes: [
      { trait_type: "PoA Score", value: 75 },
      { trait_type: "Tier", value: "Good" },
      { trait_type: "Verified Date", value: "2026-02-08" }
    ]
  }
});
```

**Endpoints to Add:**
- `POST /api/badge/mint/:agentId` - Mint verification badge NFT
- `GET /api/badge/:agentId` - Get badge metadata
- `POST /api/badge/revoke/:agentId` - Burn badge on verification expiry

**Integration (Metaplex):**
```javascript
import { Metaplex } from "@metaplex-foundation/js";

const metaplex = Metaplex.make(connection);
const { nft } = await metaplex.nfts().create({
  uri: badgeMetadataUri,
  name: `MoltLaunch Verified: ${agentId}`,
  sellerFeeBasisPoints: 0, // No royalties
  isMutable: true, // Can update on renewal
});
```

**Effort:** 4 hours

---

### 5. 🌉 Wormhole/deBridge (Cross-Chain Verification)

**What:** Bridge verification attestations to other chains.

**Why for MoltLaunch:**
- Agents verified on Solana can prove identity on Ethereum, Base, etc.
- Expands addressable market
- First cross-chain agent verification system

**Use Case:**
```javascript
// Agent verified on Solana wants to operate on Base
const crossChainAttestation = await bridgeVerification({
  agentId: "trading-bot-001",
  sourceChain: "solana",
  targetChain: "base",
  score: 75,
  attestationHash: "0x..."
});
// Returns: Base-compatible verification proof
```

**Effort:** 8+ hours (post-hackathon)

---

### 6. 🎰 Switchboard (VRF + Custom Oracles)

**What:** Verifiable random functions + custom oracle feeds.

**Why for MoltLaunch:**
- Agents that need randomness (games, lottery, selection)
- Verify they use VRF not pseudo-random
- Custom feeds for agent-specific data

**Use Case:**
```javascript
// Verify agent uses VRF for randomness
const vrfUsage = await detectVRFUsage(agentCode);
// Uses Switchboard VRF: +10 score (provably fair)
// Uses Math.random(): -5 score (manipulable)
```

**Effort:** 3 hours

---

### 7. 📊 DAS API (Digital Asset Standard)

**What:** Helius/Triton API for compressed NFTs and asset indexing.

**Why for MoltLaunch:**
- Efficiently query agent's on-chain assets
- Track verification badge ownership
- Compressed NFTs for cheaper badge minting

**Use Case:**
```javascript
// Get all MoltLaunch badges owned by wallet
const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'getAssetsByOwner',
    params: {
      ownerAddress: walletAddress,
      displayOptions: { showCollectionMetadata: true }
    }
  })
});
```

**Effort:** 2 hours

---

## Implementation Priority (Remaining 4 Days)

### Day 6 (Today - Feb 8)

| Integration | Time | Value |
|-------------|------|-------|
| **Pyth Price Feeds** | 2h | High - trading agents need this |
| **Jito Tip Estimate** | 1h | Medium - shows MEV awareness |

### Day 7 (Feb 9)

| Integration | Time | Value |
|-------------|------|-------|
| **Agent Kit Detection** | 2h | High - ecosystem integration |
| **Metaplex Badge NFT** | 3h | High - visual, shareable proof |

### Day 8 (Feb 10)

| Integration | Time | Value |
|-------------|------|-------|
| **DAS API for Badges** | 2h | Medium - query optimization |
| **Switchboard VRF Check** | 2h | Medium - niche but valuable |

### Day 9 (Feb 11 - Final)

- Polish, documentation, demo video
- No new integrations

---

## Endpoints Summary

### New Endpoints to Implement

```
# Oracles
GET  /api/oracles/pyth/price/:symbol     # Get Pyth price
GET  /api/oracles/pyth/feeds             # List available feeds

# MEV
GET  /api/mev/jito/tip-estimate          # Recommended Jito tip
GET  /api/verify/mev-protection/:agentId # Check MEV protection

# NFT Badges
POST /api/badge/mint/:agentId            # Mint verification badge
GET  /api/badge/:agentId                 # Get badge metadata
POST /api/badge/revoke/:agentId          # Burn expired badge

# Agent Kit
POST /api/verify/agent-kit               # Detect solana-agent-kit usage
GET  /api/capabilities/detected/:agentId # List detected capabilities

# VRF
GET  /api/verify/randomness/:agentId     # Check VRF usage
```

---

## Dependencies to Add

```json
{
  "@pythnetwork/price-service-client": "^1.9.0",
  "@pythnetwork/pyth-solana-receiver": "^0.8.0",
  "jito-ts": "^4.1.0",
  "@metaplex-foundation/js": "^0.20.0",
  "@switchboard-xyz/solana.js": "^3.0.0",
  "solana-agent-kit": "^2.0.0"
}
```

---

## Forum Post Ideas

1. **"MoltLaunch + Pyth: Verified Agents Use Trusted Oracles"**
   - Announce oracle verification
   - Tag Pyth team

2. **"NFT Verification Badges: Proof You Can Trade"**
   - Announce Metaplex integration
   - Show badge preview

3. **"MEV-Aware Agents Score Higher"**
   - Jito integration announcement
   - Explain why MEV protection matters

---

## Resources

- [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit)
- [Pyth Docs](https://docs.pyth.network/)
- [Jito Docs](https://docs.jito.wtf/)
- [Metaplex Docs](https://docs.metaplex.com/)
- [Switchboard Docs](https://docs.switchboard.xyz/)
- [Helius DAS API](https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api)
