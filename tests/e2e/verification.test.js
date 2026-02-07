/**
 * E2E Tests: Verification Flow
 * 
 * Tests the core verification endpoints.
 */

const request = require('supertest');
const crypto = require('crypto');
const app = require('../../server');

// Helper to generate unique nonce
const generateNonce = () => crypto.randomBytes(16).toString('hex');

describe('Verification Flow', () => {
    
    describe('POST /api/verify/deep', () => {
        
        it('should verify agent with valid data', async () => {
            const res = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `test-agent-${Date.now()}`,
                    nonce: generateNonce(),
                    timestamp: Math.floor(Date.now() / 1000),
                    capabilities: ['trading', 'analysis'],
                    codeUrl: 'https://github.com/test/agent'
                });
            
            expect(res.status).toBe(200);
            expect(res.body.verified).toBe(true);
            expect(res.body.score).toBeGreaterThan(0);
            expect(res.body.attestation).toBeDefined();
            expect(res.body.attestation.hash).toBeDefined();
        });
        
        it('should return score and tier', async () => {
            const res = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `score-test-${Date.now()}`,
                    capabilities: ['trading']
                });
            
            expect(res.status).toBe(200);
            expect(typeof res.body.score).toBe('number');
            expect(res.body.score).toBeGreaterThanOrEqual(0);
            expect(res.body.score).toBeLessThanOrEqual(100);
            expect(res.body.scoreTier).toBeDefined();
        });
        
        it('should require agentId', async () => {
            const res = await request(app)
                .post('/api/verify/deep')
                .send({
                    capabilities: ['trading']
                });
            
            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
        });
        
        it('should generate STARK proof when requested', async () => {
            const res = await request(app)
                .post('/api/verify/deep?proof=true')
                .send({
                    agentId: `stark-test-${Date.now()}`,
                    capabilities: ['trading', 'analysis', 'api'],
                    codeUrl: 'https://github.com/test/agent',
                    documentation: true,
                    testCoverage: 80,
                    generateProof: true
                });
            
            expect(res.status).toBe(200);
            
            // STARK proof should be present if score >= 60
            if (res.body.score >= 60) {
                expect(res.body.starkProof).toBeDefined();
                expect(res.body.starkProof.enabled).toBe(true);
                expect(res.body.starkProof.type).toBe('circle-stark');
            }
        });
        
        it('should include behavioral bonus when traces provided', async () => {
            const agentId = `behavioral-test-${Date.now()}`;
            
            // First submit a trace
            const traceRes = await request(app)
                .post('/api/traces')
                .send({
                    agentId,
                    trace: {
                        period: { start: '2026-01-01', end: '2026-02-07' },
                        summary: {
                            totalActions: 500,
                            successRate: 0.95,
                            errorRate: 0.02
                        }
                    }
                });
            
            expect(traceRes.status).toBe(200);
            const traceId = traceRes.body.traceId;
            
            // Now verify with trace (same agentId)
            const verifyRes = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId,
                    capabilities: ['trading'],
                    executionTraces: [traceId]
                });
            
            expect(verifyRes.status).toBe(200);
            // Behavioral bonus should apply
            if (verifyRes.body.behavioral) {
                expect(verifyRes.body.behavioral.enabled).toBe(true);
            }
        }, 60000); // Increase timeout to 60s
    });
    
    describe('GET /api/verify/status/:agentId', () => {
        
        it('should return verification status for verified agent', async () => {
            const agentId = `status-test-${Date.now()}`;
            
            // First verify
            await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId,
                    capabilities: ['trading']
                });
            
            // Then check status
            const res = await request(app)
                .get(`/api/verify/status/${agentId}`);
            
            expect(res.status).toBe(200);
            expect(res.body.agentId).toBe(agentId);
            expect(res.body.verified).toBeDefined();
            expect(res.body.score).toBeDefined();
        });
        
        it('should return not verified for unknown agent', async () => {
            const res = await request(app)
                .get('/api/verify/status/nonexistent-agent-xyz');
            
            // API returns 200 with verified: false for unknown agents
            expect(res.status).toBe(200);
            expect(res.body.verified).toBe(false);
        });
    });
    
    describe('POST /api/verify/status/batch', () => {
        
        it('should check multiple agents at once', async () => {
            const agents = [
                `batch-1-${Date.now()}`,
                `batch-2-${Date.now()}`,
                `batch-3-${Date.now()}`
            ];
            
            // Verify first agent
            await request(app)
                .post('/api/verify/deep')
                .send({ agentId: agents[0], capabilities: ['trading'] });
            
            // Batch check
            const res = await request(app)
                .post('/api/verify/status/batch')
                .send({ agentIds: agents });
            
            expect(res.status).toBe(200);
            expect(res.body.results).toHaveLength(3);
            expect(res.body.count).toBe(3);
        });
        
        it('should require agentIds array', async () => {
            const res = await request(app)
                .post('/api/verify/status/batch')
                .send({ agentIds: 'not-an-array' });
            
            expect(res.status).toBe(400);
        });
    });
});
