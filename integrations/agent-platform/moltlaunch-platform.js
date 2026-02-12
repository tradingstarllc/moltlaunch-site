/**
 * MoltLaunch Platform Integration
 * 
 * Drop-in verification for agent platforms, marketplaces, and operating systems.
 */

const crypto = require('crypto');

class MoltLaunch {
    constructor(options = {}) {
        this.apiUrl = options.apiUrl || 'https://youragent.id';
        this.platformId = options.platformId || 'unknown';
        this.timeout = options.timeout || 30000;
        this.retries = options.retries || 3;
        this.eventHandlers = {};
    }

    /**
     * Make API request with retry logic
     */
    async request(method, path, data = null) {
        const url = `${this.apiUrl}${path}`;
        let lastError;

        for (let attempt = 0; attempt < this.retries; attempt++) {
            try {
                const options = {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Platform-Id': this.platformId
                    }
                };

                if (data) {
                    options.body = JSON.stringify(data);
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);
                options.signal = controller.signal;

                const response = await fetch(url, options);
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.error || `HTTP ${response.status}`);
                }

                return await response.json();
            } catch (e) {
                lastError = e;
                if (attempt < this.retries - 1) {
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }

        throw lastError;
    }

    /**
     * Generate nonce for secure requests
     */
    generateNonce() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Quick verification check (free)
     */
    async quickCheck(agentId) {
        return this.request('POST', '/api/verify/quick', { agentId });
    }

    /**
     * Full verification with on-chain AI
     */
    async verify(data) {
        const payload = {
            agentId: data.agentId,
            capabilities: data.capabilities || [],
            codeUrl: data.codeUrl,
            nonce: data.nonce || this.generateNonce(),
            timestamp: data.timestamp || Math.floor(Date.now() / 1000),
            wallet: data.wallet,
            documentation: data.documentation,
            testCoverage: data.testCoverage,
            codeLines: data.codeLines,
            validityDays: data.validityDays || 30,
            generateProof: data.generateProof || false,
            executionTraces: data.executionTraces || []
        };

        const result = await this.request('POST', '/api/verify/deep', payload);
        
        // Emit event
        if (result.passed) {
            this.emit('verified', data.agentId, result);
        }

        return result;
    }

    /**
     * Get current verification status
     */
    async getStatus(agentId) {
        return this.request('GET', `/api/verify/status/${agentId}`);
    }

    /**
     * Batch check multiple agents
     */
    async batchCheck(agentIds) {
        const result = await this.request('POST', '/api/verify/status/batch', { agentIds });
        return result.results || [];
    }

    /**
     * Get badge information for display
     */
    async getBadge(agentId) {
        const status = await this.getStatus(agentId);
        
        let tier = 'unverified';
        let badge = 'gray';
        
        if (status.verified) {
            if (status.score >= 90) {
                tier = 'premium';
                badge = 'gold';
            } else if (status.score >= 75) {
                tier = 'verified';
                badge = 'silver';
            } else {
                tier = 'basic';
                badge = 'bronze';
            }
        }

        return {
            verified: status.verified,
            score: status.score,
            tier,
            badge,
            expiresAt: status.expiresAt,
            svgUrl: `${this.apiUrl}/badges/${badge}.svg`
        };
    }

    /**
     * Submit execution trace for behavioral scoring
     */
    async submitTrace(agentId, trace) {
        const result = await this.request('POST', '/api/traces', {
            agentId,
            trace
        });
        
        this.emit('behavioral_update', agentId, result.behavioralScore);
        
        return result.traceId;
    }

    /**
     * Get behavioral score
     */
    async getBehavioralScore(agentId) {
        return this.request('GET', `/api/traces/${agentId}/score`);
    }

    /**
     * Get all traces for an agent
     */
    async getTraces(agentId) {
        return this.request('GET', `/api/traces/${agentId}`);
    }

    /**
     * Check if attestation is revoked
     */
    async isRevoked(attestationHash) {
        return this.request('GET', `/api/verify/revoked/${attestationHash}`);
    }

    /**
     * Renew verification before expiry
     */
    async renew(agentId) {
        return this.request('POST', `/api/verify/renew/${agentId}`);
    }

    /**
     * Generate STARK proof for existing verification
     */
    async generateProof(agentId) {
        return this.request('POST', `/api/stark/generate/${agentId}`);
    }

    /**
     * Verify STARK proof
     */
    async verifyProof(proof) {
        return this.request('POST', '/api/stark/verify', { proof });
    }

    /**
     * Get on-chain AI deployment info
     */
    async getOnChainInfo() {
        return this.request('GET', '/api/onchain-ai');
    }

    /**
     * Event handling
     */
    on(event, handler) {
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(handler);
    }

    emit(event, ...args) {
        const handlers = this.eventHandlers[event] || [];
        handlers.forEach(handler => {
            try {
                handler(...args);
            } catch (e) {
                console.error(`Event handler error for ${event}:`, e);
            }
        });
    }

    /**
     * Health check
     */
    async health() {
        return this.request('GET', '/api/health');
    }
}

// State machine for agent verification lifecycle
class AgentVerificationState {
    constructor(moltlaunch, agentId) {
        this.moltlaunch = moltlaunch;
        this.agentId = agentId;
        this.state = 'unknown';
        this.status = null;
    }

    async refresh() {
        try {
            this.status = await this.moltlaunch.getStatus(this.agentId);
            
            if (!this.status.verified) {
                this.state = 'unverified';
            } else if (this.status.revoked) {
                this.state = 'revoked';
            } else if (new Date(this.status.expiresAt) < new Date()) {
                this.state = 'expired';
            } else {
                this.state = 'verified';
            }
        } catch (e) {
            if (e.message.includes('not found')) {
                this.state = 'unverified';
            } else {
                this.state = 'error';
            }
        }

        return this.state;
    }

    isValid() {
        return this.state === 'verified';
    }

    needsRenewal() {
        if (this.state !== 'verified' || !this.status) return false;
        const expiry = new Date(this.status.expiresAt);
        const daysUntilExpiry = (expiry - new Date()) / (1000 * 60 * 60 * 24);
        return daysUntilExpiry < 7;
    }
}

// Export for various module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MoltLaunch, AgentVerificationState };
}

if (typeof window !== 'undefined') {
    window.MoltLaunch = MoltLaunch;
    window.AgentVerificationState = AgentVerificationState;
}
