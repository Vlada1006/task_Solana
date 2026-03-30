# Козацький бізнес — Solana On-Chain Game

A fully on-chain game built on Solana using the Anchor framework. Players search for resources, craft unique NFT items, and trade them on a decentralised marketplace for MagicToken currency.

---

## Program IDs (Devnet)

| Program | Address |
|---------|---------|
| resource_manager | `4dNQgKi74dCATTf84YuMEyHESoJAPQunsC44WqE1nC8v` |
| magic_token | `9XB3axXHPNswG2kJXRBTYipk65JP2bsFTtMtTZm2BXAs` |
| item_nft | `ABef4SCxwM4oWm5YNuRsCeFg1pv9NrUkxNK3GPEuCG8w` |
| search | `C1uqnbu6fqij8NPidvFMfks7A37x97M5xm9WYpyxRtWA` |
| crafting | `HHnXL9vfkMWgLAA8q5iSp4pD7ip5A3DXQgTTgus44w29` |
| marketplace | `91mqUcMbs89f8CDoG1mBWKyeC1FbPSFAdhcE8yD5DQdC` |

---

## Architecture

The game comprises six inter-dependent Anchor programs communicating via CPI:

```
┌──────────────┐       ┌──────────────┐
│    search     │──CPI──▶│resource_manager│
└──────────────┘       └───────┬───────┘
                               │
┌──────────────┐       ┌───────▼───────┐
│   crafting    │──CPI──▶│resource_manager│──burn resources
│              │──CPI──▶│   item_nft    │──mint NFT
└──────────────┘       └──────────────┘
                               
┌──────────────┐       ┌──────────────┐
│  marketplace  │──CPI──▶│   item_nft    │──burn NFT
│              │──CPI──▶│  magic_token  │──mint MagicToken
└──────────────┘       └──────────────┘
```

### Program Responsibilities

| Program | Role |
|---------|------|
| **resource_manager** | Manages GameConfig, creates Token-2022 resource mints (MetadataPointer), provides CPI-gated mint/burn endpoints |
| **magic_token** | Creates a single Token-2022 MagicToken mint; CPI-gated minting callable only by marketplace |
| **item_nft** | Mints/burns Metaplex NFT items; CPI-gated to crafting and marketplace |
| **search** | Player-facing program — cooldown-based resource foraging with weighted random drops via resource_manager CPI |
| **crafting** | Validates recipes, burns resources via resource_manager CPI, mints NFT via item_nft CPI |
| **marketplace** | Sell items instantly (burn NFT → receive MagicToken), or list/buy/delist items in P2P escrow |

### On-Chain Accounts (PDAs)

```
GameConfig        — seeds: ["game_config"]
MintAuthority     — seeds: ["mint_authority"]
MagicConfig       — seeds: ["magic_config"]
MagicMintAuthority— seeds: ["magic_mint_authority"]
ItemNftConfig     — seeds: ["item_nft_config"]
NftAuthority      — seeds: ["nft_authority"]
Player            — seeds: ["player", player_pubkey]
ItemMetadata      — seeds: ["item_metadata", nft_mint]
CallerAuthority   — seeds: ["caller_authority"] (per-program CPI gate)
ListingEscrow     — seeds: ["listing", nft_mint]
```

---

## Resources (SPL Token-2022)

| ID | Name | Symbol | Decimals |
|----|------|--------|----------|
| 0 | Wood | WOOD | 0 |
| 1 | Iron | IRON | 0 |
| 2 | Gold | GOLD | 0 |
| 3 | Leather | LEATHER | 0 |
| 4 | Stone | STONE | 0 |
| 5 | Diamond | DIAMOND | 0 |

## Crafting Recipes

| Item | Wood | Iron | Gold | Leather | Stone | Diamond |
|------|------|------|------|---------|-------|---------|
| Cossack Saber | 1 | 3 | 0 | 1 | 0 | 0 |
| Elder Staff | 2 | 0 | 1 | 0 | 0 | 1 |
| Mage Armor | 0 | 2 | 1 | 4 | 0 | 0 |
| Battle Bracelet | 0 | 4 | 2 | 0 | 0 | 2 |

## MagicToken Prices

| Item | Price (MagicToken) |
|------|--------------------|
| Cossack Saber | 100 |
| Elder Staff | 150 |
| Mage Armor | 200 |
| Battle Bracelet | 300 |

---

## Prerequisites

- **Rust** 1.89+ (managed via `rust-toolchain.toml`)
- **Solana CLI** ≥ 1.18
- **Anchor CLI** ≥ 0.32.1
- **Node.js** ≥ 18
- **Yarn** (used as the Anchor package manager)

## Setup

```bash
# Clone the repository
git clone https://github.com/Vlada1006/task_Solana.git
cd task_Solana/cossack_business

# Install JS dependencies
yarn install

# Build all programs
anchor build
```

---

## Running Tests

The test suite covers all six programs with 100% coverage — initialization, player registration, resource searching, item crafting, marketplace operations, and security checks.

```bash
anchor test
```

This will:
1. Build all programs
2. Start a local validator (cloning Metaplex from mainnet)
3. Run the full Mocha test suite

### Test Files

| File | Scope |
|------|-------|
| `tests/initialization.ts` | GameConfig, resource mints, MagicToken, ItemNft initialization |
| `tests/player-registration.ts` | Player PDA creation and duplicate checks |
| `tests/search.ts` | Resource foraging, cooldown enforcement, weighted drops |
| `tests/crafting.ts` | Recipe validation, resource burning, NFT minting |
| `tests/marketplace.ts` | Sell, list, buy, delist operations; MagicToken payouts |
| `tests/security.ts` | Unauthorized access, direct mint/burn prevention, CPI-gate checks |

---

## Deploy to Devnet

### Automated (recommended)

```bash
chmod +x scripts/deploy-devnet.sh
./scripts/deploy-devnet.sh
```

The script will:
1. Switch Solana CLI to devnet
2. Check wallet balance
3. Build and deploy all six programs
4. Run the initialization script to create on-chain state

### Manual

```bash
# 1. Switch to devnet
solana config set --url devnet

# 2. Ensure your wallet has SOL
solana airdrop 2

# 3. Build
anchor build

# 4. Deploy each program
anchor deploy --program-name resource_manager --provider.cluster devnet
anchor deploy --program-name magic_token      --provider.cluster devnet
anchor deploy --program-name item_nft         --provider.cluster devnet
anchor deploy --program-name search           --provider.cluster devnet
anchor deploy --program-name crafting         --provider.cluster devnet
anchor deploy --program-name marketplace      --provider.cluster devnet

# 5. Initialize on-chain state
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
  npx ts-node scripts/initialize.ts
```

---

## Interaction Examples

### Register a Player

```typescript
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const provider = anchor.AnchorProvider.env();
const searchProgram = new anchor.Program(searchIdl, provider);

const [playerPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("player"), provider.wallet.publicKey.toBuffer()],
  searchProgram.programId
);

await searchProgram.methods
  .registerPlayer()
  .accounts({
    player: provider.wallet.publicKey,
    playerAccount: playerPda,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();
```

### Search for Resources

```typescript
const [gameConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("game_config")],
  resourceManagerProgram.programId
);
const [mintAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint_authority")],
  resourceManagerProgram.programId
);

// remainingAccounts = 6 resource mints + 6 player ATAs
await searchProgram.methods
  .searchResources()
  .accounts({
    player: wallet.publicKey,
    playerAccount: playerPda,
    callerAuthority: searchCallerPda,
    gameConfig,
    mintAuthority,
    resourceManagerProgram: resourceManagerProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .remainingAccounts(resourceMintAndAtaAccounts)
  .rpc();
```

### Craft an Item

```typescript
// Recipe 0 = Cossack Saber: 1 Wood, 3 Iron, 1 Leather
const recipeIndex = 0;
const neededResourceIds = [0, 1, 3]; // WOOD, IRON, LEATHER

await craftingProgram.methods
  .craftItem(recipeIndex, Buffer.from(neededResourceIds))
  .accounts({
    player: wallet.publicKey,
    callerAuthority: craftCallerPda,
    gameConfig,
    resourceManagerProgram: resourceManagerProgram.programId,
    itemNftProgram: itemNftProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    token2022Program: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .remainingAccounts([...resourceAccounts, ...nftAccounts])
  .signers([nftMintKeypair])
  .rpc();
```

### Sell an Item on Marketplace

```typescript
await marketplaceProgram.methods
  .sellItem()
  .accounts({
    seller: wallet.publicKey,
    itemMetadata: itemMetadataPda,
    nftMint: nftMint.publicKey,
    sellerNftAccount: sellerNftAta,
    magicTokenMint: magicMint.publicKey,
    sellerMagicAccount: sellerMagicAta,
    gameConfig,
    nftAuthority: nftAuthorityPda,
    magicMintAuthority: magicMintAuthorityPda,
    callerAuthority: marketCallerPda,
    itemNftProgram: itemNftProgram.programId,
    magicTokenProgram: magicTokenProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    token2022Program: TOKEN_2022_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();
```

---

## Security Model

- **CPI-gated minting/burning** — Resource tokens can only be minted by `search` (via `resource_manager`) and burned by `crafting` (via `resource_manager`). Direct Token-2022 mint/burn is blocked because the mint authority is a PDA owned by `resource_manager`.
- **CPI-gated NFT operations** — NFTs are minted only by `crafting` (via `item_nft`) and burned only by `marketplace` (via `item_nft`). The NFT update authority is a PDA owned by `item_nft`.
- **CPI-gated MagicToken** — MagicToken can only be minted by `marketplace` (via `magic_token`). The mint authority PDA belongs to `magic_token`.
- **Caller authority verification** — Each program derives a `caller_authority` PDA and passes it during CPI calls. The receiving program verifies the PDA seeds and the calling program ID match.
- **Player ownership checks** — All player-facing instructions require the player's signature and verify `player_account.owner == signer`.
- **Cooldown enforcement** — The `search` program stores `last_search_timestamp` in the player PDA and rejects searches before the cooldown expires (on-chain clock).

---

## Project Structure

```
cossack_business/
├── Anchor.toml                  # Anchor workspace config
├── Cargo.toml                   # Rust workspace members
├── package.json                 # JS dependencies & scripts
├── tsconfig.json                # TypeScript compiler options
├── rust-toolchain.toml          # Rust 1.89 toolchain
├── programs/
│   ├── resource_manager/        # GameConfig, Token-2022 mints, CPI mint/burn
│   ├── magic_token/             # MagicToken mint (CPI-gated)
│   ├── item_nft/                # Metaplex NFT mint/burn (CPI-gated)
│   ├── search/                  # Player registration, resource foraging
│   ├── crafting/                # Recipe validation, craft items
│   └── marketplace/             # Sell, list, buy, delist items
├── scripts/
│   ├── initialize.ts            # On-chain initialization script
│   └── deploy-devnet.sh         # Automated devnet deployment
└── tests/
    ├── helpers/
    │   ├── setup.ts             # Test provider, program handles, PDAs
    │   └── utils.ts             # Shared test utilities
    ├── initialization.ts        # Init tests
    ├── player-registration.ts   # Player PDA tests
    ├── search.ts                # Resource search tests
    ├── crafting.ts              # Crafting tests
    ├── marketplace.ts           # Marketplace tests
    └── security.ts              # Access-control tests
```

---

## License

ISC
