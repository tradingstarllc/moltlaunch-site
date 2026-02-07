/**
 * Generate images using x402 payment protocol via ClawCredit
 * Uses ClawCredit SDK to pay for AdPrompt image generation
 */

const { ClawCredit } = require('@t54-labs/clawcredit-sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load credentials
const credPath = path.join(os.homedir(), '.openclaw', 'credentials', 'clawcredit.json');
let creds;
try {
  creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  console.log('✓ Loaded ClawCredit credentials');
  console.log(`  Agent ID: ${creds.agent_id}`);
  console.log(`  Expires: ${creds.token_expires_at}`);
} catch (err) {
  console.error('ERROR: Could not load credentials from', credPath);
  process.exit(1);
}

async function generateImage(description, platform = 'x') {
  // Initialize ClawCredit with our token
  const credit = new ClawCredit({
    agentName: "MoltLaunch-ImageGen",
    apiToken: creds.api_token
  });

  const businessSummary = `MoltLaunch is trust infrastructure for AI agents on Solana. 
We provide Proof-of-Agent verification scoring, staking pools, and on-chain attestations 
to help agents prove they are real and trustworthy before accessing DeFi protocols.`;

  const targetUrl = 'https://x402.adprompt.io/creative-generation';

  console.log('\n🎨 Generating image via x402...');
  console.log(`  Platform: ${platform}`);
  console.log(`  Description: ${description}`);
  console.log(`  Cost: ~$1.00 USDC\n`);

  try {
    const result = await credit.pay({
      transaction: {
        recipient: targetUrl,
        amount: 1.00,  // $1 USDC
        chain: "BASE",
        asset: "USDC"
      },
      request_body: {
        http: {
          url: targetUrl,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeout_s: 120  // Image gen can take time
        },
        body: {
          business_summary: businessSummary,
          platform: platform,
          media_type: "image",
          description: description
        }
      },
      context: {
        reasoning_process: "Generating marketing image for MoltLaunch hackathon project dashboard"
      }
    });

    if (result.status === 'success') {
      console.log('✅ Payment successful!');
      console.log(`  Amount charged: $${result.amount_charged}`);
      console.log(`  Remaining balance: $${result.remaining_balance}`);
      console.log(`  TX hash: ${result.tx_hash}`);
      console.log('\n📦 Merchant response:');
      console.log(JSON.stringify(result.merchant_response, null, 2));
      return result.merchant_response;
    } else {
      console.error('❌ Payment failed:', result);
      return null;
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.message.includes('suspended')) {
      console.log('\n💳 Credit line may be suspended. Check repayment status.');
      const status = await credit.getRepaymentStatus();
      console.log('Repayment status:', status);
    }
    return null;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage: node generate-x402-image.js [description] [platform]

Platforms: instagram, tiktok, facebook, youtube, pinterest, x, linkedin, discord

Examples:
  node generate-x402-image.js "Futuristic robot getting verified"
  node generate-x402-image.js "AI agent trust badge" x
  node generate-x402-image.js "Staking pool with coins" instagram
`);
    return;
  }

  const description = args[0];
  const platform = args[1] || 'x';

  await generateImage(description, platform);
}

main().catch(console.error);

module.exports = { generateImage };
