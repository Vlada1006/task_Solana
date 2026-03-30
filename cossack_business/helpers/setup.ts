import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ResourceManager } from "../../target/types/resource_manager";
import { MagicToken } from "../../target/types/magic_token";
import { ItemNft } from "../../target/types/item_nft";
import { Search } from "../../target/types/search";
import { Crafting } from "../../target/types/crafting";
import { Marketplace } from "../../target/types/marketplace";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

// ---------- Provider & program handles ----------
export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

export const rmProgram = anchor.workspace
  .resourceManager as Program<ResourceManager>;
export const mtProgram = anchor.workspace.magicToken as Program<MagicToken>;
export const inProgram = anchor.workspace.itemNft as Program<ItemNft>;
export const searchProgram = anchor.workspace.search as Program<Search>;
export const craftProgram = anchor.workspace.crafting as Program<Crafting>;
export const marketProgram = anchor.workspace.marketplace as Program<Marketplace>;

// Deployer / admin wallet exposed by the anchor provider
export const admin = provider.wallet;

// ---------- Resource configuration ----------
export const resourceMints: Keypair[] = [];
export const resourceNames = [
  "Wood", "Iron", "Gold", "Leather", "Stone", "Diamond",
];
export const resourceSymbols = [
  "WOOD", "IRON", "GOLD", "LEATHER", "STONE", "DIAMOND",
];

// ---------- PDA placeholders (populated in initializeAll) ----------
export let magicMintKp: Keypair;
export let gameConfigPda: PublicKey;
export let mintAuthorityPda: PublicKey;
export let magicConfigPda: PublicKey;
export let magicMintAuthPda: PublicKey;
export let itemNftConfigPda: PublicKey;
export let nftAuthorityPda: PublicKey;

// Caller authority PDAs (one per program that performs CPI calls)
export const searchCallerAuth = PublicKey.findProgramAddressSync(
  [Buffer.from("caller_authority")],
  searchProgram.programId
)[0];

export const craftCallerAuth = PublicKey.findProgramAddressSync(
  [Buffer.from("caller_authority")],
  craftProgram.programId
)[0];

export const marketCallerAuth = PublicKey.findProgramAddressSync(
  [Buffer.from("caller_authority")],
  marketProgram.programId
)[0];

// ---------- Test players ----------
export const player1 = Keypair.generate();
export const player2 = Keypair.generate();

// ---------- Game parameters for tests ----------
export const itemPrices = [100, 150, 200, 300];
export const rarityWeights = [30, 25, 20, 12, 10, 3];
export const searchCooldown = 2; // seconds (low value for faster tests)

let setupComplete = false;

/**
 * One-time bootstrap that funds test wallets, derives PDAs, and generates
 * keypairs for resource mints and the MagicToken mint.  Safe to call
 * multiple times — subsequent calls are no-ops.
 */
export async function initializeAll(): Promise<void> {
  if (setupComplete) return;
  setupComplete = true;

  // Airdrop SOL to each test player
  for (const kp of [player1, player2]) {
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  // Derive all needed PDAs
  [gameConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_config")],
    rmProgram.programId
  );
  [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    rmProgram.programId
  );
  [magicConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("magic_config")],
    mtProgram.programId
  );
  [magicMintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("magic_mint_authority")],
    mtProgram.programId
  );
  [itemNftConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("item_nft_config")],
    inProgram.programId
  );
  [nftAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nft_authority")],
    inProgram.programId
  );

  // Generate keypairs for the 6 resource mints
  for (let i = 0; i < 6; i++) {
    resourceMints.push(Keypair.generate());
  }
  magicMintKp = Keypair.generate();

  // Re-export mutable values so `require()` picks them up
  exports.magicMintKp = magicMintKp;
  exports.gameConfigPda = gameConfigPda;
  exports.mintAuthorityPda = mintAuthorityPda;
  exports.magicConfigPda = magicConfigPda;
  exports.magicMintAuthPda = magicMintAuthPda;
  exports.itemNftConfigPda = itemNftConfigPda;
  exports.nftAuthorityPda = nftAuthorityPda;
}
