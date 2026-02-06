// MoltLaunch DBC Client - Connects to devnet pool

const DBC_API = window.location.origin;

class MoltLaunchDBC {
    constructor() {
        this.poolInfo = null;
    }
    
    async getPoolInfo() {
        try {
            const response = await fetch(`${DBC_API}/api/dbc/pool`);
            this.poolInfo = await response.json();
            return this.poolInfo;
        } catch (error) {
            console.error('Failed to fetch pool info:', error);
            return null;
        }
    }
    
    async getLaunches() {
        try {
            const response = await fetch(`${DBC_API}/api/launches`);
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch launches:', error);
            return { launches: [] };
        }
    }
    
    getExplorerUrl(type = 'token') {
        if (!this.poolInfo) return null;
        const { tokenMint, network } = this.poolInfo;
        const cluster = network === 'mainnet' ? '' : `?cluster=${network}`;
        return `https://solscan.io/${type}/${tokenMint}${cluster}`;
    }
    
    async buyTokens(amountSOL) {
        if (!window.solana) {
            throw new Error('Wallet not connected');
        }
        
        // This would need the full swap transaction building
        // For now, return instructions for manual swap
        const poolInfo = await this.getPoolInfo();
        return {
            instruction: 'Connect wallet and swap on Meteora DEX',
            tokenMint: poolInfo.tokenMint,
            network: poolInfo.network,
            amountSOL,
            meteoraUrl: `https://app.meteora.ag/pools/${poolInfo.tokenMint}?network=devnet`
        };
    }
}

// Global instance
window.moltDBC = new MoltLaunchDBC();

// Auto-load pool info on page load
document.addEventListener('DOMContentLoaded', async () => {
    const poolInfo = await window.moltDBC.getPoolInfo();
    if (poolInfo) {
        console.log('MoltLaunch DBC Pool loaded:', poolInfo.symbol, 'on', poolInfo.network);
        
        // Update UI if elements exist
        const poolBadge = document.getElementById('pool-network');
        if (poolBadge) {
            poolBadge.textContent = poolInfo.network.toUpperCase();
            poolBadge.classList.add(poolInfo.network === 'mainnet' ? 'live' : 'devnet');
        }
        
        const tokenLink = document.getElementById('token-explorer');
        if (tokenLink) {
            tokenLink.href = poolInfo.explorerUrl;
        }
    }
});
