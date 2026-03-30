import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ResourceManager } from "../target/types/resource_manager";
import { MagicToken } from "../target/types/magic_token";
import { ItemNft } from "../target/types/item_nft";
import { Search } from "../target/types/search";
import { Crafting } from "../target/types/crafting";
import { Marketplace } from "../target/types/marketplace";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

/**
 * Post-deploy bootstrap script.
 *
 * Creates every on-chain configuration account and registers
 * the six resource mints, the MagicToken mint, and the ItemNft
 * config.  Safe to run multiple times — already-initialised
 * accounts are silently skipped.
 *
 * Usage:
 *   npx ts-node scripts/initialize.ts
 *
 * Environment:
 *   ANCHOR_PROVIDER_URL  – RPC endpoint (defaults to localhost)
 *   ANCHOR_WALLET        – path to admin keypair
 */
async function main() {
  const anchorProvider = anchor.AnchorProvider.env();
  anchor.setProvider(anchorProvider);

  // Grab handles for each deployed program
  const resourceMgr = anchor.workspace.resourceManager as Program<ResourceManager>;
  const magicTokenProg = anchor.workspace.magicToken as Program<MagicToken>;
  const itemNftProg = anchor.workspace.itemNft as Program<ItemNft>;
  const searchProg = anchor.workspace.search as Program<Search>;
  const craftingProg = anchor.workspace.crafting as Program<Crafting>;
  const marketplaceProg = anchor.workspace.marketplace as Program<Marketplace>;

  const deployer = anchorProvider.wallet;
  console.log("Deployer wallet:", deployer.publicKey.toBase58());

  // ---------- Game parameters ----------
  const sellPrices = [100, 150, 200, 300];
  const rarityDistribution = [30, 25, 20, 12, 10, 3];
  const cooldownSec = 60;

  const materialNames = ["Wood", "Iron", "Gold", "Leather", "Stone", "Diamond"];
  const materialTickers = ["WOOD", "IRON", "GOLD", "LEATHER", "STONE", "DIAMOND"];

  // ---------- Derive every PDA ----------
  const [gameConfigAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_config")],
    resourceMgr.programId
  );
  const [mintAuthAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    resourceMgr.programId
  );
  const [magicConfigAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("magic_config")],
    magicTokenProg.programId
  );
  const [magicMintAuthAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("magic_mint_authority")],
    magicTokenProg.programId
  );
  const [itemNftConfigAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("item_nft_config")],
    itemNftProg.programId
  );
  const [nftAuthAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("nft_authority")],
    itemNftProg.programId
  );

  // ── Step 1 — GameConfig ──────────────────────────────────────────────
  console.log("\nStep 1: Creating GameConfig...");
  try {
    await resourceMgr.methods
      .initializeGame(
        sellPrices.map((v) => new anchor.BN(v)),
        Buffer.from(rarityDistribution),
        new anchor.BN(cooldownSec),
        searchProg.programId,
        craftingProg.programId,
        marketplaceProg.programId
      )
      .accounts({
        admin: deployer.publicKey,
        gameConfig: gameConfigAddr,
        mintAuthority: mintAuthAddr,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("GameConfig PDA:", gameConfigAddr.toBase58());
  } catch (e: any) {
    if (e.toString().includes("already in use")) {
      console.log("GameConfig already exists — skipping.");
    } else {
      throw e;
    }
  }

  // ── Step 2 — Resource mints (6 Token-2022 mints) ─────────────────────
  console.log("\nStep 2: Registering resource mints...");
  const resourceKeypairs: Keypair[] = [];
  for (let ri = 0; ri < 6; ri++) {
    const mintKp = Keypair.generate();
    resourceKeypairs.push(mintKp);
    try {
      await resourceMgr.methods
        .initializeResource(
          ri,
          materialNames[ri],
          materialTickers[ri],
          `https://cossack.game/resource/${ri}.json`
        )
        .accounts({
          admin: deployer.publicKey,
          gameConfig: gameConfigAddr,
          mint: mintKp.publicKey,
          mintAuthority: mintAuthAddr,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([mintKp])
        .rpc();
      console.log(`Resource ${ri} (${materialTickers[ri]}): ${mintKp.publicKey.toBase58()}`);
    } catch (e: any) {
      console.log(`Resource ${ri} error:`, e.message?.slice(0, 80));
    }
  }

  // ── Step 3 — MagicToken mint ─────────────────────────────────────────
  console.log("\nStep 3: Creating MagicToken mint...");
  const magicMintKp = Keypair.generate();
  try {
    await magicTokenProg.methods
      .initializeMagicToken(
        "MagicToken",
        "MAGIC",
        "https://cossack.game/magic.json",
        marketplaceProg.programId
      )
      .accounts({
        admin: deployer.publicKey,
        config: magicConfigAddr,
        mint: magicMintKp.publicKey,
        mintAuthority: magicMintAuthAddr,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([magicMintKp])
      .rpc();
    console.log("MagicToken mint:", magicMintKp.publicKey.toBase58());
  } catch (e: any) {
    if (e.toString().includes("already in use")) {
      console.log("   MagicToken already exists — skipping.");
    } else {
      throw e;
    }
  }

  // ── Step 4 — ItemNft configuration ───────────────────────────────────
  console.log("\nStep 4: Creating ItemNft config...");
  try {
    await itemNftProg.methods
      .initializeItemNft(craftingProg.programId, marketplaceProg.programId)
      .accounts({
        admin: deployer.publicKey,
        config: itemNftConfigAddr,
        nftAuthority: nftAuthAddr,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("   ItemNftConfig PDA:", itemNftConfigAddr.toBase58());
  } catch (e: any) {
    if (e.toString().includes("already in use")) {
      console.log("   ItemNft config already exists — skipping.");
    } else {
      throw e;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n=== Initialisation complete ===");
  console.log("\nDeployed program IDs:");
  console.log("  resource_manager:", resourceMgr.programId.toBase58());
  console.log("  magic_token:     ", magicTokenProg.programId.toBase58());
  console.log("  item_nft:        ", itemNftProg.programId.toBase58());
  console.log("  search:          ", searchProg.programId.toBase58());
  console.log("  crafting:        ", craftingProg.programId.toBase58());
  console.log("  marketplace:     ", marketplaceProg.programId.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
