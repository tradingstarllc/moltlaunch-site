/**
 * SlotScribe Integration for MoltLaunch
 * 
 * Anchors execution trace commitments to Solana via Memo instructions.
 * Provides immutable "flight recorder" for agent behavioral proofs.
 */

const crypto = require('crypto');

// SlotScribe API configuration
const SLOTSCRIBE_API = process.env.SLOTSCRIBE_API || 'https://api.slotscribe.xyz';
const SLOTSCRIBE_SDK_URL = 'https://slotscribe.xyz';

/**
 * SlotScribe client for anchoring trace commitments
 */
class SlotScribeAnchor {
    constructor(options = {}) {
        this.apiBase = options.apiBase || SLOTSCRIBE_API;
        this.network = options.network || 'devnet';
        this.wallet = options.wallet || null; // AgentWallet instance
    }

    /**
     * Anchor a trace commitment to Solana via Memo instruction
     * 
     * @param {Object} params
     * @param {string} params.agentId - Agent identifier
     * @param {string} params.traceId - Trace identifier
     * @param {string} params.commitment - SHA-256 commitment hash
     * @param {Object} params.metadata - Additional metadata to include
     * @returns {Promise<Object>} Anchor result with txHash
     */
    async anchorCommitment({ agentId, traceId, commitment, metadata = {} }) {
        // Build the memo payload
        const memoPayload = {
            version: '1.0',
            type: 'moltlaunch:trace',
            agentId,
            traceId,
            commitment,
            timestamp: Date.now(),
            ...metadata
        };

        // Serialize and hash for compact on-chain storage
        const memoString = JSON.stringify(memoPayload);
        const memoHash = crypto.createHash('sha256')
            .update(memoString)
            .digest('hex')
            .slice(0, 64); // Memo has size limits

        try {
            // Option 1: Use SlotScribe SDK directly
            if (this.wallet) {
                return await this._anchorViaSdk(memoHash, memoPayload);
            }

            // Option 2: Use SlotScribe hosted API
            return await this._anchorViaApi(memoHash, memoPayload);
        } catch (error) {
            console.error('SlotScribe anchor failed:', error.message);
            return {
                success: false,
                error: error.message,
                commitment,
                traceId
            };
        }
    }

    /**
     * Anchor via SlotScribe SDK (requires wallet)
     */
    async _anchorViaSdk(memoHash, payload) {
        // This would use @slotscribe/sdk when available
        // For now, simulate the expected interface
        
        const { Connection, PublicKey, Transaction, TransactionInstruction } = 
            require('@solana/web3.js');
        
        const connection = new Connection(
            this.network === 'mainnet' 
                ? 'https://api.mainnet-beta.solana.com'
                : 'https://api.devnet.solana.com'
        );

        // Memo program ID
        const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

        // Build memo instruction
        const memoInstruction = new TransactionInstruction({
            keys: [],
            programId: MEMO_PROGRAM_ID,
            data: Buffer.from(memoHash, 'utf8')
        });

        // Build and sign transaction
        const tx = new Transaction().add(memoInstruction);
        tx.feePayer = this.wallet.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        // Sign via AgentWallet
        const signedTx = await this.wallet.signTransaction(tx);
        
        // Submit
        const txHash = await connection.sendRawTransaction(signedTx.serialize());
        await connection.confirmTransaction(txHash);

        return {
            success: true,
            txHash,
            commitment: payload.commitment,
            traceId: payload.traceId,
            memoHash,
            network: this.network,
            explorerUrl: `https://explorer.solana.com/tx/${txHash}?cluster=${this.network}`
        };
    }

    /**
     * Anchor via SlotScribe hosted API (no wallet needed)
     */
    async _anchorViaApi(memoHash, payload) {
        const response = await fetch(`${this.apiBase}/v1/anchor`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                network: this.network,
                memo: memoHash,
                metadata: {
                    source: 'moltlaunch',
                    agentId: payload.agentId,
                    traceId: payload.traceId
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'SlotScribe API error');
        }

        const result = await response.json();
        
        return {
            success: true,
            txHash: result.txHash || result.signature,
            commitment: payload.commitment,
            traceId: payload.traceId,
            memoHash,
            network: this.network,
            explorerUrl: result.explorerUrl
        };
    }

    /**
     * Verify an anchored trace
     * 
     * @param {string} txHash - Transaction hash to verify
     * @param {string} expectedCommitment - Expected commitment hash
     * @returns {Promise<Object>} Verification result
     */
    async verifyAnchor(txHash, expectedCommitment) {
        try {
            const { Connection } = require('@solana/web3.js');
            
            const connection = new Connection(
                this.network === 'mainnet'
                    ? 'https://api.mainnet-beta.solana.com'
                    : 'https://api.devnet.solana.com'
            );

            const tx = await connection.getTransaction(txHash, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });

            if (!tx) {
                return { valid: false, error: 'Transaction not found' };
            }

            // Extract memo from transaction
            const memoInstruction = tx.transaction.message.instructions.find(ix => {
                // Check if it's a memo instruction
                const programId = tx.transaction.message.accountKeys[ix.programIdIndex];
                return programId.toString() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
            });

            if (!memoInstruction) {
                return { valid: false, error: 'No memo instruction found' };
            }

            // Decode memo data
            const memoData = Buffer.from(memoInstruction.data).toString('utf8');

            // Verify commitment matches
            const expectedMemoHash = crypto.createHash('sha256')
                .update(JSON.stringify({ commitment: expectedCommitment }))
                .digest('hex')
                .slice(0, 64);

            const matches = memoData.includes(expectedCommitment) || 
                           memoData === expectedMemoHash;

            return {
                valid: matches,
                txHash,
                blockTime: tx.blockTime,
                slot: tx.slot,
                memoData,
                expectedCommitment
            };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }
}

/**
 * Integration helper for MoltLaunch execution traces
 */
class MoltLaunchSlotScribeIntegration {
    constructor(options = {}) {
        this.anchor = new SlotScribeAnchor(options);
        this.moltlaunchApi = options.moltlaunchApi || 'https://web-production-419d9.up.railway.app/api';
    }

    /**
     * Submit trace and anchor to Solana in one flow
     * 
     * @param {string} agentId 
     * @param {Object} traceData 
     * @returns {Promise<Object>}
     */
    async submitAndAnchor(agentId, traceData) {
        // Step 1: Submit trace to MoltLaunch
        const submitResponse = await fetch(`${this.moltlaunchApi}/traces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId, trace: traceData })
        });

        if (!submitResponse.ok) {
            throw new Error('Failed to submit trace');
        }

        const traceResult = await submitResponse.json();

        // Step 2: Anchor commitment to Solana
        const anchorResult = await this.anchor.anchorCommitment({
            agentId,
            traceId: traceResult.traceId,
            commitment: traceResult.commitment,
            metadata: {
                behavioralScore: traceResult.behavioralScore,
                period: traceData.period
            }
        });

        if (!anchorResult.success) {
            console.warn('Anchor failed, trace saved but not on-chain:', anchorResult.error);
            return { ...traceResult, anchored: false };
        }

        // Step 3: Update MoltLaunch with anchor txHash
        await fetch(`${this.moltlaunchApi}/traces/${traceResult.traceId}/anchor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txHash: anchorResult.txHash })
        });

        return {
            ...traceResult,
            anchored: true,
            txHash: anchorResult.txHash,
            explorerUrl: anchorResult.explorerUrl
        };
    }

    /**
     * Verify a trace's on-chain anchor
     */
    async verifyTrace(traceId) {
        // Get trace from MoltLaunch
        const traceResponse = await fetch(`${this.moltlaunchApi}/traces/info`);
        // Would need a getTrace endpoint - simplified for now
        
        // For now, return structure
        return {
            traceId,
            verified: false,
            note: 'Full verification requires trace lookup endpoint'
        };
    }
}

module.exports = {
    SlotScribeAnchor,
    MoltLaunchSlotScribeIntegration
};
