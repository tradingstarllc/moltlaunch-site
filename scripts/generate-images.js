/**
 * x402 Image Generation via Freepik Mystic API
 * 
 * Uses x402 micropayments to generate images for MoltLaunch.
 * Freepik x402 endpoint: POST https://api.freepik.com/v1/x402/ai/mystic
 * 
 * Usage: node scripts/generate-images.js
 */

const { wrapFetch } = require('@x402/fetch');

const FREEPIK_X402_URL = 'https://api.freepik.com/v1/x402/ai/mystic';

// MoltLaunch image prompts for landing page
const IMAGE_PROMPTS = [
    {
        name: 'hero-agents',
        prompt: 'Futuristic AI robots working together in a neon-lit trading floor, purple and cyan lighting, digital circuits, blockchain nodes floating in air, professional tech aesthetic, 4k quality',
        aspect_ratio: 'landscape_16_9'
    },
    {
        name: 'verification-badge',
        prompt: 'A holographic verification badge with checkmark, glowing cyan and purple, digital certificate floating in space, blockchain attestation symbol, minimalist futuristic style',
        aspect_ratio: 'square_1_1'
    },
    {
        name: 'staking-pools',
        prompt: 'Abstract visualization of liquidity pools with coins flowing between them, purple and cyan gradients, digital tokens, investment growth chart in background, modern fintech aesthetic',
        aspect_ratio: 'landscape_16_9'
    },
    {
        name: 'bounty-hunters',
        prompt: 'Diverse group of AI agents hunting for bugs in code, cyberpunk detective style, neon purple and cyan, magnifying glass on smart contracts, reward coins floating',
        aspect_ratio: 'landscape_4_3'
    },
    {
        name: 'token-launch',
        prompt: 'Rocket launching from a bonding curve chart, Solana logo subtly visible, purple and cyan flames, digital tokens trailing behind, celebration confetti made of code',
        aspect_ratio: 'square_1_1'
    },
    {
        name: 'performance-monitor',
        prompt: 'Dashboard with AI agent performance metrics, efficiency gauges, profit charts, holographic displays, dark theme with cyan and purple accents, futuristic control room',
        aspect_ratio: 'landscape_16_9'
    }
];

async function generateImage(prompt, aspectRatio, wallet) {
    const fetch = wrapFetch(global.fetch, wallet);
    
    try {
        const response = await fetch(FREEPIK_X402_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt,
                aspect_ratio: aspectRatio,
                model: 'realism',
                resolution: '2k',
                hdr: 50,
                creative_detailing: 50,
                filter_nsfw: true
            })
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Freepik API error: ${response.status} - ${error}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Image generation failed:', error.message);
        return null;
    }
}

async function generateAllImages(wallet) {
    console.log('🎨 Generating MoltLaunch images via x402...\n');
    
    const results = [];
    
    for (const image of IMAGE_PROMPTS) {
        console.log(`Generating: ${image.name}...`);
        
        const result = await generateImage(image.prompt, image.aspect_ratio, wallet);
        
        if (result) {
            results.push({
                name: image.name,
                url: result.data?.[0]?.url || result.url,
                prompt: image.prompt
            });
            console.log(`  ✅ Generated: ${image.name}`);
        } else {
            console.log(`  ❌ Failed: ${image.name}`);
        }
        
        // Rate limiting
        await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log('\n📸 Generation complete!');
    console.log(JSON.stringify(results, null, 2));
    
    return results;
}

// Export for use in other modules
module.exports = { generateImage, generateAllImages, IMAGE_PROMPTS };

// CLI usage
if (require.main === module) {
    console.log('MoltLaunch x402 Image Generator');
    console.log('================================\n');
    console.log('This script generates images using Freepik x402 API.');
    console.log('Requires: @x402/fetch and a funded Solana wallet.\n');
    console.log('Image prompts to generate:');
    IMAGE_PROMPTS.forEach((img, i) => {
        console.log(`  ${i + 1}. ${img.name} (${img.aspect_ratio})`);
    });
    console.log('\nTo run with wallet: Set up x402 client and call generateAllImages()');
}
