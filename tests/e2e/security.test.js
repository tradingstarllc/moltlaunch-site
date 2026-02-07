/**
 * E2E Tests: Security Features
 * 
 * Tests nonce, timestamp, and replay protection.
 */

const request = require('supertest');
const crypto = require('crypto');
const app = require('../../server');

const generateNonce = () => crypto.randomBytes(16).toString('hex');

describe('Security Features', () => {
    
    describe('Timestamp Validation', () => {
        
        it('should accept timestamp within ±60 seconds', async () => {
            const res = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `ts-valid-${Date.now()}`,
                    nonce: generateNonce(),
                    timestamp: Math.floor(Date.now() / 1000),
                    capabilities: ['trading']
                });
            
            expect(res.status).toBe(200);
        });
        
        it('should reject timestamp too far in past', async () => {
            const res = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `ts-past-${Date.now()}`,
                    nonce: generateNonce(),
                    timestamp: Math.floor(Date.now() / 1000) - 120, // 2 minutes ago
                    capabilities: ['trading']
                });
            
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/timestamp/i);
        });
        
        it('should reject timestamp too far in future', async () => {
            const res = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `ts-future-${Date.now()}`,
                    nonce: generateNonce(),
                    timestamp: Math.floor(Date.now() / 1000) + 120, // 2 minutes ahead
                    capabilities: ['trading']
                });
            
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/timestamp/i);
        });
    });
    
    describe('Nonce Replay Protection', () => {
        
        it('should reject duplicate nonce', async () => {
            const nonce = generateNonce();
            const timestamp = Math.floor(Date.now() / 1000);
            
            // First request should succeed
            const first = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `nonce-1-${Date.now()}`,
                    nonce,
                    timestamp,
                    capabilities: ['trading']
                });
            
            expect(first.status).toBe(200);
            
            // Second request with same nonce should fail
            const second = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `nonce-2-${Date.now()}`,
                    nonce, // Same nonce
                    timestamp,
                    capabilities: ['trading']
                });
            
            expect(second.status).toBe(400);
            expect(second.body.error).toMatch(/nonce/i);
        });
        
        it('should accept different nonces', async () => {
            const timestamp = Math.floor(Date.now() / 1000);
            
            const first = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `diff-nonce-1-${Date.now()}`,
                    nonce: generateNonce(),
                    timestamp,
                    capabilities: ['trading']
                });
            
            const second = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `diff-nonce-2-${Date.now()}`,
                    nonce: generateNonce(), // Different nonce
                    timestamp,
                    capabilities: ['trading']
                });
            
            expect(first.status).toBe(200);
            expect(second.status).toBe(200);
        });
    });
    
    describe('Attestation Revocation', () => {
        
        it('should check revocation status', async () => {
            const res = await request(app)
                .get('/api/verify/revoked/somehash123');
            
            expect(res.status).toBe(200);
            expect(res.body.revoked).toBeDefined();
        });
        
        it('should revoke attestation', async () => {
            // First verify an agent
            const agentId = `revoke-test-${Date.now()}`;
            const verifyRes = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId,
                    capabilities: ['trading']
                });
            
            const attestationHash = verifyRes.body.attestation?.hash;
            
            if (attestationHash) {
                // Revoke it
                const revokeRes = await request(app)
                    .post('/api/verify/revoke')
                    .send({
                        attestationHash,
                        reason: 'Test revocation'
                    });
                
                expect(revokeRes.status).toBe(200);
                expect(revokeRes.body.revoked).toBe(true);
                
                // Check revocation status
                const checkRes = await request(app)
                    .get(`/api/verify/revoked/${attestationHash}`);
                
                expect(checkRes.body.revoked).toBe(true);
            }
        });
    });
    
    describe('Backward Compatibility', () => {
        
        it('should work without nonce/timestamp (insecure mode)', async () => {
            const res = await request(app)
                .post('/api/verify/deep')
                .send({
                    agentId: `compat-test-${Date.now()}`,
                    capabilities: ['trading']
                    // No nonce or timestamp
                });
            
            expect(res.status).toBe(200);
            expect(res.body.security?.secureMode).toBe(false);
        });
    });
});
