/**
 * MoltLaunch STARK Prover Module
 * 
 * Privacy-preserving threshold proofs for agent verification.
 * 
 * Implements a simplified but cryptographically real STARK proof system:
 * - Polynomial commitment via Merkle tree over evaluations
 * - FRI-based low-degree testing
 * - Fiat-Shamir transform for non-interactivity
 * - Verifiable threshold ZKP: "score >= threshold" without revealing score
 */

const { M31, M31_PRIME, Polynomial, MerkleTree, FiatShamirTranscript, computeScore, PublicInputs, PrivateWitness, VerificationFeatures, WEIGHTS } = require('./types');
const { VerificationCircuit, CircuitTrace, NUM_BITS, TRACE_WIDTH } = require('./circuit');
const { STWOProver, generateVerificationProof, verifyProof, StarkProof, FRI_LAYERS, NUM_QUERIES, TRACE_LEN, BLOWUP_FACTOR } = require('./prover');
const { generateConsistencyProof, verifyConsistencyProof, generateStreakProof, generateStabilityProof } = require('./consistency-proof');

/**
 * High-level API for generating verification proofs
 */
class MoltLaunchStarkProver {
    constructor() {
        this.prover = new STWOProver();
    }

    /**
     * Generate a privacy-preserving proof that an agent passed verification
     * 
     * @param {Object} data - Verification data from POA-Scorer
     * @param {string} data.agentId - Agent identifier
     * @param {number} data.score - Verification score (private, not revealed)
     * @param {Object} data.features - Feature values used in scoring
     * @param {number} [data.threshold=60] - Passing threshold
     * @param {number} [data.validityDays=30] - Proof validity period
     * @returns {Promise<Object>} Proof result
     */
    async generateProof(data) {
        return generateVerificationProof(data);
    }

    /**
     * Verify a STARK proof (off-chain)
     * 
     * Given only the proof and public inputs, independently confirm the claim
     * "score >= threshold" without learning the score.
     * 
     * @param {Object} proof - Proof object
     * @returns {Promise<Object>} Verification result
     */
    async verifyProof(proof) {
        return verifyProof(proof);
    }

    /**
     * Generate a consistency proof (multi-period threshold)
     * 
     * @param {Object} data
     * @param {Array<{score: number, timestamp: number}>} data.periods
     * @param {number} data.threshold
     * @param {string} data.agentId
     * @returns {Object}
     */
    generateConsistencyProof(data) {
        return generateConsistencyProof(data);
    }

    /**
     * Verify a consistency proof
     * @param {Object} proof
     * @returns {Object}
     */
    verifyConsistencyProof(proof) {
        return verifyConsistencyProof(proof);
    }

    /**
     * Check if score would pass threshold
     * (for pre-check before proof generation)
     * @param {number} score
     * @param {number} [threshold=60]
     * @returns {boolean}
     */
    wouldPass(score, threshold = 60) {
        return score >= threshold;
    }

    /**
     * Get prover information
     * @returns {Object}
     */
    getInfo() {
        return {
            name: 'moltlaunch-stark-lite',
            version: '2.0.0',
            backend: 'moltlaunch-stark-lite',
            field: 'M31 (Mersenne-31, p = 2^31 - 1)',
            hashFunction: 'SHA-256',
            proofSystem: {
                traceCommitment: 'Merkle tree over trace rows',
                constraintSystem: 'Arithmetic constraints with bit decomposition',
                lowDegreeTest: 'FRI (Fast Reed-Solomon IOP)',
                nonInteractivity: 'Fiat-Shamir transform'
            },
            parameters: {
                traceLength: TRACE_LEN,
                friLayers: FRI_LAYERS,
                numQueries: NUM_QUERIES,
                blowupFactor: BLOWUP_FACTOR,
                numBits: NUM_BITS,
                securityBits: `~${NUM_QUERIES * Math.log2(TRACE_LEN * BLOWUP_FACTOR / 2)} bits (simplified)`
            },
            features: [
                'Privacy-preserving threshold proofs (score >= threshold without revealing score)',
                'Real polynomial commitment via Merkle tree',
                'Real FRI protocol with folding verification',
                'Fiat-Shamir non-interactive challenges',
                'Bit decomposition range proofs',
                'Multi-period consistency proofs',
                'Streak proofs',
                'Stability proofs'
            ],
            limitations: [
                'Simplified parameters (4 FRI layers, 8 queries)',
                'Not constant-time (no side-channel resistance)',
                'SHA-256 instead of algebraic hash (Poseidon)',
                'Production would use 20+ queries for 128-bit security'
            ]
        };
    }
}

// Export everything
module.exports = {
    // Main API
    MoltLaunchStarkProver,
    generateVerificationProof,
    verifyProof,

    // Consistency proofs
    generateConsistencyProof,
    verifyConsistencyProof,
    generateStreakProof,
    generateStabilityProof,

    // Low-level components
    VerificationCircuit,
    CircuitTrace,
    STWOProver,
    StarkProof,

    // Algebraic primitives
    M31,
    M31_PRIME,
    Polynomial,
    MerkleTree,
    FiatShamirTranscript,

    // Scoring
    computeScore,
    PublicInputs,
    PrivateWitness,
    VerificationFeatures,
    WEIGHTS,

    // Constants
    NUM_BITS,
    TRACE_WIDTH,
    FRI_LAYERS,
    NUM_QUERIES,
    TRACE_LEN,
    BLOWUP_FACTOR
};
