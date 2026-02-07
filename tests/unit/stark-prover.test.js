/**
 * Unit Tests: STARK Prover Module
 * 
 * Tests the stark-prover module in isolation.
 */

const {
    M31,
    computeScore,
    MoltLaunchStarkProver,
    VerificationCircuit,
    generateVerificationProof,
    verifyProof
} = require('../../stark-prover');

describe('STARK Prover Module', () => {
    
    describe('M31 Field Arithmetic', () => {
        
        it('should create M31 element', () => {
            const a = new M31(100);
            expect(a.value).toBe(100n);
            expect(a.toNumber()).toBe(100);
        });
        
        it('should add M31 elements', () => {
            const a = new M31(100);
            const b = new M31(50);
            const c = a.add(b);
            expect(c.toNumber()).toBe(150);
        });
        
        it('should multiply M31 elements', () => {
            const a = new M31(10);
            const b = new M31(5);
            const c = a.mul(b);
            expect(c.toNumber()).toBe(50);
        });
        
        it('should reduce modulo M31 prime', () => {
            const prime = 2147483647n; // 2^31 - 1
            const a = new M31(Number(prime + 10n));
            expect(a.value).toBe(10n);
        });
        
        it('should compare M31 elements', () => {
            const a = new M31(100);
            const b = new M31(100);
            const c = new M31(50);
            expect(a.eq(b)).toBe(true);
            expect(a.eq(c)).toBe(false);
            expect(a.gte(c)).toBe(true);
        });
    });
    
    describe('Score Computation', () => {
        
        it('should compute score from features', () => {
            const features = {
                hasGithub: true,
                hasApiEndpoint: true,
                capabilityCount: 3,
                codeLines: 5000,
                hasDocumentation: true,
                testCoverage: 80
            };
            
            const score = computeScore(features);
            expect(score.toNumber()).toBeGreaterThan(0);
            expect(score.toNumber()).toBeLessThanOrEqual(100);
        });
        
        it('should give higher score for more features', () => {
            const minimal = computeScore({
                hasGithub: false,
                hasApiEndpoint: false,
                capabilityCount: 0,
                codeLines: 0,
                hasDocumentation: false,
                testCoverage: 0
            });
            
            const full = computeScore({
                hasGithub: true,
                hasApiEndpoint: true,
                capabilityCount: 5,
                codeLines: 10000,
                hasDocumentation: true,
                testCoverage: 100
            });
            
            expect(full.toNumber()).toBeGreaterThan(minimal.toNumber());
        });
        
        it('should cap score at 100', () => {
            const score = computeScore({
                hasGithub: true,
                hasApiEndpoint: true,
                capabilityCount: 10,
                codeLines: 50000,
                hasDocumentation: true,
                testCoverage: 100
            });
            
            expect(score.toNumber()).toBeLessThanOrEqual(100);
        });
    });
    
    describe('VerificationCircuit', () => {
        
        it('should create circuit from verification data', () => {
            const circuit = VerificationCircuit.fromVerificationData({
                agentId: 'test-agent',
                score: 75,
                features: {
                    hasGithub: true,
                    hasApiEndpoint: true,
                    capabilityCount: 3
                },
                threshold: 60,
                validityDays: 30
            });
            
            expect(circuit).toBeDefined();
            expect(circuit.public).toBeDefined();
            expect(circuit.private).toBeDefined();
        });
        
        it('should evaluate constraints', () => {
            const circuit = VerificationCircuit.fromVerificationData({
                agentId: 'test-agent',
                score: 75,
                features: {},
                threshold: 60,
                validityDays: 30
            });
            
            const result = circuit.evaluate();
            expect(result).toBeDefined();
            expect(result.constraints).toBeInstanceOf(Array);
        });
    });
    
    describe('MoltLaunchStarkProver', () => {
        let prover;
        
        beforeAll(() => {
            prover = new MoltLaunchStarkProver();
        });
        
        it('should return prover info', () => {
            const info = prover.getInfo();
            expect(info.name).toBe('moltlaunch-stark-prover');
            expect(info.version).toBe('1.0.0');
            expect(info.backend).toBe('stwo-simulator');
            expect(info.field).toContain('M31');
        });
        
        it('should check if score would pass', () => {
            expect(prover.wouldPass(75, 60)).toBe(true);
            expect(prover.wouldPass(50, 60)).toBe(false);
            expect(prover.wouldPass(60, 60)).toBe(true);
        });
        
        it('should generate proof for passing score', async () => {
            const result = await prover.generateProof({
                agentId: 'test-agent',
                score: 80,
                features: {},
                threshold: 60,
                validityDays: 30
            });
            
            expect(result.success).toBe(true);
            expect(result.proof).toBeDefined();
            expect(result.proof.type).toBe('circle-stark');
            expect(result.commitment).toBeDefined();
        });
        
        it('should not generate proof for failing score', async () => {
            const result = await prover.generateProof({
                agentId: 'test-agent',
                score: 40,
                features: {},
                threshold: 60,
                validityDays: 30
            });
            
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
        
        it('should verify valid proof', async () => {
            const genResult = await prover.generateProof({
                agentId: 'verify-test',
                score: 85,
                features: {},
                threshold: 60,
                validityDays: 30
            });
            
            expect(genResult.success).toBe(true);
            
            const verifyResult = await prover.verifyProof(genResult.proof);
            expect(verifyResult.valid).toBe(true);
        });
        
        it('should reject invalid proof type', async () => {
            const result = await prover.verifyProof({
                type: 'invalid',
                commitment: 'fake'
            });
            
            expect(result.valid).toBe(false);
        });
    });
    
    describe('Proof Generation', () => {
        
        it('should include public inputs in proof', async () => {
            const result = await generateVerificationProof({
                agentId: 'public-inputs-test',
                score: 78,
                features: {},
                threshold: 60,
                validityDays: 30
            });
            
            expect(result.success).toBe(true);
            expect(result.publicInputs).toBeDefined();
            expect(result.publicInputs.threshold).toBe(60);
            expect(result.publicInputs.expiry).toBeDefined();
        });
        
        it('should not reveal score in proof', async () => {
            const result = await generateVerificationProof({
                agentId: 'privacy-test',
                score: 92,
                features: {},
                threshold: 60,
                validityDays: 30
            });
            
            expect(result.success).toBe(true);
            // Score should NOT be in public inputs
            expect(result.publicInputs.score).toBeUndefined();
        });
    });
});
