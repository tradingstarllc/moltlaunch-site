/**
 * Generate multiple branding images for MoltLaunch via x402
 */

const { ClawCredit } = require('@t54-labs/clawcredit-sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');

const credPath = path.join(os.homedir(), '.openclaw', 'credentials', 'clawcredit.json');
const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

const credit = new ClawCredit({
  agentName: "MoltLaunch-Branding",
  apiToken: creds.api_token
});

const BUSINESS_SUMMARY = `MoltLaunch is trust infrastructure for AI agents on Solana blockchain. 
We provide Proof-of-Agent verification scoring, staking pools, and on-chain attestations 
to help AI agents prove they are real and trustworthy before accessing DeFi protocols.
Brand colors: cyan (#22d3ee), purple (#a855f7), dark backgrounds.`;

const IMAGES_TO_GENERATE = [
  {
    name: "hero-banner",
    platform: "x",
    description: "A wide cinematic hero banner showing AI agents being verified on a blockchain. Dark theme with cyan and purple neon accents. Multiple robot silhouettes passing through a glowing verification gateway. Abstract futuristic cityscape in background. No text."
  },
  {
    name: "staking-pool",
    platform: "x",
    description: "A visualization of AI agents pooling resources together. Show multiple glowing robot avatars around a central pool of golden coins/tokens. Dark background with purple and cyan lighting. Represents community staking. No text."
  },
  {
    name: "lifecycle-verify",
    platform: "x",
    description: "Phase 1 of agent lifecycle: VERIFICATION. A single AI robot stepping into a scanning beam, getting analyzed. Cyan colored theme. Dark background. Futuristic checkpoint aesthetic. No text."
  },
  {
    name: "lifecycle-operate",
    platform: "x",
    description: "Phase 3 of agent lifecycle: OPERATION. A verified AI agent actively trading, with holographic charts and data streams around it. Purple colored theme. Dark background. Shows agent in action. No text."
  }
];

async function generateImage(imageConfig) {
  const targetUrl = 'https://x402.adprompt.io/creative-generation';
  
  console.log(`\n🎨 Generating: ${imageConfig.name}`);
  console.log(`   ${imageConfig.description.slice(0, 80)}...`);

  try {
    const result = await credit.pay({
      transaction: {
        recipient: targetUrl,
        amount: 1.00,
        chain: "BASE",
        asset: "USDC"
      },
      request_body: {
        http: {
          url: targetUrl,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeout_s: 180
        },
        body: {
          business_summary: BUSINESS_SUMMARY,
          platform: imageConfig.platform,
          media_type: "image",
          description: imageConfig.description
        }
      },
      context: {
        reasoning_process: `Generating ${imageConfig.name} image for MoltLaunch hackathon branding`
      }
    });

    if (result.status === 'success') {
      console.log(`   ✅ Success! Charged: $${result.amount_charged}, Remaining: $${result.remaining_balance}`);
      return {
        name: imageConfig.name,
        ...result.merchant_response
      };
    }
  } catch (err) {
    console.error(`   ❌ Failed: ${err.message}`);
    return null;
  }
}

async function downloadImages(results) {
  const https = require('https');
  const outputDir = path.join(__dirname, '..', 'images', 'branding');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const result of results) {
    if (!result || !result.run_json_url) continue;
    
    console.log(`\n📥 Downloading ${result.name}...`);
    
    try {
      // Fetch the run.json to get image URLs
      const runData = await fetch(result.run_json_url).then(r => r.json());
      const items = runData.result?.final_result?.items || [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const imageUrl = `https://x402.adprompt.io${item.url}`;
        const filename = `${result.name}-${i + 1}.png`;
        const filepath = path.join(outputDir, filename);
        
        const response = await fetch(imageUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(filepath, buffer);
        
        console.log(`   ✓ Saved: ${filename} (${Math.round(buffer.length / 1024)}KB)`);
      }
    } catch (err) {
      console.error(`   ❌ Download failed: ${err.message}`);
    }
  }
}

async function main() {
  console.log('🚀 MoltLaunch Branding Image Generation');
  console.log('========================================');
  console.log(`Credit remaining: $${creds.credit_limit} (starting)`);
  console.log(`Images to generate: ${IMAGES_TO_GENERATE.length}`);
  console.log(`Estimated cost: $${IMAGES_TO_GENERATE.length}`);
  
  const results = [];
  
  for (const imageConfig of IMAGES_TO_GENERATE) {
    const result = await generateImage(imageConfig);
    if (result) {
      results.push(result);
    }
    
    // Small delay between requests
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n========================================');
  console.log(`Generated ${results.length}/${IMAGES_TO_GENERATE.length} images`);
  
  if (results.length > 0) {
    await downloadImages(results);
  }
  
  console.log('\n✨ Done!');
}

main().catch(console.error);
