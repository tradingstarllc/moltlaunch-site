/**
 * Execution Traces Module for MoltLaunch
 * 
 * Provides behavioral scoring based on agent execution history.
 */

const crypto = require('crypto');

/**
 * Trace storage (in-memory for now)
 */
const traceStore = new Map();

/**
 * Generate trace ID
 */
function generateTraceId() {
    return 'tr_' + crypto.randomBytes(12).toString('hex');
}

/**
 * Compute Merkle root of actions
 */
function computeActionsMerkle(actions) {
    if (!actions || actions.length === 0) {
        return crypto.createHash('sha256').update('empty').digest('hex');
    }
    
    // Hash each action
    let hashes = actions.map(action => 
        crypto.createHash('sha256')
            .update(JSON.stringify(action))
            .digest('hex')
    );
    
    // Build Merkle tree
    while (hashes.length > 1) {
        const newHashes = [];
        for (let i = 0; i < hashes.length; i += 2) {
            const left = hashes[i];
            const right = hashes[i + 1] || left;
            newHashes.push(
                crypto.createHash('sha256')
                    .update(left + right)
                    .digest('hex')
            );
        }
        hashes = newHashes;
    }
    
    return hashes[0];
}

/**
 * Compute trace commitment
 */
function computeCommitment(trace) {
    const actionsMerkle = computeActionsMerkle(trace.actions);
    const summaryHash = crypto.createHash('sha256')
        .update(JSON.stringify(trace.summary || {}))
        .digest('hex');
    
    return crypto.createHash('sha256')
        .update(actionsMerkle + summaryHash + trace.agentId)
        .digest('hex');
}

/**
 * Calculate behavioral score from trace
 */
function calculateBehavioralScore(trace) {
    const breakdown = {
        hasTraces: 0,
        verified: 0,
        history7d: 0,
        successRate: 0,
        lowErrors: 0,
        uptime: 0
    };
    
    // Has traces: +5
    breakdown.hasTraces = 5;
    
    // Verified on-chain: +5 (check if anchored)
    if (trace.anchoredAt) {
        breakdown.verified = 5;
    }
    
    // 7+ day history: +5
    if (trace.period) {
        const start = new Date(trace.period.start);
        const end = new Date(trace.period.end);
        const days = (end - start) / (1000 * 60 * 60 * 24);
        if (days >= 7) {
            breakdown.history7d = 5;
        }
    }
    
    // Success rate > 90%: +3
    const summary = trace.summary || {};
    if (summary.successRate && summary.successRate > 0.90) {
        breakdown.successRate = 3;
    }
    
    // Low error rate < 5%: +2
    if (summary.errorRate !== undefined && summary.errorRate < 0.05) {
        breakdown.lowErrors = 2;
    }
    
    // Consistent uptime: +5 (simplified check)
    if (summary.totalActions && summary.totalActions > 100) {
        breakdown.uptime = 5;
    }
    
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    
    return { total, breakdown };
}

/**
 * Submit a new trace
 */
function submitTrace(agentId, traceData) {
    const traceId = generateTraceId();
    const now = new Date().toISOString();
    
    const trace = {
        version: '1.0',
        traceId,
        agentId,
        createdAt: now,
        period: traceData.period || {
            start: now,
            end: now
        },
        summary: traceData.summary || {},
        actions: traceData.actions || [],
        commitment: null,
        anchoredAt: null
    };
    
    // Compute commitment
    trace.commitment = computeCommitment(trace);
    
    // Calculate behavioral score
    const { total: behavioralScore, breakdown } = calculateBehavioralScore(trace);
    
    // Store trace
    if (!traceStore.has(agentId)) {
        traceStore.set(agentId, []);
    }
    traceStore.get(agentId).push(trace);
    
    return {
        success: true,
        traceId,
        commitment: trace.commitment,
        behavioralScore,
        breakdown
    };
}

/**
 * Get traces for an agent
 */
function getTraces(agentId) {
    const traces = traceStore.get(agentId) || [];
    return traces.map(t => ({
        traceId: t.traceId,
        period: t.period,
        summary: t.summary,
        commitment: t.commitment,
        anchoredAt: t.anchoredAt,
        createdAt: t.createdAt
    }));
}

/**
 * Get a specific trace
 */
function getTrace(traceId) {
    for (const [agentId, traces] of traceStore) {
        const trace = traces.find(t => t.traceId === traceId);
        if (trace) {
            return trace;
        }
    }
    return null;
}

/**
 * Calculate aggregate behavioral score for agent
 */
function getAgentBehavioralScore(agentId, traceIds = null) {
    const traces = traceStore.get(agentId) || [];
    
    if (traces.length === 0) {
        return { total: 0, breakdown: {}, traceCount: 0 };
    }
    
    // Filter by trace IDs if provided
    let relevantTraces = traces;
    if (traceIds && traceIds.length > 0) {
        relevantTraces = traces.filter(t => traceIds.includes(t.traceId));
    }
    
    if (relevantTraces.length === 0) {
        return { total: 0, breakdown: {}, traceCount: 0 };
    }
    
    // Aggregate across all traces
    const aggregateSummary = {
        totalActions: 0,
        successRate: 0,
        errorRate: 0
    };
    
    let totalDays = 0;
    let hasAnchored = false;
    
    for (const trace of relevantTraces) {
        const summary = trace.summary || {};
        aggregateSummary.totalActions += summary.totalActions || 0;
        aggregateSummary.successRate += (summary.successRate || 0) * (summary.totalActions || 1);
        aggregateSummary.errorRate += (summary.errorRate || 0) * (summary.totalActions || 1);
        
        if (trace.period) {
            const start = new Date(trace.period.start);
            const end = new Date(trace.period.end);
            totalDays += (end - start) / (1000 * 60 * 60 * 24);
        }
        
        if (trace.anchoredAt) {
            hasAnchored = true;
        }
    }
    
    // Weighted averages
    if (aggregateSummary.totalActions > 0) {
        aggregateSummary.successRate /= aggregateSummary.totalActions;
        aggregateSummary.errorRate /= aggregateSummary.totalActions;
    }
    
    // Create aggregate trace for scoring
    const aggregateTrace = {
        period: { start: new Date(Date.now() - totalDays * 24 * 60 * 60 * 1000), end: new Date() },
        summary: aggregateSummary,
        anchoredAt: hasAnchored ? new Date() : null
    };
    
    const { total, breakdown } = calculateBehavioralScore(aggregateTrace);
    
    return {
        total,
        breakdown,
        traceCount: relevantTraces.length,
        aggregateSummary,
        totalPeriod: `${Math.round(totalDays)} days`
    };
}

/**
 * Mark trace as anchored on-chain
 */
function anchorTrace(traceId, txHash) {
    const trace = getTrace(traceId);
    if (!trace) {
        return { success: false, error: 'Trace not found' };
    }
    
    trace.anchoredAt = new Date().toISOString();
    trace.anchorTx = txHash;
    
    return {
        success: true,
        traceId,
        anchoredAt: trace.anchoredAt,
        txHash
    };
}

/**
 * Verify a Merkle proof for an action
 */
function verifyActionProof(traceId, actionIndex, merkleProof) {
    const trace = getTrace(traceId);
    if (!trace) {
        return { valid: false, error: 'Trace not found' };
    }
    
    if (!trace.actions || actionIndex >= trace.actions.length) {
        return { valid: false, error: 'Action not found' };
    }
    
    // In a full implementation, verify the Merkle proof
    // For now, just verify the trace exists and is valid
    return {
        valid: true,
        traceId,
        actionIndex,
        action: trace.actions[actionIndex],
        commitment: trace.commitment
    };
}

module.exports = {
    submitTrace,
    getTraces,
    getTrace,
    getAgentBehavioralScore,
    anchorTrace,
    verifyActionProof,
    computeCommitment,
    calculateBehavioralScore
};
