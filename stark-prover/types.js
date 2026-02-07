/**
 * M31 Field Arithmetic
 * Mersenne-31 prime: p = 2^31 - 1 = 2147483647
 * 
 * Based on Murkl/STWO implementation
 */

const M31_PRIME = 2147483647n; // 2^31 - 1

class M31 {
    constructor(value) {
        // Reduce modulo prime
        this.value = BigInt(value) % M31_PRIME;
        if (this.value < 0n) {
            this.value += M31_PRIME;
        }
    }

    add(other) {
        return new M31(this.value + other.value);
    }

    sub(other) {
        return new M31(this.value - other.value + M31_PRIME);
    }

    mul(other) {
        return new M31(this.value * other.value);
    }

    // Fast reduction using Mersenne prime structure
    // For 2^31 - 1: x mod p = (x & p) + (x >> 31), repeat if needed
    static fastReduce(x) {
        let val = x;
        while (val >= M31_PRIME) {
            val = (val & M31_PRIME) + (val >> 31n);
        }
        return val;
    }

    eq(other) {
        return this.value === other.value;
    }

    gte(other) {
        return this.value >= other.value;
    }

    toNumber() {
        return Number(this.value);
    }

    toString() {
        return this.value.toString();
    }
}

/**
 * Verification Features as M31 values
 */
class VerificationFeatures {
    constructor(features) {
        this.hasGithub = new M31(features.hasGithub ? 1 : 0);
        this.hasApiEndpoint = new M31(features.hasApiEndpoint ? 1 : 0);
        this.capabilityCount = new M31(Math.min(features.capabilityCount || 0, 5));
        this.codeLines = new M31(Math.min(Math.floor((features.codeLines || 0) / 100), 50));
        this.hasDocumentation = new M31(features.hasDocumentation ? 1 : 0);
        this.testCoverage = new M31(Math.min(features.testCoverage || 0, 100));
    }

    toArray() {
        return [
            this.hasGithub,
            this.hasApiEndpoint,
            this.capabilityCount,
            this.codeLines,
            this.hasDocumentation,
            this.testCoverage
        ];
    }
}

/**
 * Scoring weights as M31 values
 */
const WEIGHTS = {
    baseScore: new M31(10),
    github: new M31(15),
    api: new M31(20),
    capability: new M31(5),
    codeLinesPerHundred: new M31(3), // 0.3 * 10 for integer math
    documentation: new M31(10),
    testCoveragePercent: new M31(2)  // 0.2 * 10 for integer math
};

/**
 * Compute score from features (same as POA-Scorer)
 * Returns M31 value
 */
function computeScore(features) {
    const f = new VerificationFeatures(features);
    
    // score = 10 + (github*15) + (api*20) + (caps*5) + (code*0.3) + (docs*10) + (tests*0.2)
    let score = WEIGHTS.baseScore.value;
    score += f.hasGithub.value * WEIGHTS.github.value;
    score += f.hasApiEndpoint.value * WEIGHTS.api.value;
    score += f.capabilityCount.value * WEIGHTS.capability.value;
    score += f.codeLines.value * 3n / 10n; // 0.3 per 100 lines
    score += f.hasDocumentation.value * WEIGHTS.documentation.value;
    score += f.testCoverage.value * 2n / 10n; // 0.2 per percent
    
    // Clamp to 0-100
    if (score > 100n) score = 100n;
    
    return new M31(score);
}

/**
 * Public inputs for the STARK circuit
 */
class PublicInputs {
    constructor({ threshold, commitment, timestamp, expiry }) {
        this.threshold = new M31(threshold || 60);
        this.commitment = commitment; // bytes32
        this.timestamp = BigInt(timestamp || Math.floor(Date.now() / 1000));
        this.expiry = BigInt(expiry || this.timestamp + 30n * 24n * 60n * 60n);
    }

    toBytes() {
        // Serialize for hashing
        const buffer = Buffer.alloc(72);
        buffer.writeBigUInt64LE(BigInt(this.threshold.value), 0);
        if (this.commitment) {
            Buffer.from(this.commitment, 'hex').copy(buffer, 8);
        }
        buffer.writeBigUInt64LE(this.timestamp, 40);
        buffer.writeBigUInt64LE(this.expiry, 48);
        return buffer;
    }
}

/**
 * Private witness for the STARK circuit
 */
class PrivateWitness {
    constructor({ score, features }) {
        this.score = new M31(score);
        this.features = new VerificationFeatures(features);
    }
}

module.exports = {
    M31_PRIME,
    M31,
    VerificationFeatures,
    WEIGHTS,
    computeScore,
    PublicInputs,
    PrivateWitness
};
