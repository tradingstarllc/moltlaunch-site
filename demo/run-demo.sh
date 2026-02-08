#!/bin/bash

# MoltLaunch Demo Script
# This creates clean terminal output for recording

API="https://web-production-419d9.up.railway.app"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

slow_type() {
    echo ""
    echo -e "${CYAN}$1${NC}"
    sleep 1
}

show_command() {
    echo ""
    echo -e "${YELLOW}$ $1${NC}"
    sleep 0.5
}

divider() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

clear
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║   🔐 MoltLaunch - Trust Infrastructure for Agents   ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║   Verify AI agents before you trust them.           ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
sleep 3

divider
slow_type "📍 Step 1: Quick Verify - Does this agent respond?"
show_command 'curl -X POST "$API/api/verify/quick" -d "{agentId: demo-agent, apiEndpoint: ...}"'
sleep 1

curl -s -X POST "$API/api/verify/quick" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "demo-agent", "apiEndpoint": "https://web-production-419d9.up.railway.app"}' | jq '.'

sleep 3

divider
slow_type "📍 Step 2: Deep Verify - Comprehensive analysis with on-chain AI"
show_command 'curl -X POST "$API/api/verify/deep" -d "{agentId: trading-bot, capabilities: [...]}"'
sleep 1

curl -s -X POST "$API/api/verify/deep" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "video-demo-agent",
    "capabilities": ["trading", "analysis"],
    "codeUrl": "https://github.com/tradingstarllc/proof-of-agent",
    "documentation": true,
    "codeLines": 5000
  }' | jq '{verified, score, tier: .scoreTier, onChainAI: .onChainAI.enabled}'

sleep 3

divider
slow_type "📍 Step 3: Check Status - Instant lookup (cached 30 days)"
show_command 'curl "$API/api/verify/status/video-demo-agent"'
sleep 1

curl -s "$API/api/verify/status/video-demo-agent" | jq '{verified, score, tier, expiresAt, daysRemaining}'

sleep 3

divider
slow_type "📍 Step 4: STARK Proof - Privacy-preserving verification"
slow_type "   Prove 'score >= 60' without revealing exact score"
show_command 'curl -X POST "$API/api/stark/generate/video-demo-agent" -d "{threshold: 60}"'
sleep 1

curl -s -X POST "$API/api/stark/generate/video-demo-agent" \
  -H "Content-Type: application/json" \
  -d '{"threshold": 60}' | jq '{
    success,
    commitment: .commitment[0:24],
    threshold: .publicInputs.threshold,
    privacyNote
  }'

sleep 3

divider
slow_type "📍 Step 5: Ecosystem Bonuses - Rewarding best practices"
show_command 'curl "$API/api/oracles/pyth/price/SOL%2FUSD"'
sleep 1

curl -s "$API/api/oracles/pyth/price/SOL%2FUSD" | jq '{symbol, price, verificationBonus}'

sleep 2
show_command 'curl "$API/api/mev/jito/tip-estimate"'
curl -s "$API/api/mev/jito/tip-estimate" | jq '{urgency, estimatedTip, verificationBonus}'

sleep 3

divider
slow_type "📍 Step 6: List Verified Agents"
show_command 'curl "$API/api/verify/list"'
sleep 1

curl -s "$API/api/verify/list" | jq '{count, agents: [.agents[].agentId]}'

sleep 3

divider
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║   ✅ MoltLaunch Demo Complete                        ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║   Install: npm install @moltlaunch/proof-of-agent   ║${NC}"
echo -e "${GREEN}║   Docs:    web-production-419d9.up.railway.app      ║${NC}"
echo -e "${GREEN}║   GitHub:  github.com/tradingstarllc/proof-of-agent ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║   85% of AI agent tokens rug. We're fixing that.    ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
