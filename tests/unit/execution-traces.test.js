/**
 * Unit Tests: Execution Traces Module
 * 
 * Tests the execution-traces module in isolation.
 */

const {
    submitTrace,
    getTraces,
    getTrace,
    getAgentBehavioralScore,
    anchorTrace,
    verifyActionProof,
    computeCommitment,
    calculateBehavioralScore
} = require('../../execution-traces');

describe('Execution Traces Module', () => {
    
    describe('submitTrace', () => {
        
        it('should submit trace and return traceId', () => {
            const result = submitTrace(`agent-${Date.now()}`, {
                period: { start: '2026-01-01', end: '2026-02-07' },
                summary: { totalActions: 100 }
            });
            
            expect(result.success).toBe(true);
            expect(result.traceId).toBeDefined();
            expect(result.traceId).toMatch(/^tr_/);
        });
        
        it('should compute commitment', () => {
            const result = submitTrace(`agent-commit-${Date.now()}`, {
                period: { start: '2026-01-01', end: '2026-02-07' },
                summary: { totalActions: 100 }
            });
            
            expect(result.commitment).toBeDefined();
            expect(result.commitment.length).toBe(64); // SHA256 hex
        });
        
        it('should calculate behavioral score', () => {
            const result = submitTrace(`agent-score-${Date.now()}`, {
                period: { start: '2026-01-01', end: '2026-02-07' },
                summary: {
                    totalActions: 500,
                    successRate: 0.95,
                    errorRate: 0.02
                }
            });
            
            expect(result.behavioralScore).toBeGreaterThan(0);
            expect(result.breakdown).toBeDefined();
        });
    });
    
    describe('calculateBehavioralScore', () => {
        
        it('should give +5 for having traces', () => {
            const { breakdown } = calculateBehavioralScore({
                period: { start: '2026-02-01', end: '2026-02-07' },
                summary: {}
            });
            
            expect(breakdown.hasTraces).toBe(5);
        });
        
        it('should give +5 for 7+ day history', () => {
            const { breakdown } = calculateBehavioralScore({
                period: { start: '2026-01-01', end: '2026-02-07' }, // 37 days
                summary: {}
            });
            
            expect(breakdown.history7d).toBe(5);
        });
        
        it('should not give 7d bonus for short history', () => {
            const { breakdown } = calculateBehavioralScore({
                period: { start: '2026-02-05', end: '2026-02-07' }, // 2 days
                summary: {}
            });
            
            expect(breakdown.history7d).toBe(0);
        });
        
        it('should give +3 for success rate > 90%', () => {
            const { breakdown } = calculateBehavioralScore({
                period: { start: '2026-02-01', end: '2026-02-07' },
                summary: { successRate: 0.95 }
            });
            
            expect(breakdown.successRate).toBe(3);
        });
        
        it('should not give success bonus for rate <= 90%', () => {
            const { breakdown } = calculateBehavioralScore({
                period: { start: '2026-02-01', end: '2026-02-07' },
                summary: { successRate: 0.85 }
            });
            
            expect(breakdown.successRate).toBe(0);
        });
        
        it('should give +2 for error rate < 5%', () => {
            const { breakdown } = calculateBehavioralScore({
                period: { start: '2026-02-01', end: '2026-02-07' },
                summary: { errorRate: 0.02 }
            });
            
            expect(breakdown.lowErrors).toBe(2);
        });
        
        it('should give +5 for uptime (100+ actions)', () => {
            const { breakdown } = calculateBehavioralScore({
                period: { start: '2026-02-01', end: '2026-02-07' },
                summary: { totalActions: 500 }
            });
            
            expect(breakdown.uptime).toBe(5);
        });
        
        it('should give +5 for verified (anchored) trace', () => {
            const { breakdown } = calculateBehavioralScore({
                period: { start: '2026-02-01', end: '2026-02-07' },
                summary: {},
                anchoredAt: new Date().toISOString()
            });
            
            expect(breakdown.verified).toBe(5);
        });
        
        it('should cap total at 25', () => {
            const { total } = calculateBehavioralScore({
                period: { start: '2026-01-01', end: '2026-02-07' },
                summary: {
                    totalActions: 1000,
                    successRate: 0.99,
                    errorRate: 0.001
                },
                anchoredAt: new Date().toISOString()
            });
            
            expect(total).toBeLessThanOrEqual(25);
        });
    });
    
    describe('getTraces', () => {
        
        it('should return empty array for unknown agent', () => {
            const traces = getTraces('unknown-agent-xyz');
            expect(traces).toEqual([]);
        });
        
        it('should return traces for known agent', () => {
            const agentId = `traces-list-${Date.now()}`;
            submitTrace(agentId, {
                period: { start: '2026-02-01', end: '2026-02-07' },
                summary: { totalActions: 100 }
            });
            
            const traces = getTraces(agentId);
            expect(traces.length).toBe(1);
            expect(traces[0].traceId).toBeDefined();
        });
    });
    
    describe('getAgentBehavioralScore', () => {
        
        it('should return 0 for agent with no traces', () => {
            const result = getAgentBehavioralScore('no-traces-agent');
            expect(result.total).toBe(0);
            expect(result.traceCount).toBe(0);
        });
        
        it('should aggregate score from multiple traces', () => {
            const agentId = `multi-trace-${Date.now()}`;
            
            submitTrace(agentId, {
                period: { start: '2026-01-01', end: '2026-01-15' },
                summary: { totalActions: 200, successRate: 0.95 }
            });
            
            submitTrace(agentId, {
                period: { start: '2026-01-15', end: '2026-02-07' },
                summary: { totalActions: 300, successRate: 0.96 }
            });
            
            const result = getAgentBehavioralScore(agentId);
            expect(result.traceCount).toBe(2);
            expect(result.total).toBeGreaterThan(0);
        });
    });
    
    describe('anchorTrace', () => {
        
        it('should anchor trace with txHash', () => {
            const agentId = `anchor-test-${Date.now()}`;
            const { traceId } = submitTrace(agentId, {
                period: { start: '2026-02-01', end: '2026-02-07' },
                summary: {}
            });
            
            const result = anchorTrace(traceId, 'txhash123');
            expect(result.success).toBe(true);
            expect(result.anchoredAt).toBeDefined();
        });
        
        it('should fail for unknown trace', () => {
            const result = anchorTrace('tr_unknown', 'txhash123');
            expect(result.success).toBe(false);
        });
    });
    
    describe('verifyActionProof', () => {
        
        it('should verify action in trace', () => {
            const agentId = `action-proof-${Date.now()}`;
            const { traceId } = submitTrace(agentId, {
                period: { start: '2026-02-01', end: '2026-02-07' },
                summary: {},
                actions: [
                    { timestamp: '2026-02-01', type: 'trade', success: true }
                ]
            });
            
            const result = verifyActionProof(traceId, 0, []);
            expect(result.valid).toBe(true);
            expect(result.traceId).toBe(traceId);
        });
        
        it('should fail for unknown trace', () => {
            const result = verifyActionProof('tr_unknown', 0, []);
            expect(result.valid).toBe(false);
        });
    });
    
    describe('computeCommitment', () => {
        
        it('should produce deterministic commitment', () => {
            const trace = {
                agentId: 'commit-test',
                summary: { totalActions: 100 },
                actions: []
            };
            
            const commit1 = computeCommitment(trace);
            const commit2 = computeCommitment(trace);
            
            expect(commit1).toBe(commit2);
        });
        
        it('should produce different commitment for different data', () => {
            const trace1 = {
                agentId: 'commit-test-1',
                summary: { totalActions: 100 },
                actions: []
            };
            
            const trace2 = {
                agentId: 'commit-test-2',
                summary: { totalActions: 200 },
                actions: []
            };
            
            const commit1 = computeCommitment(trace1);
            const commit2 = computeCommitment(trace2);
            
            expect(commit1).not.toBe(commit2);
        });
    });
});
