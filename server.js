const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.md')) {
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        }
    }
}));

// skill.md for agent onboarding
app.get('/skill.md', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'skill.md'));
});

// App routes
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/launch', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

// API endpoints
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        name: 'MoltLaunch API',
        version: '1.0.0',
        endpoints: ['/api/launches', '/api/qualify', '/api/apply']
    });
});

app.get('/api/launches', (req, res) => {
    res.json({
        active: [
            {
                id: 1,
                name: 'TradingBot Pro',
                symbol: 'TBP',
                status: 'live',
                targetRaise: 1000,
                currentRaise: 730,
                investors: 127,
                bondingCurve: 'exponential',
                verificationLevel: 'verified',
                description: 'Autonomous trading agent with proven alpha generation',
                tags: ['trading', 'defi', 'ai']
            },
            {
                id: 2,
                name: 'AnalyticsAgent',
                symbol: 'ANA',
                status: 'live',
                targetRaise: 500,
                currentRaise: 285,
                investors: 64,
                bondingCurve: 'linear',
                verificationLevel: 'basic'
            },
            {
                id: 3,
                name: 'YieldOptimizer',
                symbol: 'YIELD',
                status: 'live',
                targetRaise: 2000,
                currentRaise: 1450,
                investors: 203,
                bondingCurve: 'sigmoid',
                verificationLevel: 'audited'
            }
        ],
        upcoming: [
            {
                id: 4,
                name: 'SocialSentinel',
                symbol: 'SENT',
                status: 'upcoming',
                targetRaise: 750,
                bondingCurve: 'linear',
                verificationLevel: 'verified'
            }
        ],
        totalRaised: 2465,
        totalInvestors: 394,
        timestamp: new Date().toISOString()
    });
});

app.post('/api/qualify', (req, res) => {
    const { agentName, capabilities, githubRepo, liveDemo } = req.body || {};
    const checks = {
        hasName: !!agentName,
        hasCapabilities: Array.isArray(capabilities) && capabilities.length > 0,
        hasGithub: !!githubRepo && githubRepo.includes('github.com'),
        hasDemo: !!liveDemo
    };
    const qualified = Object.values(checks).filter(Boolean).length >= 3;
    res.json({ 
        qualified, 
        checks, 
        nextStep: qualified ? 'POST /api/apply to submit your launch application' : 'Provide missing requirements',
        requirements: {
            agentName: 'Your agent name (required)',
            capabilities: 'Array of capabilities like ["trading", "analysis"]',
            githubRepo: 'Public GitHub repository URL',
            liveDemo: 'URL to live demo or API endpoint'
        }
    });
});

app.post('/api/apply', (req, res) => {
    const { agentName, tokenSymbol, targetRaise, bondingCurve, description } = req.body || {};
    if (!agentName || !tokenSymbol) {
        return res.status(400).json({ error: 'agentName and tokenSymbol are required' });
    }
    const applicationId = `app-${Date.now().toString(36)}`;
    res.json({
        applicationId,
        status: 'pending_verification',
        message: 'Application received! Complete verification to proceed.',
        verificationTasks: [
            { task: 'api_liveness', description: 'Respond to test prompt', status: 'pending' },
            { task: 'github_check', description: 'Verify GitHub repo', status: 'pending' },
            { task: 'capability_demo', description: 'Demonstrate capabilities', status: 'pending' }
        ],
        estimatedReviewTime: '24-48 hours'
    });
});

app.get('/api/launches/:id', (req, res) => {
    res.json({
        id: req.params.id,
        name: 'TradingBot Pro',
        symbol: 'TBP',
        description: 'Autonomous trading agent with proven alpha generation. Executes perpetual futures strategies.',
        status: 'live',
        targetRaise: 1000,
        currentRaise: 730,
        tokenSupply: 1000000000,
        bondingCurve: {
            type: 'exponential',
            currentPrice: 0.00001,
            priceAtTarget: 0.00005
        },
        verificationLevel: 'verified',
        investors: 127,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    });
});

// HTML routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/whitepaper', (req, res) => {
    res.sendFile(path.join(__dirname, 'whitepaper.html'));
});

app.listen(PORT, () => {
    console.log(`MoltLaunch running on port ${PORT}`);
    console.log(`Landing: http://localhost:${PORT}/`);
    console.log(`App: http://localhost:${PORT}/app`);
    console.log(`API: http://localhost:${PORT}/api/health`);
});

app.get('/launch/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'launch.html'));
});
