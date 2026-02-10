# MoltLaunch FAQ

---

## How is MoltLaunch different from DePIN?

**DePIN networks verify DEVICES. MoltLaunch verifies AGENTS.**

DePIN (io.net, Helium, Nosana) proves that physical hardware exists and works — GPUs pass benchmarks, hotspots provide coverage, compute nodes process jobs. But DePIN has no idea what software runs on that hardware.

MoltLaunch proves that the AI agent running on that hardware is real, unique, capable, and behaving consistently. We're a consumer of DePIN attestations that adds an agent intelligence layer on top.

```
DePIN:      "This GPU exists and works"       → Device identity
MoltLaunch: "This AI agent is real and good"   → Agent identity
```

**The analogy:** DePIN is the building inspector ("this building has electricity and passes code"). MoltLaunch is the business license office ("this business operating in this building is legitimate and has a track record"). You need both.

**Why we need each other:**
- DePIN without MoltLaunch: Verified hardware running unknown software
- MoltLaunch without DePIN: Verified agent on spoofable hardware
- Together: Verified agent on verified hardware — the strongest trust signal possible

---

## What's the difference between MoltLaunch and ERC-8004?

**ERC-8004** is an Ethereum draft standard (by MetaMask, EF, Google, Coinbase) for agent identity, reputation, and validation registries using ERC-721 NFTs. It defines the interface but leaves implementation to validators.

**MoltLaunch** is a Solana-native implementation that extends ERC-8004's concepts with:

| Feature | ERC-8004 | MoltLaunch |
|---------|----------|------------|
| Identity | Wallet-based (ERC-721) | Hardware-anchored (TPM + DePIN) |
| Sybil cost | $0 (new wallet) | $100-500/mo (new hardware) |
| Reputation privacy | Public scores | STARK proofs (private) |
| Validation | Interface only | Deployed (on-chain AI) |
| DePIN | Not available on Ethereum | Native on Solana |

Our validation responses include ERC-8004-compatible fields for cross-chain interoperability.

---

## What's the difference between MoltLaunch and SATI?

**SATI** (by Cascade Protocol) is the closest Solana project to what we're building. They use Token-2022 NFTs for agent identity with SAS (Solana Attestation Service) for reputation — great for wallet visibility.

**MoltLaunch adds what SATI doesn't have:** Sybil resistance. Creating a SATI identity costs ~0.003 SOL (mint rent). Creating a MoltLaunch Level 5 identity requires a verified DePIN device ($500+/mo).

We've proposed integration: SATI provides the identity layer (Token-2022 NFTs in wallets), MoltLaunch provides the Sybil-resistance layer (hardware attestation). See [our integration proposal](https://github.com/cascade-protocol/sati/issues/3).

---

## How do STARK proofs work in MoltLaunch?

STARK (Scalable Transparent ARgument of Knowledge) proofs let agents prove properties about themselves without revealing the underlying data.

**Example:** An agent with a score of 78 can prove "my score is at least 60" without revealing that the score is exactly 78. The verifier learns the agent passed the threshold but nothing else.

**Four proof types:**

| Type | Proves | Hides |
|------|--------|-------|
| Threshold | Score ≥ X | Exact score |
| Consistency | Maintained threshold for N days | Individual daily scores |
| Streak | N consecutive periods above threshold | Actual streak length |
| Stability | Variance below maximum | Actual variance |

**Why this matters:** Trading bots need reputation but can't reveal their performance (competitors would copy their edge). STARK proofs solve this.

**Technical note:** Our proofs use M31 field arithmetic and Poseidon commitments — inspired by STWO/Circle STARKs. Currently STARK-inspired simulations optimized for demonstration. Production would require formal verification and a Rust-based prover.

---

## What is the Trust Ladder?

Six levels of identity verification with increasing Sybil resistance:

| Level | Method | Sybil Cost | What It Proves |
|-------|--------|------------|---------------|
| 0 | None | $0 | Nothing |
| 1 | API key | $0 | Authentication only |
| 2 | Code hash | $0 | Code exists (changeable) |
| 3 | Hardware fingerprint | $100/mo | Unique server |
| 4 | TPM attestation | $200/mo | Unique physical machine |
| 5 | DePIN device | $500+/mo | Verified decentralized hardware |

Higher levels require more physical infrastructure to forge. Level 3 uses challenge-response (server issues a nonce, agent hashes it with hardware data, 5-minute expiry). Level 5 verifies the DePIN device PDA actually exists on Solana.

---

## How does hardware fingerprinting work?

The SDK collects system-level data and hashes it:

```
identity_hash = SHA-256(
    hardware_hash(CPU, memory, hostname) |
    runtime_hash(Node version, OS, env) |
    code_hash(SHA-256 of main source file) |
    network_hash(MAC addresses)
)
```

**Same machine + same code = same hash.** You can't fake 10 different agents on one server.

**Challenge-response prevents replay:** The server issues a random nonce → the agent hashes it WITH the hardware data → submits within 5 minutes. Can't pre-compute or replay old attestations.

**Limitations:** Software-level fingerprinting (Level 3) can be spoofed by modifying OS calls. TPM (Level 4) and DePIN (Level 5) provide hardware-rooted attestation that's much harder to fake.

---

## What happens when an agent changes hardware?

The identity PDA is tied to the owner's public key, not the hardware hash. When hardware changes:

1. Agent calls `rotate_identity` with new hardware hash
2. Previous hash stored for audit trail
3. Trust level drops to Level 2 (must re-attest with new hardware)
4. PoA score preserved (behavioral history carries over)
5. Consistency proof resets (new hardware = new baseline)

The agent keeps the same identity — just with updated hardware evidence.

---

## Can an agent delegate authority?

Yes. Delegation allows an agent to authorize a hot wallet to act on its behalf:

| Scope | What the Delegate Can Do |
|-------|-------------------------|
| Full | Everything the owner can |
| AttestOnly | Submit traces, update trust |
| ReadOnly | Prove identity, not modify |
| SignTransactions | Sign on behalf (hot wallet) |

Delegations are time-bound and revocable. Use case: trading bot owner holds keys in cold storage, hot wallet signs daily trades and submits traces.

---

## How is MoltLaunch governed?

We're decentralizing in four phases:

| Phase | When | How |
|-------|------|-----|
| 1. Single authority | Now (hackathon) | Our server signs attestations |
| 2. Squads multisig | Month 1 | 2-of-3 signatures required (deployed on devnet ✅) |
| 3. Validator network | Month 3 | 4-5 independent validators with staking |

The DAO will govern protocol rules (scoring weights, trust thresholds, fee structure) but NOT individual verification results (validators do that via consensus).

See [GOVERNANCE.md](https://github.com/tradingstarllc/moltlaunch/blob/main/GOVERNANCE.md) for the full roadmap.

---

## What is the Solana Agent Protocol (SAP)?

SAP is an application-layer standard we proposed for agent trust on Solana. Three proposals:

| Proposal | Title |
|----------|-------|
| SAP-0001 | Validation Protocol — unified request/response format |
| SAP-0002 | Hardware-Anchored Identity — TPM + DePIN fingerprinting |
| SAP-0003 | DePIN Device Attestation — io.net, Helium, Nosana binding |

**Spec:** https://github.com/tradingstarllc/solana-agent-protocol

**sRFC:** https://github.com/solana-foundation/SRFCs/discussions/9

SAP is not a SIMD (protocol-level change). It's an application-layer standard any Solana program can adopt.

---

## How much does verification cost?

| Trust Level | Cost | Method |
|-------------|------|--------|
| 1-2 | Free | API call |
| 3 | ~$0.01 | x402 micropayment |
| 4 | ~$0.05 | x402 micropayment |
| 5 | ~$0.10 | x402 micropayment |

On-chain PDA creation costs ~0.003 SOL (rent). Verification scores are cached for 30 days.

---

## Is MoltLaunch open source?

Yes. Everything is MIT licensed.

| Repo | Description |
|------|-------------|
| [moltlaunch](https://github.com/tradingstarllc/moltlaunch) | Main project + Anchor program |
| [moltlaunch-site](https://github.com/tradingstarllc/moltlaunch-site) | API server + website (90+ endpoints) |
| [moltlaunch-sdk](https://github.com/tradingstarllc/moltlaunch-sdk) | npm SDK v2.4.0 |
| [poa-scorer](https://github.com/tradingstarllc/poa-scorer) | On-chain AI model |
| [solana-agent-protocol](https://github.com/tradingstarllc/solana-agent-protocol) | SAP spec proposals |
