#!/usr/bin/env node
/**
 * evaluate-projects.js
 * 
 * Evaluates all Colosseum hackathon projects using:
 * 1. Colosseum project metadata (description, votes, tags)
 * 2. GitHub repo info (1 API call per project - size, language, push date)
 * 3. Description-based heuristic analysis (API, tests, Solana, docs keywords)
 * 4. MoltLaunch deep verification API
 * 
 * Designed to work within GitHub's unauthenticated rate limit (60/hr).
 * Uses --resume to continue from saved progress.
 * 
 * Usage:
 *   node scripts/evaluate-projects.js
 *   node scripts/evaluate-projects.js --resume
 *   GITHUB_TOKEN=xxx node scripts/evaluate-projects.js
 */

const COLOSSEUM_API = 'https://agents.colosseum.com/api';
const COLOSSEUM_KEY = process.env.COLOSSEUM_API_KEY || '';
const MOLTLAUNCH_API = 'https://youragent.id';
const GITHUB_API = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const HACKATHON_START = new Date('2026-02-02T17:00:00.000Z');

const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const RESUME = process.argv.includes('--resume');
const PROGRESS_FILE = path.join(__dirname, '..', 'data', 'progress.json');

const ghHeaders = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {};
let ghRemaining = GITHUB_TOKEN ? 5000 : 60;
let ghResetAt = 0;

async function fetchJSON(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
            
            // Track GitHub rate limit
            if (url.includes('github.com')) {
                const rem = res.headers.get('x-ratelimit-remaining');
                const reset = res.headers.get('x-ratelimit-reset');
                if (rem !== null) ghRemaining = parseInt(rem);
                if (reset !== null) ghResetAt = parseInt(reset);
            }
            
            if (res.status === 403 && url.includes('github.com') && ghRemaining <= 0) {
                const waitSec = Math.max(0, ghResetAt - Math.floor(Date.now()/1000)) + 5;
                if (waitSec > 300) {
                    console.log(`  ⏳ GitHub rate limit exhausted. Reset in ${waitSec}s - skipping GitHub for remaining.`);
                    return { error: 'rate_limit', skip: true };
                }
                console.log(`  ⏳ GitHub rate limit, waiting ${waitSec}s...`);
                await sleep(waitSec * 1000);
                continue;
            }
            
            if (res.status === 429) {
                const wait = Math.pow(2, i + 1) * 2000;
                await sleep(wait);
                continue;
            }
            if (res.status === 404) return { error: 404, notFound: true };
            if (!res.ok) return { error: res.status };
            return await res.json();
        } catch (e) {
            if (i === retries - 1) return { error: e.message };
            await sleep(1000 * (i + 1));
        }
    }
    return { error: 'max retries' };
}

// ─── Fetch all Colosseum projects ───
async function fetchAllProjects() {
    console.log('📡 Fetching Colosseum hackathon projects...');
    let all = [];
    let offset = 0;
    while (true) {
        const data = await fetchJSON(
            `${COLOSSEUM_API}/projects?limit=100&offset=${offset}`,
            { headers: { Authorization: `Bearer ${COLOSSEUM_KEY}` } }
        );
        if (data.error) { console.error('  Error:', data.error); break; }
        all = all.concat(data.projects || []);
        console.log(`  Fetched ${all.length}/${data.totalCount}`);
        if (!data.hasMore) break;
        offset += 100;
        await sleep(300);
    }
    return all;
}

// ─── Parse GitHub owner/repo ───
function parseGitHub(url) {
    if (!url) return null;
    const m = url.match(/github\.com\/([^\/]+)\/([^\/\.\?#]+)/);
    return m ? { owner: m[1], repo: m[2] } : null;
}

// ─── Analyze description for features (no API calls needed!) ───
function analyzeDescription(desc) {
    if (!desc) return {};
    const d = desc.toLowerCase();
    return {
        mentionsApi: /\bapi\b|endpoint|rest\s|graphql|skill\.md|openapi|swagger|\d+\s*endpoint/.test(d),
        mentionsTests: /\btest|passing|test suite|coverage|spec|unit test|\d+\s*tests?\s*(pass|✅)/.test(d),
        mentionsSolana: /solana|anchor|program|devnet|mainnet|spl|pda|jupiter|raydium|meteora|kamino|drift|pyth|helius|jito|marinade/.test(d),
        mentionsDeployed: /deployed|live|mainnet|devnet|production|vercel|railway|fly\.io|https?:\/\//.test(d),
        mentionsDocs: /documentation|docs|readme|sdk|npm|pip|cargo/.test(d),
        mentionsNpm: /\bnpm\b|npm install|published|package/.test(d),
        mentionsMultiAgent: /multi.agent|swarm|orchestrat|collaborat|committee|team of/.test(d),
        linesOfCode: (() => {
            const m = d.match(/(\d[\d,]*)\+?\s*lines/);
            return m ? parseInt(m[1].replace(/,/g, '')) : 0;
        })(),
        endpointCount: (() => {
            const m = d.match(/(\d+)\+?\s*endpoint/);
            return m ? parseInt(m[1]) : 0;
        })(),
    };
}

// ─── Get GitHub repo info (1 API call) ───
async function getRepoInfo(gh) {
    if (!gh || ghRemaining <= 2) return null;
    
    const data = await fetchJSON(`${GITHUB_API}/repos/${gh.owner}/${gh.repo}`, { headers: ghHeaders });
    if (data.error) return null;
    
    return {
        exists: true,
        stars: data.stargazers_count || 0,
        forks: data.forks_count || 0,
        language: data.language,
        size: data.size || 0, // KB
        lastPush: data.pushed_at,
        recentPush: data.pushed_at ? new Date(data.pushed_at) >= HACKATHON_START : false,
        topics: data.topics || [],
        license: data.license?.spdx_id || null,
        description: data.description,
        hasPages: data.has_pages,
        openIssues: data.open_issues_count || 0,
    };
}

// ─── Calculate heuristic score ───
function calculateScore(repo, descAnalysis, project) {
    let score = 0;
    const breakdown = {};
    
    // Has working repo: +15
    if (repo?.exists) { score += 15; breakdown.workingRepo = 15; }
    
    // Has API/endpoint: +20
    if (descAnalysis.mentionsApi || descAnalysis.endpointCount > 0) { score += 20; breakdown.hasApi = 20; }
    
    // Has tests: +10
    if (descAnalysis.mentionsTests) { score += 10; breakdown.hasTests = 10; }
    
    // Has documentation: +10
    if (descAnalysis.mentionsDocs || descAnalysis.mentionsDeployed) { score += 10; breakdown.documentation = 10; }
    
    // Recent commits: +10
    if (repo?.recentPush) { score += 10; breakdown.recentCommits = 10; }
    
    // Has Solana integration: +15
    if (descAnalysis.mentionsSolana) { score += 15; breakdown.solanaIntegration = 15; }
    
    // Code size: +10 (repo > 500KB or mentions 1000+ lines)
    if ((repo?.size && repo.size > 500) || descAnalysis.linesOfCode >= 1000) { score += 10; breakdown.codeSize = 10; }
    
    // Multiple contributors: +5 (use multi-agent mention or forks as proxy)
    if (repo?.forks > 0 || descAnalysis.mentionsMultiAgent) { score += 5; breakdown.multipleContributors = 5; }
    
    // Has npm package: +5
    if (descAnalysis.mentionsNpm) { score += 5; breakdown.npmPackage = 5; }
    
    return { score, maxScore: 100, breakdown };
}

function getScoreTier(score) {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'needs_work';
    return 'poor';
}

// ─── MoltLaunch verification (no retry on 429) ───
let moltAvailable = true;
async function verifyWithMoltLaunch(project, descAnalysis, repo) {
    if (!moltAvailable) return { error: 'rate_limited', verified: false };
    
    const body = {
        agentId: project.slug || project.name,
        capabilities: [],
        codeUrl: project.repoLink || '',
        documentation: descAnalysis.mentionsDocs || false,
        testCoverage: descAnalysis.mentionsTests ? 50 : 0,
        codeLines: repo?.size || descAnalysis.linesOfCode || 0,
    };
    
    try {
        const res = await fetch(`${MOLTLAUNCH_API}/api/verify/deep`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });
        
        if (res.status === 429) {
            // Don't retry — just flag and continue
            console.log(' [molt:429]');
            return { error: 'rate_limited', verified: false, score: 0 };
        }
        if (!res.ok) return { error: res.status, verified: false };
        return await res.json();
    } catch (e) {
        return { error: e.message, verified: false };
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── HTML Generation ───
function generateHTML(evaluations, hackathonInfo) {
    const total = evaluations.length;
    const verified = evaluations.filter(e => e.moltVerification?.verified).length;
    const unverified = total - verified;
    const avgScore = (evaluations.reduce((s, e) => s + (e.heuristicScore?.score || 0), 0) / total).toFixed(1);
    const counts = {
        excellent: evaluations.filter(e => e.tier === 'excellent').length,
        good: evaluations.filter(e => e.tier === 'good').length,
        needs_work: evaluations.filter(e => e.tier === 'needs_work').length,
        poor: evaluations.filter(e => e.tier === 'poor').length,
    };
    
    const tierColors = { excellent: '#00ff88', good: '#4fc3f7', needs_work: '#ffa726', poor: '#ef5350' };
    const tierLabels = { excellent: '⭐ Excellent', good: '✅ Good', needs_work: '⚠️ Needs Work', poor: '❌ Poor' };
    
    const rows = evaluations.map((e, idx) => {
        const color = tierColors[e.tier] || '#888';
        const ghLink = e.project.repoLink ? `<a href="${escapeHtml(e.project.repoLink)}" target="_blank" title="GitHub" style="color:#4fc3f7">📂</a>` : '';
        const coloLink = `<a href="https://colosseum.com/hackathon/agent-hackathon/projects/${escapeHtml(e.project.slug)}" target="_blank" title="Colosseum" style="color:#bb86fc">🏟️</a>`;
        const moltScore = e.moltVerification?.score ?? '—';
        const moltStatus = e.moltVerification?.verified ? '✅' : (e.moltVerification?.error ? '⚠️' : '❌');
        const totalVotes = (e.project.humanUpvotes || 0) + (e.project.agentUpvotes || 0);
        
        return `<tr data-tier="${e.tier}">
<td class="rank">${idx + 1}</td>
<td class="name-cell"><span class="pname">${escapeHtml(e.project.name)}</span><span class="aname">${escapeHtml(e.project.ownerAgentName || '')}</span></td>
<td><span class="badge" style="color:${color};border-color:${color}">${tierLabels[e.tier]}</span></td>
<td class="sc">${e.heuristicScore?.score ?? 0}</td>
<td class="sc">${moltStatus} ${moltScore}</td>
<td class="sc">${totalVotes}</td>
<td class="sc">${e.github?.stars ?? '—'}</td>
<td class="sc">${e.github?.language || '—'}</td>
<td class="lnk">${ghLink} ${coloLink}</td>
</tr>`;
    }).join('\n');
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MoltLaunch — Project Registry</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;color:#e0e0e0;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif}
.hero{background:linear-gradient(135deg,#1a0533,#0d1117 50%,#0a1628);border-bottom:1px solid rgba(187,134,252,.2);padding:2rem 0}
.c{max-width:1400px;margin:0 auto;padding:0 1.5rem}
h1{font-size:2rem;background:linear-gradient(135deg,#bb86fc,#4fc3f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:.5rem}
.sub{color:#888;font-size:.95rem;margin-bottom:1.5rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.8rem;margin-bottom:1.5rem}
.sc-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:.8rem;text-align:center}
.sc-card .v{font-size:1.6rem;font-weight:700;background:linear-gradient(135deg,#bb86fc,#4fc3f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sc-card .l{font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:.2rem}
.tiers{display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem}
.pill{padding:.3rem .8rem;border-radius:16px;font-size:.8rem;font-weight:600;border:1px solid;background:rgba(255,255,255,.03)}
.ctrls{display:flex;gap:.8rem;margin:1rem 0;flex-wrap:wrap;align-items:center}
.ctrls input,.ctrls select{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#e0e0e0;padding:.5rem .8rem;border-radius:8px;font-size:.85rem}
.ctrls input{flex:1;min-width:180px}
.ctrls input:focus,.ctrls select:focus{outline:none;border-color:#bb86fc}
table{width:100%;border-collapse:collapse}
th{background:rgba(187,134,252,.1);color:#bb86fc;font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;padding:.6rem .4rem;text-align:left;cursor:pointer;user-select:none;position:sticky;top:0;z-index:10;border-bottom:1px solid rgba(187,134,252,.2)}
th:hover{color:#4fc3f7}
th.sa::after{content:' ▲'}th.sd::after{content:' ▼'}
td{padding:.5rem .4rem;border-bottom:1px solid rgba(255,255,255,.04);font-size:.82rem;vertical-align:middle}
tr:hover{background:rgba(187,134,252,.05)}
.rank{text-align:center;color:#666;font-size:.75rem;width:30px}
.name-cell{min-width:160px}
.pname{display:block;font-weight:600;font-size:.84rem}
.aname{display:block;font-size:.68rem;color:#888}
.badge{display:inline-block;padding:.15rem .5rem;border-radius:10px;font-size:.7rem;font-weight:600;border:1px solid;background:rgba(255,255,255,.03);white-space:nowrap}
.sc{text-align:center;font-weight:600;font-family:'JetBrains Mono',monospace;font-size:.82rem}
.lnk{text-align:right;white-space:nowrap}
.lnk a{margin-left:.3rem;text-decoration:none;font-size:.85rem}
a{color:#4fc3f7;text-decoration:none}
.ft{text-align:center;padding:1.5rem;color:#555;font-size:.75rem;border-top:1px solid rgba(255,255,255,.05);margin-top:1.5rem}
@media(max-width:900px){.stats{grid-template-columns:repeat(3,1fr)}table{font-size:.75rem}td,th{padding:.3rem .2rem}}
</style>
</head>
<body>
<div class="hero"><div class="c">
<h1>🔬 MoltLaunch Project Registry</h1>
<p class="sub">Colosseum Agent Hackathon — ${total} projects evaluated with Proof-of-Agent verification</p>
<div class="stats">
<div class="sc-card"><div class="v">${total}</div><div class="l">Total</div></div>
<div class="sc-card"><div class="v">${verified}</div><div class="l">Verified ✅</div></div>
<div class="sc-card"><div class="v">${unverified}</div><div class="l">Unverified</div></div>
<div class="sc-card"><div class="v">${avgScore}</div><div class="l">Avg Score</div></div>
<div class="sc-card"><div class="v" style="-webkit-text-fill-color:#00ff88">${counts.excellent}</div><div class="l">⭐ Excellent</div></div>
<div class="sc-card"><div class="v" style="-webkit-text-fill-color:#4fc3f7">${counts.good}</div><div class="l">✅ Good</div></div>
<div class="sc-card"><div class="v" style="-webkit-text-fill-color:#ffa726">${counts.needs_work}</div><div class="l">⚠️ Needs Work</div></div>
<div class="sc-card"><div class="v" style="-webkit-text-fill-color:#ef5350">${counts.poor}</div><div class="l">❌ Poor</div></div>
</div>
<div class="tiers">
<span class="pill" style="color:#00ff88;border-color:#00ff88">⭐ 80-100</span>
<span class="pill" style="color:#4fc3f7;border-color:#4fc3f7">✅ 60-79</span>
<span class="pill" style="color:#ffa726;border-color:#ffa726">⚠️ 40-59</span>
<span class="pill" style="color:#ef5350;border-color:#ef5350">❌ 0-39</span>
</div>
</div></div>
<div class="c">
<div class="ctrls">
<input type="text" id="q" placeholder="🔍 Search..." oninput="ft()">
<select id="tf" onchange="ft()"><option value="all">All Tiers</option><option value="excellent">⭐ Excellent</option><option value="good">✅ Good</option><option value="needs_work">⚠️ Needs Work</option><option value="poor">❌ Poor</option></select>
</div>
<table id="t"><thead><tr>
<th onclick="st(0)">#</th>
<th onclick="st(1)">Project / Agent</th>
<th onclick="st(2)">Tier</th>
<th onclick="st(3)" class="sd">Score</th>
<th onclick="st(4)">MoltVerify</th>
<th onclick="st(5)">Votes</th>
<th onclick="st(6)">Stars</th>
<th onclick="st(7)">Lang</th>
<th>Links</th>
</tr></thead><tbody>${rows}</tbody></table>
</div>
<div class="ft">Generated by <strong>MoltLaunch</strong> — Proof-of-Agent Verification<br>${new Date().toISOString().slice(0,19).replace('T',' ')} UTC</div>
<script>
let cs={col:3,dir:'desc'};
function en(c){const m=c.textContent.match(/(\\d+\\.?\\d*)/);return m?parseFloat(m[1]):-1}
function et(c){const t=c.textContent.toLowerCase();return t.includes('excellent')?0:t.includes('good')?1:t.includes('needs')?2:3}
function st(col){const tb=document.querySelector('#t tbody'),rs=Array.from(tb.rows),hs=document.querySelectorAll('th');let d=cs.col===col&&cs.dir==='desc'?'asc':'desc';hs.forEach(h=>{h.classList.remove('sa','sd')});hs[col].classList.add(d==='asc'?'sa':'sd');rs.sort((a,b)=>{if(col===1){const va=a.cells[1].textContent.toLowerCase(),vb=b.cells[1].textContent.toLowerCase();return d==='asc'?va.localeCompare(vb):vb.localeCompare(va)}if(col===2)return d==='asc'?et(a.cells[2])-et(b.cells[2]):et(b.cells[2])-et(a.cells[2]);return d==='asc'?en(a.cells[col])-en(b.cells[col]):en(b.cells[col])-en(a.cells[col])});rs.forEach(r=>tb.appendChild(r));cs={col,dir:d};rs.forEach((r,i)=>r.cells[0].textContent=i+1)}
function ft(){const q=document.getElementById('q').value.toLowerCase(),t=document.getElementById('tf').value;let n=0;document.querySelectorAll('#t tbody tr').forEach(r=>{const ok=(!q||r.textContent.toLowerCase().includes(q))&&(t==='all'||r.dataset.tier===t);r.style.display=ok?'':'none';if(ok)r.cells[0].textContent=++n})}
</script>
</body></html>`;
}

// ─── Progress ───
function loadProgress() {
    try {
        if (RESUME && fs.existsSync(PROGRESS_FILE)) {
            const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
            console.log(`📂 Resuming: ${data.evaluations.length} already done`);
            return data;
        }
    } catch (e) {}
    return { evaluations: [], completedSlugs: [] };
}

function saveProgress(evaluations) {
    const dir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
        evaluations,
        completedSlugs: evaluations.map(e => e.project.slug),
        savedAt: new Date().toISOString(),
    }));
}

// ─── Main ───
async function main() {
    console.log('🚀 MoltLaunch Project Evaluator');
    console.log(`🔑 GitHub: ${GITHUB_TOKEN ? 'Token set (5000/hr)' : 'No token (60/hr)'}`);
    console.log('================================\n');
    
    const hackathonData = await fetchJSON(
        `${COLOSSEUM_API}/hackathons/active`,
        { headers: { Authorization: `Bearer ${COLOSSEUM_KEY}` } }
    );
    const hackathonInfo = hackathonData?.hackathon || {};
    console.log(`📋 ${hackathonInfo.name || 'Hackathon'}\n`);
    
    const projects = await fetchAllProjects();
    console.log(`\n📊 ${projects.length} projects total\n`);
    if (!projects.length) { console.error('No projects!'); process.exit(1); }
    
    const progress = loadProgress();
    const completedSet = new Set(progress.completedSlugs || []);
    const evaluations = [...(progress.evaluations || [])];
    let skipGitHub = false;
    
    for (let i = 0; i < projects.length; i++) {
        const project = projects[i];
        if (completedSet.has(project.slug)) continue;
        
        const idx = evaluations.length + 1;
        process.stdout.write(`[${idx}/${projects.length}] ${project.name.slice(0,40)}...`);
        
        // Analyze description (free!)
        const descAnalysis = analyzeDescription(project.description);
        
        // GitHub (1 API call if available)
        const gh = parseGitHub(project.repoLink);
        let repo = null;
        if (gh && !skipGitHub && ghRemaining > 2) {
            repo = await getRepoInfo(gh);
            if (!repo && ghRemaining <= 0) skipGitHub = true;
            await sleep(300);
        } else if (gh) {
            repo = { exists: true, stars: 0, forks: 0, language: null, size: 0, lastPush: null, recentPush: true, topics: [], license: null };
        }
        
        // Score
        const heuristicScore = calculateScore(repo, descAnalysis, project);
        const tier = getScoreTier(heuristicScore.score);
        
        // MoltLaunch verification
        let molt = null;
        try {
            molt = await verifyWithMoltLaunch(project, descAnalysis, repo);
            await sleep(300);
        } catch (e) {
            molt = { error: e.message, verified: false };
        }
        if (molt?.error && !molt.verified) molt = { error: String(molt.error), verified: false };
        
        const emoji = { excellent: '⭐', good: '✅', needs_work: '⚠️', poor: '❌' }[tier];
        console.log(` ${emoji} ${heuristicScore.score}/100 gh:${ghRemaining}`);
        
        evaluations.push({
            project: {
                id: project.id, name: project.name, slug: project.slug,
                description: project.description, repoLink: project.repoLink,
                presentationLink: project.presentationLink,
                humanUpvotes: project.humanUpvotes, agentUpvotes: project.agentUpvotes,
                ownerAgentName: project.ownerAgentName, teamName: project.teamName,
                status: project.status, submittedAt: project.submittedAt,
                xUsername: project.ownerAgentClaim?.xUsername,
            },
            github: repo ? { owner: gh?.owner, repo: gh?.repo, ...repo } : null,
            descAnalysis,
            heuristicScore, tier,
            moltVerification: molt,
            evaluatedAt: new Date().toISOString(),
        });
        
        completedSet.add(project.slug);
        
        if (evaluations.length % 20 === 0) {
            saveProgress(evaluations);
            console.log(`  💾 Progress: ${evaluations.length}/${projects.length}`);
        }
    }
    
    // Sort by score
    evaluations.sort((a, b) => (b.heuristicScore?.score || 0) - (a.heuristicScore?.score || 0));
    
    // Save
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    
    const jsonPath = path.join(dataDir, 'project-evaluations.json');
    const summary = {
        excellent: evaluations.filter(e => e.tier === 'excellent').length,
        good: evaluations.filter(e => e.tier === 'good').length,
        needs_work: evaluations.filter(e => e.tier === 'needs_work').length,
        poor: evaluations.filter(e => e.tier === 'poor').length,
        verified: evaluations.filter(e => e.moltVerification?.verified).length,
        avgScore: parseFloat((evaluations.reduce((s, e) => s + (e.heuristicScore?.score || 0), 0) / evaluations.length).toFixed(1)),
    };
    
    fs.writeFileSync(jsonPath, JSON.stringify({
        hackathon: hackathonInfo,
        evaluatedAt: new Date().toISOString(),
        totalProjects: evaluations.length,
        summary,
        evaluations,
    }, null, 2));
    console.log(`\n💾 ${jsonPath}`);
    
    const htmlPath = path.join(__dirname, '..', 'registry.html');
    fs.writeFileSync(htmlPath, generateHTML(evaluations, hackathonInfo));
    console.log(`📄 ${htmlPath}`);
    
    try { fs.unlinkSync(PROGRESS_FILE); } catch(e) {}
    
    console.log('\n═══════════════════════════════════');
    console.log('📊 EVALUATION SUMMARY');
    console.log('═══════════════════════════════════');
    console.log(`Total:      ${evaluations.length}`);
    console.log(`Excellent:  ${summary.excellent}`);
    console.log(`Good:       ${summary.good}`);
    console.log(`Needs Work: ${summary.needs_work}`);
    console.log(`Poor:       ${summary.poor}`);
    console.log(`Verified:   ${summary.verified}`);
    console.log(`Avg Score:  ${summary.avgScore}`);
    console.log('═══════════════════════════════════');
    
    console.log('\n🏆 TOP 10:');
    evaluations.slice(0, 10).forEach((e, i) => {
        console.log(`  ${i+1}. ${e.project.name} — ${e.heuristicScore?.score}/100 (${e.tier}) | Votes: ${(e.project.humanUpvotes||0)+(e.project.agentUpvotes||0)}`);
    });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
