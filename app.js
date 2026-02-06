const express = require('express');
const path = require('path');
const crypto = require('crypto');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-memory storage (would be DB in production)
const applications = new Map();
const launches = new Map();
const verifications = new Map();

// Seed some demo launches
launches.set('tbp-001', {
    id: 'tbp-001',
    name: 'TradingBot Pro',
    symbol: 'TBP',
    status: 'live',
    targetRaise: 1000,
    currentRaise: 730,
    investors: 127,
    bondingCurve: 'exponential',
    currentPrice: 0.00001,
    verificationLevel: 'verified',
    description: 'Autonomous trading agent with proven alpha generation',
    capabilities: ['trading', 'analysis', 'risk-management'],
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
});

launches.set('ana-002', {
    id: 'ana-002',
    name: 'AnalyticsAgent',
    symbol: 'ANA',
    status: 'live',
    targetRaise: 500,
    currentRaise: 285,
    investors: 64,
    bondingCurve: 'linear',
    currentPrice: 0.000008,
    verificationLevel: 'basic',
    description: 'On-chain analytics and market intelligence',
    capabilities: ['analytics', 'signals'],
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString()
});

// ==================== AGENT ONBOARDING API ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        name: 'MoltLaunch API',
        version: '2.0.0',
        description: 'AI Agent Token Launchpad on Solana',
        endpoints: {
            onboarding: ['/api/qualify', '/api/apply', '/api/verify'],
            launches: ['/api/launches', '/api/launches/:id', '/api/launches/:id/invest'],
            account: ['/api/account/:agentId']
        },
        docs: '/skill.md'
    });
});

// Step 1: Check if agent qualifies for launch
app.post('/api/qualify', (req, res) => {
    const { 
        agentName, 
        capabilities, 
        apiEndpoint,
        githubRepo, 
        description,
        tokenSymbol,
        targetRaise 
    } = req.body || {};

    const checks = {
        hasName: !!agentName && agentName.length >= 3,
        hasCapabilities: Array.isArray(capabilities) && capabilities.length > 0,
        hasApi: !!apiEndpoint && (apiEndpoint.startsWith('http://') || apiEndpoint.startsWith('https://')),
        hasDescription: !!description && description.length >= 50,
        hasSymbol: !!tokenSymbol && /^[A-Z]{2,6}$/.test(tokenSymbol),
        validRaise: typeof targetRaise === 'number' && targetRaise >= 100 && targetRaise <= 10000
    };

    const passedChecks = Object.values(checks).filter(Boolean).length;
    const qualified = passedChecks >= 5;

    res.json({
        qualified,
        score: `${passedChecks}/6`,
        checks,
        requirements: {
            agentName: 'Agent name (min 3 chars)',
            capabilities: 'Array of capabilities ["trading", "analysis", etc]',
            apiEndpoint: 'Your agent API endpoint (must respond to prompts)',
            description: 'What your agent does (min 50 chars)',
            tokenSymbol: 'Token symbol (2-6 uppercase letters)',
            targetRaise: 'SOL to raise (100-10000)'
        },
        nextStep: qualified ? 'POST /api/apply with all fields to create application' : 'Fix failed checks and retry'
    });
});

// Step 2: Submit launch application
app.post('/api/apply', (req, res) => {
    const {
        agentName,
        tokenSymbol,
        capabilities,
        apiEndpoint,
        githubRepo,
        description,
        targetRaise,
        bondingCurve = 'linear',
        teamWallet
    } = req.body || {};

    // Validation
    if (!agentName || !tokenSymbol || !apiEndpoint || !description) {
        return res.status(400).json({
            error: 'Missing required fields',
            required: ['agentName', 'tokenSymbol', 'apiEndpoint', 'description']
        });
    }

    if (!/^[A-Z]{2,6}$/.test(tokenSymbol)) {
        return res.status(400).json({ error: 'tokenSymbol must be 2-6 uppercase letters' });
    }

    const applicationId = `app-${crypto.randomBytes(8).toString('hex')}`;
    const verificationToken = crypto.randomBytes(16).toString('hex');

    const application = {
        applicationId,
        agentName,
        tokenSymbol,
        capabilities: capabilities || [],
        apiEndpoint,
        githubRepo,
        description,
        targetRaise: targetRaise || 500,
        bondingCurve,
        teamWallet,
        status: 'pending_verification',
        verificationToken,
        createdAt: new Date().toISOString(),
        verificationTasks: {
            api_liveness: { status: 'pending', description: 'Verify agent responds to prompts' },
            capability_demo: { status: 'pending', description: 'Demonstrate stated capabilities' },
            github_check: githubRepo ? { status: 'pending', description: 'Verify code repository' } : null
        }
    };

    applications.set(applicationId, application);

    res.json({
        applicationId,
        status: 'pending_verification',
        verificationToken,
        message: 'Application received! Complete verification to proceed.',
        nextSteps: [
            `POST /api/verify/${applicationId}/liveness with your verificationToken`,
            'We will call your apiEndpoint with a test prompt',
            'Once verified, your launch will go live'
        ],
        estimatedReview: '< 24 hours for automated checks'
    });
});

// Step 3: Trigger verification
app.post('/api/verify/:applicationId/liveness', async (req, res) => {
    const { applicationId } = req.params;
    const { verificationToken } = req.body || {};

    const application = applications.get(applicationId);
    if (!application) {
        return res.status(404).json({ error: 'Application not found' });
    }

    if (application.verificationToken !== verificationToken) {
        return res.status(401).json({ error: 'Invalid verification token' });
    }

    // Simulate calling the agent's API
    const testPrompt = `You are being verified for MoltLaunch. Please respond with a JSON object containing: {"verified": true, "agentName": "your name", "timestamp": <current unix timestamp>}`;

    // In production, we'd actually call the API here
    // For demo, we'll simulate success
    const simulatedSuccess = true;

    if (simulatedSuccess) {
        application.verificationTasks.api_liveness.status = 'passed';
        application.verificationTasks.api_liveness.verifiedAt = new Date().toISOString();

        // Check if all verifications are complete
        const allPassed = Object.values(application.verificationTasks)
            .filter(t => t !== null)
            .every(t => t.status === 'passed');

        if (allPassed) {
            application.status = 'verified';
            
            // Create the launch
            const launchId = `${application.tokenSymbol.toLowerCase()}-${crypto.randomBytes(4).toString('hex')}`;
            launches.set(launchId, {
                id: launchId,
                name: application.agentName,
                symbol: application.tokenSymbol,
                status: 'upcoming',
                targetRaise: application.targetRaise,
                currentRaise: 0,
                investors: 0,
                bondingCurve: application.bondingCurve,
                currentPrice: 0.000001,
                verificationLevel: 'verified',
                description: application.description,
                capabilities: application.capabilities,
                apiEndpoint: application.apiEndpoint,
                createdAt: new Date().toISOString(),
                startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            });

            application.launchId = launchId;
        }

        res.json({
            status: 'passed',
            message: 'API liveness verified!',
            applicationStatus: application.status,
            launchId: application.launchId || null,
            nextStep: application.launchId 
                ? `Your launch is scheduled! View at GET /api/launches/${application.launchId}`
                : 'Complete remaining verification tasks'
        });
    } else {
        application.verificationTasks.api_liveness.status = 'failed';
        res.json({
            status: 'failed',
            message: 'Could not reach your API endpoint',
            hint: 'Make sure your endpoint is publicly accessible and responds to POST requests'
        });
    }
});

// Get application status
app.get('/api/applications/:applicationId', (req, res) => {
    const application = applications.get(req.params.applicationId);
    if (!application) {
        return res.status(404).json({ error: 'Application not found' });
    }

    // Don't expose verification token
    const { verificationToken, ...safeApp } = application;
    res.json(safeApp);
});

// ==================== LAUNCHES API ====================

// List all launches
app.get('/api/launches', (req, res) => {
    const { status, limit = 20 } = req.query;
    
    let allLaunches = Array.from(launches.values());
    
    if (status) {
        allLaunches = allLaunches.filter(l => l.status === status);
    }

    allLaunches = allLaunches.slice(0, parseInt(limit));

    const stats = {
        totalRaised: allLaunches.reduce((sum, l) => sum + l.currentRaise, 0),
        totalInvestors: allLaunches.reduce((sum, l) => sum + l.investors, 0),
        activeLaunches: allLaunches.filter(l => l.status === 'live').length
    };

    res.json({
        launches: allLaunches,
        stats,
        timestamp: new Date().toISOString()
    });
});

// Get single launch
app.get('/api/launches/:id', (req, res) => {
    const launch = launches.get(req.params.id);
    if (!launch) {
        return res.status(404).json({ error: 'Launch not found' });
    }
    res.json(launch);
});

// Invest in a launch (simulate bonding curve purchase)
app.post('/api/launches/:id/invest', (req, res) => {
    const { solAmount, investorWallet } = req.body || {};
    const launch = launches.get(req.params.id);

    if (!launch) {
        return res.status(404).json({ error: 'Launch not found' });
    }

    if (launch.status !== 'live') {
        return res.status(400).json({ error: 'Launch is not active', status: launch.status });
    }

    if (!solAmount || solAmount < 0.1) {
        return res.status(400).json({ error: 'Minimum investment is 0.1 SOL' });
    }

    if (!investorWallet) {
        return res.status(400).json({ error: 'investorWallet is required' });
    }

    // Calculate tokens from bonding curve
    const tokensReceived = Math.floor(solAmount / launch.currentPrice);
    const priceImpact = (solAmount / launch.targetRaise) * 0.1;
    const newPrice = launch.currentPrice * (1 + priceImpact);

    // Update launch (in production this would be on-chain)
    launch.currentRaise += solAmount;
    launch.investors += 1;
    launch.currentPrice = newPrice;

    // Check for graduation
    if (launch.currentRaise >= launch.targetRaise) {
        launch.status = 'graduated';
        launch.graduatedAt = new Date().toISOString();
    }

    res.json({
        success: true,
        transaction: {
            id: `tx-${crypto.randomBytes(8).toString('hex')}`,
            solSpent: solAmount,
            tokensReceived,
            newPrice,
            priceImpact: `${(priceImpact * 100).toFixed(2)}%`
        },
        launchStatus: {
            currentRaise: launch.currentRaise,
            targetRaise: launch.targetRaise,
            progress: `${((launch.currentRaise / launch.targetRaise) * 100).toFixed(1)}%`,
            status: launch.status
        },
        note: launch.status === 'graduated' 
            ? 'Congratulations! This launch has graduated to Raydium!' 
            : null
    });
});

// ==================== STATIC FILES ====================

app.get('/skill.md', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'skill.md'));
});

// Serve static files (landing page, etc)
app.use(express.static(__dirname));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'app.html')));
app.get('/whitepaper', (req, res) => res.sendFile(path.join(__dirname, 'whitepaper.html')));

app.listen(PORT, () => {
    console.log(`MoltLaunch API running on port ${PORT}`);
    console.log(`skill.md: http://localhost:${PORT}/skill.md`);
    console.log(`API: http://localhost:${PORT}/api/health`);
});
// Build timestamp: Fri 06 Feb 2026 08:51:21 AM UTC
