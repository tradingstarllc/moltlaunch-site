/**
 * Verification Circuit for STARK Proofs
 * 
 * Proves: score >= threshold (without revealing score)
 * 
 * This is a JavaScript representation of the circuit constraints.
 * In production, this would be compiled to STWO/RISC-V.
 */

const crypto = require('crypto');
const { M31, computeScore, PublicInputs, PrivateWitness, WEIGHTS } = require('./types');

/**
 * Verification Circuit
 * 
 * Constraints:
 * 1. score = computeScore(features)
 * 2. score >= threshold
 * 3. commitment = hash(agentId)
 * 4. timestamp < expiry
 */
class VerificationCircuit {
    constructor(publicInputs, privateWitness) {
        this.public = publicInputs;
        this.private = privateWitness;
    }

    /**
     * Check all constraints (for local verification)
     * Returns { valid: boolean, constraints: [] }
     */
    evaluate() {
        const constraints = [];

        // Constraint 1: Score computed correctly from features
        const computedScore = computeScore({
            hasGithub: this.private.features.hasGithub.value > 0n,
            hasApiEndpoint: this.private.features.hasApiEndpoint.value > 0n,
            capabilityCount: Number(this.private.features.capabilityCount.value),
            codeLines: Number(this.private.features.codeLines.value) * 100,
            hasDocumentation: this.private.features.hasDocumentation.value > 0n,
            testCoverage: Number(this.private.features.testCoverage.value)
        });

        const scoreValid = computedScore.eq(this.private.score);
        constraints.push({
            name: 'score_computation',
            valid: scoreValid,
            computed: computedScore.toNumber(),
            claimed: this.private.score.toNumber()
        });

        // Constraint 2: Score >= Threshold
        const passesThreshold = this.private.score.gte(this.public.threshold);
        constraints.push({
            name: 'threshold_check',
            valid: passesThreshold,
            score: this.private.score.toNumber(),
            threshold: this.public.threshold.toNumber()
        });

        // Constraint 3: Not expired (current time check would be done at verification)
        const notExpired = BigInt(Math.floor(Date.now() / 1000)) < this.public.expiry;
        constraints.push({
            name: 'not_expired',
            valid: notExpired,
            currentTime: Math.floor(Date.now() / 1000),
            expiry: Number(this.public.expiry)
        });

        // All constraints must pass
        const valid = constraints.every(c => c.valid);

        return { valid, constraints };
    }

    /**
     * Generate commitment from agent ID
     */
    static generateCommitment(agentId) {
        return crypto.createHash('sha256')
            .update(`moltlaunch:agent:${agentId}`)
            .digest('hex');
    }

    /**
     * Create circuit from verification data
     */
    static fromVerificationData(data) {
        const { agentId, score, features, threshold = 60, validityDays = 30 } = data;

        const timestamp = Math.floor(Date.now() / 1000);
        const expiry = timestamp + validityDays * 24 * 60 * 60;

        const publicInputs = new PublicInputs({
            threshold,
            commitment: this.generateCommitment(agentId),
            timestamp,
            expiry
        });

        const privateWitness = new PrivateWitness({
            score,
            features
        });

        return new VerificationCircuit(publicInputs, privateWitness);
    }
}

/**
 * Circuit trace generation (for STWO)
 * 
 * The trace is a table of field elements that the STARK prover
 * will commit to and prove constraints over.
 */
class CircuitTrace {
    constructor(circuit) {
        this.circuit = circuit;
        this.trace = [];
    }

    /**
     * Generate trace for the verification circuit
     */
    generate() {
        // Row 0: Public inputs
        this.trace.push({
            type: 'public',
            threshold: this.circuit.public.threshold.value,
            timestamp: this.circuit.public.timestamp,
            expiry: this.circuit.public.expiry
        });

        // Row 1: Private witness (score)
        this.trace.push({
            type: 'witness',
            score: this.circuit.private.score.value
        });

        // Rows 2-7: Feature values
        const features = this.circuit.private.features.toArray();
        features.forEach((f, i) => {
            this.trace.push({
                type: 'feature',
                index: i,
                value: f.value
            });
        });

        // Row 8: Constraint - score computation
        const computedScore = computeScore({
            hasGithub: features[0].value > 0n,
            hasApiEndpoint: features[1].value > 0n,
            capabilityCount: Number(features[2].value),
            codeLines: Number(features[3].value) * 100,
            hasDocumentation: features[4].value > 0n,
            testCoverage: Number(features[5].value)
        });
        this.trace.push({
            type: 'constraint',
            name: 'score_equals_computed',
            left: this.circuit.private.score.value,
            right: computedScore.value
        });

        // Row 9: Constraint - threshold check
        this.trace.push({
            type: 'constraint',
            name: 'score_gte_threshold',
            score: this.circuit.private.score.value,
            threshold: this.circuit.public.threshold.value,
            result: this.circuit.private.score.value >= this.circuit.public.threshold.value ? 1n : 0n
        });

        return this.trace;
    }

    /**
     * Serialize trace for STWO prover
     */
    toBytes() {
        // Convert BigInt to string for JSON serialization
        const serializableTrace = this.trace.map(row => {
            const newRow = {};
            for (const [key, value] of Object.entries(row)) {
                if (typeof value === 'bigint') {
                    newRow[key] = value.toString();
                } else {
                    newRow[key] = value;
                }
            }
            return newRow;
        });
        return Buffer.from(JSON.stringify(serializableTrace));
    }

    /**
     * Serialize trace to JSON-safe format
     */
    toJSON() {
        return this.trace.map(row => {
            const newRow = {};
            for (const [key, value] of Object.entries(row)) {
                if (typeof value === 'bigint') {
                    newRow[key] = value.toString();
                } else {
                    newRow[key] = value;
                }
            }
            return newRow;
        });
    }
}

module.exports = {
    VerificationCircuit,
    CircuitTrace
};
