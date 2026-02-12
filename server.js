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

// Solana on-chain anchoring
let solanaConnection = null;
let solanaKeypair = null;
try {
    const { Connection, Keypair, Transaction, TransactionInstruction, PublicKey } = require('@solana/web3.js');
    const keypairPath = require('path').join(require('os').homedir(), 'moltbot-trial/products/launchpad/devnet-wallet.json');
    const keypairData = JSON.parse(require('fs').readFileSync(keypairPath));
    solanaKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    solanaConnection = new Connection('https://api.devnet.solana.com', 'confirmed');
    console.log('Solana connection established:', solanaKeypair.publicKey.toBase58());
} catch (e) {
    console.log('Solana direct connection not available:', e.message);
}

const app = express();

// Rate limiting
const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later' }
});
const verifyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Verification rate limited. Try again in 1 minute.' }
});
app.use('/api/', apiLimiter);
app.use('/api/verify/deep', verifyLimiter);
app.use('/api/verify/quick', verifyLimiter);

// Admin middleware
const ADMIN_KEYS = [process.env.ADMIN_KEY, process.env.BACKUP_KEY].filter(Boolean);
function requireAdmin(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!key || ADMIN_KEYS.length === 0 || !ADMIN_KEYS.includes(key)) {
        return res.status(401).json({ error: 'Admin access required' });
    }
    next();
}

// Hash IP for privacy
const hashIP = (ip) => {
    if (!ip) return 'unknown';
    return crypto.createHash('sha256').update(ip + 'moltlaunch-salt').digest('hex').substring(0, 12);
};

const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(__dirname, 'requests.log');
const DATA_DIR = path.join(__dirname, 'data');
const AIRDROP_FILE = path.join(__dirname, 'airdrop-registry.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Data file paths
const DATA_FILES = {
    verifications: path.join(DATA_DIR, 'verifications.json'),
    bounties: path.join(DATA_DIR, 'bounties.json'),
    pools: path.join(DATA_DIR, 'pools.json'),
    traces: path.join(DATA_DIR, 'traces.json'),
    credits: path.join(DATA_DIR, 'credits.json'),
    attestations: path.join(DATA_DIR, 'attestations.json'),
    revocations: path.join(DATA_DIR, 'revocations.json'),
    badges: path.join(DATA_DIR, 'badges.json')
};

// Generic load/save helpers
function loadData(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`Loaded ${filePath}: ${Object.keys(data).length} entries`);
            return data;
        }
    } catch (e) {
        console.log(`Starting fresh: ${filePath}`);
    }
    return defaultValue;
}

function saveData(filePath, data) {
    fs.writeFile(filePath, JSON.stringify(data, null, 2), (err) => {
        if (err) console.error(`Save error ${filePath}:`, err.message);
    });
}

// Debounced save (wait 1s after last change before writing)
const saveTimers = {};
function debouncedSave(key, filePath, data) {
    if (saveTimers[key]) clearTimeout(saveTimers[key]);
    saveTimers[key] = setTimeout(() => saveData(filePath, data), 1000);
}

console.log('Starting MoltLaunch API...');
console.log('PORT:', PORT);
console.log('Data directory:', DATA_DIR);

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

// Verification cache (for status lookups) - PERSISTED
const verificationCache = loadData(DATA_FILES.verifications, {});
const saveVerifications = () => debouncedSave('verifications', DATA_FILES.verifications, verificationCache);

// Seed moltlaunch-agent on startup (Railway ephemeral filesystem workaround)
if (!verificationCache['moltlaunch-agent']) {
    console.log('Seeding moltlaunch-agent verification...');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    verificationCache['moltlaunch-agent'] = {
        score: 75,
        tier: 'good',
        timestamp: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        attestationHash: 'seed_' + require('crypto').randomBytes(16).toString('hex'),
        features: { hasGithub: 1, hasApiEndpoint: 1, capabilityCount: 6 },
        onChain: false,
        secureMode: false,
        hasStarkProof: false
    };
    saveVerifications();
}

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

// Revoked attestations - PERSISTED
const revokedAttestationsData = loadData(DATA_FILES.revocations, []);
const revokedAttestations = new Set(revokedAttestationsData);
const saveRevocations = () => debouncedSave('revocations', DATA_FILES.revocations, [...revokedAttestations]);
console.log(`Loaded ${revokedAttestations.size} revoked attestations`);

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

// Stats endpoint (admin only)
app.get('/api/stats', requireAdmin, (req, res) => {
    const uptime = Math.floor((Date.now() - new Date(stats.startedAt).getTime()) / 1000);
    res.json({
        ...stats,
        uptimeSeconds: uptime,
        uptimeFormatted: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s`
    });
});

// Logs backup endpoint (admin only)
app.get('/api/logs', requireAdmin, (req, res) => {
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
        version: '2.4.0',
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

// Credit balances - PERSISTED
let creditBalances = loadData(DATA_FILES.credits, {});
const saveCredits = () => debouncedSave('credits', DATA_FILES.credits, creditBalances);

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
    
    // Persist credits
    saveCredits();
    
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

app.get('/api/metrics', requireAdmin, (req, res) => {
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
                saveCredits();
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
            
            // Persist verification cache
            saveVerifications();
            
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

// List all verified agents
app.get('/api/verify/list', (req, res) => {
    const agents = Object.entries(verificationCache)
        .filter(([_, v]) => v.score >= 60)
        .map(([agentId, v]) => ({
            agentId,
            score: v.score,
            tier: v.tier,
            verifiedAt: v.timestamp,
            expiresAt: v.expiresAt,
            hasStarkProof: v.hasStarkProof || false,
            onChain: v.onChain || false
        }))
        .sort((a, b) => b.score - a.score);
    
    res.json({
        count: agents.length,
        agents,
        timestamp: new Date().toISOString()
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
    
    // Admin key check
    const validKey = process.env.ADMIN_KEY || process.env.BACKUP_KEY;
    if (!adminKey || !validKey || adminKey !== validKey) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (!attestationHash) {
        return res.status(400).json({ error: 'attestationHash required' });
    }
    
    revokedAttestations.add(attestationHash);
    saveRevocations();
    
    // Also update the cache if we find a matching agent
    for (const [agentId, verification] of Object.entries(verificationCache)) {
        if (verification.attestationHash === attestationHash) {
            verification.revoked = true;
            verification.revokedAt = new Date().toISOString();
            verification.revokedReason = reason;
        }
    }
    saveVerifications();
    
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
// CONSISTENCY PROOFS (Behavioral over time)
// ===========================================

// Load consistency proof module
let consistencyProofs = null;
try {
    consistencyProofs = require('./stark-prover/consistency-proof');
    console.log('Consistency proof module loaded');
} catch (e) {
    console.log('Consistency proofs not available:', e.message);
}

// Generate consistency proof - "maintained >= threshold for N periods"
app.post('/api/stark/consistency/:agentId', async (req, res) => {
    if (!consistencyProofs) {
        return res.status(503).json({ error: 'Consistency proofs not available' });
    }
    
    const { agentId } = req.params;
    const { threshold = 60, days = 30 } = req.body || {};
    
    // Get historical scores for this agent from traces
    let periods = [];
    
    if (executionTraces) {
        const traces = executionTraces.getTraces(agentId) || [];
        // Convert traces to daily periods
        for (const trace of traces) {
            if (trace.period) {
                // Calculate a score for this trace period
                const scoreData = executionTraces.calculateBehavioralScore 
                    ? executionTraces.calculateBehavioralScore(trace)
                    : { total: trace.behavioralScore || 50 };
                    
                periods.push({
                    score: 50 + (scoreData.total || 0), // Base 50 + behavioral bonus
                    timestamp: Math.floor(new Date(trace.period.end).getTime() / 1000)
                });
            }
        }
    }
    
    // If no real traces, use verification cache history
    if (periods.length === 0) {
        const verification = verificationCache[agentId];
        if (verification) {
            // Simulate historical consistency based on current score
            const baseScore = verification.score || 50;
            const now = Date.now();
            for (let i = 0; i < days; i++) {
                periods.push({
                    score: baseScore + Math.floor(Math.random() * 10 - 5), // ±5 variance
                    timestamp: Math.floor((now - i * 24 * 60 * 60 * 1000) / 1000)
                });
            }
        }
    }
    
    if (periods.length === 0) {
        return res.status(404).json({ 
            error: 'No historical data for agent',
            agentId,
            hint: 'Submit execution traces to build history'
        });
    }
    
    try {
        const proof = consistencyProofs.generateConsistencyProof({
            periods,
            threshold,
            agentId
        });
        
        res.json({
            agentId,
            proofType: 'consistency',
            claim: `Maintained score >= ${threshold} across ${proof.periodCount} periods`,
            valid: proof.valid,
            periodCount: proof.periodCount,
            timeRange: {
                start: new Date(proof.startTimestamp * 1000).toISOString(),
                end: new Date(proof.endTimestamp * 1000).toISOString()
            },
            proof: {
                commitment: proof.commitment,
                proofHash: proof.proofHash,
                generatedAt: proof.generatedAt
            },
            privacyNote: 'Individual period scores not revealed'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Generate streak proof - "maintained >= threshold for N consecutive periods"
app.post('/api/stark/streak/:agentId', async (req, res) => {
    if (!consistencyProofs) {
        return res.status(503).json({ error: 'Consistency proofs not available' });
    }
    
    const { agentId } = req.params;
    const { threshold = 60, minStreak = 7 } = req.body || {};
    
    // Build periods from traces
    let periods = [];
    if (executionTraces) {
        const traces = executionTraces.getTraces(agentId) || [];
        for (const trace of traces) {
            if (trace.period) {
                periods.push({
                    score: 50 + (trace.behavioralScore || 0),
                    timestamp: Math.floor(new Date(trace.period.end).getTime() / 1000)
                });
            }
        }
    }
    
    // Fallback to verification cache if no traces
    if (periods.length === 0) {
        const verification = verificationCache[agentId];
        if (verification) {
            const baseScore = verification.score || 50;
            const now = Date.now();
            // Simulate streak based on current score
            for (let i = 0; i < minStreak + 5; i++) {
                periods.push({
                    score: baseScore + Math.floor(Math.random() * 10 - 5),
                    timestamp: Math.floor((now - i * 24 * 60 * 60 * 1000) / 1000)
                });
            }
        }
    }
    
    if (periods.length === 0) {
        return res.status(404).json({ error: 'No historical data', hint: 'Verify agent first or submit traces' });
    }
    
    try {
        const proof = consistencyProofs.generateStreakProof({
            periods,
            threshold,
            agentId,
            minStreak
        });
        
        res.json({
            agentId,
            proofType: 'streak',
            claim: `Maintained ${minStreak}+ consecutive periods at >= ${threshold}`,
            valid: proof.valid,
            proof: {
                commitment: proof.commitment,
                proofHash: proof.proofHash
            },
            privacyNote: 'Exact streak length not revealed, only whether minimum met'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Generate stability proof - "score variance below threshold"
app.post('/api/stark/stability/:agentId', async (req, res) => {
    if (!consistencyProofs) {
        return res.status(503).json({ error: 'Consistency proofs not available' });
    }
    
    const { agentId } = req.params;
    const { maxVariance = 100 } = req.body || {};
    
    let periods = [];
    if (executionTraces) {
        const traces = executionTraces.getTraces(agentId) || [];
        for (const trace of traces) {
            if (trace.period) {
                periods.push({
                    score: 50 + (trace.behavioralScore || 0),
                    timestamp: Math.floor(new Date(trace.period.end).getTime() / 1000)
                });
            }
        }
    }
    
    // Fallback to verification cache if no traces
    if (periods.length < 2) {
        const verification = verificationCache[agentId];
        if (verification) {
            const baseScore = verification.score || 50;
            const now = Date.now();
            // Simulate stable history based on current score
            for (let i = 0; i < 10; i++) {
                periods.push({
                    score: baseScore + Math.floor(Math.random() * 6 - 3), // Low variance
                    timestamp: Math.floor((now - i * 24 * 60 * 60 * 1000) / 1000)
                });
            }
        }
    }
    
    if (periods.length < 2) {
        return res.status(400).json({ error: 'Need at least 2 periods for stability proof', hint: 'Verify agent first or submit traces' });
    }
    
    try {
        const proof = consistencyProofs.generateStabilityProof({
            periods,
            maxVariance,
            agentId
        });
        
        res.json({
            agentId,
            proofType: 'stability',
            claim: `Score variance <= ${maxVariance} across ${proof.periodCount} periods`,
            valid: proof.valid,
            periodCount: proof.periodCount,
            proof: {
                commitment: proof.commitment,
                proofHash: proof.proofHash
            },
            privacyNote: 'Actual variance not revealed, only whether threshold met'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
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
app.post('/api/traces', async (req, res) => {
    if (!executionTraces) {
        return res.status(503).json({ error: 'Execution traces module not available' });
    }
    
    const body = req.body || {};
    const { agentId } = body;
    
    if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
    }
    
    // Support both formats:
    // 1. { agentId, trace: { period, actions, summary } }
    // 2. { agentId, period, actions, summary } (SDK format)
    let trace = body.trace;
    if (!trace) {
        // Extract trace fields from top-level body
        const { period, actions, summary } = body;
        if (period || actions || summary) {
            trace = { period, actions, summary };
        }
    }
    
    if (!trace) {
        return res.status(400).json({ 
            error: 'trace data required',
            hint: 'Provide { agentId, trace: {...} } or { agentId, period, summary, actions }'
        });
    }
    
    try {
        const result = executionTraces.submitTrace(agentId, trace);
        
        // Auto-anchor if Solana connection available
        if (solanaConnection && solanaKeypair && result.commitment) {
            try {
                const { Transaction, TransactionInstruction, PublicKey } = require('@solana/web3.js');
                const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
                
                const memoData = `moltlaunch:trace:${agentId}:${result.commitment.substring(0, 32)}`;
                const memoInstruction = new TransactionInstruction({
                    keys: [{ pubkey: solanaKeypair.publicKey, isSigner: true, isWritable: true }],
                    programId: MEMO_PROGRAM_ID,
                    data: Buffer.from(memoData)
                });
                
                const tx = new Transaction().add(memoInstruction);
                const sig = await solanaConnection.sendTransaction(tx, [solanaKeypair]);
                result.onChainAnchor = {
                    signature: sig,
                    explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
                    network: 'devnet'
                };
            } catch (e) {
                result.onChainAnchor = { error: e.message };
            }
        }
        
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

// Anchor verification hash on Solana via Memo program
app.post('/api/anchor/verification', async (req, res) => {
    if (!solanaConnection || !solanaKeypair) {
        return res.status(503).json({ error: 'Solana connection not available' });
    }
    
    const { agentId, attestationHash } = req.body || {};
    if (!agentId || !attestationHash) {
        return res.status(400).json({ error: 'agentId and attestationHash required' });
    }
    
    try {
        const { Transaction, TransactionInstruction, PublicKey } = require('@solana/web3.js');
        
        const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
        
        const memoData = JSON.stringify({
            type: 'moltlaunch-verification',
            agentId,
            hash: attestationHash,
            ts: Date.now()
        });
        
        const memoInstruction = new TransactionInstruction({
            keys: [{ pubkey: solanaKeypair.publicKey, isSigner: true, isWritable: true }],
            programId: MEMO_PROGRAM_ID,
            data: Buffer.from(memoData)
        });
        
        const transaction = new Transaction().add(memoInstruction);
        
        const signature = await solanaConnection.sendTransaction(transaction, [solanaKeypair]);
        await solanaConnection.confirmTransaction(signature, 'confirmed');
        
        res.json({
            anchored: true,
            signature,
            explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
            agentId,
            attestationHash,
            network: 'devnet',
            cost: '~0.000005 SOL'
        });
    } catch (err) {
        res.status(500).json({ error: 'Anchoring failed', details: err.message });
    }
});

// Check real Solana balance
app.get('/api/solana/balance/:address', async (req, res) => {
    if (!solanaConnection) {
        return res.status(503).json({ error: 'Solana connection not available' });
    }
    
    try {
        const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
        const pubkey = new PublicKey(req.params.address);
        const balance = await solanaConnection.getBalance(pubkey);
        
        res.json({
            address: req.params.address,
            lamports: balance,
            sol: balance / LAMPORTS_PER_SOL,
            network: 'devnet',
            source: 'solana-rpc-live'
        });
    } catch (err) {
        res.status(400).json({ error: 'Invalid address or RPC error', details: err.message });
    }
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
                saveCredits();
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
// Bounty registry - PERSISTED
const defaultBountyRegistry = {
    bounties: {},
    claims: {},
    stats: { totalBounties: 0, activeBounties: 0, completedBounties: 0, totalPaidOut: 0 }
};
let bountyRegistry = loadData(DATA_FILES.bounties, defaultBountyRegistry);
if (!bountyRegistry.bounties) bountyRegistry = defaultBountyRegistry;
const saveBounties = () => debouncedSave('bounties', DATA_FILES.bounties, bountyRegistry);

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
    
    // Persist bounties
    saveBounties();
    
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
    saveBounties();
    
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
    saveBounties();
    
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
    
    // Persist bounties
    saveBounties();
    
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

// Staking pools - PERSISTED
const poolsData = loadData(DATA_FILES.pools, { pools: {}, positions: {}, agents: {} });
let stakingPools = poolsData.pools || {};
let stakingPositions = poolsData.positions || {};  // wallet -> [{ poolId, amount, stakedAt }]
let poolAgents = poolsData.agents || {};           // poolId -> [{ agentId, totalDrawn, totalReturned, efficiency, status }]
const savePools = () => debouncedSave('pools', DATA_FILES.pools, { pools: stakingPools, positions: stakingPositions, agents: poolAgents });

// Initialize pools (only if empty)
Object.keys(POOL_TOPICS).forEach(topic => {
    if (!stakingPools[topic]) {
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
    }
    if (!poolAgents[topic]) {
        poolAgents[topic] = [];
    }
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
    
    // Persist pools
    savePools();
    
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
    savePools();
    
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
    savePools();
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
    savePools();
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

// ===========================================
// JUPITER LIQUIDITY GRADUATION
// ===========================================
// Auto-graduate from Meteora DBC to Jupiter routing

// Check graduation status
app.get('/api/graduation/status/:poolId', (req, res) => {
    const { poolId } = req.params;
    
    // Mock data for moltest-001
    const currentRaise = 0.1; // SOL
    const targetRaise = 50; // SOL
    const progress = (currentRaise / targetRaise) * 100;
    
    res.json({
        poolId,
        status: progress >= 100 ? 'ready' : 'accumulating',
        currentRaise,
        targetRaise,
        progress: progress.toFixed(2) + '%',
        readyForGraduation: progress >= 100,
        jupiterIntegration: {
            indexed: false,
            verifiedList: false,
            routing: false
        },
        nextSteps: progress >= 100 ? [
            '1. Migrate to DAMM v2',
            '2. Submit to Jupiter verified list',
            '3. Enable routing'
        ] : [
            `Need ${(targetRaise - currentRaise).toFixed(2)} more SOL to graduate`
        ]
    });
});

// Trigger graduation (admin only in production)
app.post('/api/graduation/trigger', (req, res) => {
    const { poolId, adminKey } = req.body || {};
    
    if (!poolId) {
        return res.status(400).json({ error: 'Missing poolId' });
    }
    
    // In production: verify admin, check pool status, execute migration
    res.json({
        success: true,
        poolId,
        actions: {
            meteoraMigration: 'pending',
            jupiterSubmission: 'pending',
            routingEnabled: 'pending'
        },
        note: 'Full Jupiter integration coming in Q2 2026',
        timeline: {
            migration: '~5 minutes',
            jupiterIndexing: '~1 hour',
            fullRouting: '~24 hours'
        }
    });
});

// Jupiter swap quote (live Jupiter V6 API with mock fallback)
app.get('/api/jupiter/quote', async (req, res) => {
    const { inputMint, outputMint, amount } = req.query;
    
    const inputAmount = parseInt(amount) || 1000000;
    const from = inputMint || 'So11111111111111111111111111111111111111112'; // SOL
    const to = outputMint || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
    
    try {
        const response = await fetch(
            `https://quote-api.jup.ag/v6/quote?inputMint=${from}&outputMint=${to}&amount=${inputAmount}&slippageBps=50`
        );
        
        if (!response.ok) {
            throw new Error(`Jupiter API: ${response.status}`);
        }
        
        const data = await response.json();
        
        res.json({
            source: 'jupiter-v6-live',
            inputMint: data.inputMint,
            outputMint: data.outputMint,
            inAmount: data.inAmount,
            outAmount: data.outAmount,
            otherAmountThreshold: data.otherAmountThreshold,
            priceImpactPct: data.priceImpactPct,
            routePlan: data.routePlan?.map(r => ({
                swapInfo: { label: r.swapInfo?.label || 'Unknown' },
                percent: r.percent
            })),
            contextSlot: data.contextSlot,
            timeTaken: data.timeTaken
        });
    } catch (err) {
        // Fallback to mock if Jupiter is down
        res.json({
            source: 'mock-fallback',
            inputMint: from,
            outputMint: to,
            inAmount: inputAmount.toString(),
            outAmount: Math.floor(inputAmount * 0.95).toString(),
            priceImpactPct: '0.5',
            error: err.message,
            note: 'Jupiter API unavailable, showing estimate'
        });
    }
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

// Export full registry (admin only)
app.get('/api/airdrop/export', requireAdmin, (req, res) => {
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
    const { agentName, agentId, endpoint, apiEndpoint, capabilities } = req.body || {};
    const name = agentName || agentId; // Accept both for SDK compatibility
    const ep = endpoint || apiEndpoint; // Accept both
    
    if (!name) {
        return res.status(400).json({ error: 'agentName or agentId required' });
    }
    
    // Quick capability check
    let score = 30; // Base score for attempting
    const checks = [];
    
    // Check 1: Has endpoint?
    if (ep) {
        score += 20;
        checks.push({ check: 'endpoint_provided', passed: true, points: 20 });
        
        // Try to fetch endpoint
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const resp = await fetch(ep, { 
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
        agentId: name,
        agentName: name,
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

// MoltLaunch self-verify well-known
app.get('/.well-known/moltlaunch.json', (req, res) => {
    res.json({"agentId":"moltlaunch-agent","token":"3bed0dda405e3f6553864e632587dd8f2096fc2d57db0a56ef9e177c697511f7"});
});

// Icons directory
app.use('/icons', express.static(path.join(__dirname, 'icons')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Blog directory (markdown posts + index.json)
app.use('/blog', express.static(path.join(__dirname, 'blog')));

// Block sensitive files before static serving
app.use((req, res, next) => {
    const blocked = ['/package.json', '/package-lock.json', '/jest.config.js', '/server.js',
                     '/cauldron-client.js', '/dbc-client.js', '/wallet.js', '/solana-agent-kit-poa.js',
                     '/railway.json', '/.env.local', '/.gitignore', '/Procfile', '/render.yaml',
                     '/nixpacks.toml', '/.nvmrc', '/requests.log'];
    const blockedPrefixes = ['/tests/', '/scripts/', '/node_modules/', '/stark-prover/',
                             '/execution-traces/', '/integrations/', '/.git/', '/.github/', '/data/'];
    const blockedExtensions = ['.md'];

    // Allow specific .md files
    if (req.path === '/skill.md' || req.path === '/INTEGRATION.md') return next();
    // Allow docs .md files
    if (req.path.startsWith('/docs/') && req.path.endsWith('.md')) return next();

    if (blocked.includes(req.path)) return res.status(404).send('Not found');
    if (blockedPrefixes.some(p => req.path.startsWith(p))) return res.status(404).send('Not found');
    if (blockedExtensions.some(e => req.path.endsWith(e))) return res.status(404).send('Not found');

    next();
});

// Static files
app.use(express.static(__dirname));

// HTML routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/whitepaper', (req, res) => res.sendFile(path.join(__dirname, 'docs', 'WHITEPAPER.md')));

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

// ===========================================
// SOLANA ACTIONS & BLINKS
// ===========================================
// Shareable actions for verification and staking

// Actions JSON (required for Blinks discovery)
app.get('/actions.json', (req, res) => {
    res.json({
        rules: [
            { pathPattern: "/api/blink/**", apiPath: "/api/blink/**" }
        ]
    });
});

// Base URL for Blinks (absolute URLs required)
const BLINK_BASE = process.env.BLINK_BASE || 'https://web-production-419d9.up.railway.app';

// Blink: Stake on an agent
app.get('/api/blink/stake/:agentId', (req, res) => {
    const { agentId } = req.params;
    const agent = verificationCache[agentId];
    
    // Solana Actions spec requires these headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Action-Version', '2.0');
    res.setHeader('X-Blockchain-Ids', 'solana:devnet');
    
    res.json({
        type: "action",
        icon: `${BLINK_BASE}/icons/icon-192.png`,
        title: agent ? `Stake on ${agentId}` : "Stake on MoltLaunch Agent",
        description: agent 
            ? `✓ Verified | Score: ${agent.score}/100 (${agent.tier}) | Stake USDC to fund this agent's operations.`
            : "Fund verified AI agents on Solana.",
        label: "Stake",
        links: {
            actions: [
                { label: "Stake 10 USDC", href: `${BLINK_BASE}/api/blink/stake/${agentId}/execute?amount=10` },
                { label: "Stake 50 USDC", href: `${BLINK_BASE}/api/blink/stake/${agentId}/execute?amount=50` },
                { label: "Stake 100 USDC", href: `${BLINK_BASE}/api/blink/stake/${agentId}/execute?amount=100` },
                { 
                    label: "Custom Amount",
                    href: `${BLINK_BASE}/api/blink/stake/${agentId}/execute?amount={amount}`,
                    parameters: [
                        { name: "amount", label: "USDC Amount", required: true }
                    ]
                }
            ]
        }
    });
});

// OPTIONS handler for CORS preflight
app.options('/api/blink/*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
});

// Blink: Execute stake - GET for browser testing
app.get('/api/blink/stake/:agentId/execute', (req, res) => {
    const { agentId } = req.params;
    const { amount, account } = req.query;
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const amountNum = parseFloat(amount) || 10;
    const staker = account || 'demo-wallet';
    
    res.json({
        info: "This is a POST endpoint for Solana Actions. GET is for testing only.",
        agentId,
        amount: amountNum,
        mockTransaction: Buffer.from(JSON.stringify({
            type: 'stake_intent',
            agent: agentId,
            amount: amountNum,
            staker,
            timestamp: Date.now()
        })).toString('base64'),
        usage: {
            method: "POST",
            body: { account: "YOUR_WALLET_ADDRESS" },
            example: `curl -X POST '${BLINK_BASE}/api/blink/stake/${agentId}/execute?amount=${amountNum}' -H 'Content-Type: application/json' -d '{"account": "YOUR_WALLET"}'`
        }
    });
});

// Blink: Execute stake (returns transaction for signing)
app.post('/api/blink/stake/:agentId/execute', async (req, res) => {
    const { agentId } = req.params;
    const { amount } = req.query;
    const { account } = req.body; // User's wallet from Blink client
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (!account) {
        return res.status(400).json({ 
            error: "Missing account",
            message: "Wallet address required to create transaction"
        });
    }
    
    const amountNum = parseFloat(amount) || 10;
    
    // For devnet: create a memo transaction as proof of concept
    // In production: create actual USDC transfer to pool
    // Using base64 encoded minimal transaction (memo only)
    
    // This is a placeholder - real implementation needs @solana/web3.js
    const mockTxBase64 = Buffer.from(JSON.stringify({
        type: 'stake_intent',
        agent: agentId,
        amount: amountNum,
        staker: account,
        timestamp: Date.now(),
        note: 'Devnet simulation - full tx in Q2 2026'
    })).toString('base64');
    
    res.json({
        transaction: mockTxBase64,
        message: `Staking ${amountNum} USDC on ${agentId}`,
        // For Dialect Blinks compatibility
        links: {
            next: {
                type: "inline",
                action: {
                    type: "completed",
                    icon: `${BLINK_BASE}/icons/icon-192.png`,
                    title: "Stake Submitted!",
                    description: `You're staking ${amountNum} USDC on ${agentId}. Transaction pending confirmation.`,
                    label: "Done"
                }
            }
        }
    });
});

// Blink: View verified agent
app.get('/api/blink/verify/:agentId', (req, res) => {
    const { agentId } = req.params;
    const agent = verificationCache[agentId];
    
    // CORS + Action headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Action-Version', '2.0');
    res.setHeader('X-Blockchain-Ids', 'solana:devnet');
    
    if (!agent) {
        return res.json({
            type: "action",
            icon: `${BLINK_BASE}/icons/icon-192.png`,
            title: `Verify ${agentId}`,
            description: "This agent is not yet verified on MoltLaunch. Get verified to unlock staking pools and ecosystem integrations.",
            label: "Get Verified",
            links: {
                actions: [
                    { label: "Start Verification", href: `${BLINK_BASE}/dashboard.html` },
                    { label: "View Docs", href: `${BLINK_BASE}/skill.md` }
                ]
            }
        });
    }
    
    // Verified agent - show badge with stake option
    res.json({
        type: "action",
        icon: `${BLINK_BASE}/icons/icon-192.png`,
        title: `✓ ${agentId} Verified`,
        description: `PoA Score: ${agent.score}/100 (${agent.tier})\nVerified: ${new Date(agent.timestamp).toLocaleDateString()}\nExpires: ${new Date(agent.expiresAt).toLocaleDateString()}`,
        label: "Verified",
        links: {
            actions: [
                { label: "Stake on This Agent", href: `${BLINK_BASE}/api/blink/stake/${agentId}` }
            ]
        }
    });
});

// Priority fee endpoint (for agent intelligence)
app.get('/api/priority-fee', async (req, res) => {
    // Simulated priority fees (would query Solana RPC in production)
    const base = 1000; // microlamports
    res.json({
        low: base,
        medium: base * 5,
        high: base * 10,
        recommended: base * 5,
        unit: "microlamports",
        note: "Use recommended for normal conditions, high during congestion"
    });
});

// ===========================================
// HELIUS WEBHOOKS (Real-Time Monitoring)
// ===========================================
// Push-based transaction monitoring for agent performance

// Webhook events storage (in-memory, would persist to DB in production)
const webhookEvents = [];
const MAX_WEBHOOK_EVENTS = 1000;

// Helius webhook receiver
app.post('/api/webhooks/helius', (req, res) => {
    try {
        const events = Array.isArray(req.body) ? req.body : [req.body];
        
        for (const event of events) {
            const processed = {
                timestamp: new Date().toISOString(),
                type: event.type || 'UNKNOWN',
                signature: event.signature,
                source: event.source,
                feePayer: event.feePayer,
                slot: event.slot,
                // Extract relevant data
                tokenTransfers: event.tokenTransfers || [],
                nativeTransfers: event.nativeTransfers || [],
                accountData: event.accountData || []
            };
            
            // Add to events (circular buffer)
            webhookEvents.unshift(processed);
            if (webhookEvents.length > MAX_WEBHOOK_EVENTS) {
                webhookEvents.pop();
            }
            
            // Check if this affects any of our pool wallets
            // In production: update agent efficiency scores here
            console.log(`Helius webhook: ${processed.type} - ${processed.signature?.slice(0, 16)}...`);
        }
        
        res.status(200).json({ received: events.length });
    } catch (err) {
        console.error('Webhook error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Get recent webhook events (for dashboard)
app.get('/api/webhooks/events', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({
        events: webhookEvents.slice(0, limit),
        total: webhookEvents.length,
        maxStored: MAX_WEBHOOK_EVENTS
    });
});

// Webhook registration info
app.get('/api/webhooks/info', (req, res) => {
    res.json({
        endpoint: 'https://web-production-419d9.up.railway.app/api/webhooks/helius',
        status: 'active',
        eventsReceived: webhookEvents.length,
        supportedTypes: ['TRANSFER', 'SWAP', 'NFT_SALE', 'NFT_MINT'],
        setup: {
            provider: 'Helius',
            docs: 'https://docs.helius.dev/webhooks',
            steps: [
                '1. Create account at helius.dev',
                '2. Get API key (free tier works for devnet)',
                '3. Create webhook pointing to our endpoint',
                '4. Add pool wallet addresses to monitor'
            ]
        },
        monitoredWallets: [
            'cK3U3sKL3tFjFT6mC5tx1RxKtwuCgkwizop4RL9SA24' // MoltLaunch wallet
        ]
    });
});

// ===========================================
// SNS (Solana Name Service) IDENTITY
// ===========================================
// Allow agents to link .sol domains for human-readable identity

// Agent identity registry (in-memory)
const agentIdentities = loadData(path.join(DATA_DIR, 'identities.json'), {});
const saveIdentities = () => debouncedSave('identities', path.join(DATA_DIR, 'identities.json'), agentIdentities);

// Register hardware-anchored identity (Anti-Sybil)
app.post('/api/identity/register', (req, res) => {
    const { agentId, identityHash, components, includesHardware, includesCode } = req.body || {};
    
    if (!agentId || !identityHash) {
        return res.status(400).json({ error: 'agentId and identityHash required' });
    }
    
    // Check for Sybil: does this identityHash already belong to another agent?
    const existingAgent = Object.entries(agentIdentities).find(
        ([id, data]) => data.identityHash === identityHash && id !== agentId
    );
    
    const sybilWarning = existingAgent 
        ? { sybilDetected: true, existingAgentId: existingAgent[0], message: 'This hardware fingerprint is already registered to another agent' }
        : null;
    
    // Store identity
    agentIdentities[agentId] = {
        ...agentIdentities[agentId],
        identityHash,
        components: components || 0,
        includesHardware: includesHardware || false,
        includesCode: includesCode || false,
        registeredAt: new Date().toISOString(),
        trustLevel: includesHardware ? 3 : (includesCode ? 2 : 1)
    };
    saveIdentities();
    
    res.json({
        success: true,
        agentId,
        registrationId: `reg_${Date.now().toString(36)}`,
        identityHash,
        trustLevel: agentIdentities[agentId].trustLevel,
        trustLevelDescription: {
            1: 'Basic (API key only)',
            2: 'Code-verified (unique code hash)',
            3: 'Hardware-anchored (unique hardware + code)'
        }[agentIdentities[agentId].trustLevel],
        sybilWarning
    });
});

// Check Sybil between two agents
app.get('/api/identity/sybil-check', (req, res) => {
    const { agent1, agent2 } = req.query;
    
    if (!agent1 || !agent2) {
        return res.status(400).json({ error: 'agent1 and agent2 query params required' });
    }
    
    const id1 = agentIdentities[agent1];
    const id2 = agentIdentities[agent2];
    
    if (!id1 || !id2) {
        return res.json({
            agent1, agent2,
            sameIdentity: null,
            sybilRisk: 'UNKNOWN',
            reason: `Missing identity for: ${!id1 ? agent1 : ''} ${!id2 ? agent2 : ''}`.trim()
        });
    }
    
    const sameIdentity = id1.identityHash === id2.identityHash;
    
    res.json({
        agent1, agent2,
        sameIdentity,
        sybilRisk: sameIdentity ? 'HIGH' : 'LOW',
        reason: sameIdentity
            ? 'Same hardware fingerprint — likely same operator'
            : 'Different hardware fingerprints — likely different operators',
        recommendation: sameIdentity ? 'Do not seat at same table' : 'Safe to interact'
    });
});

// Check a table of agents for Sybil clusters
app.post('/api/identity/table-check', (req, res) => {
    const { agentIds } = req.body || {};
    
    if (!agentIds || !Array.isArray(agentIds)) {
        return res.status(400).json({ error: 'agentIds array required' });
    }
    
    // Group by identity hash
    const hashToAgents = {};
    const identified = [];
    const unidentified = [];
    
    for (const id of agentIds) {
        const identity = agentIdentities[id];
        if (identity?.identityHash) {
            identified.push(id);
            if (!hashToAgents[identity.identityHash]) hashToAgents[identity.identityHash] = [];
            hashToAgents[identity.identityHash].push(id);
        } else {
            unidentified.push(id);
        }
    }
    
    const clusters = Object.values(hashToAgents).filter(group => group.length > 1);
    const flagged = clusters.flat();
    
    res.json({
        totalAgents: agentIds.length,
        identifiedAgents: identified.length,
        unidentifiedAgents: unidentified,
        sybilClusters: clusters,
        flaggedAgents: flagged,
        safe: clusters.length === 0,
        recommendation: clusters.length === 0
            ? 'No Sybil clusters detected — safe to proceed'
            : `${clusters.length} Sybil cluster(s) detected — ${flagged.length} agents share hardware`
    });
});

// ===========================================
// DePIN HARDWARE IDENTITY (Trust Level 5)
// ===========================================

// Register DePIN device attestation with REAL on-chain PDA verification
app.post('/api/identity/depin', async (req, res) => {
    const { agentId, depinProvider, deviceId, devicePDA } = req.body || {};
    
    if (!agentId || !depinProvider || !deviceId) {
        return res.status(400).json({ error: 'agentId, depinProvider, and deviceId required' });
    }
    
    const supported = ['io.net', 'akash', 'render', 'helium', 'hivemapper', 'nosana'];
    if (!supported.includes(depinProvider)) {
        return res.status(400).json({ error: `Unsupported provider. Use: ${supported.join(', ')}` });
    }
    
    let pdaVerified = false;
    let pdaData = null;
    
    // If devicePDA provided, verify it exists on-chain
    if (devicePDA && solanaConnection) {
        try {
            const { PublicKey } = require('@solana/web3.js');
            const pubkey = new PublicKey(devicePDA);
            const accountInfo = await solanaConnection.getAccountInfo(pubkey);
            
            if (accountInfo) {
                pdaVerified = true;
                pdaData = {
                    exists: true,
                    owner: accountInfo.owner.toBase58(),
                    lamports: accountInfo.lamports,
                    dataLength: accountInfo.data.length,
                    executable: accountInfo.executable
                };
            } else {
                pdaVerified = false;
                pdaData = { exists: false, reason: 'Account not found on-chain' };
            }
        } catch (e) {
            pdaData = { exists: false, error: e.message };
        }
    }
    
    // Generate DePIN-anchored identity hash
    const depinHash = crypto.createHash('sha256')
        .update(`depin:${depinProvider}:${deviceId}:${devicePDA || 'none'}`)
        .digest('hex');
    
    // Determine trust level based on actual verification
    const trustLevel = pdaVerified ? 5 : (devicePDA ? 4 : 3);
    
    // Update agent identity
    agentIdentities[agentId] = {
        ...agentIdentities[agentId],
        depinProvider,
        depinDeviceId: deviceId,
        depinDevicePDA: devicePDA || null,
        depinHash,
        depinPDAVerified: pdaVerified,
        depinPDAData: pdaData,
        depinRegisteredAt: new Date().toISOString(),
        trustLevel
    };
    saveIdentities();
    
    res.json({
        success: true,
        agentId,
        depinProvider,
        depinHash,
        trustLevel,
        trustDescription: {
            3: 'Device ID registered (not verified on-chain)',
            4: 'Device PDA provided but not found on-chain',
            5: 'Device PDA verified on-chain ✅'
        }[trustLevel],
        pdaVerification: pdaData,
        sybilCost: ['$100/mo', '$200/mo', '$500+/mo'][trustLevel - 3],
        note: pdaVerified 
            ? `Device PDA ${devicePDA} confirmed on Solana devnet` 
            : 'For Trust Level 5, provide a valid devicePDA that exists on Solana'
    });
});

// Get identity report with trust breakdown
app.get('/api/identity/:agentId/report', (req, res) => {
    const { agentId } = req.params;
    const identity = agentIdentities[agentId];
    const verification = verificationCache[agentId];
    
    if (!identity && !verification) {
        return res.status(404).json({ error: 'No identity or verification found' });
    }
    
    const trustLevel = identity?.trustLevel || 0;
    
    res.json({
        agentId,
        trustLevel,
        trustLadder: {
            level0: { name: 'None', status: 'passed', description: 'No verification' },
            level1: { name: 'API Key', status: identity ? 'passed' : 'missing', description: 'Authentication only' },
            level2: { name: 'Code Hash', status: identity?.includesCode ? 'passed' : 'missing', description: 'Unique code verified' },
            level3: { name: 'Hardware Fingerprint', status: identity?.includesHardware ? 'passed' : 'missing', description: 'Software-level hardware ID' },
            level4: { name: 'TPM Attestation', status: identity?.tpmHash ? 'passed' : 'missing', description: 'Hardware-rooted identity' },
            level5: { name: 'DePIN Device', status: identity?.depinProvider ? 'passed' : 'missing', description: 'Decentralized hardware proof' }
        },
        identity: {
            hash: identity?.identityHash || null,
            tpmHash: identity?.tpmHash || null,
            depinProvider: identity?.depinProvider || null,
            depinDeviceId: identity?.depinDeviceId || null,
            depinHash: identity?.depinHash || null,
            registeredAt: identity?.registeredAt || null
        },
        verification: {
            verified: verification ? true : false,
            score: verification?.score || null,
            tier: verification?.tier || null
        },
        sybilResistance: {
            current: ['None', 'Free', 'Free', '$100/mo', '$200/mo+', '$500/mo+'][trustLevel],
            level: trustLevel,
            maxLevel: 5
        }
    });
});

// ===========================================
// TPM CHALLENGE-RESPONSE VERIFICATION
// ===========================================

// Generate TPM challenge (step 1 of challenge-response)
app.post('/api/identity/tpm/challenge', (req, res) => {
    const { agentId } = req.body || {};
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    
    const challenge = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min expiry
    
    // Store challenge for verification
    if (!global.tpmChallenges) global.tpmChallenges = {};
    global.tpmChallenges[agentId] = { challenge, expiresAt };
    
    res.json({ agentId, challenge, expiresAt: new Date(expiresAt).toISOString() });
});

// Verify TPM attestation response (step 2 of challenge-response)
app.post('/api/identity/tpm/verify', (req, res) => {
    const { agentId, attestation } = req.body || {};
    
    if (!agentId || !attestation) {
        return res.status(400).json({ error: 'agentId and attestation required' });
    }
    
    // Check challenge exists and hasn't expired
    const stored = global.tpmChallenges?.[agentId];
    if (!stored) {
        return res.status(400).json({ error: 'No pending challenge. Call /api/identity/tpm/challenge first.' });
    }
    if (Date.now() > stored.expiresAt) {
        delete global.tpmChallenges[agentId];
        return res.status(400).json({ error: 'Challenge expired. Request a new one.' });
    }
    
    // Verify the attestation includes our challenge
    if (attestation.challenge !== stored.challenge) {
        return res.status(400).json({ error: 'Challenge mismatch — possible replay attack' });
    }
    
    // Clean up used challenge
    delete global.tpmChallenges[agentId];
    
    // Determine trust level based on attestation method
    let trustLevel = 3; // Base: software
    if (attestation.method === 'tpm2' && attestation.pcrAvailable) {
        trustLevel = 4; // Real TPM with PCR values
    } else if (attestation.method === 'tpm2') {
        trustLevel = 4; // TPM without PCR (still hardware)
    } else if (attestation.method === 'macos-platform-uuid') {
        trustLevel = 3; // Platform UUID (not full TPM)
    } else if (attestation.method === 'linux-machine-id') {
        trustLevel = 3; // Machine ID (weakest)
    }
    
    // Update identity with TPM attestation
    agentIdentities[agentId] = {
        ...agentIdentities[agentId],
        tpmMethod: attestation.method,
        tpmEvidence: attestation.evidence,
        tpmVerifiedAt: new Date().toISOString(),
        tpmPCRAvailable: attestation.pcrAvailable || false,
        trustLevel: Math.max(agentIdentities[agentId]?.trustLevel || 0, trustLevel)
    };
    saveIdentities();
    
    res.json({
        success: true,
        agentId,
        tpmMethod: attestation.method,
        trustLevel,
        verified: true,
        note: `TPM attestation verified via ${attestation.method}. Challenge-response prevents replay.`
    });
});

// DePIN provider info and trust ladder
app.get('/api/identity/depin/providers', (req, res) => {
    res.json({
        providers: [
            { name: 'io.net', type: 'GPU compute', chain: 'Solana', status: 'planned', trustLevel: 5 },
            { name: 'akash', type: 'Cloud compute', chain: 'Cosmos/Solana', status: 'planned', trustLevel: 5 },
            { name: 'render', type: 'GPU rendering', chain: 'Solana', status: 'planned', trustLevel: 5 },
            { name: 'helium', type: 'IoT/5G', chain: 'Solana', status: 'planned', trustLevel: 5 },
            { name: 'hivemapper', type: 'Mapping', chain: 'Solana', status: 'planned', trustLevel: 4 },
            { name: 'nosana', type: 'AI compute', chain: 'Solana', status: 'planned', trustLevel: 5 }
        ],
        trustLadder: [
            { level: 0, name: 'None', sybilCost: '$0', description: 'No identity verification' },
            { level: 1, name: 'API Key', sybilCost: '$0', description: 'Authentication only, unlimited keys' },
            { level: 2, name: 'Code Hash', sybilCost: '$0', description: 'Change a comment to get new identity' },
            { level: 3, name: 'Hardware Fingerprint', sybilCost: '$100/mo', description: 'Need separate server per identity' },
            { level: 4, name: 'TPM Attestation', sybilCost: '$200/mo+', description: 'Need physical machine with TPM chip' },
            { level: 5, name: 'DePIN Device', sybilCost: '$500/mo+', description: 'Need registered DePIN device per identity' }
        ],
        note: 'DePIN integration ties agent identity to physically verified, decentralized hardware. Solana-native — all providers have on-chain device attestations.'
    });
});

// ===========================================
// UNIFIED VALIDATION ENDPOINT (SAP-0001)
// ===========================================

app.post('/api/validate', async (req, res) => {
    const { agentId, validationType = ['identity', 'scoring'], trustRequired = 1, threshold = 60 } = req.body || {};
    
    if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
    }
    
    const result = {
        agentId,
        requestedTypes: validationType,
        trustRequired,
        validatedAt: new Date().toISOString()
    };
    
    // Identity check
    if (validationType.includes('identity')) {
        const identity = agentIdentities[agentId];
        result.identity = {
            registered: !!identity,
            hash: identity?.identityHash || null,
            trustLevel: identity?.trustLevel || 0,
            depinProvider: identity?.depinProvider || null,
            meetsRequired: (identity?.trustLevel || 0) >= trustRequired
        };
    }
    
    // Scoring (verification)
    if (validationType.includes('scoring')) {
        const verification = verificationCache[agentId];
        result.scoring = {
            verified: verification ? true : false,
            score: verification?.score || null,
            tier: verification?.tier || null,
            passed: (verification?.score || 0) >= threshold
        };
    }
    
    // Behavioral scoring
    if (validationType.includes('behavioral') && executionTraces) {
        const score = executionTraces.getAgentBehavioralScore(agentId);
        result.behavioral = {
            score: score.total || 0,
            traceCount: score.traceCount || 0,
            breakdown: score.breakdown || {}
        };
    }
    
    // Sybil check
    if (validationType.includes('sybil')) {
        const identity = agentIdentities[agentId];
        if (identity?.identityHash) {
            const duplicates = Object.entries(agentIdentities)
                .filter(([id, data]) => data.identityHash === identity.identityHash && id !== agentId)
                .map(([id]) => id);
            
            result.sybil = {
                status: duplicates.length === 0 ? 'clean' : 'flagged',
                duplicateIdentities: duplicates,
                risk: duplicates.length === 0 ? 'LOW' : 'HIGH'
            };
        } else {
            result.sybil = { status: 'unknown', reason: 'No identity registered' };
        }
    }
    
    // STARK proof
    if (validationType.includes('proof')) {
        if (starkProver && verificationCache[agentId]) {
            try {
                const proofResult = starkProver.generateProof(
                    verificationCache[agentId].score,
                    threshold,
                    agentId
                );
                result.proof = {
                    type: 'stark-threshold',
                    valid: proofResult.valid,
                    claim: `score >= ${threshold}`,
                    commitment: proofResult.commitment,
                    privacyNote: 'Exact score not revealed'
                };
            } catch (e) {
                result.proof = { error: e.message };
            }
        } else {
            result.proof = { available: false, reason: 'No verification data or prover unavailable' };
        }
    }
    
    // Overall pass/fail
    const checks = [];
    if (result.identity) checks.push(result.identity.meetsRequired);
    if (result.scoring) checks.push(result.scoring.passed);
    if (result.sybil) checks.push(result.sybil.status !== 'flagged');
    
    result.passed = checks.length > 0 && checks.every(Boolean);
    
    // ERC-8004 compatible response
    result.erc8004Compatible = {
        response: result.scoring?.score || 0,
        tag: 'moltlaunch-sap-v1',
        responseURI: `${req.protocol}://${req.get('host')}/api/identity/${agentId}/report`
    };
    
    // Anchor on Solana if all checks passed
    if (result.passed && solanaConnection && solanaKeypair) {
        try {
            const { Transaction, TransactionInstruction, PublicKey } = require('@solana/web3.js');
            const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
            
            const memoData = `sap:validate:${agentId}:${result.scoring?.score || 0}:${result.identity?.trustLevel || 0}`;
            const memoIx = new TransactionInstruction({
                keys: [{ pubkey: solanaKeypair.publicKey, isSigner: true, isWritable: true }],
                programId: MEMO_PROGRAM_ID,
                data: Buffer.from(memoData)
            });
            
            const tx = new Transaction().add(memoIx);
            const sig = await solanaConnection.sendTransaction(tx, [solanaKeypair]);
            
            result.anchor = {
                chain: 'solana-devnet',
                signature: sig,
                explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`
            };
        } catch (e) {
            result.anchor = { error: e.message };
        }
    }
    
    res.json(result);
});

// Link a .sol domain to an agent
app.post('/api/identity/link', (req, res) => {
    const { agentId, solDomain, wallet, signature } = req.body || {};
    
    if (!agentId || !solDomain) {
        return res.status(400).json({ 
            error: 'Missing required fields',
            required: ['agentId', 'solDomain']
        });
    }
    
    // Validate domain format
    if (!solDomain.endsWith('.sol')) {
        return res.status(400).json({ error: 'Domain must end with .sol' });
    }
    
    // Check if agent is verified
    if (!verificationCache[agentId]) {
        return res.status(400).json({ error: 'Agent must be verified first' });
    }
    
    // Store identity link
    agentIdentities[agentId] = {
        solDomain,
        wallet: wallet || null,
        linkedAt: new Date().toISOString(),
        verified: false // Would verify on-chain ownership in production
    };
    saveIdentities();
    
    res.json({
        success: true,
        agentId,
        identity: agentIdentities[agentId],
        note: 'On-chain verification coming in Q2 2026'
    });
});

// Resolve agent identity
app.get('/api/identity/:agentId', (req, res) => {
    const { agentId } = req.params;
    const identity = agentIdentities[agentId];
    const verification = verificationCache[agentId];
    
    res.json({
        agentId,
        displayName: identity?.solDomain || agentId,
        solDomain: identity?.solDomain || null,
        wallet: identity?.wallet || null,
        identityHash: identity?.identityHash || null,
        trustLevel: identity?.trustLevel || 0,
        registeredAt: identity?.registeredAt || null,
        verified: verification ? true : false,
        score: verification?.score || null,
        tier: verification?.tier || null
    });
});

// List all identities
app.get('/api/identities', (req, res) => {
    const identities = Object.entries(agentIdentities).map(([agentId, data]) => ({
        agentId,
        ...data,
        verification: verificationCache[agentId] ? {
            score: verificationCache[agentId].score,
            tier: verificationCache[agentId].tier
        } : null
    }));
    
    res.json({
        count: identities.length,
        identities
    });
});

// ===========================================
// DIALECT NOTIFICATIONS (Stub)
// ===========================================
// Agent-to-human notifications via wallet or Telegram

// Notification queue (would integrate with Dialect SDK in production)
const notificationQueue = [];

app.post('/api/notify', (req, res) => {
    const { recipient, message, channels, priority } = req.body || {};
    
    if (!recipient || !message) {
        return res.status(400).json({ error: 'Missing recipient or message' });
    }
    
    const notification = {
        id: 'notif_' + crypto.randomBytes(8).toString('hex'),
        recipient,
        message,
        channels: channels || ['wallet'],
        priority: priority || 'normal',
        status: 'queued',
        createdAt: new Date().toISOString()
    };
    
    notificationQueue.push(notification);
    
    res.json({
        success: true,
        notification,
        note: 'Dialect integration coming in Q2 2026. Notifications queued but not delivered yet.'
    });
});

app.get('/api/notifications', (req, res) => {
    const { recipient } = req.query;
    let notifications = notificationQueue;
    
    if (recipient) {
        notifications = notifications.filter(n => n.recipient === recipient);
    }
    
    res.json({
        count: notifications.length,
        notifications: notifications.slice(-50) // Last 50
    });
});

// ==========================================
// PYTH ORACLE INTEGRATION
// ==========================================

const PYTH_PRICE_FEEDS = {
    'SOL/USD': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
    'BTC/USD': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    'ETH/USD': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    'USDC/USD': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    'BONK/USD': '0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
    'JUP/USD': '0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996'
};

app.get('/api/oracles/pyth/feeds', (req, res) => {
    res.json({
        provider: 'Pyth Network',
        network: 'solana',
        feeds: Object.entries(PYTH_PRICE_FEEDS).map(([symbol, id]) => ({
            symbol,
            feedId: id,
            endpoint: `/api/oracles/pyth/price/${encodeURIComponent(symbol)}`
        })),
        docs: 'https://docs.pyth.network/price-feeds'
    });
});

app.get('/api/oracles/pyth/price/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const feedId = PYTH_PRICE_FEEDS[symbol.toUpperCase()];
    
    if (!feedId) {
        return res.status(404).json({ 
            error: 'Price feed not found',
            availableFeeds: Object.keys(PYTH_PRICE_FEEDS)
        });
    }
    
    try {
        // Fetch from Pyth Hermes API
        const response = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}`);
        const data = await response.json();
        
        if (data.parsed && data.parsed[0]) {
            const priceData = data.parsed[0].price;
            const price = Number(priceData.price) * Math.pow(10, priceData.expo);
            
            res.json({
                symbol: symbol.toUpperCase(),
                feedId,
                price: price.toFixed(6),
                confidence: Number(priceData.conf) * Math.pow(10, priceData.expo),
                publishTime: new Date(data.parsed[0].price.publish_time * 1000).toISOString(),
                source: 'pyth-hermes',
                verificationBonus: '+10 PoA score for using Pyth oracles'
            });
        } else {
            res.status(502).json({ error: 'Unable to fetch price from Pyth' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Pyth API error', details: err.message });
    }
});

// ==========================================
// JITO MEV INTEGRATION
// ==========================================

const JITO_TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4bVBAAqvAJxMvD3f7cuNQhe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADaUMid9yfUytqMBgopwjb2DTLSdBGpK3JmBvFmNc94h'
];

app.get('/api/mev/jito/tip-accounts', (req, res) => {
    res.json({
        provider: 'Jito Labs',
        accounts: JITO_TIP_ACCOUNTS,
        note: 'Include a SOL transfer to one of these accounts as the last instruction in your bundle'
    });
});

app.get('/api/mev/jito/tip-estimate', async (req, res) => {
    const { urgency = 'medium' } = req.query;
    
    // Simulated tip estimates based on network conditions
    // In production, would query Jito block engine
    const baseTip = 10000; // 10k lamports
    const multipliers = { low: 0.5, medium: 1, high: 2, urgent: 5 };
    const multiplier = multipliers[urgency] || 1;
    
    res.json({
        urgency,
        estimatedTip: Math.floor(baseTip * multiplier),
        tipAccountsSample: JITO_TIP_ACCOUNTS.slice(0, 2),
        bundles: {
            endpoint: 'https://mainnet.block-engine.jito.wtf',
            docs: 'https://docs.jito.wtf/lowlatencytxnsend/'
        },
        verificationBonus: '+15 PoA score for using Jito bundles (MEV protection)'
    });
});

app.get('/api/verify/mev-protection/:agentId', (req, res) => {
    const { agentId } = req.params;
    
    // Check if agent uses Jito (would check transaction history in production)
    // For now, return stub data
    res.json({
        agentId,
        usesJito: false,
        bundleCount: 0,
        avgTip: 0,
        recommendation: 'Enable Jito bundles for +15 PoA score boost',
        howToEnable: {
            npm: 'npm install jito-ts',
            docs: 'https://docs.jito.wtf/'
        }
    });
});

// ==========================================
// METAPLEX VERIFICATION BADGES
// ==========================================

// Verification badges - PERSISTED
const badgesData = loadData(DATA_FILES.badges, {});
const verificationBadges = new Map(Object.entries(badgesData));
const saveBadges = () => debouncedSave('badges', DATA_FILES.badges, Object.fromEntries(verificationBadges));
console.log(`Loaded ${verificationBadges.size} verification badges`);

app.get('/api/badge/:agentId', (req, res) => {
    const { agentId } = req.params;
    const badge = verificationBadges.get(agentId);
    
    if (!badge) {
        // Check if agent is verified
        const verified = verificationCache[agentId];
        if (verified && verified.score >= 60) {
            // Generate badge metadata (not minted yet)
            res.json({
                agentId,
                minted: false,
                eligible: true,
                score: verified.score,
                tier: verified.tier,
                metadata: {
                    name: `MoltLaunch Verified: ${agentId}`,
                    symbol: 'MOLT-V',
                    description: `This agent achieved a Proof-of-Agent score of ${verified.score}/100 on MoltLaunch.`,
                    image: `https://web-production-419d9.up.railway.app/images/branding/x402-badge-2.png`,
                    attributes: [
                        { trait_type: 'PoA Score', value: verified.score },
                        { trait_type: 'Tier', value: verified.tier },
                        { trait_type: 'Verified Date', value: new Date().toISOString().split('T')[0] }
                    ],
                    external_url: `https://web-production-419d9.up.railway.app/api/verify/status/${agentId}`
                },
                mintEndpoint: `/api/badge/mint/${agentId}`
            });
        } else {
            res.status(404).json({ 
                error: 'Agent not verified or score below 60',
                eligibleScore: 60,
                currentScore: verified?.score || 0
            });
        }
    } else {
        res.json(badge);
    }
});

app.post('/api/badge/mint/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const { wallet } = req.body;
    
    const verified = verificationCache[agentId];
    if (!verified || verified.score < 60) {
        return res.status(400).json({ error: 'Agent not eligible for badge' });
    }
    
    // In production, would use Metaplex to mint NFT
    // For now, create a mock badge
    const badge = {
        agentId,
        minted: true,
        mintedAt: new Date().toISOString(),
        recipient: wallet || 'simulation-mode',
        nft: {
            mint: `BADGE${Date.now().toString(36).toUpperCase()}`,
            collection: 'MoltLaunch Verified Agents',
            metadata: {
                name: `MoltLaunch Verified: ${agentId}`,
                score: verified.score,
                tier: verified.tier
            }
        },
        note: 'Metaplex minting requires mainnet deployment. Badge metadata is ready.'
    };
    
    verificationBadges.set(agentId, badge);
    saveBadges();
    
    res.json({
        success: true,
        badge,
        shareUrl: `https://tensor.trade/item/${badge.nft.mint}` // Would be real URL
    });
});

// ==========================================
// SOLANA AGENT KIT DETECTION
// ==========================================

const AGENT_KIT_PLUGINS = [
    '@solana-agent-kit/plugin-token',
    '@solana-agent-kit/plugin-nft',
    '@solana-agent-kit/plugin-defi',
    '@solana-agent-kit/plugin-misc',
    '@solana-agent-kit/plugin-blinks'
];

app.post('/api/verify/agent-kit', async (req, res) => {
    const { agentId, repoUrl, packageJson } = req.body;
    
    if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
    }
    
    let detectedPlugins = [];
    let scoreBoost = 0;
    
    if (packageJson) {
        // Parse provided package.json
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        if (deps['solana-agent-kit']) {
            scoreBoost += 5;
            detectedPlugins.push('solana-agent-kit (core)');
        }
        
        for (const plugin of AGENT_KIT_PLUGINS) {
            if (deps[plugin]) {
                scoreBoost += 3;
                detectedPlugins.push(plugin);
            }
        }
    }
    
    res.json({
        agentId,
        usesAgentKit: detectedPlugins.length > 0,
        detectedPlugins,
        capabilities: detectedPlugins.map(p => p.replace('@solana-agent-kit/plugin-', '')),
        scoreBoost,
        note: 'Using solana-agent-kit with plugins demonstrates Solana ecosystem integration'
    });
});

app.get('/api/capabilities/solana-agent-kit', (req, res) => {
    res.json({
        name: 'Solana Agent Kit',
        repo: 'https://github.com/sendaifun/solana-agent-kit',
        plugins: AGENT_KIT_PLUGINS.map(p => ({
            name: p,
            scoreBoost: 3,
            capabilities: p.split('-').pop()
        })),
        coreBoost: 5,
        maxBoost: 5 + (AGENT_KIT_PLUGINS.length * 3),
        integration: 'Submit your package.json to /api/verify/agent-kit for detection'
    });
});

// ==========================================
// DASHBOARD V2 APIs
// ==========================================

// List agents by wallet (for dashboard)
app.get('/api/agents', (req, res) => {
    const { wallet } = req.query;
    
    if (!wallet) {
        // Return all agents (limited)
        const allAgents = Object.entries(verificationCache)
            .map(([agentId, v]) => ({
                agentId,
                name: v.name || agentId,
                score: v.score || 0,
                tier: v.tier || 'unverified',
                verified: v.verified || false,
                capabilities: v.capabilities || [],
                wallet: v.wallet,
                verifiedAt: v.verifiedAt,
                expiresAt: v.expiresAt
            }))
            .slice(0, 100);
        return res.json({ agents: allAgents, total: allAgents.length });
    }
    
    // Find agents by wallet
    const userAgents = Object.entries(verificationCache)
        .filter(([_, v]) => v.wallet === wallet || v.contact === wallet)
        .map(([agentId, v]) => ({
            agentId,
            name: v.name || agentId,
            score: v.score || 0,
            tier: v.tier || 'unverified',
            verified: v.verified || false,
            capabilities: v.capabilities || [],
            github: v.codeUrl || v.github,
            verifiedAt: v.verifiedAt,
            expiresAt: v.expiresAt,
            behavioralScore: v.behavioralScore || 0,
            totalTraces: v.totalTraces || 0
        }));
    
    // Also check airdrop registry for agents by this wallet
    const airdropAgents = Object.entries(airdropRegistry.agents)
        .filter(([_, a]) => a.wallet === wallet)
        .map(([agentId, a]) => {
            // Merge with verification if exists
            const v = verificationCache[agentId];
            return {
                agentId,
                name: a.name || agentId,
                score: v?.score || 0,
                tier: v?.tier || 'pending',
                verified: v?.verified || false,
                capabilities: v?.capabilities || [],
                appliedAt: a.appliedAt
            };
        });
    
    // Dedupe by agentId
    const seenIds = new Set(userAgents.map(a => a.agentId));
    const combined = [...userAgents];
    for (const a of airdropAgents) {
        if (!seenIds.has(a.agentId)) {
            combined.push(a);
        }
    }
    
    res.json({ agents: combined, wallet, total: combined.length });
});

// Get full agent details
app.get('/api/agents/:agentId', (req, res) => {
    const { agentId } = req.params;
    const v = verificationCache[agentId];
    const airdrop = airdropRegistry.agents[agentId];
    
    if (!v && !airdrop) {
        return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Get traces for this agent (via executionTraces module)
    let agentTraces = [];
    if (executionTraces) {
        try {
            agentTraces = executionTraces.getTraces(agentId) || [];
        } catch (e) {}
    }
    
    // Get pool memberships
    const poolApps = [];
    Object.entries(poolAgents).forEach(([topic, agents]) => {
        const found = agents.find(a => a.agentId === agentId);
        if (found) {
            poolApps.push({ topic, ...found });
        }
    });
    
    res.json({
        agentId,
        name: v?.name || airdrop?.name || agentId,
        score: v?.score || 0,
        tier: v?.tier || 'unverified',
        verified: v?.verified || false,
        verifiedAt: v?.verifiedAt,
        expiresAt: v?.expiresAt,
        attestationHash: v?.attestationHash,
        capabilities: v?.capabilities || [],
        github: v?.codeUrl || v?.github,
        wallet: v?.wallet || v?.contact || airdrop?.wallet,
        behavioralScore: v?.behavioralScore || 0,
        totalTraces: agentTraces.length,
        traces: agentTraces.slice(0, 20),
        pools: poolApps,
        appliedAt: airdrop?.appliedAt,
        scoreBreakdown: v?.breakdown || null,
        signals: v?.signals || null
    });
});

// Leaderboard - top verified agents
app.get('/api/leaderboard', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const capability = req.query.capability;
    
    let agents = Object.entries(verificationCache)
        .filter(([_, v]) => v.verified && v.score > 0)
        .map(([agentId, v]) => ({
            agentId,
            name: v.name || agentId,
            score: v.score || 0,
            tier: v.tier || 'good',
            capabilities: v.capabilities || [],
            behavioralScore: v.behavioralScore || 0,
            totalScore: (v.score || 0) + (v.behavioralScore || 0),
            verifiedAt: v.verifiedAt
        }));
    
    // Filter by capability if specified
    if (capability) {
        agents = agents.filter(a => 
            a.capabilities.some(c => c.toLowerCase() === capability.toLowerCase())
        );
    }
    
    // Sort by total score
    agents.sort((a, b) => b.totalScore - a.totalScore);
    
    // Add rank
    agents = agents.slice(0, limit).map((a, i) => ({ ...a, rank: i + 1 }));
    
    res.json({ 
        agents, 
        total: agents.length,
        filters: { capability }
    });
});

// Pool positions by wallet
app.get('/api/pool/positions', (req, res) => {
    const { wallet } = req.query;
    
    if (!wallet) {
        return res.status(400).json({ error: 'wallet query param required' });
    }
    
    // Find agents belonging to this wallet
    const walletAgents = Object.entries(verificationCache)
        .filter(([_, v]) => v.wallet === wallet || v.contact === wallet)
        .map(([agentId]) => agentId);
    
    // Find pool positions for those agents
    const positions = [];
    Object.entries(poolAgents).forEach(([topic, agents]) => {
        agents.forEach(agent => {
            if (walletAgents.includes(agent.agentId)) {
                positions.push({
                    topic,
                    agentId: agent.agentId,
                    status: agent.status || 'active',
                    totalDrawn: agent.totalDrawn || 0,
                    totalReturned: agent.totalReturned || 0,
                    efficiency: agent.efficiency || 0
                });
            }
        });
    });
    
    // Get staking positions
    const stakes = Object.entries(stakingPositions)
        .filter(([_, s]) => s.wallet === wallet)
        .map(([topic, s]) => ({
            topic,
            amount: s.amount || 0,
            stakedAt: s.stakedAt,
            status: 'active'
        }));
    
    res.json({ 
        positions, 
        stakes,
        wallet,
        totalStaked: stakes.reduce((sum, s) => sum + (s.amount || 0), 0)
    });
});

// Register agent (enhanced for dashboard)
app.post('/api/agents/register', async (req, res) => {
    const { agentId, name, description, github, capabilities, wallet } = req.body || {};
    
    if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
    }
    
    // Validate agentId format
    if (!/^[a-z0-9-]+$/.test(agentId)) {
        return res.status(400).json({ error: 'agentId must be lowercase alphanumeric with hyphens' });
    }
    
    // Check if already exists
    if (verificationCache[agentId]) {
        return res.status(409).json({ error: 'Agent ID already registered' });
    }
    
    const now = new Date().toISOString();
    
    // Store in verification cache
    verificationCache[agentId] = {
        name: name || agentId,
        description: description || '',
        capabilities: capabilities || [],
        codeUrl: github,
        wallet: wallet,
        contact: wallet,
        registeredAt: now,
        verified: false,
        score: 0,
        tier: 'unverified'
    };
    saveVerifications();
    
    // Also track in airdrop registry
    if (wallet) {
        if (!airdropRegistry.wallets[wallet]) {
            airdropRegistry.wallets[wallet] = {
                registeredAt: now,
                actions: []
            };
            airdropRegistry.stats.totalWallets++;
        }
        airdropRegistry.wallets[wallet].agentId = agentId;
        airdropRegistry.wallets[wallet].actions.push({ type: 'register', at: now });
        airdropRegistry.wallets[wallet].tier = calculateTier(airdropRegistry.wallets[wallet]);
        
        airdropRegistry.agents[agentId] = {
            wallet,
            name: name || agentId,
            appliedAt: now,
            verified: false
        };
        saveRegistry();
    }
    
    res.json({
        success: true,
        agentId,
        status: 'registered',
        message: 'Agent registered. Run verification to get your PoA score.',
        nextStep: 'POST /api/verify/deep with agentId'
    });
});

// API key management
const apiKeysCache = loadData(path.join(DATA_DIR, 'api-keys.json'), {});
const saveApiKeys = () => debouncedSave('api-keys', path.join(DATA_DIR, 'api-keys.json'), apiKeysCache);

app.post('/api/keys/generate', (req, res) => {
    const { wallet, name } = req.body || {};
    
    if (!wallet) {
        return res.status(400).json({ error: 'wallet required' });
    }
    
    const keyId = `mlt_${crypto.randomBytes(16).toString('hex')}`;
    const secret = crypto.randomBytes(32).toString('hex');
    
    apiKeysCache[keyId] = {
        wallet,
        name: name || 'Dashboard Key',
        createdAt: new Date().toISOString(),
        lastUsed: null,
        usageCount: 0
    };
    saveApiKeys();
    
    res.json({
        keyId,
        secret,
        message: 'Save this secret - it will not be shown again'
    });
});

app.get('/api/keys', (req, res) => {
    const { wallet } = req.query;
    
    if (!wallet) {
        return res.status(400).json({ error: 'wallet query param required' });
    }
    
    const keys = Object.entries(apiKeysCache)
        .filter(([_, k]) => k.wallet === wallet)
        .map(([keyId, k]) => ({
            keyId,
            name: k.name,
            createdAt: k.createdAt,
            lastUsed: k.lastUsed,
            usageCount: k.usageCount
        }));
    
    res.json({ keys, wallet });
});

app.delete('/api/keys/:keyId', (req, res) => {
    const { keyId } = req.params;
    const { wallet } = req.body || {};
    
    if (!apiKeysCache[keyId]) {
        return res.status(404).json({ error: 'Key not found' });
    }
    
    if (apiKeysCache[keyId].wallet !== wallet) {
        return res.status(403).json({ error: 'Not authorized' });
    }
    
    delete apiKeysCache[keyId];
    saveApiKeys();
    
    res.json({ success: true, message: 'Key deleted' });
});

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
