/**
 * STARK Prover Test Suite
 * 
 * Tests the real polynomial commitment, FRI protocol, and verifiable threshold ZKP.
 * Run: cd stark-prover && node test.js
 */

const {
    MoltLaunchStarkProver,
    generateVerificationProof,
    verifyProof,
    generateConsistencyProof,
    verifyConsistencyProof,
    generateStreakProof,
    generateStabilityProof,
    M31,
    M31_PRIME,
    Polynomial,
    MerkleTree,
    FiatShamirTranscript,
    VerificationCircuit,
    CircuitTrace,
} = require('./index');

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

async function testAsync(name, fn) {
    total++;
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

(async () => {

// ============================================================
// Unit Tests: M31 Field Arithmetic
// ============================================================
console.log('\n🔢 M31 Field Arithmetic');

test('M31 addition', () => {
    const a = new M31(100);
    const b = new M31(200);
    assert(a.add(b).eq(new M31(300)), 'add failed');
});

test('M31 subtraction', () => {
    const a = new M31(100);
    const b = new M31(200);
    const result = a.sub(b); // Should wrap around
    assert(result.eq(new M31(M31_PRIME - 100n)), 'sub failed');
});

test('M31 multiplication', () => {
    const a = new M31(1000);
    const b = new M31(2000);
    assert(a.mul(b).eq(new M31(2000000)), 'mul failed');
});

test('M31 inverse', () => {
    const a = new M31(42);
    const inv = a.inv();
    assert(a.mul(inv).eq(M31.ONE), `42 * inv(42) should be 1, got ${a.mul(inv).toString()}`);
});

test('M31 inverse of large value', () => {
    const a = new M31(M31_PRIME - 1n);
    const inv = a.inv();
    assert(a.mul(inv).eq(M31.ONE), 'inverse of p-1 failed');
});

test('M31 exponentiation', () => {
    const a = new M31(2);
    const result = a.pow(10n);
    assert(result.eq(new M31(1024)), `2^10 should be 1024, got ${result.toString()}`);
});

test('M31 negation', () => {
    const a = new M31(42);
    const neg = a.neg();
    assert(a.add(neg).isZero(), 'a + (-a) should be 0');
});

// ============================================================
// Unit Tests: Polynomial
// ============================================================
console.log('\n📐 Polynomial Operations');

test('Polynomial evaluate constant', () => {
    const p = Polynomial.constant(new M31(42));
    assert(p.evaluate(new M31(100)).eq(new M31(42)), 'constant eval failed');
    assert(p.evaluate(new M31(0)).eq(new M31(42)), 'constant eval at 0 failed');
});

test('Polynomial evaluate linear', () => {
    // p(x) = 3 + 5x
    const p = new Polynomial([new M31(3), new M31(5)]);
    assert(p.evaluate(new M31(0)).eq(new M31(3)), 'p(0) failed');
    assert(p.evaluate(new M31(1)).eq(new M31(8)), 'p(1) failed');
    assert(p.evaluate(new M31(2)).eq(new M31(13)), 'p(2) failed');
});

test('Polynomial addition', () => {
    const p1 = new Polynomial([new M31(1), new M31(2)]); // 1 + 2x
    const p2 = new Polynomial([new M31(3), new M31(4)]); // 3 + 4x
    const sum = p1.add(p2); // 4 + 6x
    assert(sum.evaluate(new M31(1)).eq(new M31(10)), 'add eval at 1 failed');
});

test('Polynomial multiplication', () => {
    const p1 = new Polynomial([new M31(1), new M31(1)]); // 1 + x
    const p2 = new Polynomial([new M31(1), new M31(1)]); // 1 + x
    const prod = p1.mul(p2); // 1 + 2x + x^2
    assert(prod.evaluate(new M31(2)).eq(new M31(9)), '(1+x)^2 at x=2 should be 9');
    assert(prod.degree() === 2, `degree should be 2, got ${prod.degree()}`);
});

test('Polynomial interpolation', () => {
    // Interpolate through (1,5), (2,8), (3,13)
    // These fit p(x) = 1 + x + x^2: p(1)=3, p(2)=7, p(3)=13
    // Actually let's use simple points: y = 2x + 1
    const xs = [new M31(1), new M31(2), new M31(3)];
    const ys = [new M31(3), new M31(5), new M31(7)];
    const p = Polynomial.interpolate(xs, ys);
    assert(p.evaluate(new M31(1)).eq(new M31(3)), 'interp at 1 failed');
    assert(p.evaluate(new M31(2)).eq(new M31(5)), 'interp at 2 failed');
    assert(p.evaluate(new M31(3)).eq(new M31(7)), 'interp at 3 failed');
    // Check at another point: 2*4+1 = 9
    assert(p.evaluate(new M31(4)).eq(new M31(9)), 'interp at 4 failed');
});

test('Polynomial even/odd split', () => {
    // p(x) = 1 + 2x + 3x^2 + 4x^3
    // p_even(x^2) = 1 + 3x^2, p_odd(x^2) = 2 + 4x^2
    // So p_even(y) = 1 + 3y, p_odd(y) = 2 + 4y
    const p = new Polynomial([new M31(1), new M31(2), new M31(3), new M31(4)]);
    const { even, odd } = p.splitEvenOdd();
    assert(even.evaluate(new M31(0)).eq(new M31(1)), 'even(0) failed');
    assert(even.evaluate(new M31(1)).eq(new M31(4)), 'even(1) failed');
    assert(odd.evaluate(new M31(0)).eq(new M31(2)), 'odd(0) failed');
    assert(odd.evaluate(new M31(1)).eq(new M31(6)), 'odd(1) failed');
});

test('Polynomial FRI fold', () => {
    // p(x) = 1 + 2x + 3x^2 + 4x^3
    // fold with alpha=1: p_even + 1*p_odd = (1+3y) + (2+4y) = 3 + 7y
    const p = new Polynomial([new M31(1), new M31(2), new M31(3), new M31(4)]);
    const folded = p.friFold(new M31(1));
    assert(folded.evaluate(new M31(0)).eq(new M31(3)), 'fold(0) failed');
    assert(folded.evaluate(new M31(1)).eq(new M31(10)), 'fold(1) failed');
    assert(folded.degree() <= 1, `folded degree should be <= 1, got ${folded.degree()}`);
});

// ============================================================
// Unit Tests: Merkle Tree
// ============================================================
console.log('\n🌳 Merkle Tree');

test('Merkle tree build and root', () => {
    const leaves = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c'), Buffer.from('d')];
    const tree = new MerkleTree(leaves);
    assert(tree.root().length === 64, 'root should be 64 hex chars');
});

test('Merkle proof verify (valid)', () => {
    const leaves = [Buffer.from('leaf0'), Buffer.from('leaf1'), Buffer.from('leaf2'), Buffer.from('leaf3')];
    const tree = new MerkleTree(leaves);
    
    for (let i = 0; i < 4; i++) {
        const proof = tree.getProof(i);
        const valid = MerkleTree.verifyProof(proof.leaf, proof.index, proof.path, tree.root());
        assert(valid, `proof for leaf ${i} should verify`);
    }
});

test('Merkle proof verify (invalid — wrong leaf)', () => {
    const leaves = [Buffer.from('leaf0'), Buffer.from('leaf1'), Buffer.from('leaf2'), Buffer.from('leaf3')];
    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(0);
    
    // Try to verify with a different leaf hash
    const fakeLeaf = MerkleTree.hashLeaf(Buffer.from('fake'));
    const valid = MerkleTree.verifyProof(fakeLeaf, proof.index, proof.path, tree.root());
    assert(!valid, 'proof with wrong leaf should NOT verify');
});

test('Merkle proof verify (invalid — wrong root)', () => {
    const leaves = [Buffer.from('leaf0'), Buffer.from('leaf1')];
    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(0);
    const valid = MerkleTree.verifyProof(proof.leaf, proof.index, proof.path, 'deadbeef'.repeat(8));
    assert(!valid, 'proof with wrong root should NOT verify');
});

test('Merkle tree padding (non-power-of-2)', () => {
    const leaves = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')];
    const tree = new MerkleTree(leaves);
    assert(tree.root().length === 64, 'padded tree should have valid root');
    // All 3 leaves should have valid proofs
    for (let i = 0; i < 3; i++) {
        const proof = tree.getProof(i);
        assert(MerkleTree.verifyProof(proof.leaf, proof.index, proof.path, tree.root()),
            `padded proof ${i} should verify`);
    }
});

// ============================================================
// Unit Tests: Fiat-Shamir Transcript
// ============================================================
console.log('\n🎲 Fiat-Shamir Transcript');

test('Transcript determinism', () => {
    const t1 = new FiatShamirTranscript();
    const t2 = new FiatShamirTranscript();
    t1.absorbLabel('test');
    t2.absorbLabel('test');
    t1.absorb(Buffer.from('data'));
    t2.absorb(Buffer.from('data'));
    assert(t1.squeezeM31().eq(t2.squeezeM31()), 'same input should give same output');
});

test('Transcript sensitivity', () => {
    const t1 = new FiatShamirTranscript();
    const t2 = new FiatShamirTranscript();
    t1.absorb(Buffer.from('data1'));
    t2.absorb(Buffer.from('data2'));
    assert(!t1.squeezeM31().eq(t2.squeezeM31()), 'different input should give different output');
});

// ============================================================
// Unit Tests: Circuit Trace
// ============================================================
console.log('\n🔌 Circuit Trace');

test('Trace generation for score=78, threshold=60', () => {
    const circuit = VerificationCircuit.fromVerificationData({
        agentId: 'test-agent',
        score: 78,
        features: { hasGithub: true, hasApiEndpoint: true, capabilityCount: 3, codeLines: 500, hasDocumentation: true, testCoverage: 80 },
        threshold: 60
    });
    const trace = new CircuitTrace(circuit);
    const rows = trace.generate(16);
    assertEqual(rows.length, 16, 'should have 16 rows');
    assertEqual(rows[0].length, 18, 'each row should have 18 columns');
    
    // Check first row values
    assert(rows[0][0].eq(new M31(78)), 'col0 should be score=78');
    assert(rows[0][1].eq(new M31(60)), 'col1 should be threshold=60');
    assert(rows[0][2].eq(new M31(18)), 'col2 should be difference=18');
});

test('Trace constraint check passes for valid trace', () => {
    const circuit = VerificationCircuit.fromVerificationData({
        agentId: 'test-agent',
        score: 78,
        features: { hasGithub: true, hasApiEndpoint: true, capabilityCount: 3, codeLines: 500, hasDocumentation: true, testCoverage: 80 },
        threshold: 60
    });
    const trace = new CircuitTrace(circuit);
    trace.generate(16);
    const result = trace.checkConstraints();
    assert(result.valid, `constraints should pass: ${result.failedConstraints.join(', ')}`);
});

test('Trace generation fails for score < threshold', () => {
    const circuit = VerificationCircuit.fromVerificationData({
        agentId: 'test-agent',
        score: 50,
        features: { hasGithub: true, hasApiEndpoint: false },
        threshold: 60
    });
    const trace = new CircuitTrace(circuit);
    let threw = false;
    try {
        trace.generate(16);
    } catch (e) {
        threw = true;
        assert(e.message.includes('below threshold'), `should mention threshold: ${e.message}`);
    }
    assert(threw, 'should throw for score < threshold');
});

// ============================================================
// Integration Tests: Full Proof Generation & Verification
// ============================================================
console.log('\n🔐 Full STARK Proof Generation & Verification');

const defaultFeatures = {
    hasGithub: true,
    hasApiEndpoint: true,
    capabilityCount: 3,
    codeLines: 500,
    hasDocumentation: true,
    testCoverage: 80
};

await testAsync('Test 1: Generate proof for score=78, threshold=60 → should succeed', async () => {
    const result = await generateVerificationProof({
        agentId: 'test-agent-001',
        score: 78,
        features: defaultFeatures,
        threshold: 60,
        validityDays: 30
    });
    assert(result.success === true, `proof generation should succeed: ${JSON.stringify(result)}`);
    assert(result.proof !== undefined, 'should have proof object');
    assert(result.proof.type === 'moltlaunch-stark-lite', `type should be moltlaunch-stark-lite`);
    assert(result.proof.version === '2.0', 'version should be 2.0');
    assert(result.proof.proof.traceCommitment.length === 64, 'trace commitment should be 64 hex chars');
    assert(result.proof.proof.fri.layers.length === 4, 'should have 4 FRI layers');
    assert(result.proof.proof.queries.length === 8, 'should have 8 queries');
    console.log(`    Proof size: ${JSON.stringify(result.proof).length} bytes`);
    console.log(`    FRI layers: ${result.proof.proof.fri.layers.length}`);
    console.log(`    Queries: ${result.proof.proof.queries.length}`);
    console.log(`    Security bits: ~${result.proof.metadata.securityBits}`);
});

await testAsync('Test 2: Verify valid proof → should pass', async () => {
    const result = await generateVerificationProof({
        agentId: 'test-agent-002',
        score: 78,
        features: defaultFeatures,
        threshold: 60,
        validityDays: 30
    });
    assert(result.success, 'proof generation should succeed');

    const verification = await verifyProof(result.proof);
    assert(verification.valid === true, `verification should pass: ${verification.error || ''}`);
    assertEqual(verification.threshold, 60, 'verified threshold should be 60');
    assert(verification.friLayers === 4, 'should report 4 FRI layers');
    assert(verification.numQueries === 8, 'should report 8 queries');
    console.log(`    Verified: ${verification.valid}`);
    console.log(`    Threshold: ${verification.threshold}`);
    console.log(`    Security bits: ${verification.securityBits}`);
});

await testAsync('Test 3: Verify with wrong threshold → should fail', async () => {
    const result = await generateVerificationProof({
        agentId: 'test-agent-003',
        score: 78,
        features: defaultFeatures,
        threshold: 60,
        validityDays: 30
    });
    assert(result.success, 'proof generation should succeed');

    // Tamper with the threshold in public inputs
    const tamperedProof = JSON.parse(JSON.stringify(result.proof));
    tamperedProof.publicInputs.threshold = 50; // Changed from 60 to 50

    const verification = await verifyProof(tamperedProof);
    assert(verification.valid === false, 'verification should FAIL with tampered threshold');
    console.log(`    Correctly rejected: ${verification.error}`);
});

await testAsync('Test 4: Generate proof for score=50, threshold=60 → should fail', async () => {
    const result = await generateVerificationProof({
        agentId: 'test-agent-004',
        score: 50,
        features: { hasGithub: false, hasApiEndpoint: false, capabilityCount: 0 },
        threshold: 60,
        validityDays: 30
    });
    assert(result.success === false, 'proof generation should FAIL for score < threshold');
    assert(result.error !== undefined, 'should have error message');
    console.log(`    Correctly rejected: ${result.error}`);
});

await testAsync('Test 5: Tampered proof data → should fail verification', async () => {
    const result = await generateVerificationProof({
        agentId: 'test-agent-005',
        score: 78,
        features: defaultFeatures,
        threshold: 60,
        validityDays: 30
    });
    assert(result.success, 'proof generation should succeed');

    // Tamper with a Merkle proof
    const tamperedProof = JSON.parse(JSON.stringify(result.proof));
    if (tamperedProof.proof.queries[0].layerOpenings[0].merkleProof[0]) {
        tamperedProof.proof.queries[0].layerOpenings[0].merkleProof[0].hash = 'deadbeef'.repeat(8);
    }

    const verification = await verifyProof(tamperedProof);
    assert(verification.valid === false, 'verification should FAIL with tampered Merkle proof');
    console.log(`    Correctly rejected: ${verification.error}`);
});

await testAsync('Test 6: Tampered FRI commitment → should fail (challenge mismatch)', async () => {
    const result = await generateVerificationProof({
        agentId: 'test-agent-006',
        score: 78,
        features: defaultFeatures,
        threshold: 60,
        validityDays: 30
    });
    assert(result.success, 'proof generation should succeed');

    // Tamper with FRI layer commitment
    const tamperedProof = JSON.parse(JSON.stringify(result.proof));
    tamperedProof.proof.fri.layers[0].commitment = 'abcdef01'.repeat(8);

    const verification = await verifyProof(tamperedProof);
    assert(verification.valid === false, 'verification should FAIL with tampered FRI commitment');
    console.log(`    Correctly rejected: ${verification.error}`);
});

await testAsync('Test 7: Score at exact threshold boundary (score=60, threshold=60)', async () => {
    const result = await generateVerificationProof({
        agentId: 'test-agent-007',
        score: 60,
        features: defaultFeatures,
        threshold: 60,
        validityDays: 30
    });
    assert(result.success === true, 'proof should succeed at exact threshold');

    const verification = await verifyProof(result.proof);
    assert(verification.valid === true, `verification should pass: ${verification.error || ''}`);
    console.log(`    Boundary case passed (score == threshold)`);
});

await testAsync('Test 8: Score just below threshold (score=59, threshold=60)', async () => {
    const result = await generateVerificationProof({
        agentId: 'test-agent-008',
        score: 59,
        features: defaultFeatures,
        threshold: 60,
        validityDays: 30
    });
    assert(result.success === false, 'proof should fail just below threshold');
    console.log(`    Correctly rejected at score=59`);
});

await testAsync('Test 9: Maximum score (score=100, threshold=60)', async () => {
    const result = await generateVerificationProof({
        agentId: 'test-agent-009',
        score: 100,
        features: defaultFeatures,
        threshold: 60,
        validityDays: 30
    });
    assert(result.success === true, 'proof should succeed at max score');

    const verification = await verifyProof(result.proof);
    assert(verification.valid === true, `verification should pass: ${verification.error || ''}`);
    console.log(`    Max score passed`);
});

await testAsync('Test 10: Proof is deterministic (same inputs → same structure)', async () => {
    // Two proofs with same inputs should have same trace commitment
    // (timestamps might differ by a second, so we fix them)
    const data = {
        agentId: 'test-agent-010',
        score: 78,
        features: defaultFeatures,
        threshold: 60,
        validityDays: 30
    };
    const r1 = await generateVerificationProof(data);
    const r2 = await generateVerificationProof(data);
    assert(r1.success && r2.success, 'both should succeed');
    // Trace commitments should be identical (same score data)
    assertEqual(r1.proof.proof.traceCommitment, r2.proof.proof.traceCommitment,
        'trace commitments should be identical for same inputs');
    console.log(`    Deterministic: trace commitments match`);
});

// ============================================================
// Integration Tests: Consistency Proofs
// ============================================================
console.log('\n📊 Consistency Proofs');

await testAsync('Consistency proof: all periods pass', async () => {
    const periods = [];
    const baseTime = Math.floor(Date.now() / 1000) - 7 * 86400;
    for (let i = 0; i < 7; i++) {
        periods.push({ score: 65 + i * 3, timestamp: baseTime + i * 86400 });
    }

    const proof = generateConsistencyProof({
        periods,
        threshold: 60,
        agentId: 'test-consistency-agent'
    });
    assert(proof.valid === true, `consistency proof should be valid: ${proof.error || ''}`);
    assertEqual(proof.periodCount, 7, 'should cover 7 periods');
    assert(proof.proof.traceCommitment.length === 64, 'should have trace commitment');
    assert(proof.proof.fri.commitments.length > 0, 'should have FRI commitments');
    console.log(`    Periods: ${proof.periodCount}`);
    console.log(`    Proof hash: ${proof.proofHash.substring(0, 16)}...`);
});

await testAsync('Consistency proof verification', async () => {
    const periods = [];
    const baseTime = Math.floor(Date.now() / 1000) - 5 * 86400;
    for (let i = 0; i < 5; i++) {
        periods.push({ score: 70, timestamp: baseTime + i * 86400 });
    }

    const proof = generateConsistencyProof({
        periods,
        threshold: 60,
        agentId: 'verify-consistency-agent'
    });
    assert(proof.valid, 'generation should succeed');

    const verification = verifyConsistencyProof(proof);
    assert(verification.valid === true, `verification should pass: ${verification.error || ''}`);
    assertEqual(verification.periodCount, 5, 'should verify 5 periods');
    console.log(`    Verified: ${verification.valid}`);
});

await testAsync('Consistency proof: one period fails', async () => {
    const periods = [
        { score: 70, timestamp: 1000000 },
        { score: 80, timestamp: 1000001 },
        { score: 55, timestamp: 1000002 }, // Below threshold
        { score: 75, timestamp: 1000003 },
    ];

    const proof = generateConsistencyProof({
        periods,
        threshold: 60,
        agentId: 'fail-consistency-agent'
    });
    assert(proof.valid === false, 'should fail when any period is below threshold');
    console.log(`    Correctly rejected: ${proof.error}`);
});

await testAsync('Consistency proof: tampered proof fails verification', async () => {
    const periods = [
        { score: 70, timestamp: 1000000 },
        { score: 80, timestamp: 1000001 },
    ];

    const proof = generateConsistencyProof({
        periods,
        threshold: 60,
        agentId: 'tamper-consistency'
    });
    assert(proof.valid, 'generation should succeed');

    // Tamper with the proof
    proof.proofHash = 'deadbeef'.repeat(8);
    const verification = verifyConsistencyProof(proof);
    assert(verification.valid === false, 'tampered proof should fail');
    console.log(`    Correctly rejected: ${verification.error}`);
});

// ============================================================
// Integration Tests: Streak Proofs
// ============================================================
console.log('\n🔥 Streak Proofs');

await testAsync('Streak proof: meets minimum streak', async () => {
    const periods = [
        { score: 70, timestamp: 1000000 },
        { score: 75, timestamp: 1000001 },
        { score: 80, timestamp: 1000002 },
        { score: 65, timestamp: 1000003 },
        { score: 72, timestamp: 1000004 },
    ];

    const proof = generateStreakProof({
        periods,
        threshold: 60,
        agentId: 'streak-agent',
        minStreak: 3
    });
    assert(proof.valid === true, 'streak proof should be valid');
    assertEqual(proof.claimedStreak, 3);
    console.log(`    Streak proof valid, claimed=${proof.claimedStreak}`);
});

await testAsync('Streak proof: does not meet minimum', async () => {
    const periods = [
        { score: 70, timestamp: 1000000 },
        { score: 50, timestamp: 1000001 }, // Break
        { score: 80, timestamp: 1000002 },
        { score: 50, timestamp: 1000003 }, // Break
    ];

    const proof = generateStreakProof({
        periods,
        threshold: 60,
        agentId: 'streak-fail-agent',
        minStreak: 3
    });
    assert(proof.valid === false, 'should fail with insufficient streak');
    console.log(`    Correctly rejected: ${proof.error}`);
});

// ============================================================
// Integration Tests: Stability Proofs
// ============================================================
console.log('\n📈 Stability Proofs');

await testAsync('Stability proof: low variance', async () => {
    const periods = [
        { score: 70, timestamp: 1000000 },
        { score: 72, timestamp: 1000001 },
        { score: 71, timestamp: 1000002 },
        { score: 69, timestamp: 1000003 },
    ];

    const proof = generateStabilityProof({
        periods,
        maxVariance: 10,
        agentId: 'stable-agent'
    });
    assert(proof.valid === true, 'should be stable');
    assert(proof.proof.scoreCommitment.length === 64, 'should have score commitment');
    console.log(`    Stable: variance within threshold`);
});

await testAsync('Stability proof: high variance', async () => {
    const periods = [
        { score: 30, timestamp: 1000000 },
        { score: 90, timestamp: 1000001 },
        { score: 40, timestamp: 1000002 },
        { score: 85, timestamp: 1000003 },
    ];

    const proof = generateStabilityProof({
        periods,
        maxVariance: 10,
        agentId: 'volatile-agent'
    });
    assert(proof.valid === false, 'should be unstable');
    console.log(`    Correctly identified as volatile`);
});

// ============================================================
// API Tests
// ============================================================
console.log('\n📦 API Tests');

test('MoltLaunchStarkProver.getInfo()', () => {
    const prover = new MoltLaunchStarkProver();
    const info = prover.getInfo();
    assertEqual(info.name, 'moltlaunch-stark-lite');
    assertEqual(info.version, '2.0.0');
    assert(info.proofSystem.lowDegreeTest.includes('FRI'), 'should mention FRI');
    assert(info.parameters.friLayers === 4, 'should have 4 FRI layers');
    assert(info.parameters.numQueries === 8, 'should have 8 queries');
    console.log(`    Name: ${info.name}`);
    console.log(`    Security: ${info.parameters.securityBits}`);
});

test('MoltLaunchStarkProver.wouldPass()', () => {
    const prover = new MoltLaunchStarkProver();
    assert(prover.wouldPass(78, 60) === true, '78 >= 60');
    assert(prover.wouldPass(60, 60) === true, '60 >= 60');
    assert(prover.wouldPass(59, 60) === false, '59 < 60');
    assert(prover.wouldPass(0, 60) === false, '0 < 60');
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
if (failed === 0) {
    console.log('🎉 All tests passed!');
} else {
    console.log(`💥 ${failed} test(s) failed`);
    process.exit(1);
}

})().catch(e => { console.error(e); process.exit(1); });
