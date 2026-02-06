// MoltLaunch Wallet Connection
// Supports Phantom, Solflare, and generic Solana wallets

const WalletManager = {
    provider: null,
    publicKey: null,
    
    // Detect available Solana wallet
    detectWallet() {
        // Check for Phantom
        if (window.phantom?.solana?.isPhantom) {
            return { provider: window.phantom.solana, name: 'Phantom' };
        }
        // Check for Solflare
        if (window.solflare?.isSolflare) {
            return { provider: window.solflare, name: 'Solflare' };
        }
        // Check for generic Solana provider (fallback)
        if (window.solana?.isPhantom) {
            return { provider: window.solana, name: 'Phantom' };
        }
        if (window.solana) {
            return { provider: window.solana, name: 'Solana Wallet' };
        }
        return null;
    },
    
    // Truncate address for display
    truncateAddress(address) {
        if (!address) return '';
        const str = address.toString();
        return `${str.slice(0, 4)}...${str.slice(-4)}`;
    },
    
    // Update UI based on connection state
    updateUI(connected, address = null) {
        const btn = document.getElementById('wallet-btn');
        const btnText = document.getElementById('wallet-btn-text');
        const dropdown = document.getElementById('wallet-dropdown');
        const chevron = btn?.querySelector('.wallet-chevron');
        const walletIcon = btn?.querySelector('.wallet-icon');
        
        if (!btn || !btnText) return;
        
        if (connected && address) {
            btnText.textContent = this.truncateAddress(address);
            btn.classList.add('connected');
            btn.setAttribute('data-connected', 'true');
            if (chevron) chevron.style.display = 'inline';
            if (walletIcon) walletIcon.style.display = 'none';
        } else {
            btnText.textContent = 'Connect Wallet';
            btn.classList.remove('connected');
            btn.setAttribute('data-connected', 'false');
            if (chevron) chevron.style.display = 'none';
            if (walletIcon) walletIcon.style.display = 'block';
            if (dropdown) dropdown.classList.remove('show');
        }
    },
    
    // Connect wallet
    async connect() {
        const wallet = this.detectWallet();
        
        if (!wallet) {
            // No wallet detected - show install options
            this.showInstallModal();
            return null;
        }
        
        try {
            this.provider = wallet.provider;
            
            // Request connection
            const response = await this.provider.connect();
            this.publicKey = response.publicKey.toString();
            
            // Save to localStorage
            localStorage.setItem('moltlaunch_wallet', this.publicKey);
            localStorage.setItem('moltlaunch_wallet_name', wallet.name);
            
            // Update UI
            this.updateUI(true, this.publicKey);
            
            // Listen for disconnect
            this.provider.on('disconnect', () => {
                this.handleDisconnect();
            });
            
            // Listen for account change
            this.provider.on('accountChanged', (publicKey) => {
                if (publicKey) {
                    this.publicKey = publicKey.toString();
                    localStorage.setItem('moltlaunch_wallet', this.publicKey);
                    this.updateUI(true, this.publicKey);
                } else {
                    this.handleDisconnect();
                }
            });
            
            console.log(`Connected to ${wallet.name}: ${this.publicKey}`);
            return this.publicKey;
            
        } catch (err) {
            console.error('Wallet connection failed:', err);
            if (err.code === 4001) {
                // User rejected
                console.log('User rejected connection');
            }
            return null;
        }
    },
    
    // Disconnect wallet
    async disconnect() {
        try {
            if (this.provider && this.provider.disconnect) {
                await this.provider.disconnect();
            }
        } catch (err) {
            console.error('Disconnect error:', err);
        }
        
        this.handleDisconnect();
    },
    
    // Handle disconnect (cleanup)
    handleDisconnect() {
        this.provider = null;
        this.publicKey = null;
        localStorage.removeItem('moltlaunch_wallet');
        localStorage.removeItem('moltlaunch_wallet_name');
        this.updateUI(false);
        console.log('Wallet disconnected');
    },
    
    // Try to restore previous connection
    async tryReconnect() {
        const savedAddress = localStorage.getItem('moltlaunch_wallet');
        if (!savedAddress) return false;
        
        const wallet = this.detectWallet();
        if (!wallet) {
            // Wallet extension not available anymore
            localStorage.removeItem('moltlaunch_wallet');
            localStorage.removeItem('moltlaunch_wallet_name');
            return false;
        }
        
        try {
            this.provider = wallet.provider;
            
            // Try to reconnect silently (onlyIfTrusted)
            const response = await this.provider.connect({ onlyIfTrusted: true });
            this.publicKey = response.publicKey.toString();
            
            // Update localStorage in case address changed
            localStorage.setItem('moltlaunch_wallet', this.publicKey);
            
            this.updateUI(true, this.publicKey);
            
            // Set up event listeners
            this.provider.on('disconnect', () => {
                this.handleDisconnect();
            });
            
            this.provider.on('accountChanged', (publicKey) => {
                if (publicKey) {
                    this.publicKey = publicKey.toString();
                    localStorage.setItem('moltlaunch_wallet', this.publicKey);
                    this.updateUI(true, this.publicKey);
                } else {
                    this.handleDisconnect();
                }
            });
            
            console.log('Reconnected to wallet:', this.publicKey);
            return true;
            
        } catch (err) {
            // Silent reconnect failed - user needs to connect manually
            console.log('Auto-reconnect failed, manual connection required');
            localStorage.removeItem('moltlaunch_wallet');
            localStorage.removeItem('moltlaunch_wallet_name');
            return false;
        }
    },
    
    // Show modal for wallet installation
    showInstallModal() {
        // Create modal if it doesn't exist
        let modal = document.getElementById('wallet-install-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'wallet-install-modal';
            modal.className = 'wallet-modal';
            modal.innerHTML = `
                <div class="wallet-modal-content">
                    <div class="wallet-modal-header">
                        <h3>Install a Wallet</h3>
                        <button class="wallet-modal-close" onclick="WalletManager.hideInstallModal()">&times;</button>
                    </div>
                    <p>You need a Solana wallet to connect. Choose one below:</p>
                    <div class="wallet-options">
                        <a href="https://phantom.app/" target="_blank" class="wallet-option">
                            <img src="https://phantom.app/img/phantom-logo.svg" alt="Phantom" onerror="this.style.display='none'">
                            <span>Phantom</span>
                        </a>
                        <a href="https://solflare.com/" target="_blank" class="wallet-option">
                            <img src="https://solflare.com/favicon.ico" alt="Solflare" onerror="this.style.display='none'">
                            <span>Solflare</span>
                        </a>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        modal.classList.add('show');
    },
    
    hideInstallModal() {
        const modal = document.getElementById('wallet-install-modal');
        if (modal) {
            modal.classList.remove('show');
        }
    },
    
    // Toggle dropdown menu
    toggleDropdown() {
        const dropdown = document.getElementById('wallet-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('show');
        }
    },
    
    // Handle button click
    async handleClick() {
        const btn = document.getElementById('wallet-btn');
        const isConnected = btn?.getAttribute('data-connected') === 'true';
        
        if (isConnected) {
            this.toggleDropdown();
        } else {
            await this.connect();
        }
    },
    
    // Copy address to clipboard
    async copyAddress() {
        if (this.publicKey) {
            try {
                await navigator.clipboard.writeText(this.publicKey);
                // Show feedback
                const dropdown = document.getElementById('wallet-dropdown');
                const copyBtn = dropdown?.querySelector('.copy-address');
                if (copyBtn) {
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                    }, 1500);
                }
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        }
    },
    
    // Initialize
    init() {
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const walletContainer = document.getElementById('wallet-container');
            const dropdown = document.getElementById('wallet-dropdown');
            if (walletContainer && dropdown && !walletContainer.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });
        
        // Close modal when clicking outside
        document.addEventListener('click', (e) => {
            const modal = document.getElementById('wallet-install-modal');
            if (modal && e.target === modal) {
                this.hideInstallModal();
            }
        });
        
        // Try to reconnect on page load
        this.tryReconnect();
    }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => WalletManager.init());
} else {
    WalletManager.init();
}
