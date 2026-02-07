/**
 * Example: Integrating MoltLaunch into an Agent Platform
 * 
 * This shows how AIoOS, TUNA, or any agent platform can use MoltLaunch.
 */

const { MoltLaunch, AgentVerificationState } = require('./moltlaunch-platform');

// Initialize
const moltlaunch = new MoltLaunch({
    apiUrl: 'https://web-production-419d9.up.railway.app',
    platformId: 'aioos'  // Your platform ID
});

// =================================================
// Example 1: Verification on Agent Registration
// =================================================

async function onAgentRegister(agent) {
    console.log(`Verifying agent ${agent.id}...`);
    
    const result = await moltlaunch.verify({
        agentId: agent.id,
        capabilities: agent.capabilities,
        codeUrl: agent.github,
        generateProof: true  // Get STARK proof
    });

    console.log('Verification result:', {
        passed: result.passed,
        score: result.score,
        tier: result.scoreTier,
        hasProof: !!result.starkProof?.enabled
    });

    return result;
}

// =================================================
// Example 2: Agent State Machine
// =================================================

async function checkAgentState(agentId) {
    const state = new AgentVerificationState(moltlaunch, agentId);
    await state.refresh();

    console.log(`Agent ${agentId} state:`, state.state);
    console.log('  Valid:', state.isValid());
    console.log('  Needs renewal:', state.needsRenewal());

    // Auto-renew if expiring soon
    if (state.needsRenewal()) {
        console.log('  Triggering renewal...');
        await moltlaunch.renew(agentId);
    }

    return state;
}

// =================================================
// Example 3: Behavioral Scoring
// =================================================

async function trackAgentBehavior(agentId, executionData) {
    // Submit execution trace
    const traceId = await moltlaunch.submitTrace(agentId, {
        period: executionData.period,
        summary: {
            totalActions: executionData.actions.length,
            successRate: executionData.successCount / executionData.actions.length,
            errorRate: executionData.errorCount / executionData.actions.length,
            avgResponseTime: executionData.avgLatency
        }
    });

    console.log(`Trace submitted: ${traceId}`);

    // Get updated behavioral score
    const score = await moltlaunch.getBehavioralScore(agentId);
    console.log('Behavioral score:', score);

    return score;
}

// =================================================
// Example 4: Ranking Agents by Trust
// =================================================

async function rankAgentsByTrust(agentIds) {
    // Get verification status for all agents
    const results = await moltlaunch.batchCheck(agentIds);

    // Sort by verification score
    const ranked = results
        .filter(r => r.verified)
        .sort((a, b) => (b.score || 0) - (a.score || 0));

    console.log('Ranked agents:');
    ranked.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.agentId}: ${r.score || 'N/A'} points`);
    });

    return ranked;
}

// =================================================
// Example 5: Badge Display
// =================================================

async function getAgentBadge(agentId) {
    const badge = await moltlaunch.getBadge(agentId);
    
    console.log(`Agent ${agentId} badge:`, badge);
    // {
    //   verified: true,
    //   score: 85,
    //   tier: 'verified',
    //   badge: 'silver',
    //   expiresAt: '2026-03-07...',
    //   svgUrl: '.../badges/silver.svg'
    // }

    return badge;
}

// =================================================
// Example 6: Event Handling
// =================================================

function setupEventHandlers() {
    moltlaunch.on('verified', (agentId, result) => {
        console.log(`✅ Agent ${agentId} verified with score ${result.score}`);
        // Update your database, send notifications, etc.
    });

    moltlaunch.on('behavioral_update', (agentId, score) => {
        console.log(`📊 Agent ${agentId} behavioral score: ${score}`);
    });
}

// =================================================
// Run Examples
// =================================================

async function main() {
    setupEventHandlers();

    // Test with a sample agent
    const testAgent = {
        id: 'aioos-demo-agent',
        capabilities: ['trading', 'analysis', 'reporting'],
        github: 'https://github.com/example/agent'
    };

    try {
        // 1. Verify the agent
        console.log('\n=== Verification ===');
        const verification = await onAgentRegister(testAgent);

        // 2. Check state
        console.log('\n=== State Check ===');
        await checkAgentState(testAgent.id);

        // 3. Submit behavior
        console.log('\n=== Behavioral Scoring ===');
        await trackAgentBehavior(testAgent.id, {
            period: {
                start: '2026-01-01',
                end: '2026-02-07'
            },
            actions: new Array(500).fill({}),
            successCount: 475,
            errorCount: 10,
            avgLatency: 200
        });

        // 4. Get badge
        console.log('\n=== Badge ===');
        await getAgentBadge(testAgent.id);

    } catch (e) {
        console.error('Error:', e.message);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = {
    onAgentRegister,
    checkAgentState,
    trackAgentBehavior,
    rankAgentsByTrust,
    getAgentBadge
};
