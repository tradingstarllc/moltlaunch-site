const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { Multisig, MultisigInstruction } = require("@sqds/multisig");
const fs = require("fs");
const path = require("path");

async function main() {
    // Load our wallet
    const walletPath = path.join(require("os").homedir(), "moltbot-trial/products/launchpad/devnet-wallet.json");
    const walletData = JSON.parse(fs.readFileSync(walletPath));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    
    console.log("=== MoltLaunch Multisig Setup ===");
    console.log("Wallet:", wallet.publicKey.toBase58());
    
    // Connect to devnet
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const balance = await connection.getBalance(wallet.publicKey);
    console.log("Balance:", balance / 1e9, "SOL");
    
    if (balance < 0.1 * 1e9) {
        console.log("Insufficient balance. Need at least 0.1 SOL");
        return;
    }
    
    // Generate a unique multisig create key
    const createKey = Keypair.generate();
    console.log("Create Key:", createKey.publicKey.toBase58());
    
    // Derive multisig PDA
    const [multisigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("multisig"), createKey.publicKey.toBuffer()],
        new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf")
    );
    console.log("Multisig PDA:", multisigPda.toBase58());
    
    // Members: our wallet + 2 placeholder slots for future partners
    // For now, all 3 keys are ours (we'll transfer to partners later)
    const member1 = wallet.publicKey; // MoltLaunch (us)
    
    // Generate placeholder keys for future partners
    // In production, these would be partner wallets
    const partner2 = Keypair.generate();
    const partner3 = Keypair.generate();
    
    console.log("\nMultisig Members:");
    console.log("  Member 1 (MoltLaunch):", member1.toBase58());
    console.log("  Member 2 (Partner slot):", partner2.publicKey.toBase58());
    console.log("  Member 3 (Partner slot):", partner3.publicKey.toBase58());
    console.log("\nThreshold: 2-of-3");
    
    try {
        // Create the multisig
        const ix = await Multisig.createMultisig({
            connection,
            createKey: createKey.publicKey,
            creator: wallet.publicKey,
            multisigPda,
            configAuthority: null, // No config authority initially
            threshold: 2,
            members: [
                { key: member1, permissions: { mask: 7 } }, // All permissions
                { key: partner2.publicKey, permissions: { mask: 7 } },
                { key: partner3.publicKey, permissions: { mask: 7 } },
            ],
            timeLock: 0,
        });

        const tx = new Transaction().add(...ix);
        const sig = await sendAndConfirmTransaction(connection, tx, [wallet, createKey]);
        
        console.log("\n✅ Multisig created!");
        console.log("Transaction:", sig);
        console.log("Explorer:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
        console.log("Multisig PDA:", multisigPda.toBase58());
        
        // Save multisig info
        const multisigInfo = {
            multisigPda: multisigPda.toBase58(),
            createKey: createKey.publicKey.toBase58(),
            threshold: 2,
            members: [
                { role: "MoltLaunch", key: member1.toBase58() },
                { role: "Partner 2 (placeholder)", key: partner2.publicKey.toBase58() },
                { role: "Partner 3 (placeholder)", key: partner3.publicKey.toBase58() }
            ],
            createdAt: new Date().toISOString(),
            txSignature: sig,
            network: "devnet",
            note: "Partner slots will be transferred to real partners post-hackathon"
        };
        
        fs.writeFileSync(
            path.join(__dirname, "..", "data", "multisig.json"),
            JSON.stringify(multisigInfo, null, 2)
        );
        console.log("\nSaved to data/multisig.json");
        
        return multisigInfo;
        
    } catch (e) {
        console.error("Error:", e.message);
        
        // If Squads SDK doesn't work, fall back to raw transaction
        console.log("\nFalling back to manual multisig PDA...");
        
        // Just create a record of the intended multisig
        const multisigInfo = {
            multisigPda: multisigPda.toBase58(),
            createKey: createKey.publicKey.toBase58(),
            threshold: 2,
            members: [
                { role: "MoltLaunch", key: member1.toBase58() },
                { role: "Partner 2 (placeholder)", key: partner2.publicKey.toBase58() },
                { role: "Partner 3 (placeholder)", key: partner3.publicKey.toBase58() }
            ],
            createdAt: new Date().toISOString(),
            status: "planned",
            network: "devnet",
            error: e.message,
            note: "Squads multisig creation failed - will retry with correct SDK version"
        };
        
        fs.writeFileSync(
            path.join(__dirname, "..", "data", "multisig.json"),
            JSON.stringify(multisigInfo, null, 2)
        );
        console.log("Saved planned config to data/multisig.json");
        
        return multisigInfo;
    }
}

main().catch(console.error);
