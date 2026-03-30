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
export const anchorProvider = anchor.AnchorProvider.env();
anchor.setProvider(anchorProvider);

export const resourceMgrProg = anchor.workspace
  .resourceManager as Program<ResourceManager>;
export const magicTokenProg = anchor.workspace.magicToken as Program<MagicToken>;
export const itemNftProg = anchor.workspace.itemNft as Program<ItemNft>;
export const searchProg = anchor.workspace.search as Program<Search>;
export const craftingProg = anchor.workspace.crafting as Program<Crafting>;
export const marketplaceProg = anchor.workspace.marketplace as Program<Marketplace>;

// Deployer wallet exposed by the anchor provider
export const deployer = anchorProvider.wallet;

// ---------- Resource configuration ----------
export const resMintKeypairs: Keypair[] = [];
export const materialNames = [
  "Wood", "Iron", "Gold", "Leather", "Stone", "Diamond",
];
export const materialTickers = [
  "WOOD", "IRON", "GOLD", "LEATHER", "STONE", "DIAMOND",
];

// ---------- PDA placeholders (populated in bootstrapTestEnv) ----------
export let magicMintKeypair: Keypair;
export let gameConfigAddr: PublicKey;
export let mintAuthAddr: PublicKey;
export let magicCfgAddr: PublicKey;
export let magicMintAuthAddr: PublicKey;
export let nftConfigAddr: PublicKey;
export let nftAuthAddr: PublicKey;

// Caller authority PDAs (one per program that performs CPI calls)
export const searchCallerPda = PublicKey.findProgramAddressSync(
  [Buffer.from("caller_authority")],
  searchProg.programId
)[0];

export const craftCallerPda = PublicKey.findProgramAddressSync(
  [Buffer.from("caller_authority")],
  craftingProg.programId
)[0];

export const marketCallerPda = PublicKey.findProgramAddressSync(
  [Buffer.from("caller_authority")],
  marketplaceProg.programId
)[0];

// ---------- Test players ----------
export const testWallet1 = Keypair.generate();
export const testWallet2 = Keypair.generate();

// ---------- Game parameters for tests ----------
export const salePrices = [100, 150, 200, 300];
export const dropDistribution = [30, 25, 20, 12, 10, 3];
export const cooldownSec = 2; // seconds (low value for faster tests)

let alreadyInitialized = false;

/**
 * One-time bootstrap that funds test wallets, derives PDAs, and generates
 * keypairs for resource mints and the MagicToken mint.  Safe to call
 * multiple times — subsequent calls are no-ops.
 */
export async function bootstrapTestEnv(): Promise<void> {
  if (alreadyInitialized) return;
  alreadyInitialized = true;

  // Airdrop SOL to each test player
  for (const wallet of [testWallet1, testWallet2]) {
    const sig = await anchorProvider.connection.requestAirdrop(
      wallet.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await anchorProvider.connection.confirmTransaction(sig);
  }

  // Derive all needed PDAs
  [gameConfigAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_config")],
    resourceMgrProg.programId
  );
  [mintAuthAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    resourceMgrProg.programId
  );
  [magicCfgAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("magic_config")],
    magicTokenProg.programId
  );
  [magicMintAuthAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("magic_mint_authority")],
    magicTokenProg.programId
  );
  [nftConfigAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("item_nft_config")],
    itemNftProg.programId
  );
  [nftAuthAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("nft_authority")],
    itemNftProg.programId
  );

  // Generate keypairs for the 6 resource mints
  for (let i = 0; i < 6; i++) {
    resMintKeypairs.push(Keypair.generate());
  }
  magicMintKeypair = Keypair.generate();

  // Re-export mutable values so `require()` picks them up
  exports.magicMintKeypair = magicMintKeypair;
  exports.gameConfigAddr = gameConfigAddr;
  exports.mintAuthAddr = mintAuthAddr;
  exports.magicCfgAddr = magicCfgAddr;
  exports.magicMintAuthAddr = magicMintAuthAddr;
  exports.nftConfigAddr = nftConfigAddr;
  exports.nftAuthAddr = nftAuthAddr;
}
