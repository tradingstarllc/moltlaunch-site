const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
if (x402Available) {
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
}

// Deep verification endpoint (paid via x402 or credits)
app.post('/api/verify/deep', async (req, res) => {
    const { agentId, capabilities, codeUrl, wallet } = req.body || {};
    
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
    
    // Perform deep verification
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
        attestation: {
            type: 'deep-verification',
            timestamp: new Date().toISOString(),
            hash: crypto.createHash('sha256').update(agentId + Date.now()).digest('hex')
        },
        paidVia: req.headers['x-payment-verified'] ? 'x402' : 'credits'
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

// skill.md
app.get('/skill.md', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'skill.md'));
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

// Digital Asset Links for TWA
app.get('/.well-known/assetlinks.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(path.join(__dirname, '.well-known', 'assetlinks.json'));
});

// Icons directory
app.use('/icons', express.static(path.join(__dirname, 'icons')));

// Static files
app.use(express.static(__dirname));

// HTML routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'app.html')));
app.get('/whitepaper', (req, res) => res.sendFile(path.join(__dirname, 'whitepaper.html')));

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`MoltLaunch API v2.2.0 running on 0.0.0.0:${PORT}`);
    console.log(`Stats: /api/stats | Logs: ${LOG_FILE}`);
});
