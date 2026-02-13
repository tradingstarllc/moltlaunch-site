/**
 * M31 Field Arithmetic, Polynomial Operations, and Merkle Trees
 * 
 * Mersenne-31 prime: p = 2^31 - 1 = 2147483647
 * 
 * This module provides the algebraic foundation for the STARK prover:
 * - M31 field: addition, subtraction, multiplication, inversion, exponentiation
 * - Polynomial: evaluate, interpolate (Lagrange), add, multiply, split even/odd
 * - MerkleTree: SHA-256 based commitment scheme with inclusion proofs
 */

const crypto = require('crypto');

const M31_PRIME = 2147483647n; // 2^31 - 1

/**
 * M31 Field Element
 * 
 * All arithmetic is modulo the Mersenne-31 prime p = 2^31 - 1.
 * This field is used in Circle STARKs (STWO) for its efficient arithmetic.
 */
class M31 {
    /**
     * @param {number|bigint|M31} value - Value to reduce into field
     */
    constructor(value) {
        if (value instanceof M31) {
            this.value = value.value;
            return;
        }
        this.value = ((BigInt(value) % M31_PRIME) + M31_PRIME) % M31_PRIME;
    }

    /** @returns {M31} this + other mod p */
    add(other) {
        return new M31((this.value + other.value) % M31_PRIME);
    }

    /** @returns {M31} this - other mod p */
    sub(other) {
        return new M31((this.value - other.value + M31_PRIME) % M31_PRIME);
    }

    /** @returns {M31} this * other mod p */
    mul(other) {
        return new M31((this.value * other.value) % M31_PRIME);
    }

    /**
     * Modular exponentiation via repeated squaring
     * @param {bigint} exp - Exponent
     * @returns {M31} this^exp mod p
     */
    pow(exp) {
        let result = new M31(1);
        let base = new M31(this.value);
        exp = BigInt(exp);
        if (exp < 0n) throw new Error('Negative exponent');
        while (exp > 0n) {
            if (exp & 1n) result = result.mul(base);
            base = base.mul(base);
            exp >>= 1n;
        }
        return result;
    }

    /**
     * Modular inverse using Fermat's little theorem: a^(-1) = a^(p-2) mod p
     * @returns {M31} Multiplicative inverse
     */
    inv() {
        if (this.value === 0n) throw new Error('Division by zero in M31');
        return this.pow(M31_PRIME - 2n);
    }

    /** @returns {M31} Additive inverse (-this mod p) */
    neg() {
        return new M31(this.value === 0n ? 0n : M31_PRIME - this.value);
    }

    /** @returns {boolean} this == other */
    eq(other) {
        return this.value === other.value;
    }

    /** @returns {boolean} this >= other (as integers, not algebraic) */
    gte(other) {
        return this.value >= other.value;
    }

    /** @returns {boolean} this == 0 */
    isZero() {
        return this.value === 0n;
    }

    /** @returns {number} Field element as JS number */
    toNumber() {
        return Number(this.value);
    }

    /** @returns {string} */
    toString() {
        return this.value.toString();
    }

    /** Canonical zero */
    static get ZERO() { return new M31(0); }
    /** Canonical one */
    static get ONE() { return new M31(1); }
}

/**
 * Polynomial over M31
 * 
 * Represented as coefficient array: coeffs[i] is the coefficient of x^i.
 * coeffs[0] is the constant term.
 * 
 * Used for:
 * - Trace interpolation (evaluation domain → coefficient form)
 * - FRI folding (split into even/odd, recombine with challenge)
 * - Constraint polynomial computation
 */
class Polynomial {
    /**
     * @param {M31[]} coeffs - Coefficients [a_0, a_1, ..., a_n] for a_0 + a_1*x + ... + a_n*x^n
     */
    constructor(coeffs) {
        // Clone and trim trailing zeros
        this.coeffs = coeffs.map(c => new M31(c.value !== undefined ? c.value : c));
        while (this.coeffs.length > 1 && this.coeffs[this.coeffs.length - 1].isZero()) {
            this.coeffs.pop();
        }
    }

    /**
     * Degree of polynomial (-1 for zero polynomial by convention, but we return 0)
     * @returns {number}
     */
    degree() {
        if (this.coeffs.length === 1 && this.coeffs[0].isZero()) return 0;
        return this.coeffs.length - 1;
    }

    /**
     * Evaluate polynomial at a point using Horner's method
     * p(x) = a_0 + x*(a_1 + x*(a_2 + ... ))
     * 
     * @param {M31} x - Evaluation point
     * @returns {M31} p(x)
     */
    evaluate(x) {
        x = new M31(x.value !== undefined ? x.value : x);
        let result = M31.ZERO;
        for (let i = this.coeffs.length - 1; i >= 0; i--) {
            result = result.mul(x).add(this.coeffs[i]);
        }
        return result;
    }

    /**
     * Evaluate polynomial at multiple points
     * @param {M31[]} points - Evaluation points
     * @returns {M31[]} Evaluations
     */
    evaluateMulti(points) {
        return points.map(p => this.evaluate(p));
    }

    /**
     * Add two polynomials
     * @param {Polynomial} other
     * @returns {Polynomial}
     */
    add(other) {
        const maxLen = Math.max(this.coeffs.length, other.coeffs.length);
        const result = [];
        for (let i = 0; i < maxLen; i++) {
            const a = i < this.coeffs.length ? this.coeffs[i] : M31.ZERO;
            const b = i < other.coeffs.length ? other.coeffs[i] : M31.ZERO;
            result.push(a.add(b));
        }
        return new Polynomial(result);
    }

    /**
     * Subtract polynomial
     * @param {Polynomial} other
     * @returns {Polynomial}
     */
    sub(other) {
        const maxLen = Math.max(this.coeffs.length, other.coeffs.length);
        const result = [];
        for (let i = 0; i < maxLen; i++) {
            const a = i < this.coeffs.length ? this.coeffs[i] : M31.ZERO;
            const b = i < other.coeffs.length ? other.coeffs[i] : M31.ZERO;
            result.push(a.sub(b));
        }
        return new Polynomial(result);
    }

    /**
     * Multiply two polynomials (schoolbook O(n^2))
     * @param {Polynomial} other
     * @returns {Polynomial}
     */
    mul(other) {
        if (this.coeffs.length === 1 && this.coeffs[0].isZero()) return Polynomial.zero();
        if (other.coeffs.length === 1 && other.coeffs[0].isZero()) return Polynomial.zero();
        
        const result = new Array(this.coeffs.length + other.coeffs.length - 1).fill(null).map(() => M31.ZERO);
        for (let i = 0; i < this.coeffs.length; i++) {
            for (let j = 0; j < other.coeffs.length; j++) {
                result[i + j] = result[i + j].add(this.coeffs[i].mul(other.coeffs[j]));
            }
        }
        return new Polynomial(result);
    }

    /**
     * Scalar multiplication
     * @param {M31} scalar
     * @returns {Polynomial}
     */
    scale(scalar) {
        scalar = new M31(scalar.value !== undefined ? scalar.value : scalar);
        return new Polynomial(this.coeffs.map(c => c.mul(scalar)));
    }

    /**
     * Split polynomial into even and odd parts:
     * p(x) = p_even(x^2) + x * p_odd(x^2)
     * 
     * This is the core operation for FRI folding.
     * 
     * @returns {{even: Polynomial, odd: Polynomial}}
     */
    splitEvenOdd() {
        const even = [];
        const odd = [];
        for (let i = 0; i < this.coeffs.length; i++) {
            if (i % 2 === 0) {
                even.push(this.coeffs[i]);
            } else {
                odd.push(this.coeffs[i]);
            }
        }
        if (even.length === 0) even.push(M31.ZERO);
        if (odd.length === 0) odd.push(M31.ZERO);
        return {
            even: new Polynomial(even),
            odd: new Polynomial(odd)
        };
    }

    /**
     * FRI fold: given p(x) = p_even(x^2) + x * p_odd(x^2),
     * compute p_folded(x) = p_even(x) + alpha * p_odd(x)
     * 
     * This reduces the degree by half.
     * 
     * @param {M31} alpha - Fiat-Shamir challenge
     * @returns {Polynomial} Folded polynomial of half the degree
     */
    friFold(alpha) {
        const { even, odd } = this.splitEvenOdd();
        return even.add(odd.scale(alpha));
    }

    /**
     * Lagrange interpolation: given (x_i, y_i) pairs, find the unique
     * polynomial p of degree < n such that p(x_i) = y_i.
     * 
     * @param {M31[]} xs - Evaluation points (must be distinct)
     * @param {M31[]} ys - Values at those points
     * @returns {Polynomial} Interpolated polynomial
     */
    static interpolate(xs, ys) {
        if (xs.length !== ys.length) throw new Error('xs and ys must have same length');
        const n = xs.length;
        if (n === 0) return Polynomial.zero();

        // Lagrange basis polynomials
        let result = Polynomial.zero();
        for (let i = 0; i < n; i++) {
            // L_i(x) = product_{j!=i} (x - x_j) / (x_i - x_j)
            let basis = new Polynomial([M31.ONE]);
            let denom = M31.ONE;
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                // Multiply by (x - x_j)
                basis = basis.mul(new Polynomial([xs[j].neg(), M31.ONE]));
                // Accumulate denominator
                denom = denom.mul(xs[i].sub(xs[j]));
            }
            // Scale by y_i / denom
            const scalar = ys[i].mul(denom.inv());
            result = result.add(basis.scale(scalar));
        }
        return result;
    }

    /** @returns {Polynomial} The zero polynomial */
    static zero() {
        return new Polynomial([M31.ZERO]);
    }

    /** @returns {Polynomial} The constant polynomial c */
    static constant(c) {
        return new Polynomial([new M31(c.value !== undefined ? c.value : c)]);
    }
}

/**
 * SHA-256 based Merkle Tree
 * 
 * Used for polynomial commitment:
 * - Build tree over evaluations of a polynomial
 * - Commit to the root hash
 * - Open individual leaves with Merkle inclusion proofs
 * 
 * Leaf hashing: H(0x00 || leaf_data)
 * Node hashing: H(0x01 || left || right)
 */
class MerkleTree {
    /**
     * Build a Merkle tree from leaf data
     * Pads to next power of 2 with zero leaves.
     * 
     * @param {Buffer[]|string[]} leaves - Leaf data (will be hashed)
     */
    constructor(leaves) {
        if (leaves.length === 0) throw new Error('Cannot build empty Merkle tree');

        // Pad to power of 2
        this.leafCount = leaves.length;
        let n = 1;
        while (n < leaves.length) n <<= 1;
        
        // Hash leaves: H(0x00 || data)
        this.hashedLeaves = [];
        for (let i = 0; i < n; i++) {
            if (i < leaves.length) {
                const data = typeof leaves[i] === 'string' ? Buffer.from(leaves[i]) : leaves[i];
                this.hashedLeaves.push(MerkleTree.hashLeaf(data));
            } else {
                this.hashedLeaves.push(MerkleTree.hashLeaf(Buffer.alloc(32, 0)));
            }
        }

        // Build tree bottom-up
        // tree[0] is unused, tree[1] is root, tree[n..2n-1] are leaves
        this.size = n;
        this.tree = new Array(2 * n).fill(null);
        
        // Place leaves
        for (let i = 0; i < n; i++) {
            this.tree[n + i] = this.hashedLeaves[i];
        }

        // Build internal nodes
        for (let i = n - 1; i >= 1; i--) {
            this.tree[i] = MerkleTree.hashNode(this.tree[2 * i], this.tree[2 * i + 1]);
        }
    }

    /**
     * @returns {string} Root hash (hex)
     */
    root() {
        return this.tree[1];
    }

    /**
     * Generate Merkle inclusion proof for leaf at index
     * 
     * @param {number} index - Leaf index (0-based)
     * @returns {{leaf: string, path: Array<{hash: string, position: string}>, root: string}}
     */
    getProof(index) {
        if (index < 0 || index >= this.size) throw new Error(`Index ${index} out of range`);
        
        const path = [];
        let pos = this.size + index; // Position in tree array
        
        while (pos > 1) {
            // Sibling
            const sibling = pos ^ 1;
            path.push({
                hash: this.tree[sibling],
                position: (pos & 1) === 0 ? 'right' : 'left' // Sibling position
            });
            pos >>= 1;
        }

        return {
            leaf: this.hashedLeaves[index],
            index,
            path,
            root: this.root()
        };
    }

    /**
     * Verify a Merkle inclusion proof
     * 
     * @param {string} leafHash - Hash of the leaf
     * @param {number} index - Claimed leaf index
     * @param {Array<{hash: string, position: string}>} path - Merkle path
     * @param {string} root - Expected root
     * @returns {boolean} True if proof is valid
     */
    static verifyProof(leafHash, index, path, root) {
        let current = leafHash;
        
        for (const step of path) {
            if (step.position === 'left') {
                // Sibling is on the left
                current = MerkleTree.hashNode(step.hash, current);
            } else {
                // Sibling is on the right
                current = MerkleTree.hashNode(current, step.hash);
            }
        }

        return current === root;
    }

    /**
     * Hash a leaf: H(0x00 || data)
     * @param {Buffer} data
     * @returns {string} Hex hash
     */
    static hashLeaf(data) {
        return crypto.createHash('sha256')
            .update(Buffer.concat([Buffer.from([0x00]), data]))
            .digest('hex');
    }

    /**
     * Hash an internal node: H(0x01 || left || right)
     * @param {string} left - Left child hash (hex)
     * @param {string} right - Right child hash (hex)
     * @returns {string} Hex hash
     */
    static hashNode(left, right) {
        return crypto.createHash('sha256')
            .update(Buffer.concat([
                Buffer.from([0x01]),
                Buffer.from(left, 'hex'),
                Buffer.from(right, 'hex')
            ]))
            .digest('hex');
    }
}

/**
 * Fiat-Shamir transcript for non-interactive proofs
 * 
 * Absorbs commitments and squeezes deterministic challenges.
 * Uses SHA-256 as the hash function.
 */
class FiatShamirTranscript {
    constructor() {
        this.state = Buffer.alloc(32, 0);
    }

    /**
     * Absorb data into the transcript
     * @param {string|Buffer} data - Data to absorb
     */
    absorb(data) {
        const buf = typeof data === 'string' ? Buffer.from(data, 'hex') : data;
        this.state = crypto.createHash('sha256')
            .update(Buffer.concat([this.state, buf]))
            .digest();
    }

    /**
     * Absorb a string label (for domain separation)
     * @param {string} label
     */
    absorbLabel(label) {
        this.absorb(Buffer.from(label, 'utf8'));
    }

    /**
     * Squeeze a challenge as an M31 field element
     * @returns {M31} Pseudorandom field element
     */
    squeezeM31() {
        this.state = crypto.createHash('sha256')
            .update(Buffer.concat([this.state, Buffer.from([0xFF])]))
            .digest();
        // Read first 4 bytes as uint32, reduce mod prime
        const raw = this.state.readUInt32LE(0);
        return new M31(raw % Number(M31_PRIME));
    }

    /**
     * Squeeze an integer in [0, max)
     * @param {number} max
     * @returns {number}
     */
    squeezeIndex(max) {
        this.state = crypto.createHash('sha256')
            .update(Buffer.concat([this.state, Buffer.from([0xFE])]))
            .digest();
        const raw = this.state.readUInt32LE(0);
        return raw % max;
    }

    /**
     * Clone the transcript state
     * @returns {FiatShamirTranscript}
     */
    clone() {
        const t = new FiatShamirTranscript();
        t.state = Buffer.from(this.state);
        return t;
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
    codeLinesPerHundred: new M31(3),
    documentation: new M31(10),
    testCoveragePercent: new M31(2)
};

/**
 * Compute score from features (same as POA-Scorer)
 * @param {Object} features
 * @returns {M31}
 */
function computeScore(features) {
    const f = new VerificationFeatures(features);
    
    let score = WEIGHTS.baseScore.value;
    score += f.hasGithub.value * WEIGHTS.github.value;
    score += f.hasApiEndpoint.value * WEIGHTS.api.value;
    score += f.capabilityCount.value * WEIGHTS.capability.value;
    score += f.codeLines.value * 3n / 10n;
    score += f.hasDocumentation.value * WEIGHTS.documentation.value;
    score += f.testCoverage.value * 2n / 10n;
    
    if (score > 100n) score = 100n;
    
    return new M31(score);
}

/**
 * Public inputs for the STARK circuit
 */
class PublicInputs {
    constructor({ threshold, commitment, timestamp, expiry }) {
        this.threshold = new M31(threshold || 60);
        this.commitment = commitment;
        this.timestamp = BigInt(timestamp || Math.floor(Date.now() / 1000));
        this.expiry = BigInt(expiry || this.timestamp + 30n * 24n * 60n * 60n);
    }

    toBytes() {
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
    Polynomial,
    MerkleTree,
    FiatShamirTranscript,
    VerificationFeatures,
    WEIGHTS,
    computeScore,
    PublicInputs,
    PrivateWitness
};
