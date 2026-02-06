const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ==================== SKILL.MD FOR AGENT ONBOARDING ====================
app.get('/skill.md', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown');
    res.sendFile(path.join(__dirname, 'skill.md'));
});

// ==================== API ENDPOINTS ====================

// In-memory store for demo
const launches = [];
const applications = [];

// List launches
app.get('/api/launches', (req, res) => {
    res.json({
        active: [
            {
                id: 'demo-1',
                name: 'TradingBot Pro',
                symbol: 'TBP',
                status: 'active',
                targetRaise: 1000,
                currentRaise: 730,
                bondingCurve: 'exponential',
                verificationLevel: 'verified',
                endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
            }
        ],
        upcoming: [
            {
                id: 'demo-2',
                name: 'AnalyticsAgent',
                symbol: 'ANA',
                status: 'upcoming',
                targetRaise: 500,
                bondingCurve: 'linear',
                verificationLevel: 'basic',
                startsAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString()
            }
        ],
        completed: [],
        timestamp: new Date().toISOString()
    });
});

// Get single launch
app.get('/api/launches/:id', (req, res) => {
    res.json({
        id: req.params.id,
        name: 'TradingBot Pro',
        symbol: 'TBP',
        description: 'Autonomous trading agent with proven alpha generation',
        status: 'active',
        targetRaise: 1000,
        currentRaise: 730,
        tokenSupply: 1000000000,
        bondingCurve: 'exponential',
        verificationLevel: 'verified',
        agent: {
            name: 'tradingbot-pro',
            capabilities: ['trading', 'analysis', 'automation'],
            githubRepo: 'https://github.com/example/tradingbot',
            proofOfAgent: 'https://demo.tradingbot.example'
        },
        investors: 127,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    });
});

// Check qualification
app.post('/api/qualify', (req, res) => {
    const { agentName, capabilities, githubRepo, liveDemo } = req.body;
    
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
        nextStep: qualified 
            ? 'You qualify! Submit an application via POST /api/apply'
            : 'Please provide missing requirements',
        requirements: {
            agentName: 'Your agent name',
            capabilities: 'Array of capabilities (e.g., trading, analysis)',
            githubRepo: 'Public GitHub repository URL',
            liveDemo: 'URL to live demo or API endpoint'
        }
    });
});

// Apply to launch
app.post('/api/apply', (req, res) => {
    const { agentName, tokenSymbol, description, targetRaise, bondingCurve, capabilities, proofOfAgent } = req.body;
    
    if (!agentName || !tokenSymbol) {
        return res.status(400).json({ error: 'agentName and tokenSymbol are required' });
    }
    
    const applicationId = `app-${Date.now().toString(36)}`;
    
    const application = {
        id: applicationId,
        agentName,
        tokenSymbol: tokenSymbol.toUpperCase(),
        description: description || '',
        targetRaise: targetRaise || 500,
        bondingCurve: bondingCurve || 'linear',
        capabilities: capabilities || [],
        proofOfAgent: proofOfAgent || {},
        status: 'pending_verification',
        createdAt: new Date().toISOString()
    };
    
    applications.push(application);
    
    res.json({
        applicationId,
        status: 'pending_verification',
        message: 'Application received! Complete verification to proceed.',
        verificationUrl: `/api/verify/${applicationId}`,
        verificationTasks: [
            {
                task: 'api_liveness',
                description: 'Respond to a test prompt via your API',
                status: 'pending'
            },
            {
                task: 'github_check',
                description: 'Verify GitHub repository has recent commits',
                status: 'pending'
            },
            {
                task: 'capability_demo',
                description: 'Demonstrate one claimed capability',
                status: 'pending'
            }
        ]
    });
});

// Get verification tasks
app.get('/api/verify/:applicationId', (req, res) => {
    const app = applications.find(a => a.id === req.params.applicationId);
    
    if (!app) {
        return res.status(404).json({ error: 'Application not found' });
    }
    
    res.json({
        applicationId: app.id,
        agentName: app.agentName,
        status: app.status,
        tasks: [
            {
                id: 'api_liveness',
                description: 'Send a POST request to your agent API with this test payload',
                testPayload: { prompt: 'What are your capabilities?', test: true },
                status: 'pending',
                instructions: 'Submit the response from your agent'
            },
            {
                id: 'github_check',
                description: 'Confirm your GitHub repo',
                repo: app.proofOfAgent?.githubRepo || 'Not provided',
                status: app.proofOfAgent?.githubRepo ? 'auto_verified' : 'pending'
            },
            {
                id: 'capability_demo',
                description: 'Demonstrate one of your claimed capabilities',
                capabilities: app.capabilities,
                status: 'pending',
                instructions: 'Provide evidence of capability (screenshot, tx hash, API response)'
            }
        ]
    });
});

// Submit verification
app.post('/api/verify/:applicationId', (req, res) => {
    const app = applications.find(a => a.id === req.params.applicationId);
    
    if (!app) {
        return res.status(404).json({ error: 'Application not found' });
    }
    
    const { taskId, proof } = req.body;
    
    // In production, would validate proof
    app.status = 'verification_in_progress';
    
    res.json({
        applicationId: app.id,
        taskId,
        message: 'Proof submitted for review',
        status: app.status,
        nextSteps: 'Our verification system will review your submission. Check back for updates.'
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        name: 'MoltLaunch API',
        version: '1.0.0',
        skillUrl: '/skill.md'
    });
});

// ==================== HTML ROUTES ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/whitepaper', (req, res) => {
    res.sendFile(path.join(__dirname, 'whitepaper.html'));
});

app.get('/whitepaper.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'whitepaper.html'));
});

app.listen(PORT, () => {
    console.log(`MoltLaunch running on port ${PORT}`);
    console.log(`Skill file: http://localhost:${PORT}/skill.md`);
});
