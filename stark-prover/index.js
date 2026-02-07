/**
 * MoltLaunch STARK Prover Module
 * 
 * Privacy-preserving threshold proofs for agent verification.
 */

const { M31, computeScore, PublicInputs, PrivateWitness, WEIGHTS } = require('./types');
const { VerificationCircuit, CircuitTrace } = require('./circuit');
const { STWOProver, generateVerificationProof, verifyProof, StarkProof } = require('./prover');

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
     * @param {Object} proof - Proof object
     * @returns {Promise<Object>} Verification result
     */
    async verifyProof(proof) {
        return verifyProof(proof);
    }

    /**
     * Check if score would pass threshold
     * (for pre-check before proof generation)
     */
    wouldPass(score, threshold = 60) {
        return score >= threshold;
    }

    /**
     * Get prover info
     */
    getInfo() {
        return {
            name: 'moltlaunch-stark-prover',
            version: '1.0.0',
            backend: 'stwo-simulator',
            field: 'M31 (Mersenne-31)',
            proofSize: '~6KB',
            verificationCost: '~50K CU (estimated)',
            features: [
                'Privacy-preserving threshold proofs',
                'Circle STARK over M31',
                'Post-quantum secure',
                'Solana-optimized'
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
    
    // Low-level components
    VerificationCircuit,
    CircuitTrace,
    STWOProver,
    StarkProof,
    
    // Field arithmetic
    M31,
    computeScore,
    PublicInputs,
    PrivateWitness,
    WEIGHTS
};
