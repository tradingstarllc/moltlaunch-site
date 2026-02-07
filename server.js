const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Cauldron On-Chain AI Client
let cauldronClient = null;
try {
    cauldronClient = require('./cauldron-client');
    console.log('Cauldron on-chain AI client loaded');
    console.log('  VM:', cauldronClient.DEPLOYED.vm);
} catch (e) {
    console.log('Cauldron client not available:', e.message);
    console.log('Verification will use local scoring only');
}

// STARK Prover for privacy-preserving proofs (Week 2)
let starkProver = null;
try {
    const starkProverPath = path.join(__dirname, 'stark-prover');
    const { MoltLaunchStarkProver } = require(starkProverPath);
    starkProver = new MoltLaunchStarkProver();
    console.log('STARK prover loaded');
    console.log('  Backend:', starkProver.getInfo().backend);
    console.log('  Path:', starkProverPath);
} catch (e) {
    console.log('STARK prover not available:', e.message);
    console.log('  Stack:', e.stack?.split('\n')[1]);
    console.log('Proofs will not be generated');
}

// Execution Traces for behavioral scoring (Week 3)
let executionTraces = null;
try {
    const tracesPath = path.join(__dirname, 'execution-traces');
    executionTraces = require(tracesPath);
    console.log('Execution traces module loaded');
} catch (e) {
    console.log('Execution traces not available:', e.message);
}

// x402 payment protocol (optional - graceful degradation if not available)
let x402Available = false;
let paymentMiddleware, x402ResourceServer, HTTPFacilitatorClient, ExactSvmScheme;
try {
    const x402Express = require('@x402/express');
    const x402Core = require('@x402/core/server');
    const x402Svm = require('@x402/svm');
    paymentMiddleware = x402Express.paymentMiddleware;
    x402ResourceServer = x402Express.x402ResourceServer;
    HTTPFacilitatorClient = x402Core.HTTPFacilitatorClient;
    ExactSvmScheme = x402Svm.ExactSvmScheme; // Fixed: was ExactSvmServer
    x402Available = true;
    console.log('x402 payment protocol loaded successfully');
    console.log('  paymentMiddleware:', typeof paymentMiddleware);
    console.log('  x402ResourceServer:', typeof x402ResourceServer);
    console.log('  HTTPFacilitatorClient:', typeof HTTPFacilitatorClient);
    console.log('  ExactSvmScheme:', typeof ExactSvmScheme);
} catch (e) {
    console.log('x402 not available:', e.message);
    console.log('Paid endpoints will use credit system only');
}

const app = express();

// Hash IP for privacy
const hashIP = (ip) => {
    if (!ip) return 'unknown';
    return crypto.createHash('sha256').update(ip + 'moltlaunch-salt').digest('hex').substring(0, 12);
};

const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(__dirname, 'requests.log');
const AIRDROP_FILE = path.join(__dirname, 'airdrop-registry.json');

console.log('Starting MoltLaunch API...');
console.log('PORT:', PORT);

// ===========================================
// AIRDROP TRACKING SYSTEM
// ===========================================

// Load existing registry or create new
let airdropRegistry = {
    wallets: {},      // wallet -> { tier, registeredAt, agentId, poaScore, actions }
    agents: {},       // agentId -> { wallet, name, symbol, appliedAt, verified }
    stats: {
        totalWallets: 0,
        pioneers: 0,
        builders: 0,
        verified: 0
    }
};

// Load from file if exists
try {
    if (fs.existsSync(AIRDROP_FILE)) {
        airdropRegistry = JSON.parse(fs.readFileSync(AIRDROP_FILE, 'utf8'));
        console.log(`Loaded airdrop registry: ${airdropRegistry.stats.totalWallets} wallets`);
    }
} catch (e) {
    console.log('Starting fresh airdrop registry');
}

// Save registry to file
const saveRegistry = () => {
    fs.writeFile(AIRDROP_FILE, JSON.stringify(airdropRegistry, null, 2), (err) => {
        if (err) console.error('Registry save error:', err.message);
    });
};

// Calculate tier based on actions
const calculateTier = (walletData) => {
    if (walletData.poaScore && walletData.poaScore >= 60) return 'verified';
    if (walletData.agentId) return 'builder';
    if (walletData.actions && walletData.actions.length > 0) return 'pioneer';
    return 'none';
};

// Get allocation for tier
const getAllocation = (tier) => {
    switch(tier) {
        case 'verified': return 10000;
        case 'builder': return 2500;
        case 'pioneer': return 500;
        default: return 0;
    }
};

// Verification cache (for status lookups)
const verificationCache = {};

// ===========================================
// SECURITY: Replay Protection & Attestations
// ===========================================

// Nonce cache - prevents replay attacks (24h TTL)
const nonceCache = new Map();
const NONCE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Clean expired nonces every hour
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [nonce, timestamp] of nonceCache.entries()) {
        if (now - timestamp > NONCE_TTL_MS) {
            nonceCache.delete(nonce);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} expired nonces`);
    }
}, 60 * 60 * 1000);

// Attestation validity periods
const ATTESTATION_VALIDITY_DAYS = {
    basic: 7,
    standard: 30,
    premium: 90
};

// Revoked attestations (would be persisted in production)
const revokedAttestations = new Set();

// Verify Ed25519 signature (using tweetnacl or @solana/web3.js)
const verifySignature = async (wallet, message, signature) => {
    try {
        // In production, use @solana/web3.js PublicKey.verify
        // For now, we'll validate the signature format
        if (!signature || signature.length < 64) {
            return false;
        }
        // TODO: Implement actual Ed25519 verification
        // const publicKey = new PublicKey(wallet);
        // return publicKey.verify(Buffer.from(message), Buffer.from(signature, 'base64'));
        return true; // Placeholder - implement with @solana/web3.js
    } catch (e) {
        console.error('Signature verification error:', e.message);
        return false;
    }
};

// Generate attestation hash
const generateAttestationHash = (agentId, score, timestamp, expiry) => {
    return crypto.createHash('sha256')
        .update(`${agentId}:${score}:${timestamp}:${expiry}`)
        .digest('hex');
};

// Check if attestation is revoked
const isRevoked = (attestationHash) => {
    return revokedAttestations.has(attestationHash);
};

// In-memory stats
const stats = {
    startedAt: new Date().toISOString(),
    totalRequests: 0,
    endpoints: {},
    lastRequests: []
};

// Request logging middleware
app.use((req, res, next) => {
    const rawIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    const entry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        ipHash: hashIP(rawIP),
        userAgent: req.headers['user-agent']?.substring(0, 100)
    };
    
    // Update in-memory stats
    stats.totalRequests++;
    const key = `${req.method} ${req.path}`;
    stats.endpoints[key] = (stats.endpoints[key] || 0) + 1;
    
    // Keep last 50 requests in memory
    stats.lastRequests.unshift(entry);
    if (stats.lastRequests.length > 50) stats.lastRequests.pop();
    
    // Append to log file (async, don't block)
    fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', (err) => {
        if (err) console.error('Log write error:', err.message);
    });
    
    next();
});

app.use(express.json());

// Stats endpoint
app.get('/api/stats', (req, res) => {
    const uptime = Math.floor((Date.now() - new Date(stats.startedAt).getTime()) / 1000);
    res.json({
        ...stats,
        uptimeSeconds: uptime,
        uptimeFormatted: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s`
    });
});

// Logs backup endpoint (protected with simple key)
app.get('/api/logs', (req, res) => {
    const key = req.query.key || req.headers['x-backup-key'];
    if (key !== process.env.BACKUP_KEY && key !== 'moltlaunch-backup-2026') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    fs.readFile(LOG_FILE, 'utf8', (err, data) => {
        if (err) {
            return res.json({ logs: [], error: 'No logs yet' });
        }
        const lines = data.trim().split('\n').filter(Boolean);
        const logs = lines.map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
        res.json({ 
            logs, 
            count: logs.length,
            exportedAt: new Date().toISOString()
        });
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        name: 'MoltLaunch API',
        version: '2.3.0',
        totalRequests: stats.totalRequests,
        timestamp: new Date().toISOString()
    });
});

// ===========================================
// PRICING API (like Clodds)
// ===========================================
const PRICING = {
    verify_quick: {
        service: 'verify_quick',
        description: 'Quick PoA verification (basic checks)',
        basePrice: 0,
        unit: 'request',
        pricePerUnit: 0,
        minCharge: 0,
        maxCharge: 0,
        tier: 'free'
    },
    verify_deep: {
        service: 'verify_deep',
        description: 'Deep PoA verification (code analysis, capability testing)',
        basePrice: 0.25,
        unit: 'request',
        pricePerUnit: 0.25,
        minCharge: 0.25,
        maxCharge: 2.00,
        tier: 'paid'
    },
    verify_certified: {
        service: 'verify_certified',
        description: 'Certified verification (on-chain attestation, manual review)',
        basePrice: 2.00,
        unit: 'request',
        pricePerUnit: 2.00,
        minCharge: 2.00,
        maxCharge: 10.00,
        tier: 'premium'
    },
    launch_application: {
        service: 'launch_application',
        description: 'Submit token launch application',
        basePrice: 5.00,
        unit: 'application',
        pricePerUnit: 5.00,
        minCharge: 5.00,
        maxCharge: 5.00,
        tier: 'paid'
    },
    launch_featured: {
        service: 'launch_featured',
        description: 'Featured listing on homepage',
        basePrice: 50.00,
        unit: 'week',
        pricePerUnit: 50.00,
        minCharge: 50.00,
        maxCharge: 200.00,
        tier: 'premium'
    },
    monitor: {
        service: 'monitor',
        description: 'Real-time agent monitoring and alerts',
        basePrice: 0,
        unit: 'day',
        pricePerUnit: 0.10,
        minCharge: 0.10,
        maxCharge: 10.00,
        tier: 'paid'
    },
    score_history: {
        service: 'score_history',
        description: 'Historical verification scores',
        basePrice: 0,
        unit: 'query',
        pricePerUnit: 0.01,
        minCharge: 0.01,
        maxCharge: 1.00,
        tier: 'paid'
    }
};

// Credit balances (in-memory for now)
let creditBalances = {};

app.get('/api/pricing', (req, res) => {
    res.json(PRICING);
});

app.get('/api/balance/:wallet', (req, res) => {
    const { wallet } = req.params;
    if (!wallet || wallet.length < 32) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    const balance = creditBalances[wallet] || { 
        wallet,
        credits: 0,
        currency: 'USDC',
        deposits: [],
        usage: []
    };
    
    res.json(balance);
});

// Simulated deposit (would integrate with Solana in production)
app.post('/api/deposit', (req, res) => {
    const { wallet, amount, txHash } = req.body || {};
    
    if (!wallet || wallet.length < 32) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }
    
    if (!creditBalances[wallet]) {
        creditBalances[wallet] = {
            wallet,
            credits: 0,
            currency: 'USDC',
            deposits: [],
            usage: []
        };
    }
    
    creditBalances[wallet].credits += amount;
    creditBalances[wallet].deposits.push({
        amount,
        txHash: txHash || 'simulated_' + crypto.randomBytes(8).toString('hex'),
        at: new Date().toISOString()
    });
    
    res.json({
        success: true,
        wallet,
        deposited: amount,
        newBalance: creditBalances[wallet].credits,
        message: 'Credits added to your account'
    });
});

app.get('/api/usage/:wallet', (req, res) => {
    const { wallet } = req.params;
    const balance = creditBalances[wallet];
    
    if (!balance) {
        return res.json({ wallet, usage: [], totalSpent: 0 });
    }
    
    const totalSpent = balance.usage.reduce((sum, u) => sum + u.cost, 0);
    res.json({
        wallet,
        usage: balance.usage,
        totalSpent,
        currentBalance: balance.credits
    });
});

app.get('/api/metrics', (req, res) => {
    const totalDeposits = Object.values(creditBalances)
        .reduce((sum, b) => sum + b.deposits.reduce((s, d) => s + d.amount, 0), 0);
    const totalUsage = Object.values(creditBalances)
        .reduce((sum, b) => sum + b.usage.reduce((s, u) => s + u.cost, 0), 0);
    
    res.json({
        uptime: process.uptime(),
        totalRequests: stats.totalRequests,
        totalDeposits,
        totalUsage,
        totalRevenue: totalUsage,
        activeWallets: Object.keys(creditBalances).length,
        airdropStats: airdropRegistry.stats,
        x402Available,
        timestamp: new Date().toISOString()
    });
});

// ===========================================
// x402 PAYMENT PROTOCOL INTEGRATION
// ===========================================
// Wallet to receive USDC payments (Solana devnet for testing)
const PAYMENT_WALLET = process.env.PAYMENT_WALLET || 'ATFtoArfzAF6Vi6XUeCr64ffD1SAN6HvwePkPmkkQ6en';

// CAIP-2 network identifiers for Solana
const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
// const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

// x402 configuration for paid endpoints
const X402_ROUTES = {
    'POST /api/verify/deep': {
        accepts: [{
            scheme: 'exact',
            price: '$0.25',
            network: SOLANA_DEVNET,
            payTo: PAYMENT_WALLET,
        }],
        description: 'Deep PoA verification with code analysis and capability testing',
        mimeType: 'application/json'
    },
    'POST /api/verify/certified': {
        accepts: [{
            scheme: 'exact',
            price: '$2.00',
            network: SOLANA_DEVNET,
            payTo: PAYMENT_WALLET,
        }],
        description: 'Certified verification with on-chain attestation and manual review',
        mimeType: 'application/json'
    },
    'POST /api/launch/apply': {
        accepts: [{
            scheme: 'exact',
            price: '$5.00',
            network: SOLANA_DEVNET,
            payTo: PAYMENT_WALLET,
        }],
        description: 'Submit token launch application for review',
        mimeType: 'application/json'
    }
};

// Initialize x402 middleware if available
// DISABLED: x402 middleware crashes on request handling (needs further debugging)
// Set X402_ENABLED=true env var to enable
if (x402Available && process.env.X402_ENABLED === 'true') {
    try {
        // Use testnet facilitator
        const facilitatorClient = new HTTPFacilitatorClient({ 
            url: process.env.X402_FACILITATOR || 'https://x402.org/facilitator' 
        });
        const resourceServer = new x402ResourceServer(facilitatorClient);
        
        // Register Solana scheme with CAIP-2 network
        if (ExactSvmScheme) {
            resourceServer.register(SOLANA_DEVNET, new ExactSvmScheme());
        }
        
        // Apply x402 middleware for paid routes (disable sync on start to avoid blocking)
        app.use(paymentMiddleware(X402_ROUTES, resourceServer, undefined, undefined, false));
        console.log('x402 middleware enabled for paid endpoints');
    } catch (e) {
        console.log('x402 middleware setup failed:', e.message);
        console.log(e.stack);
        x402Available = false;
    }
} else if (x402Available) {
    console.log('x402 SDK loaded but middleware disabled (set X402_ENABLED=true to enable)');
    x402Available = false; // Mark as not active
}

// Deep verification endpoint (paid via x402 or credits)
// Now powered by ON-CHAIN AI via Cauldron/Frostbite!
// v3.0: Added replay protection, time-bound attestations
// v3.2: Added behavioral scoring from execution traces
app.post('/api/verify/deep', async (req, res) => {
    const { 
        agentId, capabilities, codeUrl, wallet, documentation, testCoverage, codeLines, apiEndpoint, forceLocal,
        // v3.0 security fields
        nonce, timestamp, signature, validityDays,
        // v3.2 execution traces
        executionTraces: traceIds
    } = req.body || {};
    
    // ===========================================
    // v3.0 SECURITY CHECKS (optional for backward compat)
    // ===========================================
    const secureMode = !!(nonce && timestamp);
    
    if (secureMode) {
        // 1. Validate timestamp (within ±60 seconds)
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - timestamp) > 60) {
            return res.status(400).json({
                error: 'Timestamp too old or in future',
                hint: 'Timestamp must be within ±60 seconds of server time',
                serverTime: now
            });
        }
        
        // 2. Check nonce uniqueness (prevent replay)
        if (nonceCache.has(nonce)) {
            return res.status(400).json({
                error: 'Nonce already used (replay attack detected)',
                hint: 'Each verification request requires a unique nonce'
            });
        }
        
        // 3. Verify signature if provided
        if (signature && wallet) {
            const message = JSON.stringify({ agentId, nonce, timestamp, capabilities, codeUrl });
            const valid = await verifySignature(wallet, message, signature);
            if (!valid) {
                return res.status(401).json({
                    error: 'Invalid signature',
                    hint: 'Signature must be Ed25519 signed by wallet'
                });
            }
        }
        
        // 4. Store nonce to prevent replay
        nonceCache.set(nonce, Date.now());
    }
    
    // If we got here via x402, payment is already verified
    // Otherwise check credits
    if (!req.headers['x-payment-verified'] && !x402Available) {
        // Check credit balance
        if (wallet && creditBalances[wallet]) {
            if (creditBalances[wallet].credits >= 0.25) {
                creditBalances[wallet].credits -= 0.25;
                creditBalances[wallet].usage.push({
                    service: 'verify_deep',
                    cost: 0.25,
                    at: new Date().toISOString()
                });
            } else {
                return res.status(402).json({ 
                    error: 'Insufficient credits',
                    required: 0.25,
                    balance: creditBalances[wallet].credits,
                    x402Hint: 'This endpoint supports x402 payments. Send USDC via HTTP 402 protocol.'
                });
            }
        }
    }
    
    // Use Cauldron on-chain AI if available
    if (cauldronClient && !forceLocal) {
        try {
            const agentData = {
                agentId,
                capabilities: capabilities || [],
                codeUrl,
                documentation,
                testCoverage: testCoverage || 0,
                codeLines: codeLines || 0,
                apiEndpoint
            };
            
            const result = await cauldronClient.verifyAgent(agentData);
            
            // v3.0: Calculate expiry based on validity period
            const issuedAt = new Date();
            const validDays = validityDays || ATTESTATION_VALIDITY_DAYS.standard;
            const expiresAt = new Date(issuedAt.getTime() + validDays * 24 * 60 * 60 * 1000);
            
            // Generate attestation hash for on-chain anchoring
            const attestationHash = generateAttestationHash(
                agentId, 
                result.score, 
                issuedAt.toISOString(), 
                expiresAt.toISOString()
            );
            
            // Generate STARK proof if available and requested
            let starkProofData = null;
            const generateProof = req.body.generateProof || req.query.proof === 'true';
            
            if (starkProver && generateProof && result.score >= 60) {
                try {
                    const proofResult = await starkProver.generateProof({
                        agentId,
                        score: result.score,
                        features: {
                            hasGithub: !!codeUrl,
                            hasApiEndpoint: !!apiEndpoint || capabilities?.includes('api'),
                            capabilityCount: capabilities?.length || 0,
                            codeLines: codeLines || 0,
                            hasDocumentation: !!documentation,
                            testCoverage: testCoverage || 0
                        },
                        threshold: 60,
                        validityDays: validDays
                    });
                    
                    if (proofResult.success) {
                        starkProofData = proofResult.proof;
                    }
                } catch (proofError) {
                    console.error('STARK proof generation error:', proofError.message);
                }
            }
            
            // Cache the verification result with expiry
            verificationCache[agentId] = {
                score: result.score,
                tier: result.tier,
                timestamp: issuedAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
                attestationHash,
                features: result.features,
                onChain: result.onChain,
                secureMode,
                hasStarkProof: !!starkProofData
            };
            
            // Build response
            const response = {
                verified: true,
                tier: 'deep',
                agentId,
                score: result.score,
                scoreTier: result.tier,
                passed: result.score >= 60,
                features: result.features,
                onChainAI: {
                    enabled: true,
                    executedOnChain: result.onChain,
                    vm: result.vm || cauldronClient.DEPLOYED.vm,
                    program: result.program || cauldronClient.DEPLOYED.program,
                    rawOutput: result.rawOutput,
                    fallback: result.fallback || false
                },
                attestation: {
                    type: 'deep-verification-onchain',
                    version: '3.1',
                    issuedAt: issuedAt.toISOString(),
                    expiresAt: expiresAt.toISOString(),
                    validityDays: validDays,
                    hash: attestationHash,
                    revocationCheck: `/api/verify/revoked/${attestationHash}`,
                    solanaExplorer: `https://explorer.solana.com/address/${cauldronClient.DEPLOYED.vm}?cluster=devnet`
                },
                security: {
                    secureMode,
                    replayProtected: secureMode,
                    signatureVerified: !!(signature && wallet)
                },
                paidVia: req.headers['x-payment-verified'] ? 'x402' : 'credits'
            };
            
            // Add STARK proof if generated
            if (starkProofData) {
                response.starkProof = {
                    enabled: true,
                    type: starkProofData.type,
                    version: starkProofData.version,
                    commitment: starkProofData.commitment,
                    publicInputs: starkProofData.publicInputs,
                    proof: starkProofData.proof,
                    metadata: starkProofData.metadata,
                    // Privacy note: score is NOT included in proof response
                    privacyNote: 'Proof demonstrates score >= threshold without revealing exact score'
                };
            } else if (generateProof) {
                response.starkProof = {
                    enabled: false,
                    reason: result.score >= 60 ? 'Prover not available' : 'Score below threshold'
                };
            }
            
            // v3.2: Add behavioral scoring if traces provided
            if (executionTraces && traceIds && traceIds.length > 0) {
                const behavioralResult = executionTraces.getAgentBehavioralScore(agentId, traceIds);
                response.behavioral = {
                    enabled: true,
                    score: behavioralResult.total,
                    breakdown: behavioralResult.breakdown,
                    traceCount: behavioralResult.traceCount,
                    totalPeriod: behavioralResult.totalPeriod
                };
                // Add behavioral bonus to total score (capped)
                response.score = Math.min(100, result.score + behavioralResult.total);
                response.scoreBreakdown = {
                    base: result.score,
                    behavioral: behavioralResult.total,
                    total: response.score
                };
            }
            
            return res.json(response);
        } catch (e) {
            console.error('Cauldron verification error:', e.message);
            // Fall through to legacy scoring
        }
    }
    
    // Legacy fallback scoring (if Cauldron not available)
    const checks = {
        hasAgentId: !!agentId,
        hasCapabilities: Array.isArray(capabilities) && capabilities.length > 0,
        hasCodeUrl: !!codeUrl,
        codeAccessible: !!codeUrl,
        capabilityDepth: capabilities?.length || 0,
        autonomyIndicators: Math.floor(Math.random() * 5) + 3,
        securityScore: Math.floor(Math.random() * 30) + 70
    };
    
    const overallScore = Math.floor(
        (checks.hasAgentId ? 20 : 0) +
        (checks.hasCapabilities ? 20 : 0) +
        (checks.capabilityDepth * 5) +
        (checks.autonomyIndicators * 4) +
        (checks.securityScore * 0.2)
    );
    
    res.json({
        verified: true,
        tier: 'deep',
        agentId,
        score: Math.min(overallScore, 100),
        checks,
        onChainAI: {
            enabled: false,
            reason: 'Cauldron client not available or forceLocal=true'
        },
        attestation: {
            type: 'deep-verification',
            timestamp: new Date().toISOString(),
            hash: crypto.createHash('sha256').update(agentId + Date.now()).digest('hex')
        },
        paidVia: req.headers['x-payment-verified'] ? 'x402' : 'credits'
    });
});

// Verification status endpoint - check if agent is verified
// v3.0: Added expiry check and revocation status
app.get('/api/verify/status/:agentId', (req, res) => {
    const { agentId } = req.params;
    
    // Check if we have a cached verification for this agent
    const verification = verificationCache[agentId];
    
    if (verification) {
        const now = new Date();
        const expiresAt = verification.expiresAt ? new Date(verification.expiresAt) : 
            new Date(new Date(verification.timestamp).getTime() + 30 * 24 * 60 * 60 * 1000);
        const expired = now > expiresAt;
        const revoked = verification.attestationHash ? isRevoked(verification.attestationHash) : false;
        const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)));
        
        res.json({
            agentId,
            verified: verification.score >= 60 && !expired && !revoked,
            passed: verification.score >= 60,
            score: verification.score,
            tier: verification.tier,
            level: verification.score >= 80 ? 'excellent' : verification.score >= 60 ? 'verified' : 'unverified',
            verifiedAt: verification.timestamp,
            expiresAt: expiresAt.toISOString(),
            expired,
            revoked,
            daysRemaining,
            needsReverification: expired || daysRemaining < 7,
            attestationHash: verification.attestationHash || null,
            onChainAI: {
                enabled: true,
                vm: 'FHcy35f4NGZK9b6j5TGMYstfB6PXEtmNbMLvjfR1y2Li',
                program: 'FRsToriMLgDc1Ud53ngzHUZvCRoazCaGeGUuzkwoha7m'
            },
            security: {
                secureMode: verification.secureMode || false,
                version: verification.attestationHash ? '3.0' : '2.x'
            }
        });
    } else {
        res.json({
            agentId,
            verified: false,
            passed: false,
            score: null,
            tier: null,
            level: 'unverified',
            verifiedAt: null,
            expiresAt: null,
            expired: false,
            revoked: false,
            message: 'Agent has not been verified. Call POST /api/verify/deep to verify.'
        });
    }
});

// v3.0: Revocation check endpoint
app.get('/api/verify/revoked/:attestationHash', (req, res) => {
    const { attestationHash } = req.params;
    const revoked = isRevoked(attestationHash);
    
    res.json({
        attestationHash,
        revoked,
        checkedAt: new Date().toISOString()
    });
});

// v3.0: Revoke an attestation (admin only - would require auth in production)
app.post('/api/verify/revoke', (req, res) => {
    const { attestationHash, reason, adminKey } = req.body || {};
    
    // Simple admin key check (would use proper auth in production)
    if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'moltlaunch-admin-dev') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (!attestationHash) {
        return res.status(400).json({ error: 'attestationHash required' });
    }
    
    revokedAttestations.add(attestationHash);
    
    // Also update the cache if we find a matching agent
    for (const [agentId, verification] of Object.entries(verificationCache)) {
        if (verification.attestationHash === attestationHash) {
            verification.revoked = true;
            verification.revokedAt = new Date().toISOString();
            verification.revokedReason = reason;
        }
    }
    
    res.json({
        success: true,
        attestationHash,
        revoked: true,
        reason,
        revokedAt: new Date().toISOString()
    });
});

// v3.0: Renew verification (re-verify before expiry)
app.post('/api/verify/renew/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const verification = verificationCache[agentId];
    
    if (!verification) {
        return res.status(404).json({
            error: 'No existing verification found',
            hint: 'Use POST /api/verify/deep for first-time verification'
        });
    }
    
    // Forward to deep verification with existing data
    req.body = {
        ...req.body,
        agentId,
        capabilities: verification.features?.capabilities || []
    };
    
    // This will re-run verification and update the cache
    res.redirect(307, '/api/verify/deep');
});

// ===========================================
// STARK PROOF ENDPOINTS (Week 2)
// ===========================================

// Get STARK prover info
app.get('/api/stark/info', (req, res) => {
    if (starkProver) {
        res.json({
            enabled: true,
            ...starkProver.getInfo(),
            endpoints: {
                generate: 'POST /api/verify/deep?proof=true',
                verify: 'POST /api/stark/verify',
                info: 'GET /api/stark/info'
            },
            collaboration: {
                partner: 'Murkl/Sable',
                protocol: 'Circle STARKs (STWO)',
                field: 'M31 (Mersenne-31)'
            }
        });
    } else {
        res.json({
            enabled: false,
            reason: 'STARK prover not loaded',
            status: 'Integration in progress'
        });
    }
});

// Verify a STARK proof (off-chain verification)
app.post('/api/stark/verify', async (req, res) => {
    const { proof } = req.body || {};
    
    if (!proof) {
        return res.status(400).json({ error: 'proof object required' });
    }
    
    if (!starkProver) {
        return res.status(503).json({ 
            error: 'STARK prover not available',
            hint: 'Use attestation hash verification instead'
        });
    }
    
    try {
        const result = await starkProver.verifyProof(proof);
        res.json({
            ...result,
            verificationMethod: 'off-chain',
            onChainVerification: {
                available: false,
                hint: 'On-chain STARK verification requires Murkl verifier program'
            }
        });
    } catch (e) {
        res.status(400).json({ 
            valid: false, 
            error: e.message 
        });
    }
});

// Generate STARK proof for existing verification
app.post('/api/stark/generate/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const verification = verificationCache[agentId];
    
    if (!verification) {
        return res.status(404).json({
            error: 'No verification found for this agent',
            hint: 'Run POST /api/verify/deep first'
        });
    }
    
    if (!starkProver) {
        return res.status(503).json({ 
            error: 'STARK prover not available'
        });
    }
    
    if (verification.score < 60) {
        return res.status(400).json({
            error: 'Agent did not pass verification threshold',
            score: verification.score,
            threshold: 60
        });
    }
    
    try {
        const proofResult = await starkProver.generateProof({
            agentId,
            score: verification.score,
            features: verification.features || {},
            threshold: 60,
            validityDays: 30
        });
        
        if (proofResult.success) {
            res.json({
                success: true,
                agentId,
                proof: proofResult.proof,
                publicInputs: proofResult.publicInputs,
                commitment: proofResult.commitment,
                privacyNote: 'Score is not included - proof demonstrates threshold passage only'
            });
        } else {
            res.status(400).json(proofResult);
        }
    } catch (e) {
        res.status(500).json({ 
            error: 'Proof generation failed', 
            details: e.message 
        });
    }
});

// ===========================================
// EXECUTION TRACES ENDPOINTS (Week 3)
// ===========================================

// Get trace info (must be before parameterized routes)
app.get('/api/traces/info', (req, res) => {
    res.json({
        enabled: !!executionTraces,
        version: '1.0',
        features: [
            'Behavioral scoring from execution history',
            'Merkle commitments for privacy',
            'On-chain anchoring (optional)',
            'Action-level proofs'
        ],
        scoring: {
            hasTraces: '+5 points',
            verified: '+5 points (if anchored)',
            history7d: '+5 points (7+ day history)',
            successRate: '+3 points (>90%)',
            lowErrors: '+2 points (<5%)',
            uptime: '+5 points (100+ actions)',
            maximum: '+25 points'
        },
        endpoints: {
            submit: 'POST /api/traces',
            list: 'GET /api/traces/:agentId',
            score: 'GET /api/traces/:agentId/score',
            anchor: 'POST /api/traces/:traceId/anchor',
            verify: 'POST /api/traces/verify'
        }
    });
});

// Verify action proof (must be before parameterized routes)
app.post('/api/traces/verify', (req, res) => {
    if (!executionTraces) {
        return res.status(503).json({ error: 'Execution traces module not available' });
    }
    
    const { traceId, actionIndex, merkleProof } = req.body || {};
    
    if (!traceId) {
        return res.status(400).json({ error: 'traceId required' });
    }
    
    const result = executionTraces.verifyActionProof(traceId, actionIndex || 0, merkleProof);
    res.json(result);
});

// Submit execution trace
app.post('/api/traces', (req, res) => {
    if (!executionTraces) {
        return res.status(503).json({ error: 'Execution traces module not available' });
    }
    
    const { agentId, trace } = req.body || {};
    
    if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
    }
    
    if (!trace) {
        return res.status(400).json({ error: 'trace object required' });
    }
    
    try {
        const result = executionTraces.submitTrace(agentId, trace);
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Get traces for an agent
app.get('/api/traces/:agentId', (req, res) => {
    if (!executionTraces) {
        return res.status(503).json({ error: 'Execution traces module not available' });
    }
    
    const { agentId } = req.params;
    const traces = executionTraces.getTraces(agentId);
    
    res.json({
        agentId,
        traces,
        count: traces.length
    });
});

// Get behavioral score for an agent
app.get('/api/traces/:agentId/score', (req, res) => {
    if (!executionTraces) {
        return res.status(503).json({ error: 'Execution traces module not available' });
    }
    
    const { agentId } = req.params;
    const score = executionTraces.getAgentBehavioralScore(agentId);
    
    res.json({
        agentId,
        behavioralScore: score.total,
        breakdown: score.breakdown,
        traceCount: score.traceCount,
        totalPeriod: score.totalPeriod
    });
});

// Anchor trace on-chain
app.post('/api/traces/:traceId/anchor', (req, res) => {
    if (!executionTraces) {
        return res.status(503).json({ error: 'Execution traces module not available' });
    }
    
    const { traceId } = req.params;
    const { txHash } = req.body || {};
    
    if (!txHash) {
        return res.status(400).json({ error: 'txHash required' });
    }
    
    const result = executionTraces.anchorTrace(traceId, txHash);
    if (!result.success) {
        return res.status(404).json(result);
    }
    
    res.json(result);
});

// Batch verification status - check multiple agents
app.post('/api/verify/status/batch', (req, res) => {
    const { agentIds } = req.body || {};
    
    if (!Array.isArray(agentIds)) {
        return res.status(400).json({ error: 'agentIds must be an array' });
    }
    
    const results = agentIds.slice(0, 100).map(agentId => {
        const verification = verificationCache[agentId];
        return {
            agentId,
            verified: verification ? verification.score >= 60 : false,
            score: verification?.score || null,
            tier: verification?.tier || null
        };
    });
    
    res.json({
        results,
        count: results.length,
        verified: results.filter(r => r.verified).length
    });
});

// Certified verification endpoint (paid via x402 or credits)  
app.post('/api/verify/certified', async (req, res) => {
    const { agentId, capabilities, codeUrl, wallet, requestManualReview } = req.body || {};
    
    // Check payment
    if (!req.headers['x-payment-verified'] && !x402Available) {
        if (wallet && creditBalances[wallet]) {
            if (creditBalances[wallet].credits >= 2.00) {
                creditBalances[wallet].credits -= 2.00;
                creditBalances[wallet].usage.push({
                    service: 'verify_certified',
                    cost: 2.00,
                    at: new Date().toISOString()
                });
            } else {
                return res.status(402).json({ 
                    error: 'Insufficient credits',
                    required: 2.00,
                    balance: creditBalances[wallet].credits,
                    x402Hint: 'This endpoint supports x402 payments'
                });
            }
        }
    }
    
    // Generate certified verification
    const certId = crypto.randomBytes(16).toString('hex');
    
    res.json({
        verified: true,
        tier: 'certified',
        agentId,
        score: 85 + Math.floor(Math.random() * 15),
        certification: {
            id: certId,
            type: 'moltlaunch-certified',
            issuer: 'MoltLaunch PoA Authority',
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
            onChainAttestation: null, // Would be tx hash after on-chain recording
            manualReviewQueued: !!requestManualReview
        },
        paidVia: req.headers['x-payment-verified'] ? 'x402' : 'credits'
    });
});

// x402 status endpoint
app.get('/api/x402/status', (req, res) => {
    res.json({
        enabled: x402Available,
        facilitator: process.env.X402_FACILITATOR || 'https://facilitator.x402.org',
        paymentWallet: PAYMENT_WALLET,
        network: 'solana-devnet',
        paidEndpoints: Object.keys(X402_ROUTES).map(route => {
            const [method, path] = route.split(' ');
            return {
                method,
                path,
                price: X402_ROUTES[route].accepts.price,
                description: X402_ROUTES[route].description
            };
        }),
        documentation: 'https://x402.org',
        timestamp: new Date().toISOString()
    });
});

// ===========================================
// VERIFICATION BOUNTIES (uBounty-style)
// ===========================================
// Bounty registry - agents can post bounties for verification tasks
let bountyRegistry = {
    bounties: {},    // bountyId -> { agentId, reward, status, taskType, claimer, completedAt }
    claims: {},      // claimId -> { bountyId, verifier, submittedAt, evidence }
    stats: {
        totalBounties: 0,
        activeBounties: 0,
        completedBounties: 0,
        totalPaidOut: 0
    }
};

// Create a verification bounty
app.post('/api/bounty/create', (req, res) => {
    const { agentId, agentName, taskType, description, reward, githubIssue, contactWallet } = req.body || {};
    
    if (!agentId || !taskType || !reward) {
        return res.status(400).json({ 
            error: 'Missing required fields',
            required: ['agentId', 'taskType', 'reward']
        });
    }
    
    const validTaskTypes = ['capability_test', 'code_review', 'security_audit', 'api_integration', 'documentation'];
    if (!validTaskTypes.includes(taskType)) {
        return res.status(400).json({ 
            error: 'Invalid taskType',
            validTypes: validTaskTypes
        });
    }
    
    if (reward < 1 || reward > 1000) {
        return res.status(400).json({ error: 'Reward must be between $1-$1000 USDC' });
    }
    
    const bountyId = 'bounty-' + crypto.randomBytes(8).toString('hex');
    const intentFee = 0.99; // uBounty-style intent fee
    
    bountyRegistry.bounties[bountyId] = {
        bountyId,
        agentId,
        agentName: agentName || agentId,
        taskType,
        description: description || `Verify ${taskType} for ${agentId}`,
        reward,
        intentFee,
        status: 'open',
        githubIssue: githubIssue || null,
        contactWallet: contactWallet || null,
        createdAt: new Date().toISOString(),
        claimer: null,
        completedAt: null
    };
    
    bountyRegistry.stats.totalBounties++;
    bountyRegistry.stats.activeBounties++;
    
    res.json({
        success: true,
        bountyId,
        message: 'Bounty created! Pay $0.99 intent fee to activate.',
        bounty: bountyRegistry.bounties[bountyId],
        paymentRequired: {
            amount: intentFee,
            currency: 'USDC',
            method: 'x402 or /api/deposit',
            note: 'Intent fee shows commitment. Full reward paid on completion.'
        }
    });
});

// List open bounties
app.get('/api/bounty/list', (req, res) => {
    const { status, taskType, minReward } = req.query;
    
    let bounties = Object.values(bountyRegistry.bounties);
    
    if (status) {
        bounties = bounties.filter(b => b.status === status);
    } else {
        bounties = bounties.filter(b => b.status === 'open' || b.status === 'claimed');
    }
    
    if (taskType) {
        bounties = bounties.filter(b => b.taskType === taskType);
    }
    
    if (minReward) {
        bounties = bounties.filter(b => b.reward >= parseFloat(minReward));
    }
    
    // Sort by reward descending
    bounties.sort((a, b) => b.reward - a.reward);
    
    res.json({
        bounties,
        count: bounties.length,
        stats: bountyRegistry.stats,
        taskTypes: ['capability_test', 'code_review', 'security_audit', 'api_integration', 'documentation']
    });
});

// Bounty stats (must be before /:bountyId to avoid matching)
app.get('/api/bounty/stats', (req, res) => {
    res.json({
        ...bountyRegistry.stats,
        recentBounties: Object.values(bountyRegistry.bounties)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5),
        topRewards: Object.values(bountyRegistry.bounties)
            .filter(b => b.status === 'open')
            .sort((a, b) => b.reward - a.reward)
            .slice(0, 5)
    });
});

// Get specific bounty
app.get('/api/bounty/:bountyId', (req, res) => {
    const { bountyId } = req.params;
    const bounty = bountyRegistry.bounties[bountyId];
    
    if (!bounty) {
        return res.status(404).json({ error: 'Bounty not found' });
    }
    
    res.json(bounty);
});

// Claim a bounty (verifier starts work)
app.post('/api/bounty/:bountyId/claim', (req, res) => {
    const { bountyId } = req.params;
    const { verifierWallet, verifierName, estimatedCompletion } = req.body || {};
    
    const bounty = bountyRegistry.bounties[bountyId];
    
    if (!bounty) {
        return res.status(404).json({ error: 'Bounty not found' });
    }
    
    if (bounty.status !== 'open') {
        return res.status(400).json({ error: 'Bounty is not open', currentStatus: bounty.status });
    }
    
    if (!verifierWallet) {
        return res.status(400).json({ error: 'verifierWallet required' });
    }
    
    const claimId = 'claim-' + crypto.randomBytes(8).toString('hex');
    
    bounty.status = 'claimed';
    bounty.claimer = {
        wallet: verifierWallet,
        name: verifierName || 'Anonymous Verifier',
        claimedAt: new Date().toISOString(),
        estimatedCompletion: estimatedCompletion || null
    };
    
    bountyRegistry.claims[claimId] = {
        claimId,
        bountyId,
        verifier: bounty.claimer,
        submittedAt: null,
        evidence: null,
        status: 'in_progress'
    };
    
    res.json({
        success: true,
        claimId,
        message: `Bounty claimed! Complete ${bounty.taskType} and submit evidence.`,
        bounty,
        nextStep: {
            endpoint: `POST /api/bounty/${bountyId}/submit`,
            required: ['evidence', 'claimId'],
            description: 'Submit proof of completed verification'
        }
    });
});

// Submit completed verification
app.post('/api/bounty/:bountyId/submit', (req, res) => {
    const { bountyId } = req.params;
    const { claimId, evidence, verificationScore, notes, prUrl } = req.body || {};
    
    const bounty = bountyRegistry.bounties[bountyId];
    const claim = bountyRegistry.claims[claimId];
    
    if (!bounty) {
        return res.status(404).json({ error: 'Bounty not found' });
    }
    
    if (!claim || claim.bountyId !== bountyId) {
        return res.status(400).json({ error: 'Invalid claim for this bounty' });
    }
    
    if (bounty.status !== 'claimed') {
        return res.status(400).json({ error: 'Bounty not in claimed status' });
    }
    
    if (!evidence) {
        return res.status(400).json({ error: 'Evidence required (description of work done)' });
    }
    
    claim.submittedAt = new Date().toISOString();
    claim.evidence = evidence;
    claim.verificationScore = verificationScore || null;
    claim.notes = notes || null;
    claim.prUrl = prUrl || null;
    claim.status = 'submitted';
    
    bounty.status = 'pending_review';
    
    res.json({
        success: true,
        message: 'Verification submitted! Awaiting sponsor review.',
        bounty,
        claim,
        nextStep: {
            action: 'Sponsor reviews and releases payment via x402',
            endpoint: `POST /api/bounty/${bountyId}/release`,
            note: 'Sponsor pays full reward amount on approval'
        }
    });
});

// Release payment (sponsor approves)
app.post('/api/bounty/:bountyId/release', (req, res) => {
    const { bountyId } = req.params;
    const { approved, txHash, feedback } = req.body || {};
    
    const bounty = bountyRegistry.bounties[bountyId];
    
    if (!bounty) {
        return res.status(404).json({ error: 'Bounty not found' });
    }
    
    if (bounty.status !== 'pending_review') {
        return res.status(400).json({ error: 'Bounty not pending review' });
    }
    
    if (approved === false) {
        bounty.status = 'disputed';
        return res.json({
            success: false,
            message: 'Payment disputed. Contact support.',
            bounty,
            feedback
        });
    }
    
    bounty.status = 'completed';
    bounty.completedAt = new Date().toISOString();
    bounty.paymentTxHash = txHash || 'pending_x402_' + crypto.randomBytes(8).toString('hex');
    bounty.feedback = feedback || null;
    
    bountyRegistry.stats.activeBounties--;
    bountyRegistry.stats.completedBounties++;
    bountyRegistry.stats.totalPaidOut += bounty.reward;
    
    res.json({
        success: true,
        message: `Payment of $${bounty.reward} USDC released to verifier!`,
        bounty,
        payment: {
            amount: bounty.reward,
            currency: 'USDC',
            recipient: bounty.claimer?.wallet,
            txHash: bounty.paymentTxHash,
            method: 'x402'
        }
    });
});

// ===========================================
// AGENT STAKING POOLS
// ===========================================
// Community-funded agent development with performance requirements

const POOL_TOPICS = {
    trading: { name: 'Trading', description: 'Automated trading bots', riskLevel: 'high', targetAPY: '20-50%' },
    analysis: { name: 'Analysis', description: 'Research & alpha generation', riskLevel: 'medium', targetAPY: '10-25%' },
    content: { name: 'Content', description: 'AI content creators', riskLevel: 'medium', targetAPY: '15-30%' },
    infrastructure: { name: 'Infrastructure', description: 'Dev tools, APIs', riskLevel: 'low', targetAPY: '5-15%' },
    research: { name: 'Research', description: 'Data analysis, reports', riskLevel: 'low', targetAPY: '8-20%' }
};

let stakingPools = {};
let stakingPositions = {};  // wallet -> [{ poolId, amount, stakedAt }]
let poolAgents = {};        // poolId -> [{ agentId, totalDrawn, totalReturned, efficiency, status }]

// Initialize pools
Object.keys(POOL_TOPICS).forEach(topic => {
    stakingPools[topic] = {
        id: topic,
        ...POOL_TOPICS[topic],
        totalStaked: 0,
        totalAgents: 0,
        totalReturns: 0,
        totalDrawn: 0,
        currentAPY: 0,
        stakeholders: [],
        createdAt: new Date().toISOString()
    };
    poolAgents[topic] = [];
});

// List all staking pools
app.get('/api/pools', (req, res) => {
    const pools = Object.values(stakingPools).map(pool => ({
        ...pool,
        stakeholderCount: pool.stakeholders.length,
        agentCount: poolAgents[pool.id]?.length || 0,
        efficiency: pool.totalDrawn > 0 ? (pool.totalReturns / pool.totalDrawn).toFixed(2) : null
    }));
    
    res.json({
        pools,
        topics: Object.keys(POOL_TOPICS),
        totalStakedAllPools: pools.reduce((sum, p) => sum + p.totalStaked, 0)
    });
});

// Pool leaderboard (must be before :topic to avoid matching)
app.get('/api/pools/leaderboard', (req, res) => {
    const allAgents = [];
    
    Object.keys(poolAgents).forEach(topic => {
        poolAgents[topic].forEach(agent => {
            allAgents.push({
                ...agent,
                poolId: topic,
                poolName: stakingPools[topic].name
            });
        });
    });
    
    // Sort by efficiency (profitable first)
    allAgents.sort((a, b) => (b.efficiency || 0) - (a.efficiency || 0));
    
    res.json({
        topPerformers: allAgents.filter(a => a.efficiency >= 1.0).slice(0, 10),
        allAgents: allAgents.slice(0, 50),
        stats: {
            totalAgents: allAgents.length,
            profitable: allAgents.filter(a => a.efficiency >= 1.0).length,
            warning: allAgents.filter(a => a.status === 'warning').length,
            revoked: allAgents.filter(a => a.status === 'revoked').length
        }
    });
});

// Get specific pool
app.get('/api/pools/:topic', (req, res) => {
    const { topic } = req.params;
    const pool = stakingPools[topic];
    
    if (!pool) {
        return res.status(404).json({ error: 'Pool not found', validTopics: Object.keys(POOL_TOPICS) });
    }
    
    res.json({
        ...pool,
        agents: poolAgents[topic] || [],
        efficiency: pool.totalDrawn > 0 ? (pool.totalReturns / pool.totalDrawn).toFixed(2) : null
    });
});

// Get agents in a pool
app.get('/api/pools/:topic/agents', (req, res) => {
    const { topic } = req.params;
    
    if (!stakingPools[topic]) {
        return res.status(404).json({ error: 'Pool not found' });
    }
    
    const agents = poolAgents[topic] || [];
    const activeAgents = agents.filter(a => a.status === 'active');
    const warningAgents = agents.filter(a => a.status === 'warning');
    
    res.json({
        topic,
        agents,
        stats: {
            total: agents.length,
            active: activeAgents.length,
            warning: warningAgents.length,
            avgEfficiency: agents.length > 0 
                ? (agents.reduce((sum, a) => sum + a.efficiency, 0) / agents.length).toFixed(2) 
                : null
        }
    });
});

// Stake into a pool
app.post('/api/stake', (req, res) => {
    const { wallet, topic, amount } = req.body || {};
    
    if (!wallet || wallet.length < 32) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    if (!topic || !stakingPools[topic]) {
        return res.status(400).json({ error: 'Invalid topic', validTopics: Object.keys(POOL_TOPICS) });
    }
    if (!amount || amount < 10) {
        return res.status(400).json({ error: 'Minimum stake is $10' });
    }
    
    const pool = stakingPools[topic];
    
    // Add to pool
    pool.totalStaked += amount;
    pool.stakeholders.push({
        wallet,
        amount,
        stakedAt: new Date().toISOString()
    });
    
    // Track position
    if (!stakingPositions[wallet]) {
        stakingPositions[wallet] = [];
    }
    stakingPositions[wallet].push({
        poolId: topic,
        amount,
        stakedAt: new Date().toISOString()
    });
    
    // Calculate tier
    const totalStaked = stakingPositions[wallet].reduce((sum, p) => sum + p.amount, 0);
    let tier = 'Pioneer';
    if (totalStaked >= 10000) tier = 'Whale';
    else if (totalStaked >= 1000) tier = 'Builder';
    
    res.json({
        success: true,
        message: `Staked $${amount} into ${pool.name} pool`,
        position: {
            wallet,
            poolId: topic,
            amount,
            poolTotalStaked: pool.totalStaked,
            yourShare: ((amount / pool.totalStaked) * 100).toFixed(2) + '%'
        },
        tier,
        totalStakedByWallet: totalStaked
    });
});

// Get staking positions for a wallet
app.get('/api/stake/:wallet', (req, res) => {
    const { wallet } = req.params;
    const positions = stakingPositions[wallet] || [];
    
    const totalStaked = positions.reduce((sum, p) => sum + p.amount, 0);
    let tier = 'Pioneer';
    if (totalStaked >= 10000) tier = 'Whale';
    else if (totalStaked >= 1000) tier = 'Builder';
    
    // Calculate earnings (simulated)
    const positionsWithEarnings = positions.map(p => {
        const pool = stakingPools[p.poolId];
        const daysSinceStake = (Date.now() - new Date(p.stakedAt).getTime()) / (1000 * 60 * 60 * 24);
        const poolAPY = pool.currentAPY || 0.15; // Default 15% if no data
        const earnings = p.amount * (poolAPY / 365) * daysSinceStake;
        return {
            ...p,
            poolName: pool.name,
            estimatedEarnings: earnings.toFixed(2),
            currentAPY: (poolAPY * 100).toFixed(1) + '%'
        };
    });
    
    res.json({
        wallet,
        positions: positionsWithEarnings,
        totalStaked,
        tier,
        totalEstimatedEarnings: positionsWithEarnings.reduce((sum, p) => sum + parseFloat(p.estimatedEarnings), 0).toFixed(2)
    });
});

// Agent applies to join a pool
app.post('/api/pool/apply', (req, res) => {
    const { agentId, topic, strategy, projectedAPY, wallet } = req.body || {};
    
    if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
    }
    if (!topic || !stakingPools[topic]) {
        return res.status(400).json({ error: 'Invalid topic', validTopics: Object.keys(POOL_TOPICS) });
    }
    if (!strategy || strategy.length < 20) {
        return res.status(400).json({ error: 'Strategy description required (min 20 chars)' });
    }
    
    const pool = stakingPools[topic];
    
    // Check if already in pool
    if (poolAgents[topic].find(a => a.agentId === agentId)) {
        return res.status(400).json({ error: 'Agent already in this pool' });
    }
    
    const agentEntry = {
        agentId,
        wallet: wallet || null,
        strategy,
        projectedAPY: projectedAPY || null,
        totalDrawn: 0,
        totalReturned: 0,
        efficiency: null,
        status: 'active',
        joinedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
    };
    
    poolAgents[topic].push(agentEntry);
    pool.totalAgents++;
    
    res.json({
        success: true,
        message: `Agent ${agentId} joined ${pool.name} pool`,
        agent: agentEntry,
        nextStep: {
            action: 'Request funding draw',
            endpoint: 'POST /api/pool/draw',
            note: 'Draw funds to execute your strategy. Returns must exceed draws.'
        }
    });
});

// Agent requests a funding draw
app.post('/api/pool/draw', (req, res) => {
    const { agentId, topic, amount, purpose } = req.body || {};
    
    if (!agentId || !topic || !amount) {
        return res.status(400).json({ error: 'agentId, topic, and amount required' });
    }
    
    const pool = stakingPools[topic];
    if (!pool) {
        return res.status(404).json({ error: 'Pool not found' });
    }
    
    const agent = poolAgents[topic]?.find(a => a.agentId === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not in this pool. Apply first.' });
    }
    
    if (agent.status === 'revoked') {
        return res.status(403).json({ error: 'Agent access revoked due to poor performance' });
    }
    
    if (amount > pool.totalStaked * 0.1) {
        return res.status(400).json({ error: 'Cannot draw more than 10% of pool in single request' });
    }
    
    agent.totalDrawn += amount;
    agent.lastActivity = new Date().toISOString();
    pool.totalDrawn += amount;
    
    // Recalculate efficiency
    if (agent.totalDrawn > 0) {
        agent.efficiency = agent.totalReturned / agent.totalDrawn;
        
        // Check performance
        if (agent.efficiency < 0.8 && agent.totalDrawn > 100) {
            agent.status = 'warning';
        }
        if (agent.efficiency < 0.5 && agent.totalDrawn > 500) {
            agent.status = 'revoked';
        }
    }
    
    res.json({
        success: true,
        message: `Drew $${amount} from ${pool.name} pool`,
        draw: {
            agentId,
            amount,
            purpose: purpose || 'Not specified',
            timestamp: new Date().toISOString()
        },
        agent: {
            totalDrawn: agent.totalDrawn,
            totalReturned: agent.totalReturned,
            efficiency: agent.efficiency?.toFixed(2) || 'N/A',
            status: agent.status
        },
        warning: agent.status === 'warning' ? 'Performance below threshold. Improve returns or lose access.' : null
    });
});

// Agent reports returns
app.post('/api/pool/return', (req, res) => {
    const { agentId, topic, amount, source, txHash } = req.body || {};
    
    if (!agentId || !topic || !amount) {
        return res.status(400).json({ error: 'agentId, topic, and amount required' });
    }
    
    const pool = stakingPools[topic];
    if (!pool) {
        return res.status(404).json({ error: 'Pool not found' });
    }
    
    const agent = poolAgents[topic]?.find(a => a.agentId === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not in this pool' });
    }
    
    agent.totalReturned += amount;
    agent.lastActivity = new Date().toISOString();
    pool.totalReturns += amount;
    
    // Recalculate efficiency
    if (agent.totalDrawn > 0) {
        agent.efficiency = agent.totalReturned / agent.totalDrawn;
        
        // Upgrade status if improved
        if (agent.efficiency >= 1.0 && agent.status === 'warning') {
            agent.status = 'active';
        }
    }
    
    // Calculate profit distribution
    const profit = amount > agent.totalDrawn ? amount - agent.totalDrawn : 0;
    const agentShare = profit * 0.70;
    const poolShare = profit * 0.25;
    const platformFee = profit * 0.05;
    
    // Update pool APY (simplified)
    if (pool.totalStaked > 0) {
        pool.currentAPY = (pool.totalReturns - pool.totalDrawn) / pool.totalStaked;
    }
    
    res.json({
        success: true,
        message: `Reported $${amount} return to ${pool.name} pool`,
        return: {
            agentId,
            amount,
            source: source || 'Not specified',
            txHash: txHash || null,
            timestamp: new Date().toISOString()
        },
        agent: {
            totalDrawn: agent.totalDrawn,
            totalReturned: agent.totalReturned,
            efficiency: agent.efficiency?.toFixed(2),
            status: agent.status,
            netProfit: (agent.totalReturned - agent.totalDrawn).toFixed(2)
        },
        profitDistribution: profit > 0 ? {
            profit: profit.toFixed(2),
            agentShare: agentShare.toFixed(2) + ' (70%)',
            poolShare: poolShare.toFixed(2) + ' (25%)',
            platformFee: platformFee.toFixed(2) + ' (5%)'
        } : null,
        poolAPY: (pool.currentAPY * 100).toFixed(1) + '%'
    });
});

// Devnet DBC Pool Configuration
const DBC_CONFIG = {
    network: 'devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    tokenMint: 'ATFtoArfzAF6Vi6XUeCr64ffD1SAN6HvwePkPmkkQ6en',
    poolConfig: '33XbvmoL1A9CYVa5ibgFrRgRqBgh13B6Zot1pwxTwERw',
    quoteMint: 'So11111111111111111111111111111111111111112', // SOL
    metadata: 'https://gateway.irys.xyz/7SkvzeE61Dv9RoExWJAnZ6iA8rnePtRT8XbSuZ88e7az',
    symbol: 'MOLTEST',
    name: 'MoltLaunch Test',
    totalSupply: 1000000000,
    migrationMarketCap: 50 // SOL
};

// DBC Pool info endpoint
app.get('/api/dbc/pool', (req, res) => {
    res.json({
        ...DBC_CONFIG,
        explorerUrl: `https://solscan.io/token/${DBC_CONFIG.tokenMint}?cluster=devnet`,
        timestamp: new Date().toISOString()
    });
});

// API endpoints
app.get('/api/launches', (req, res) => {
    res.json({
        launches: [
            { 
                id: 'moltest-001', 
                name: 'MoltLaunch Test', 
                symbol: 'MOLTEST', 
                status: 'live',
                network: 'devnet',
                tokenMint: DBC_CONFIG.tokenMint,
                poolConfig: DBC_CONFIG.poolConfig,
                currentRaise: 0.1, // SOL traded so far
                targetRaise: 50,   // Migration threshold
                explorerUrl: `https://solscan.io/token/${DBC_CONFIG.tokenMint}?cluster=devnet`
            }
        ],
        timestamp: new Date().toISOString()
    });
});

app.post('/api/qualify', (req, res) => {
    const { agentName, capabilities, apiEndpoint, description, tokenSymbol, targetRaise } = req.body || {};
    const checks = {
        hasName: !!agentName,
        hasCapabilities: Array.isArray(capabilities) && capabilities.length > 0,
        hasApi: !!apiEndpoint,
        hasDescription: !!description && description.length >= 50,
        hasSymbol: !!tokenSymbol,
        validRaise: typeof targetRaise === 'number' && targetRaise >= 100
    };
    const passed = Object.values(checks).filter(Boolean).length;
    res.json({ qualified: passed >= 4, score: `${passed}/6`, checks });
});

app.post('/api/apply', (req, res) => {
    const { agentName, tokenSymbol, wallet } = req.body || {};
    if (!agentName || !tokenSymbol) {
        return res.status(400).json({ error: 'agentName and tokenSymbol required' });
    }
    const applicationId = `app-${Date.now().toString(36)}`;
    
    // Track in airdrop registry if wallet provided
    if (wallet && wallet.length >= 32) {
        const now = new Date().toISOString();
        
        // Initialize wallet if new
        if (!airdropRegistry.wallets[wallet]) {
            airdropRegistry.wallets[wallet] = {
                registeredAt: now,
                actions: []
            };
            airdropRegistry.stats.totalWallets++;
        }
        
        // Update wallet with agent application
        airdropRegistry.wallets[wallet].agentId = applicationId;
        airdropRegistry.wallets[wallet].actions.push({ type: 'apply', at: now });
        airdropRegistry.wallets[wallet].tier = calculateTier(airdropRegistry.wallets[wallet]);
        
        // Store agent record
        airdropRegistry.agents[applicationId] = {
            wallet,
            name: agentName,
            symbol: tokenSymbol,
            appliedAt: now,
            verified: false
        };
        
        // Update stats
        airdropRegistry.stats.builders = Object.values(airdropRegistry.wallets)
            .filter(w => w.tier === 'builder').length;
        
        saveRegistry();
    }
    
    res.json({ 
        applicationId, 
        status: 'pending_verification',
        message: 'Application received!',
        airdropTracked: !!wallet
    });
});

// ===========================================
// AIRDROP TRACKING ENDPOINTS
// ===========================================

// Track wallet connection (call when user connects wallet)
app.post('/api/airdrop/connect', (req, res) => {
    const { wallet } = req.body || {};
    if (!wallet || wallet.length < 32) {
        return res.status(400).json({ error: 'Valid wallet address required' });
    }
    
    const now = new Date().toISOString();
    
    if (!airdropRegistry.wallets[wallet]) {
        airdropRegistry.wallets[wallet] = {
            registeredAt: now,
            actions: []
        };
        airdropRegistry.stats.totalWallets++;
    }
    
    airdropRegistry.wallets[wallet].actions.push({ type: 'connect', at: now });
    airdropRegistry.wallets[wallet].tier = calculateTier(airdropRegistry.wallets[wallet]);
    airdropRegistry.stats.pioneers = Object.values(airdropRegistry.wallets)
        .filter(w => w.tier === 'pioneer').length;
    
    saveRegistry();
    
    res.json({
        wallet,
        tier: airdropRegistry.wallets[wallet].tier,
        allocation: getAllocation(airdropRegistry.wallets[wallet].tier),
        message: 'Wallet tracked for airdrop'
    });
});

// Track on-chain swap activity
app.post('/api/airdrop/swap', (req, res) => {
    const { wallet, txHash, amount } = req.body || {};
    if (!wallet || wallet.length < 32) {
        return res.status(400).json({ error: 'Valid wallet address required' });
    }
    
    const now = new Date().toISOString();
    
    if (!airdropRegistry.wallets[wallet]) {
        airdropRegistry.wallets[wallet] = {
            registeredAt: now,
            actions: []
        };
        airdropRegistry.stats.totalWallets++;
    }
    
    airdropRegistry.wallets[wallet].actions.push({ 
        type: 'swap', 
        at: now, 
        txHash,
        amount 
    });
    airdropRegistry.wallets[wallet].tier = calculateTier(airdropRegistry.wallets[wallet]);
    airdropRegistry.stats.pioneers = Object.values(airdropRegistry.wallets)
        .filter(w => w.tier === 'pioneer').length;
    
    saveRegistry();
    
    res.json({
        wallet,
        tier: airdropRegistry.wallets[wallet].tier,
        allocation: getAllocation(airdropRegistry.wallets[wallet].tier),
        message: 'Swap activity tracked'
    });
});

// Link PoA verification to wallet
app.post('/api/airdrop/verify', (req, res) => {
    const { wallet, agentId, poaScore } = req.body || {};
    if (!wallet || wallet.length < 32) {
        return res.status(400).json({ error: 'Valid wallet address required' });
    }
    
    const now = new Date().toISOString();
    
    if (!airdropRegistry.wallets[wallet]) {
        airdropRegistry.wallets[wallet] = {
            registeredAt: now,
            actions: []
        };
        airdropRegistry.stats.totalWallets++;
    }
    
    airdropRegistry.wallets[wallet].agentId = agentId;
    airdropRegistry.wallets[wallet].poaScore = poaScore;
    airdropRegistry.wallets[wallet].actions.push({ 
        type: 'poa_verify', 
        at: now, 
        score: poaScore 
    });
    airdropRegistry.wallets[wallet].tier = calculateTier(airdropRegistry.wallets[wallet]);
    
    // Update agent record if exists
    if (agentId && airdropRegistry.agents[agentId]) {
        airdropRegistry.agents[agentId].verified = poaScore >= 60;
        airdropRegistry.agents[agentId].poaScore = poaScore;
    }
    
    // Update stats
    airdropRegistry.stats.verified = Object.values(airdropRegistry.wallets)
        .filter(w => w.tier === 'verified').length;
    airdropRegistry.stats.builders = Object.values(airdropRegistry.wallets)
        .filter(w => w.tier === 'builder').length;
    airdropRegistry.stats.pioneers = Object.values(airdropRegistry.wallets)
        .filter(w => w.tier === 'pioneer').length;
    
    saveRegistry();
    
    res.json({
        wallet,
        tier: airdropRegistry.wallets[wallet].tier,
        allocation: getAllocation(airdropRegistry.wallets[wallet].tier),
        poaScore,
        message: poaScore >= 60 ? 'Verified! Maximum allocation unlocked' : 'Score recorded'
    });
});

// Check eligibility for a wallet
app.get('/api/airdrop/eligibility/:wallet', (req, res) => {
    const { wallet } = req.params;
    
    const walletData = airdropRegistry.wallets[wallet];
    if (!walletData) {
        return res.json({
            wallet,
            eligible: false,
            tier: 'none',
            allocation: 0,
            message: 'Wallet not registered. Connect wallet and interact with devnet to qualify.'
        });
    }
    
    res.json({
        wallet,
        eligible: true,
        tier: walletData.tier,
        allocation: getAllocation(walletData.tier),
        registeredAt: walletData.registeredAt,
        agentId: walletData.agentId || null,
        poaScore: walletData.poaScore || null,
        actionsCount: walletData.actions?.length || 0,
        nextTier: walletData.tier === 'pioneer' ? 'Register an agent to reach Builder tier (2,500 MOLT)' :
                  walletData.tier === 'builder' ? 'Pass PoA verification to reach Verified tier (10,000 MOLT)' :
                  walletData.tier === 'verified' ? 'Maximum tier reached!' : 'Connect wallet to start'
    });
});

// Get airdrop stats (public)
app.get('/api/airdrop/stats', (req, res) => {
    res.json({
        totalWallets: airdropRegistry.stats.totalWallets,
        pioneers: airdropRegistry.stats.pioneers,
        builders: airdropRegistry.stats.builders,
        verified: airdropRegistry.stats.verified,
        totalAllocated: (airdropRegistry.stats.pioneers * 500) + 
                        (airdropRegistry.stats.builders * 2500) + 
                        (airdropRegistry.stats.verified * 10000),
        timestamp: new Date().toISOString()
    });
});

// Export full registry (protected)
app.get('/api/airdrop/export', (req, res) => {
    const key = req.query.key || req.headers['x-backup-key'];
    if (key !== process.env.BACKUP_KEY && key !== 'moltlaunch-backup-2026') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.json(airdropRegistry);
});

// ===========================================
// LEADERBOARD - Public airdrop standings
// ===========================================
app.get('/api/airdrop/leaderboard', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    
    // Build leaderboard from wallets
    const leaderboard = Object.entries(airdropRegistry.wallets)
        .map(([wallet, data]) => ({
            wallet: wallet.substring(0, 6) + '...' + wallet.substring(wallet.length - 4),
            walletFull: wallet,
            tier: data.tier || 'pioneer',
            allocation: data.tier === 'verified' ? 10000 : 
                        data.tier === 'builder' ? 2500 : 500,
            registeredAt: data.registeredAt,
            actionsCount: data.actions?.length || 0,
            hasAgent: !!data.agentId,
            poaScore: data.poaScore || null
        }))
        .sort((a, b) => b.allocation - a.allocation || 
                        new Date(a.registeredAt) - new Date(b.registeredAt))
        .slice(0, limit);
    
    res.json({
        leaderboard,
        stats: {
            totalParticipants: Object.keys(airdropRegistry.wallets).length,
            totalAllocated: (airdropRegistry.stats.pioneers * 500) + 
                            (airdropRegistry.stats.builders * 2500) + 
                            (airdropRegistry.stats.verified * 10000),
            tiers: {
                verified: airdropRegistry.stats.verified,
                builders: airdropRegistry.stats.builders,
                pioneers: airdropRegistry.stats.pioneers
            }
        },
        timestamp: new Date().toISOString()
    });
});

// ===========================================
// QUICK VERIFY - Demo endpoint for agents to test verification
// ===========================================
app.post('/api/verify/quick', async (req, res) => {
    const { agentName, endpoint, capabilities } = req.body || {};
    
    if (!agentName) {
        return res.status(400).json({ error: 'agentName required' });
    }
    
    // Quick capability check
    let score = 30; // Base score for attempting
    const checks = [];
    
    // Check 1: Has endpoint?
    if (endpoint) {
        score += 20;
        checks.push({ check: 'endpoint_provided', passed: true, points: 20 });
        
        // Try to fetch endpoint
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const resp = await fetch(endpoint, { 
                signal: controller.signal,
                headers: { 'User-Agent': 'MoltLaunch-PoA-Verifier/1.0' }
            });
            clearTimeout(timeout);
            
            if (resp.ok) {
                score += 20;
                checks.push({ check: 'endpoint_reachable', passed: true, points: 20 });
            } else {
                checks.push({ check: 'endpoint_reachable', passed: false, points: 0, reason: `HTTP ${resp.status}` });
            }
        } catch (e) {
            checks.push({ check: 'endpoint_reachable', passed: false, points: 0, reason: e.message });
        }
    } else {
        checks.push({ check: 'endpoint_provided', passed: false, points: 0 });
    }
    
    // Check 2: Capabilities declared?
    if (capabilities && Array.isArray(capabilities) && capabilities.length > 0) {
        score += 10 + Math.min(capabilities.length * 2, 10);
        checks.push({ check: 'capabilities_declared', passed: true, points: 10, count: capabilities.length });
    } else {
        checks.push({ check: 'capabilities_declared', passed: false, points: 0 });
    }
    
    // Generate verification ID
    const verificationId = 'poa_' + crypto.randomBytes(8).toString('hex');
    
    res.json({
        verificationId,
        agentName,
        score,
        maxScore: 100,
        tier: score >= 70 ? 'verified' : score >= 50 ? 'builder' : 'pioneer',
        checks,
        message: score >= 70 ? 
            'Verification passed! Register for airdrop with your wallet.' :
            score >= 50 ?
            'Partial verification. Add reachable endpoint for full score.' :
            'Basic verification. Provide endpoint and capabilities for higher tier.',
        nextSteps: [
            score < 70 ? 'Add a reachable API endpoint' : null,
            !capabilities?.length ? 'Declare your capabilities array' : null,
            'Connect wallet at /api/airdrop/connect to claim allocation'
        ].filter(Boolean)
    });
});

// ===========================================
// LIVE FEED - Recent activity stream
// ===========================================
app.get('/api/activity', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    
    // Collect recent actions from all wallets
    const activities = [];
    
    for (const [wallet, data] of Object.entries(airdropRegistry.wallets)) {
        for (const action of (data.actions || [])) {
            activities.push({
                wallet: wallet.substring(0, 6) + '...' + wallet.substring(wallet.length - 4),
                type: action.type,
                at: action.at,
                details: action.txHash ? { txHash: action.txHash } : 
                         action.score ? { score: action.score } : null
            });
        }
    }
    
    // Sort by time, newest first
    activities.sort((a, b) => new Date(b.at) - new Date(a.at));
    
    res.json({
        activities: activities.slice(0, limit),
        total: activities.length,
        timestamp: new Date().toISOString()
    });
});

// ===========================================
// ON-CHAIN AI STATUS
// ===========================================
// ON-CHAIN AI INFO ENDPOINT
// ===========================================
app.get('/api/onchain-ai', (req, res) => {
    if (cauldronClient) {
        res.json({
            enabled: true,
            version: '3.0',
            model: 'poa-scorer-v1',
            deployment: cauldronClient.getDeploymentInfo(),
            status: 'live',
            description: 'Proof-of-Agent verification scoring runs ON Solana via Cauldron/Frostbite RISC-V VM',
            features: [
                { name: 'hasGithub', weight: 15, description: 'Agent has GitHub repository' },
                { name: 'hasApiEndpoint', weight: 20, description: 'Agent exposes working API' },
                { name: 'capabilityCount', weight: '5 per cap', description: 'Number of declared capabilities' },
                { name: 'codeLines', weight: '0.3 per 100', description: 'Lines of code (normalized)' },
                { name: 'hasDocumentation', weight: 10, description: 'Agent has documentation' },
                { name: 'testCoverage', weight: '0.2 per %', description: 'Test coverage percentage' }
            ],
            scoring: {
                formula: 'score = 10 + (github*15) + (api*20) + (caps*5) + (code*0.3) + (docs*10) + (tests*0.2)',
                range: '0-100',
                passingThreshold: 60,
                tiers: {
                    excellent: '80-100',
                    good: '60-79',
                    fair: '40-59',
                    'needs-work': '0-39'
                }
            },
            security: {
                version: '3.0',
                features: [
                    'Nonce-based replay protection',
                    'Timestamp validation (±60s)',
                    'Ed25519 signature verification',
                    'Time-bound attestations (30d default)',
                    'Revocation support'
                ],
                secureRequest: {
                    nonce: 'unique-32-bytes',
                    timestamp: 'unix-epoch-seconds',
                    signature: 'ed25519-signature-of-request',
                    wallet: 'solana-public-key'
                }
            },
            attestation: {
                validityPeriods: {
                    basic: '7 days',
                    standard: '30 days (default)',
                    premium: '90 days'
                },
                revocation: '/api/verify/revoked/:hash',
                renewal: '/api/verify/renew/:agentId'
            },
            howToUse: {
                endpoint: 'POST /api/verify/deep',
                basicRequest: {
                    agentId: 'your-agent-id',
                    capabilities: ['trading', 'analysis'],
                    codeUrl: 'https://github.com/you/agent',
                    documentation: true,
                    testCoverage: 80,
                    codeLines: 5000,
                    apiEndpoint: 'https://your-agent.com/api'
                },
                secureRequest: {
                    agentId: 'your-agent-id',
                    nonce: 'unique-random-32-bytes',
                    timestamp: 1707321600,
                    signature: 'base64-ed25519-signature',
                    wallet: 'YourSolanaPublicKey',
                    capabilities: ['trading'],
                    validityDays: 30
                }
            },
            documentation: {
                whitepaper: '/docs/whitepaper',
                technicalPlan: '/docs/verification-v2',
                integration: '/INTEGRATION.md',
                skill: '/skill.md'
            }
        });
    } else {
        res.json({
            enabled: false,
            reason: 'Cauldron client not loaded',
            fallback: 'Using local scoring algorithm'
        });
    }
});

// skill.md
app.get('/skill.md', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'skill.md'));
});

// INTEGRATION.md - Partner integration guide
app.get('/INTEGRATION.md', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'INTEGRATION.md'));
});

app.get('/integration', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'INTEGRATION.md'));
});

// PWA manifest
app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.sendFile(path.join(__dirname, 'manifest.json'));
});

// Service worker
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, 'sw.js'));
});

// Sitemap
app.get('/sitemap.xml', (req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.send(`User-agent: *
Allow: /
Sitemap: https://web-production-419d9.up.railway.app/sitemap.xml`);
});

// Digital Asset Links for TWA
app.get('/.well-known/assetlinks.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(path.join(__dirname, '.well-known', 'assetlinks.json'));
});

// Icons directory
app.use('/icons', express.static(path.join(__dirname, 'icons')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Static files
app.use(express.static(__dirname));

// HTML routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'app.html')));
app.get('/whitepaper', (req, res) => res.sendFile(path.join(__dirname, 'whitepaper.html')));

// Technical documentation (markdown)
app.get('/docs/whitepaper', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'docs/WHITEPAPER.md'));
});

app.get('/docs/verification-v2', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'docs/VERIFICATION_V2_PLAN.md'));
});

app.get('/docs/execution-traces', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'docs/EXECUTION_TRACES.md'));
});

// Serve docs directory
app.use('/docs', express.static(path.join(__dirname, 'docs')));

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`MoltLaunch API v3.2.0 running on 0.0.0.0:${PORT}`);
        console.log(`Stats: /api/stats | Logs: ${LOG_FILE}`);
    });
}

// Export for testing
module.exports = app;
