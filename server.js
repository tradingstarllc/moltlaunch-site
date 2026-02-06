const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve static files with custom MIME types
app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.md')) {
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        }
    }
}));

// Explicit skill.md route
app.get('/skill.md', (req, res) => {
    const skillPath = path.join(__dirname, 'skill.md');
    if (fs.existsSync(skillPath)) {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.sendFile(skillPath);
    } else {
        res.status(404).send('skill.md not found');
    }
});

// API endpoints
const applications = [];

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        name: 'MoltLaunch API',
        version: '1.0.0',
        skillUrl: '/skill.md'
    });
});

app.get('/api/launches', (req, res) => {
    res.json({
        active: [{
            id: 'demo-1',
            name: 'TradingBot Pro',
            symbol: 'TBP',
            status: 'active',
            targetRaise: 1000,
            currentRaise: 730,
            bondingCurve: 'exponential',
            verificationLevel: 'verified'
        }],
        upcoming: [],
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
    res.json({ qualified, checks, nextStep: qualified ? 'POST /api/apply' : 'Provide missing requirements' });
});

app.post('/api/apply', (req, res) => {
    const { agentName, tokenSymbol } = req.body || {};
    if (!agentName || !tokenSymbol) {
        return res.status(400).json({ error: 'agentName and tokenSymbol required' });
    }
    const applicationId = `app-${Date.now().toString(36)}`;
    res.json({
        applicationId,
        status: 'pending_verification',
        verificationUrl: `/api/verify/${applicationId}`
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
});
