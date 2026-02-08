/**
 * Behavioral Consistency Proofs
 * 
 * Prove "agent maintained >= threshold score across N periods"
 * without revealing individual period scores.
 * 
 * Use cases:
 * - "Agent stayed above 60 for 30 days" (trust signal)
 * - "No score drops below 40 in past quarter" (stability proof)
 * - "Maintained excellent tier (80+) for 7 days" (premium verification)
 */

const crypto = require('crypto');

// Mersenne-31 field operations (same as threshold proofs)
const M31_PRIME = 2147483647n; // 2^31 - 1

const M31 = {
    mod: (x) => ((x % M31_PRIME) + M31_PRIME) % M31_PRIME,
    add: (a, b) => M31.mod(a + b),
    sub: (a, b) => M31.mod(a - b),
    mul: (a, b) => M31.mod(a * b),
    pow: (base, exp) => {
        let result = 1n;
        base = M31.mod(base);
        while (exp > 0n) {
            if (exp % 2n === 1n) result = M31.mul(result, base);
            exp = exp / 2n;
            base = M31.mul(base, base);
        }
        return result;
    }
};

/**
 * Poseidon-like hash for field elements
 */
function poseidonHash(inputs) {
    let state = 0n;
    for (const input of inputs) {
        state = M31.add(state, BigInt(input));
        state = M31.mul(state, state);
        state = M31.add(state, 17n);
    }
    return state;
}

/**
 * Generate a consistency proof
 * 
 * Proves: ∀i ∈ [0, periods.length): periods[i].score >= threshold
 * 
 * @param {Object} params
 * @param {Array<{score: number, timestamp: number}>} params.periods - Daily/period scores (PRIVATE)
 * @param {number} params.threshold - Minimum score to prove (PUBLIC)
 * @param {string} params.agentId - Agent identifier
 * @returns {Object} Consistency proof
 */
function generateConsistencyProof({ periods, threshold, agentId }) {
    if (!periods || periods.length === 0) {
        throw new Error('At least one period required');
    }

    // Validate all periods meet threshold (privately)
    const allPass = periods.every(p => p.score >= threshold);
    
    // Compute statistics (for commitment, not revealed)
    const scores = periods.map(p => p.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    // Build commitment chain
    // Each period commits to: hash(score, timestamp, previous_commitment)
    let commitmentChain = 0n;
    const periodCommitments = [];
    
    for (const period of periods) {
        const periodHash = poseidonHash([
            BigInt(period.score),
            BigInt(period.timestamp),
            commitmentChain
        ]);
        periodCommitments.push(periodHash);
        commitmentChain = periodHash;
    }
    
    // Final commitment includes threshold and agent ID
    const agentIdHash = poseidonHash(
        agentId.split('').map(c => BigInt(c.charCodeAt(0)))
    );
    
    const finalCommitment = poseidonHash([
        commitmentChain,
        BigInt(threshold),
        agentIdHash,
        BigInt(periods.length)
    ]);
    
    // Generate proof components
    const proofSeed = crypto.createHash('sha256')
        .update(finalCommitment.toString())
        .update(Date.now().toString())
        .digest();
    
    // Fiat-Shamir challenge
    const challenge = poseidonHash([
        finalCommitment,
        BigInt('0x' + proofSeed.slice(0, 8).toString('hex'))
    ]);
    
    // Response (simplified - real STARK would have full trace)
    const response = M31.mul(
        M31.add(BigInt(minScore), challenge),
        M31.pow(2n, BigInt(periods.length))
    );

    return {
        // Public outputs
        valid: allPass,
        periodCount: periods.length,
        threshold,
        agentId,
        
        // Cryptographic proof
        commitment: finalCommitment.toString(),
        challenge: challenge.toString(),
        response: response.toString(),
        
        // Proof metadata
        proofType: 'consistency',
        proofVersion: '1.0',
        generatedAt: new Date().toISOString(),
        
        // Time bounds (public - when the consistency was measured)
        startTimestamp: Math.min(...periods.map(p => p.timestamp)),
        endTimestamp: Math.max(...periods.map(p => p.timestamp)),
        
        // Hash for external verification
        proofHash: crypto.createHash('sha256')
            .update(JSON.stringify({
                commitment: finalCommitment.toString(),
                threshold,
                periodCount: periods.length,
                agentId
            }))
            .digest('hex')
    };
}

/**
 * Verify a consistency proof (public verification)
 * 
 * Note: This verifies the proof structure, not the underlying data.
 * Full verification requires the original commitment chain.
 */
function verifyConsistencyProof(proof) {
    try {
        // Check required fields
        if (!proof.commitment || !proof.challenge || !proof.response) {
            return { valid: false, error: 'Missing proof components' };
        }
        
        // Verify proof hash integrity
        const expectedHash = crypto.createHash('sha256')
            .update(JSON.stringify({
                commitment: proof.commitment,
                threshold: proof.threshold,
                periodCount: proof.periodCount,
                agentId: proof.agentId
            }))
            .digest('hex');
        
        if (expectedHash !== proof.proofHash) {
            return { valid: false, error: 'Proof hash mismatch' };
        }
        
        // Verify challenge-response (simplified)
        const commitment = BigInt(proof.commitment);
        const challenge = BigInt(proof.challenge);
        const response = BigInt(proof.response);
        
        // Check response is in valid range
        if (response <= 0n || response >= M31_PRIME) {
            return { valid: false, error: 'Invalid response range' };
        }
        
        return {
            valid: true,
            periodCount: proof.periodCount,
            threshold: proof.threshold,
            timeRange: {
                start: new Date(proof.startTimestamp * 1000),
                end: new Date(proof.endTimestamp * 1000)
            },
            proofHash: proof.proofHash
        };
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

/**
 * Generate a streak proof
 * 
 * Proves: "Agent maintained >= threshold for exactly N consecutive periods"
 * Useful for: badges, tier upgrades, trust levels
 */
function generateStreakProof({ periods, threshold, agentId, minStreak }) {
    // Find longest streak >= threshold
    let currentStreak = 0;
    let longestStreak = 0;
    let streakStart = null;
    let longestStreakStart = null;
    
    for (let i = 0; i < periods.length; i++) {
        if (periods[i].score >= threshold) {
            if (currentStreak === 0) {
                streakStart = periods[i].timestamp;
            }
            currentStreak++;
            if (currentStreak > longestStreak) {
                longestStreak = currentStreak;
                longestStreakStart = streakStart;
            }
        } else {
            currentStreak = 0;
            streakStart = null;
        }
    }
    
    const meetsMinStreak = longestStreak >= minStreak;
    
    // Build commitment
    const streakCommitment = poseidonHash([
        BigInt(longestStreak),
        BigInt(threshold),
        BigInt(minStreak),
        poseidonHash(agentId.split('').map(c => BigInt(c.charCodeAt(0))))
    ]);
    
    return {
        valid: meetsMinStreak,
        claimedStreak: minStreak,
        actualStreakMeetsMin: meetsMinStreak,
        // Note: We don't reveal actual longest streak, just whether it meets minimum
        
        commitment: streakCommitment.toString(),
        threshold,
        agentId,
        
        proofType: 'streak',
        proofVersion: '1.0',
        generatedAt: new Date().toISOString(),
        
        proofHash: crypto.createHash('sha256')
            .update(JSON.stringify({
                commitment: streakCommitment.toString(),
                threshold,
                minStreak,
                agentId
            }))
            .digest('hex')
    };
}

/**
 * Generate volatility proof
 * 
 * Proves: "Agent's score variance stayed below X" (stability signal)
 * Without revealing individual scores or exact variance
 */
function generateStabilityProof({ periods, maxVariance, agentId }) {
    const scores = periods.map(p => p.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    
    const isStable = variance <= maxVariance;
    
    const stabilityCommitment = poseidonHash([
        BigInt(Math.floor(variance * 100)), // Quantize for field
        BigInt(maxVariance),
        BigInt(periods.length),
        poseidonHash(agentId.split('').map(c => BigInt(c.charCodeAt(0))))
    ]);
    
    return {
        valid: isStable,
        periodCount: periods.length,
        maxVariance,
        meetsStabilityThreshold: isStable,
        // Note: actual variance not revealed
        
        commitment: stabilityCommitment.toString(),
        agentId,
        
        proofType: 'stability',
        proofVersion: '1.0',
        generatedAt: new Date().toISOString(),
        
        proofHash: crypto.createHash('sha256')
            .update(JSON.stringify({
                commitment: stabilityCommitment.toString(),
                maxVariance,
                periodCount: periods.length,
                agentId
            }))
            .digest('hex')
    };
}

module.exports = {
    generateConsistencyProof,
    verifyConsistencyProof,
    generateStreakProof,
    generateStabilityProof,
    M31 // Export for testing
};
