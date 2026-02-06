const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
        version: '2.2.0',
        totalRequests: stats.totalRequests,
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
