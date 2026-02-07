/**
 * E2E Tests: Execution Traces
 * 
 * Tests behavioral scoring from execution history.
 */

const request = require('supertest');
const app = require('../../server');

describe('Execution Traces', () => {
    
    describe('GET /api/traces/info', () => {
        
        it('should return traces module info', async () => {
            const res = await request(app)
                .get('/api/traces/info');
            
            expect(res.status).toBe(200);
            expect(res.body.enabled).toBe(true);
            expect(res.body.version).toBe('1.0');
            expect(res.body.scoring).toBeDefined();
        });
        
        it('should list scoring breakdown', async () => {
            const res = await request(app)
                .get('/api/traces/info');
            
            expect(res.body.scoring.hasTraces).toBeDefined();
            expect(res.body.scoring.verified).toBeDefined();
            expect(res.body.scoring.history7d).toBeDefined();
            expect(res.body.scoring.maximum).toContain('25');
        });
    });
    
    describe('POST /api/traces', () => {
        
        it('should submit trace and return behavioral score', async () => {
            const res = await request(app)
                .post('/api/traces')
                .send({
                    agentId: `trace-submit-${Date.now()}`,
                    trace: {
                        period: {
                            start: '2026-01-01T00:00:00Z',
                            end: '2026-02-07T00:00:00Z'
                        },
                        summary: {
                            totalActions: 1500,
                            successRate: 0.95,
                            errorRate: 0.02,
                            avgResponseTime: 200
                        }
                    }
                });
            
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.traceId).toBeDefined();
            expect(res.body.traceId).toMatch(/^tr_/);
            expect(res.body.behavioralScore).toBeGreaterThan(0);
            expect(res.body.breakdown).toBeDefined();
        });
        
        it('should give 7d bonus for week+ history', async () => {
            const res = await request(app)
                .post('/api/traces')
                .send({
                    agentId: `trace-7d-${Date.now()}`,
                    trace: {
                        period: {
                            start: '2026-01-01T00:00:00Z', // 37+ days ago
                            end: '2026-02-07T00:00:00Z'
                        },
                        summary: {
                            totalActions: 100,
                            successRate: 0.90
                        }
                    }
                });
            
            expect(res.status).toBe(200);
            expect(res.body.breakdown.history7d).toBe(5);
        });
        
        it('should give success rate bonus for >90%', async () => {
            const res = await request(app)
                .post('/api/traces')
                .send({
                    agentId: `trace-success-${Date.now()}`,
                    trace: {
                        period: { start: '2026-02-01', end: '2026-02-07' },
                        summary: {
                            totalActions: 100,
                            successRate: 0.95 // >90%
                        }
                    }
                });
            
            expect(res.status).toBe(200);
            expect(res.body.breakdown.successRate).toBe(3);
        });
        
        it('should give low error bonus for <5%', async () => {
            const res = await request(app)
                .post('/api/traces')
                .send({
                    agentId: `trace-errors-${Date.now()}`,
                    trace: {
                        period: { start: '2026-02-01', end: '2026-02-07' },
                        summary: {
                            totalActions: 100,
                            successRate: 0.90,
                            errorRate: 0.02 // <5%
                        }
                    }
                });
            
            expect(res.status).toBe(200);
            expect(res.body.breakdown.lowErrors).toBe(2);
        });
        
        it('should require agentId', async () => {
            const res = await request(app)
                .post('/api/traces')
                .send({
                    trace: { period: { start: '2026-02-01', end: '2026-02-07' } }
                });
            
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/agentId/i);
        });
        
        it('should require trace object', async () => {
            const res = await request(app)
                .post('/api/traces')
                .send({
                    agentId: 'test'
                });
            
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/trace/i);
        });
    });
    
    describe('GET /api/traces/:agentId', () => {
        
        it('should list traces for agent', async () => {
            const agentId = `trace-list-${Date.now()}`;
            
            // Submit a trace first
            await request(app)
                .post('/api/traces')
                .send({
                    agentId,
                    trace: {
                        period: { start: '2026-02-01', end: '2026-02-07' },
                        summary: { totalActions: 100 }
                    }
                });
            
            // List traces
            const res = await request(app)
                .get(`/api/traces/${agentId}`);
            
            expect(res.status).toBe(200);
            expect(res.body.agentId).toBe(agentId);
            expect(res.body.traces).toBeInstanceOf(Array);
            expect(res.body.traces.length).toBeGreaterThan(0);
            expect(res.body.count).toBeGreaterThan(0);
        });
        
        it('should return empty array for unknown agent', async () => {
            const res = await request(app)
                .get('/api/traces/unknown-agent-xyz');
            
            expect(res.status).toBe(200);
            expect(res.body.traces).toEqual([]);
            expect(res.body.count).toBe(0);
        });
    });
    
    describe('GET /api/traces/:agentId/score', () => {
        
        it('should return aggregate behavioral score', async () => {
            const agentId = `trace-score-${Date.now()}`;
            
            // Submit trace
            await request(app)
                .post('/api/traces')
                .send({
                    agentId,
                    trace: {
                        period: { start: '2026-01-01', end: '2026-02-07' },
                        summary: {
                            totalActions: 2000,
                            successRate: 0.96,
                            errorRate: 0.01
                        }
                    }
                });
            
            // Get score
            const res = await request(app)
                .get(`/api/traces/${agentId}/score`);
            
            expect(res.status).toBe(200);
            expect(res.body.agentId).toBe(agentId);
            expect(res.body.behavioralScore).toBeGreaterThan(0);
            expect(res.body.breakdown).toBeDefined();
            expect(res.body.traceCount).toBeGreaterThan(0);
        });
    });
    
    describe('POST /api/traces/:traceId/anchor', () => {
        
        it('should anchor trace with tx hash', async () => {
            // Submit trace
            const submitRes = await request(app)
                .post('/api/traces')
                .send({
                    agentId: `trace-anchor-${Date.now()}`,
                    trace: {
                        period: { start: '2026-02-01', end: '2026-02-07' },
                        summary: { totalActions: 100 }
                    }
                });
            
            const traceId = submitRes.body.traceId;
            
            // Anchor it
            const anchorRes = await request(app)
                .post(`/api/traces/${traceId}/anchor`)
                .send({
                    txHash: '5XfakeTransactionHash123456789'
                });
            
            expect(anchorRes.status).toBe(200);
            expect(anchorRes.body.success).toBe(true);
            expect(anchorRes.body.anchoredAt).toBeDefined();
        });
        
        it('should require txHash', async () => {
            const res = await request(app)
                .post('/api/traces/tr_fake123/anchor')
                .send({});
            
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/txHash/i);
        });
    });
});
