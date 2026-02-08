# Dashboard V2 Specification

## Vision
A proper dashboard where agent creators can manage their entire lifecycle — from registration through verification, staking, and ongoing behavioral monitoring.

## Core Principles
1. **Wallet-first** — Everything tied to connected wallet
2. **Persistent** — Server-side state, not localStorage hacks
3. **Real data** — Actually call the APIs, show real scores
4. **Actionable** — Every screen has clear next steps

---

## Information Architecture

### Tab Structure
```
Dashboard (home)
├── My Agents (list view)
│   ├── Agent Detail (click into)
│   │   ├── Overview
│   │   ├── Traces
│   │   ├── Pool Position
│   │   └── API Keys
│   └── Register New Agent
├── Staking Pools
│   ├── Available Pools
│   └── My Positions
├── Leaderboard
└── Settings
    ├── API Keys
    └── Notifications
```

### URL Structure
- `/dashboard.html` — Main dashboard (agent list)
- `/dashboard.html#agent/{agentId}` — Agent detail view
- `/dashboard.html#pools` — Staking pools
- `/dashboard.html#leaderboard` — Top verified agents
- `/dashboard.html#settings` — Account settings

---

## Views

### 1. My Agents (Default View)
Grid of agent cards showing:
- Agent ID + name
- PoA Score badge (color-coded)
- Verification status (Pending/Verified/Expired)
- Last activity date
- Quick actions (Verify, View, Share)

Empty state: "No agents yet. Register your first agent to get started."

### 2. Agent Detail View
**Header:**
- Agent name + ID
- Large score circle
- Tier badge (Excellent/Good/Fair/Unverified)
- Quick actions: Re-verify | Share Badge | Copy Blink

**Tabs:**
- **Overview** — Score breakdown, capabilities, GitHub link, attestation expiry
- **Traces** — Table of submitted traces with behavioral bonus
- **Traces Chart** — Line graph of score over time
- **Pool** — Current stake, pool rank, APY, withdraw button
- **API** — Agent-specific API key, usage stats

### 3. Register Agent (Modal or Slide-out)
Form fields:
- Agent ID* (slug, validated unique)
- Display Name
- GitHub URL (optional)
- Capabilities (multi-select)
- Description (textarea)

Actions: Cancel | Register & Verify

### 4. Staking Pools View
**Available Pools:**
- Pool name (Trading, DeFi, Social, etc.)
- Total staked
- Number of agents
- Min score required
- APY estimate
- Join button

**My Positions:**
- Pool name
- Your stake amount
- Current APY
- Actions: Add | Withdraw

### 5. Leaderboard
Table:
| Rank | Agent | Score | Tier | Traces | Pool |
|------|-------|-------|------|--------|------|

Filters: All | Trading | DeFi | Social

### 6. Settings
- **API Keys** — Generate/revoke dashboard API keys
- **Notifications** — Email alerts for score changes, pool events
- **Wallet** — Connected wallet info, disconnect

---

## API Requirements

### Existing APIs (already implemented)
- `POST /api/apply` — Register agent
- `POST /api/verify/deep` — Run verification
- `GET /api/verify/status/{agentId}` — Get verification status
- `POST /api/traces` — Submit execution trace
- `GET /api/traces/{agentId}` — Get agent traces
- `POST /api/pool/apply` — Join staking pool
- `GET /api/pools` — List pools

### New APIs Needed
- `GET /api/agents?wallet={address}` — List agents by wallet
- `GET /api/agents/{agentId}` — Full agent details
- `GET /api/leaderboard?limit=50` — Top agents
- `GET /api/pool/positions?wallet={address}` — User's pool positions
- `POST /api/keys/generate` — Create API key
- `GET /api/keys?wallet={address}` — List user's API keys

---

## Technical Implementation

### Frontend Stack
- Vanilla JS (no framework, keep it simple)
- CSS Grid + Flexbox
- Chart.js for visualizations
- SPA-like behavior with hash routing

### State Management
```javascript
const state = {
  wallet: null,           // Connected wallet address
  agents: [],             // User's agents
  selectedAgent: null,    // Currently viewing
  pools: [],              // Available pools
  positions: [],          // User's pool positions
  view: 'agents'          // Current view
};
```

### Key Components
1. **WalletManager** — Connect/disconnect, persist in sessionStorage
2. **AgentList** — Render agent cards, handle selection
3. **AgentDetail** — Full agent info with tabs
4. **ScoreChart** — Chart.js line graph
5. **PoolManager** — List pools, join/leave
6. **Router** — Hash-based navigation

---

## Design System

### Colors (already defined)
```css
--bg: #09090b
--bg-subtle: #18181b
--accent: #22d3ee (cyan)
--success: #4ade80 (green)
--warning: #fbbf24 (yellow)
--error: #ef4444 (red)
--solana-green: #14F195
--solana-purple: #9945FF
```

### Score Colors
- 80-100: Green (Excellent)
- 60-79: Cyan (Good)
- 40-59: Yellow (Fair)
- 0-39: Red (Needs Work)

### Component Patterns
- Cards: `bg-subtle`, `border`, `rounded-16`, `p-24`
- Buttons: `btn-primary`, `btn-secondary`, `btn-success`
- Badges: Pill-shaped, color-coded
- Tables: Striped rows, hover state
- Empty states: Icon + message + CTA

---

## Implementation Order

### Phase 1: Foundation (2-3 hours)
1. Set up hash router
2. Create view scaffolding
3. Implement wallet manager
4. Build API client module

### Phase 2: Agent Management (3-4 hours)
1. Agent list view with cards
2. Agent detail view (overview tab)
3. Register agent modal
4. Score chart component

### Phase 3: Traces & History (2-3 hours)
1. Traces table in agent detail
2. Behavioral score chart
3. Submit trace form (improved)

### Phase 4: Staking Pools (2-3 hours)
1. Pools list view
2. Join pool flow
3. My positions view
4. Pool detail in agent view

### Phase 5: Polish (2-3 hours)
1. Leaderboard view
2. Settings page
3. Loading states
4. Error handling
5. Mobile optimization

---

## Backend API Additions

Need to add to `server.js`:

```javascript
// List agents by wallet
app.get('/api/agents', (req, res) => {
  const { wallet } = req.query;
  const userAgents = agents.filter(a => a.wallet === wallet);
  res.json({ agents: userAgents });
});

// Get full agent details
app.get('/api/agents/:agentId', (req, res) => {
  const agent = agents.find(a => a.agentId === req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json(agent);
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const sorted = [...agents]
    .filter(a => a.verified)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  res.json({ agents: sorted });
});

// Pool positions by wallet
app.get('/api/pool/positions', (req, res) => {
  const { wallet } = req.query;
  const positions = poolApplications.filter(p => p.wallet === wallet);
  res.json({ positions });
});
```

---

## Success Criteria

1. ✅ User can connect wallet and see their agents
2. ✅ User can register new agent and get score
3. ✅ User can view agent detail with tabs
4. ✅ User can submit traces and see history
5. ✅ User can join staking pool
6. ✅ User can see leaderboard
7. ✅ Mobile responsive
8. ✅ Fast (<2s initial load)
9. ✅ No console errors
10. ✅ Looks professional
