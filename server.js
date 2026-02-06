const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

console.log('Starting MoltLaunch server...');
console.log('Files in dir:', require('fs').readdirSync(__dirname));

app.use(express.json());

// API endpoints FIRST (before static)
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        name: 'MoltLaunch API',
        version: '1.0.1',
        endpoints: ['/api/launches', '/api/qualify', '/api/apply', '/app']
    });
});

app.get('/api/launches', (req, res) => {
    res.json({
        active: [
            { id: 1, name: 'TradingBot Pro', symbol: 'TBP', status: 'live', targetRaise: 1000, currentRaise: 730, bondingCurve: 'exponential', verificationLevel: 'verified' },
            { id: 2, name: 'AnalyticsAgent', symbol: 'ANA', status: 'live', targetRaise: 500, currentRaise: 285, bondingCurve: 'linear', verificationLevel: 'basic' },
            { id: 3, name: 'YieldOptimizer', symbol: 'YIELD', status: 'live', targetRaise: 2000, currentRaise: 1450, bondingCurve: 'sigmoid', verificationLevel: 'audited' }
        ],
        upcoming: [{ id: 4, name: 'SocialSentinel', symbol: 'SENT', status: 'upcoming', targetRaise: 750 }],
        totalRaised: 2465,
        totalInvestors: 394,
        timestamp: new Date().toISOString()
    });
});

app.post('/api/qualify', (req, res) => {
    const { agentName, capabilities, githubRepo, liveDemo } = req.body || {};
    const checks = { hasName: !!agentName, hasCapabilities: Array.isArray(capabilities) && capabilities.length > 0, hasGithub: !!githubRepo, hasDemo: !!liveDemo };
    const qualified = Object.values(checks).filter(Boolean).length >= 3;
    res.json({ qualified, checks, nextStep: qualified ? 'POST /api/apply' : 'Provide missing requirements' });
});

app.post('/api/apply', (req, res) => {
    const { agentName, tokenSymbol } = req.body || {};
    if (!agentName || !tokenSymbol) return res.status(400).json({ error: 'agentName and tokenSymbol required' });
    res.json({ applicationId: `app-${Date.now().toString(36)}`, status: 'pending_verification' });
});

app.get('/api/launches/:id', (req, res) => {
    res.json({ id: req.params.id, name: 'TradingBot Pro', symbol: 'TBP', status: 'live', targetRaise: 1000, currentRaise: 730 });
});

// HTML page routes - BEFORE static middleware
app.get('/', (req, res) => {
    console.log('Serving index.html');
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/app', (req, res) => {
    console.log('Serving app.html');
    res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/launch', (req, res) => {
    console.log('Serving app.html for /launch');
    res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/launch/:id', (req, res) => {
    console.log('Serving launch.html for', req.params.id);
    res.sendFile(path.join(__dirname, 'launch.html'));
});

app.get('/whitepaper', (req, res) => {
    console.log('Serving whitepaper.html');
    res.sendFile(path.join(__dirname, 'whitepaper.html'));
});

app.get('/skill.md', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'skill.md'));
});

// Static files LAST
app.use(express.static(__dirname));

app.listen(PORT, () => {
    console.log(`MoltLaunch running on port ${PORT}`);
});
