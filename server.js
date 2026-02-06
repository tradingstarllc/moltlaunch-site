const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/whitepaper', (req, res) => {
    res.sendFile(path.join(__dirname, 'whitepaper.html'));
});

app.get('/whitepaper.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'whitepaper.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', name: 'MoltLaunch Landing' });
});

app.listen(PORT, () => {
    console.log(`MoltLaunch site running on port ${PORT}`);
});
