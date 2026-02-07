/**
 * Cauldron On-Chain AI Client
 * 
 * Invokes the POA-Scorer model deployed on Solana devnet
 * VM: FHcy35f4NGZK9b6j5TGMYstfB6PXEtmNbMLvjfR1y2Li
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Deployed addresses (devnet)
const DEPLOYED = {
    vm: 'FHcy35f4NGZK9b6j5TGMYstfB6PXEtmNbMLvjfR1y2Li',
    weights: 'GnSxMWbZEa538vJ9Pf3veDrKP1LkzPiaaVmC4mRnM91N',
    ram: 'EcfDgMDK4EcykYo3LfqKHnN5y2rYNCpgbkRCJRXwP3P7',
    program: 'FRsToriMLgDc1Ud53ngzHUZvCRoazCaGeGUuzkwoha7m',
    rpc: 'https://api.devnet.solana.com'
};

// Path to poa-scorer project
const POA_SCORER_PATH = path.join(os.homedir(), 'moltbot-trial/products/launchpad/poa-scorer');

// Feature weights for local fallback scoring
const WEIGHTS = {
    hasGithub: 15,
    hasApiEndpoint: 20,
    capabilityCount: 5,  // per capability
    codeLines: 0.3,      // per 100 lines (normalized)
    hasDocumentation: 10,
    testCoverage: 0.2    // per percent
};
const BIAS = 10;

/**
 * Calculate verification score locally (fallback)
 */
function calculateScoreLocal(features) {
    const [hasGithub, hasApi, capCount, codeLines, hasDocs, testCoverage] = features;
    
    let score = BIAS;
    score += hasGithub * WEIGHTS.hasGithub;
    score += hasApi * WEIGHTS.hasApiEndpoint;
    score += capCount * WEIGHTS.capabilityCount;
    score += codeLines * WEIGHTS.codeLines;
    score += hasDocs * WEIGHTS.hasDocumentation;
    score += testCoverage * WEIGHTS.testCoverage;
    
    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Extract features from agent data
 */
function extractFeatures(agentData) {
    const {
        agentId,
        capabilities = [],
        codeUrl,
        documentation,
        testCoverage = 0,
        codeLines = 0
    } = agentData;
    
    // Feature vector: [github, api, capabilities, code_lines, docs, tests]
    return [
        codeUrl && codeUrl.includes('github') ? 1 : 0,              // has_github
        agentData.apiEndpoint ? 1 : (capabilities.length > 0 ? 1 : 0), // has_api
        Math.min(10, capabilities.length),                           // capability_count (max 10)
        Math.min(100, Math.round(codeLines / 100)),                 // code_lines (normalized 0-100)
        documentation ? 1 : 0,                                       // has_documentation
        Math.min(100, testCoverage)                                  // test_coverage (0-100)
    ];
}

/**
 * Invoke on-chain model via Cauldron CLI
 * Returns: { score, onChain: true, txHash, rawOutput }
 */
async function invokeOnChain(features) {
    return new Promise((resolve, reject) => {
        const inputFile = path.join(POA_SCORER_PATH, 'api-input.json');
        const inputData = JSON.stringify({ data: features });
        
        // Write input file
        fs.writeFileSync(inputFile, inputData);
        
        // Build command
        const cmd = `
            cd ${POA_SCORER_PATH} && \
            source ~/.cargo/env && \
            export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.local/bin:$PATH" && \
            cauldron input-write --manifest frostbite-model.toml --accounts frostbite-accounts.toml --data api-input.json 2>/dev/null && \
            cauldron invoke --accounts frostbite-accounts.toml --fast 2>&1 && \
            cauldron output --manifest frostbite-model.toml --accounts frostbite-accounts.toml 2>&1
        `;
        
        exec(cmd, { shell: '/bin/bash', timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('On-chain invoke error:', error.message);
                // Fallback to local scoring
                const localScore = calculateScoreLocal(features);
                resolve({
                    score: localScore,
                    onChain: false,
                    fallback: true,
                    error: error.message
                });
                return;
            }
            
            // Parse output
            const outputMatch = stdout.match(/output:\s*\[(\d+)\]/);
            if (outputMatch) {
                // Convert q16 fixed-point to score
                const rawOutput = parseInt(outputMatch[1], 10);
                const score = Math.min(100, Math.max(0, Math.round(rawOutput / 6553.6)));
                
                resolve({
                    score,
                    onChain: true,
                    rawOutput,
                    vm: DEPLOYED.vm,
                    program: DEPLOYED.program
                });
            } else {
                // Fallback if output parsing fails
                const localScore = calculateScoreLocal(features);
                resolve({
                    score: localScore,
                    onChain: false,
                    fallback: true,
                    parseError: true,
                    stdout: stdout.substring(0, 500)
                });
            }
        });
    });
}

/**
 * Verify agent using on-chain AI model
 */
async function verifyAgent(agentData, options = {}) {
    const features = extractFeatures(agentData);
    const forceLocal = options.forceLocal || false;
    
    let result;
    
    if (forceLocal) {
        result = {
            score: calculateScoreLocal(features),
            onChain: false,
            local: true
        };
    } else {
        try {
            result = await invokeOnChain(features);
        } catch (e) {
            result = {
                score: calculateScoreLocal(features),
                onChain: false,
                fallback: true,
                error: e.message
            };
        }
    }
    
    return {
        ...result,
        features: {
            hasGithub: features[0],
            hasApiEndpoint: features[1],
            capabilityCount: features[2],
            codeLines: features[3],
            hasDocumentation: features[4],
            testCoverage: features[5]
        },
        tier: result.score >= 80 ? 'excellent' : 
              result.score >= 60 ? 'good' : 
              result.score >= 40 ? 'fair' : 'needs-work',
        timestamp: new Date().toISOString()
    };
}

/**
 * Get deployment info
 */
function getDeploymentInfo() {
    return {
        ...DEPLOYED,
        explorer: `https://explorer.solana.com/address/${DEPLOYED.vm}?cluster=devnet`,
        model: 'poa-scorer-v1',
        features: ['hasGithub', 'hasApiEndpoint', 'capabilityCount', 'codeLines', 'hasDocumentation', 'testCoverage'],
        outputFormat: 'q16 fixed-point → score 0-100'
    };
}

module.exports = {
    verifyAgent,
    extractFeatures,
    calculateScoreLocal,
    invokeOnChain,
    getDeploymentInfo,
    DEPLOYED
};
