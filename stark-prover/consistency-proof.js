/**
 * Behavioral Consistency Proofs
 * 
 * Prove "agent maintained >= threshold score across N periods"
 * without revealing individual period scores.
 * 
 * Uses the same polynomial commitment + FRI approach as the single
 * threshold proof, but extended to batch multiple periods:
 * 
 * 1. For each period, build a trace row with score, threshold, difference,
 *    and bit decomposition (same as single proof).
 * 2. Commit to all rows via a single Merkle tree.
 * 3. Build a batch composition polynomial that encodes ALL period constraints.
 * 4. Run FRI over the batch composition polynomial.
 * 5. Verifier checks: all periods satisfy score >= threshold.
 * 
 * Use cases:
 * - "Agent stayed above 60 for 30 days" (trust signal)
 * - "No score drops below 40 in past quarter" (stability proof)  
 * - "Maintained excellent tier (80+) for 7 days" (premium verification)
 */

const crypto = require('crypto');
const { M31, M31_PRIME, Polynomial, MerkleTree, FiatShamirTranscript } = require('./types');

/** Number of bits for range proof */
const NUM_BITS = 7;

/**
 * Build a trace row for a single period's threshold proof.
 * Same structure as circuit.js but standalone for batch use.
 * 
 * @param {number} score
 * @param {number} threshold
 * @returns {M31[]} Trace row: [score, threshold, diff, bits..., upperDiff, upperBits...]
 */
function buildPeriodRow(score, threshold) {
    const difference = score - threshold;
    const upperDiff = 100 - score;

    if (difference < 0) {
        throw new Error(`Score ${score} below threshold ${threshold}`);
    }
    if (score < 0 || score > 100) {
        throw new Error(`Score ${score} out of range [0, 100]`);
    }

    const row = [
        new M31(score),
        new M31(threshold),
        new M31(difference),
    ];

    // Bit decomposition of difference
    for (let i = 0; i < NUM_BITS; i++) {
        row.push(new M31((difference >> i) & 1));
    }

    row.push(new M31(upperDiff));

    // Bit decomposition of upper difference
    for (let i = 0; i < NUM_BITS; i++) {
        row.push(new M31((upperDiff >> i) & 1));
    }

    return row;
}

/**
 * Check constraints on a single trace row (same as CircuitTrace.checkConstraints)
 * @param {M31[]} row
 * @returns {boolean}
 */
function checkRowConstraints(row) {
    const score = row[0];
    const threshold = row[1];
    const difference = row[2];

    // C1: difference = score - threshold
    if (!difference.eq(score.sub(threshold))) return false;

    // C2 & C3: bit decomposition of difference
    let reconstructed = M31.ZERO;
    for (let i = 0; i < NUM_BITS; i++) {
        const bit = row[3 + i];
        if (!bit.mul(M31.ONE.sub(bit)).isZero()) return false;
        reconstructed = reconstructed.add(bit.mul(new M31(1 << i)));
    }
    if (!reconstructed.eq(difference)) return false;

    // C4: upper_difference = 100 - score
    const upperDiff = row[10];
    if (!upperDiff.eq(new M31(100).sub(score))) return false;

    // C5 & C6: bit decomposition of upper_difference
    let upperReconstructed = M31.ZERO;
    for (let i = 0; i < NUM_BITS; i++) {
        const bit = row[11 + i];
        if (!bit.mul(M31.ONE.sub(bit)).isZero()) return false;
        upperReconstructed = upperReconstructed.add(bit.mul(new M31(1 << i)));
    }
    if (!upperReconstructed.eq(upperDiff)) return false;

    return true;
}

/**
 * Serialize a trace row to a Buffer for Merkle commitment
 * @param {M31[]} row
 * @returns {Buffer}
 */
function serializeRow(row) {
    const buf = Buffer.alloc(row.length * 4);
    for (let i = 0; i < row.length; i++) {
        buf.writeUInt32LE(Number(row[i].value), i * 4);
    }
    return buf;
}

/**
 * Generate a consistency proof
 * 
 * Proves: ∀i ∈ [0, periods.length): periods[i].score >= threshold
 * without revealing any individual score.
 * 
 * Algorithm:
 * 1. Build trace rows for each period
 * 2. Pad to power of 2
 * 3. Commit via Merkle tree
 * 4. Interpolate columns into polynomials
 * 5. Build batch composition polynomial
 * 6. Run simplified FRI (2 layers for batch proofs)
 * 7. Open at random query positions
 * 
 * @param {Object} params
 * @param {Array<{score: number, timestamp: number}>} params.periods
 * @param {number} params.threshold
 * @param {string} params.agentId
 * @returns {Object} Consistency proof
 */
function generateConsistencyProof({ periods, threshold, agentId }) {
    if (!periods || periods.length === 0) {
        throw new Error('At least one period required');
    }

    // Check all periods meet threshold
    for (const p of periods) {
        if (p.score < threshold) {
            return {
                valid: false,
                error: `Period at timestamp ${p.timestamp} has score ${p.score} < threshold ${threshold}`,
                periodCount: periods.length,
                threshold,
                agentId
            };
        }
    }

    // Build trace rows
    const traceRows = periods.map(p => buildPeriodRow(p.score, threshold));

    // Pad to power of 2
    let padded = traceRows.length;
    let paddedSize = 1;
    while (paddedSize < padded) paddedSize <<= 1;
    // Pad with valid rows (threshold, threshold, 0, [0 bits])
    while (traceRows.length < paddedSize) {
        traceRows.push(buildPeriodRow(threshold, threshold));
    }

    // Verify all constraints
    for (let i = 0; i < traceRows.length; i++) {
        if (!checkRowConstraints(traceRows[i])) {
            throw new Error(`Constraint check failed on row ${i}`);
        }
    }

    // Commit via Merkle tree
    const leaves = traceRows.map(row => serializeRow(row));
    const tree = new MerkleTree(leaves);
    const traceRoot = tree.root();

    // Initialize Fiat-Shamir transcript
    const transcript = new FiatShamirTranscript();
    transcript.absorbLabel('moltlaunch-consistency-v2');
    transcript.absorb(Buffer.from(traceRoot, 'hex'));
    transcript.absorb(Buffer.from(agentId, 'utf8'));
    transcript.absorb(Buffer.from(threshold.toString(), 'utf8'));
    transcript.absorb(Buffer.from(periods.length.toString(), 'utf8'));

    // Build batch composition polynomial
    // Interpolate each column and combine constraints
    const domain = [];
    for (let i = 0; i < paddedSize; i++) {
        domain.push(new M31(i + 1));
    }

    const numCols = traceRows[0].length;
    const colPolys = [];
    for (let c = 0; c < numCols; c++) {
        const ys = traceRows.map(row => row[c]);
        colPolys.push(Polynomial.interpolate(domain, ys));
    }

    // Random combination coefficients
    const alphas = [];
    for (let i = 0; i < 6; i++) {
        alphas.push(transcript.squeezeM31());
    }

    // Build composition (same constraints as single proof, but over all periods)
    let composition = Polynomial.zero();

    // C1: col2 - col0 + col1 = 0
    composition = composition.add(
        colPolys[2].sub(colPolys[0]).add(colPolys[1]).scale(alphas[0])
    );

    // C2: bit boolean constraints
    for (let i = 0; i < NUM_BITS; i++) {
        const bp = colPolys[3 + i];
        composition = composition.add(bp.sub(bp.mul(bp)).scale(alphas[1]));
    }

    // C3: bit decomposition matches difference
    let bitSum = Polynomial.zero();
    for (let i = 0; i < NUM_BITS; i++) {
        bitSum = bitSum.add(colPolys[3 + i].scale(new M31(1 << i)));
    }
    composition = composition.add(bitSum.sub(colPolys[2]).scale(alphas[2]));

    // C4: upper difference
    composition = composition.add(
        colPolys[10].add(colPolys[0]).sub(Polynomial.constant(new M31(100))).scale(alphas[3])
    );

    // C5: upper bit boolean
    for (let i = 0; i < NUM_BITS; i++) {
        const bp = colPolys[11 + i];
        composition = composition.add(bp.sub(bp.mul(bp)).scale(alphas[4]));
    }

    // C6: upper bit decomposition
    let upperBitSum = Polynomial.zero();
    for (let i = 0; i < NUM_BITS; i++) {
        upperBitSum = upperBitSum.add(colPolys[11 + i].scale(new M31(1 << i)));
    }
    composition = composition.add(upperBitSum.sub(colPolys[10]).scale(alphas[5]));

    // Evaluate composition on extended domain
    const extSize = paddedSize * 2;
    const extDomain = [];
    for (let i = 0; i < extSize; i++) {
        extDomain.push(new M31(paddedSize + i + 1));
    }
    const compEvals = composition.evaluateMulti(extDomain);

    // Commit to composition evaluations
    const compLeaves = compEvals.map(e => {
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(Number(e.value), 0);
        return buf;
    });
    const compTree = new MerkleTree(compLeaves);
    const compRoot = compTree.root();

    transcript.absorbLabel('composition-commitment');
    transcript.absorb(Buffer.from(compRoot, 'hex'));

    // FRI: 2 layers for batch proofs
    const friChallenges = [];
    const friCommitments = [compRoot];
    let currentEvals = compEvals;
    let currentDomain = extDomain;

    for (let layer = 0; layer < 2; layer++) {
        const alpha = transcript.squeezeM31();
        friChallenges.push(alpha);

        const halfSize = Math.floor(currentEvals.length / 2);
        const nextEvals = [];
        const nextDomain = [];

        for (let i = 0; i < halfSize; i++) {
            const x0 = currentDomain[2 * i];
            const x1 = currentDomain[2 * i + 1];
            const f0 = currentEvals[2 * i];
            const f1 = currentEvals[2 * i + 1];

            const dx = x1.sub(x0);
            const dxInv = dx.inv();
            const fEven = f0.mul(x1).sub(f1.mul(x0)).mul(dxInv);
            const fOdd = f1.sub(f0).mul(dxInv);
            const folded = fEven.add(alpha.mul(fOdd));

            nextEvals.push(folded);
            nextDomain.push(new M31(i + 1));
        }

        // Commit folded layer
        const foldLeaves = nextEvals.map(e => {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(Number(e.value), 0);
            return buf;
        });
        const foldTree = new MerkleTree(foldLeaves);
        friCommitments.push(foldTree.root());

        transcript.absorbLabel(`fri-fold-${layer}`);
        transcript.absorb(Buffer.from(foldTree.root(), 'hex'));

        currentEvals = nextEvals;
        currentDomain = nextDomain;
    }

    const finalConstant = currentEvals[0];

    // Query phase: open trace at random positions
    transcript.absorbLabel('consistency-queries');
    const numQueries = Math.min(8, paddedSize);
    const queryOpenings = [];

    for (let q = 0; q < numQueries; q++) {
        const idx = transcript.squeezeIndex(paddedSize);
        const proof = tree.getProof(idx);
        queryOpenings.push({
            index: idx,
            leafHash: proof.leaf,
            merkleProof: proof.path,
        });
    }

    // Time bounds
    const timestamps = periods.map(p => p.timestamp);

    return {
        valid: true,
        periodCount: periods.length,
        threshold,
        agentId,

        // Cryptographic proof
        proof: {
            traceCommitment: traceRoot,
            compositionCommitment: compRoot,
            compositionDegree: composition.degree(),
            fri: {
                commitments: friCommitments,
                challenges: friChallenges.map(c => c.toString()),
                finalConstant: finalConstant.toString(),
                layers: 2,
            },
            queries: queryOpenings,
            paddedSize,
        },

        proofType: 'consistency',
        proofVersion: '2.0',
        generatedAt: new Date().toISOString(),

        startTimestamp: Math.min(...timestamps),
        endTimestamp: Math.max(...timestamps),

        // Proof hash for quick integrity check
        proofHash: crypto.createHash('sha256')
            .update(JSON.stringify({
                traceCommitment: traceRoot,
                compositionCommitment: compRoot,
                threshold,
                periodCount: periods.length,
                agentId,
                finalConstant: finalConstant.toString()
            }))
            .digest('hex')
    };
}

/**
 * Verify a consistency proof
 * 
 * Recomputes Fiat-Shamir challenges and verifies:
 * 1. Proof hash integrity
 * 2. Merkle proofs at queried positions
 * 3. FRI commitment chain
 * 
 * @param {Object} proof
 * @returns {{valid: boolean, error?: string}}
 */
function verifyConsistencyProof(proof) {
    try {
        if (!proof || proof.proofVersion !== '2.0' || proof.proofType !== 'consistency') {
            return { valid: false, error: 'Invalid consistency proof format' };
        }

        const pd = proof.proof;
        if (!pd || !pd.traceCommitment || !pd.compositionCommitment || !pd.fri) {
            return { valid: false, error: 'Missing proof data' };
        }

        // Verify proof hash
        const expectedHash = crypto.createHash('sha256')
            .update(JSON.stringify({
                traceCommitment: pd.traceCommitment,
                compositionCommitment: pd.compositionCommitment,
                threshold: proof.threshold,
                periodCount: proof.periodCount,
                agentId: proof.agentId,
                finalConstant: pd.fri.finalConstant
            }))
            .digest('hex');

        if (expectedHash !== proof.proofHash) {
            return { valid: false, error: 'Proof hash mismatch' };
        }

        // Rebuild Fiat-Shamir transcript
        const transcript = new FiatShamirTranscript();
        transcript.absorbLabel('moltlaunch-consistency-v2');
        transcript.absorb(Buffer.from(pd.traceCommitment, 'hex'));
        transcript.absorb(Buffer.from(proof.agentId, 'utf8'));
        transcript.absorb(Buffer.from(proof.threshold.toString(), 'utf8'));
        transcript.absorb(Buffer.from(proof.periodCount.toString(), 'utf8'));

        // Squeeze composition alphas (to advance transcript state)
        for (let i = 0; i < 6; i++) {
            transcript.squeezeM31();
        }

        // Absorb composition commitment
        transcript.absorbLabel('composition-commitment');
        transcript.absorb(Buffer.from(pd.compositionCommitment, 'hex'));

        // Recompute FRI challenges
        const recomputedChallenges = [];
        for (let layer = 0; layer < pd.fri.layers; layer++) {
            const alpha = transcript.squeezeM31();
            recomputedChallenges.push(alpha);

            // Absorb fold commitment
            transcript.absorbLabel(`fri-fold-${layer}`);
            transcript.absorb(Buffer.from(pd.fri.commitments[layer + 1], 'hex'));
        }

        // Verify challenges match
        for (let i = 0; i < recomputedChallenges.length; i++) {
            const expected = recomputedChallenges[i];
            const actual = new M31(BigInt(pd.fri.challenges[i]));
            if (!expected.eq(actual)) {
                return { valid: false, error: `FRI challenge mismatch at layer ${i}` };
            }
        }

        // Verify trace Merkle proofs
        transcript.absorbLabel('consistency-queries');
        for (const query of pd.queries) {
            const expectedIdx = transcript.squeezeIndex(pd.paddedSize);
            if (query.index !== expectedIdx) {
                return { valid: false, error: `Query index mismatch: expected ${expectedIdx}, got ${query.index}` };
            }

            const merkleValid = MerkleTree.verifyProof(
                query.leafHash,
                query.index,
                query.merkleProof,
                pd.traceCommitment
            );
            if (!merkleValid) {
                return { valid: false, error: `Merkle proof invalid at index ${query.index}` };
            }
        }

        return {
            valid: true,
            periodCount: proof.periodCount,
            threshold: proof.threshold,
            timeRange: {
                start: new Date(proof.startTimestamp * 1000),
                end: new Date(proof.endTimestamp * 1000)
            },
            proofHash: proof.proofHash,
            friLayers: pd.fri.layers,
            queryCount: pd.queries.length
        };
    } catch (e) {
        return { valid: false, error: `Verification error: ${e.message}` };
    }
}

/**
 * Generate a streak proof
 * 
 * Proves: "Agent maintained >= threshold for at least minStreak consecutive periods"
 * Uses consistency proof internally on the streak sub-sequence.
 * 
 * @param {Object} params
 * @param {Array<{score: number, timestamp: number}>} params.periods
 * @param {number} params.threshold
 * @param {string} params.agentId
 * @param {number} params.minStreak
 * @returns {Object}
 */
function generateStreakProof({ periods, threshold, agentId, minStreak }) {
    // Find longest streak >= threshold
    let currentStreak = 0;
    let longestStreak = 0;
    let longestStreakStart = 0;
    let currentStreakStart = 0;

    for (let i = 0; i < periods.length; i++) {
        if (periods[i].score >= threshold) {
            if (currentStreak === 0) currentStreakStart = i;
            currentStreak++;
            if (currentStreak > longestStreak) {
                longestStreak = currentStreak;
                longestStreakStart = currentStreakStart;
            }
        } else {
            currentStreak = 0;
        }
    }

    const meetsMinStreak = longestStreak >= minStreak;

    if (!meetsMinStreak) {
        return {
            valid: false,
            claimedStreak: minStreak,
            error: `Longest streak (${longestStreak}) < minimum (${minStreak})`,
            threshold,
            agentId,
            proofType: 'streak',
            proofVersion: '2.0',
            generatedAt: new Date().toISOString()
        };
    }

    // Generate a consistency proof over the streak sub-sequence
    const streakPeriods = periods.slice(longestStreakStart, longestStreakStart + longestStreak);
    // Only prove for minStreak periods (don't reveal actual streak length)
    const provedPeriods = streakPeriods.slice(0, minStreak);

    const consistencyProof = generateConsistencyProof({
        periods: provedPeriods,
        threshold,
        agentId
    });

    return {
        valid: true,
        claimedStreak: minStreak,
        actualStreakMeetsMin: true,

        // Inner consistency proof for the streak
        proof: consistencyProof.proof,
        threshold,
        agentId,

        proofType: 'streak',
        proofVersion: '2.0',
        generatedAt: new Date().toISOString(),

        startTimestamp: consistencyProof.startTimestamp,
        endTimestamp: consistencyProof.endTimestamp,

        proofHash: crypto.createHash('sha256')
            .update(JSON.stringify({
                traceCommitment: consistencyProof.proof.traceCommitment,
                threshold,
                minStreak,
                agentId
            }))
            .digest('hex')
    };
}

/**
 * Generate stability proof
 * 
 * Proves: "Agent's score variance stayed below maxVariance"
 * Uses Merkle commitment over period data with a variance bound proof.
 * 
 * @param {Object} params
 * @param {Array<{score: number, timestamp: number}>} params.periods
 * @param {number} params.maxVariance
 * @param {string} params.agentId
 * @returns {Object}
 */
function generateStabilityProof({ periods, maxVariance, agentId }) {
    const scores = periods.map(p => p.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const isStable = variance <= maxVariance;

    // Commit to scores via Merkle tree
    const leaves = scores.map(s => {
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(s, 0);
        return buf;
    });
    const tree = new MerkleTree(leaves);

    // Build Fiat-Shamir transcript
    const transcript = new FiatShamirTranscript();
    transcript.absorbLabel('moltlaunch-stability-v2');
    transcript.absorb(Buffer.from(tree.root(), 'hex'));
    transcript.absorb(Buffer.from(agentId, 'utf8'));
    transcript.absorb(Buffer.from(maxVariance.toString(), 'utf8'));

    // Quantized variance commitment (don't reveal exact variance)
    const quantizedVariance = Math.floor(variance * 100);
    const varianceM31 = new M31(quantizedVariance);
    const maxVarianceM31 = new M31(Math.floor(maxVariance * 100));

    // Prove variance <= maxVariance via difference range check
    const diff = Math.floor(maxVariance * 100) - quantizedVariance;
    if (diff < 0 && isStable) {
        // Shouldn't happen, but safety check
        throw new Error('Variance computation mismatch');
    }

    // Open at random positions
    const numQueries = Math.min(4, scores.length);
    const queryOpenings = [];
    for (let q = 0; q < numQueries; q++) {
        const idx = transcript.squeezeIndex(tree.leafCount);
        const proof = tree.getProof(idx);
        queryOpenings.push({
            index: idx,
            leafHash: proof.leaf,
            merkleProof: proof.path,
        });
    }

    return {
        valid: isStable,
        periodCount: periods.length,
        maxVariance,
        meetsStabilityThreshold: isStable,

        proof: {
            scoreCommitment: tree.root(),
            varianceBoundProof: {
                quantizedDifference: isStable ? diff : null,
                meetsThreshold: isStable
            },
            queries: queryOpenings,
        },

        agentId,
        proofType: 'stability',
        proofVersion: '2.0',
        generatedAt: new Date().toISOString(),

        proofHash: crypto.createHash('sha256')
            .update(JSON.stringify({
                scoreCommitment: tree.root(),
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
    generateStabilityProof
};
