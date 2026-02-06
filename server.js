const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

console.log('Starting MoltLaunch API...');
console.log('PORT:', PORT);
console.log('__dirname:', __dirname);

app.use(express.json());

// Health check - FIRST
app.get('/api/health', (req, res) => {
    console.log('Health check hit');
    res.json({ 
        status: 'ok', 
        name: 'MoltLaunch API',
        version: '2.1.0',
        timestamp: new Date().toISOString()
    });
});

// API endpoints
app.get('/api/launches', (req, res) => {
    res.json({
        launches: [
            { id: 'tbp-001', name: 'TradingBot Pro', symbol: 'TBP', status: 'live', currentRaise: 730, targetRaise: 1000 },
            { id: 'ana-002', name: 'AnalyticsAgent', symbol: 'ANA', status: 'live', currentRaise: 285, targetRaise: 500 }
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
    const { agentName, tokenSymbol } = req.body || {};
    if (!agentName || !tokenSymbol) {
        return res.status(400).json({ error: 'agentName and tokenSymbol required' });
    }
    const applicationId = `app-${Date.now().toString(36)}`;
    res.json({ 
        applicationId, 
        status: 'pending_verification',
        message: 'Application received!'
    });
});

// skill.md
app.get('/skill.md', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, 'skill.md'));
});

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
    console.log(`MoltLaunch API running on 0.0.0.0:${PORT}`);
});
