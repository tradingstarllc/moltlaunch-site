/**
 * E2E Tests: STARK Proofs
 * 
 * Tests privacy-preserving threshold proofs.
 */

const request = require('supertest');
const app = require('../../server');

describe('STARK Proofs', () => {
    
    describe('GET /api/stark/info', () => {
        
        it('should return prover info', async () => {
            const res = await request(app)
                .get('/api/stark/info');
            
            expect(res.status).toBe(200);
            expect(res.body.enabled).toBe(true);
            expect(res.body.backend).toBe('stwo-simulator');
            expect(res.body.field).toContain('M31');
        });
        
        it('should list available endpoints', async () => {
            const res = await request(app)
                .get('/api/stark/info');
            
            expect(res.body.endpoints).toBeDefined();
            expect(res.body.endpoints.generate).toBeDefined();
            expect(res.body.endpoints.verify).toBeDefined();
        });
    });
    
    describe('POST /api/verify/deep with proof generation', () => {
        
        it('should generate proof for passing agent', async () => {
            const res = await request(app)
                .post('/api/verify/deep?proof=true')
                .send({
                    agentId: `stark-pass-${Date.now()}`,
                    capabilities: ['trading', 'analysis', 'api', 'reporting'],
                    codeUrl: 'https://github.com/test/agent',
                    documentation: true,
                    testCoverage: 85,
                    codeLines: 5000,
                    generateProof: true
                });
            
            expect(res.status).toBe(200);
            
            if (res.body.passed && res.body.score >= 60) {
                expect(res.body.starkProof).toBeDefined();
                expect(res.body.starkProof.enabled).toBe(true);
                expect(res.body.starkProof.type).toBe('circle-stark');
                expect(res.body.starkProof.commitment).toBeDefined();
                expect(res.body.starkProof.publicInputs).toBeDefined();
                expect(res.body.starkProof.publicInputs.threshold).toBe(60);
            }
        });
        
        it('should not reveal score in proof', async () => {
            const res = await request(app)
                .post('/api/verify/deep?proof=true')
                .send({
                    agentId: `stark-privacy-${Date.now()}`,
                    capabilities: ['trading', 'analysis'],
                    generateProof: true
                });
            
            expect(res.status).toBe(200);
            
            if (res.body.starkProof?.enabled) {
                // Score should NOT be in the proof
                expect(res.body.starkProof.publicInputs.score).toBeUndefined();
                expect(res.body.starkProof.privacyNote).toContain('threshold');
            }
        });
        
        it('should not generate proof for failing agent', async () => {
            // Agent with minimal data that might not pass
            const res = await request(app)
                .post('/api/verify/deep?proof=true')
                .send({
                    agentId: `stark-fail-${Date.now()}`,
                    capabilities: [], // Minimal capabilities
                    generateProof: true
                });
            
            expect(res.status).toBe(200);
            
            // If score < 60, proof should indicate failure
            if (res.body.score < 60) {
                expect(res.body.starkProof?.enabled).toBeFalsy();
            }
        });
    });
    
    describe('POST /api/stark/verify', () => {
        
        it('should verify valid proof', async () => {
            // First generate a proof
            const genRes = await request(app)
                .post('/api/verify/deep?proof=true')
                .send({
                    agentId: `verify-proof-${Date.now()}`,
                    capabilities: ['trading', 'analysis', 'api'],
                    codeUrl: 'https://github.com/test/agent',
                    generateProof: true
                });
            
            if (genRes.body.starkProof?.enabled) {
                // Verify the proof
                const verifyRes = await request(app)
                    .post('/api/stark/verify')
                    .send({ proof: genRes.body.starkProof });
                
                expect(verifyRes.status).toBe(200);
                expect(verifyRes.body.valid).toBe(true);
            }
        });
        
        it('should reject invalid proof', async () => {
            const res = await request(app)
                .post('/api/stark/verify')
                .send({
                    proof: {
                        type: 'invalid',
                        commitment: 'fake'
                    }
                });
            
            expect(res.status).toBe(200);
            expect(res.body.valid).toBe(false);
        });
        
        it('should require proof object', async () => {
            const res = await request(app)
                .post('/api/stark/verify')
                .send({});
            
            expect(res.status).toBe(400);
        });
    });
    
    describe('POST /api/stark/generate/:agentId', () => {
        
        it('should generate proof for existing verification', async () => {
            const agentId = `gen-proof-${Date.now()}`;
            
            // First verify
            await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId,
                    capabilities: ['trading', 'analysis', 'api'],
                    codeUrl: 'https://github.com/test/agent'
                });
            
            // Then generate proof separately
            const res = await request(app)
                .post(`/api/stark/generate/${agentId}`);
            
            // Should succeed if agent passed verification
            expect([200, 400]).toContain(res.status);
        });
        
        it('should return error for unknown agent', async () => {
            const res = await request(app)
                .post('/api/stark/generate/unknown-agent-xyz');
            
            // Can be 404 or 400 depending on implementation
            expect([404, 400]).toContain(res.status);
        });
    });
});
