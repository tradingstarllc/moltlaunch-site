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

console.log('Starting MoltLaunch API...');
console.log('PORT:', PORT);

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
    console.log(`MoltLaunch API v2.2.0 running on 0.0.0.0:${PORT}`);
    console.log(`Stats: /api/stats | Logs: ${LOG_FILE}`);
});
