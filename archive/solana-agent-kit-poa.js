/**
 * MoltLaunch Proof-of-Agent Integration for Solana Agent Kit
 * 
 * Add verification capabilities to any Solana agent built with solana-agent-kit.
 * Agents can verify themselves and get a PoA score before launching tokens.
 */

const MOLTLAUNCH_API = 'https://youragent.id';

/**
 * Verify an agent's capabilities and get a Proof-of-Agent score
 * @param {Object} agent - Agent configuration
 * @param {string} agent.name - Agent name
 * @param {string} agent.endpoint - API endpoint (optional)
 * @param {string[]} agent.capabilities - List of capabilities
 * @returns {Promise<Object>} Verification result with score and tier
 */
async function verifyAgent(agent) {
    const response = await fetch(`${MOLTLAUNCH_API}/api/verify/quick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agentName: agent.name,
            endpoint: agent.endpoint,
            capabilities: agent.capabilities
        })
    });
    return response.json();
}

/**
 * Register wallet for testnet airdrop
 * @param {string} wallet - Solana wallet address
 * @returns {Promise<Object>} Registration result with tier and allocation
 */
async function registerForAirdrop(wallet) {
    const response = await fetch(`${MOLTLAUNCH_API}/api/airdrop/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet })
    });
    return response.json();
}

/**
 * Check eligibility and current allocation
 * @param {string} wallet - Solana wallet address
 * @returns {Promise<Object>} Eligibility status
 */
async function checkEligibility(wallet) {
    const response = await fetch(`${MOLTLAUNCH_API}/api/airdrop/eligibility/${wallet}`);
    return response.json();
}

/**
 * Get current airdrop leaderboard
 * @param {number} limit - Number of entries (default 50)
 * @returns {Promise<Object>} Leaderboard data
 */
async function getLeaderboard(limit = 50) {
    const response = await fetch(`${MOLTLAUNCH_API}/api/airdrop/leaderboard?limit=${limit}`);
    return response.json();
}

/**
 * Submit application to launch token on MoltLaunch
 * @param {Object} application - Launch application
 * @returns {Promise<Object>} Application result
 */
async function applyForLaunch(application) {
    const response = await fetch(`${MOLTLAUNCH_API}/api/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(application)
    });
    return response.json();
}

// Example usage with Solana Agent Kit
async function example() {
    // 1. Verify your agent
    const verification = await verifyAgent({
        name: 'MyTradingBot',
        endpoint: 'https://my-bot.com/api',
        capabilities: ['trading', 'arbitrage', 'analysis']
    });
    console.log('Verification:', verification);
    // { score: 84, tier: 'verified', ... }

    // 2. If verified (score >= 70), register for airdrop
    if (verification.score >= 70) {
        const airdrop = await registerForAirdrop('YOUR_SOLANA_WALLET');
        console.log('Airdrop registration:', airdrop);
        // { tier: 'verified', allocation: 10000, ... }
    }

    // 3. Apply to launch your token
    const launch = await applyForLaunch({
        agentName: 'MyTradingBot',
        tokenSymbol: 'MTB',
        capabilities: ['trading', 'arbitrage', 'analysis'],
        apiEndpoint: 'https://my-bot.com/api',
        description: 'Autonomous trading bot with on-chain arbitrage capabilities...'
    });
    console.log('Launch application:', launch);
}

module.exports = {
    verifyAgent,
    registerForAirdrop,
    checkEligibility,
    getLeaderboard,
    applyForLaunch
};

// Run example if called directly
if (require.main === module) {
    example().catch(console.error);
}
