import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { anchorProvider, resourceMgrProg, magicTokenProg, itemNftProg, searchProg, craftingProg, marketplaceProg, deployer,
  resMintKeypairs, materialNames, materialTickers, salePrices, dropDistribution, cooldownSec, bootstrapTestEnv } from "../helpers/setup";
import { TOKEN_2022_PROGRAM_ID } from "../helpers/utils";

/**
 * Bootstraps every on-chain program configuration:
 *   1. GameConfig (resource_manager)
 *   2. Six resource Token-2022 mints
 *   3. MagicToken mint
 *   4. ItemNft config
 * Also verifies admin-only update operations and reinit rejection.
 */
describe("Game Bootstrap & Admin Operations", () => {
  let gameCfgAddress: anchor.web3.PublicKey;
  let mintAuthAddress: anchor.web3.PublicKey;
  let magicCfgAddress: anchor.web3.PublicKey;
  let magicMintAuthAddress: anchor.web3.PublicKey;
  let nftCfgAddress: anchor.web3.PublicKey;
  let nftAuthAddress: anchor.web3.PublicKey;

  before(async () => {
    await bootstrapTestEnv();
    // Pull the dynamically-derived PDAs from the setup module
    const setup = require("./helpers/setup");
    gameCfgAddress = setup.gameConfigAddr;
    mintAuthAddress = setup.mintAuthAddr;
    magicCfgAddress = setup.magicCfgAddr;
    magicMintAuthAddress = setup.magicMintAuthAddr;
    nftCfgAddress = setup.nftConfigAddr;
    nftAuthAddress = setup.nftAuthAddr;
  });

  // ─── Core initializations ────────────────────────────────────────────

  it("creates the game configuration account with correct defaults", async () => {
    await resourceMgrProg.methods
      .initializeGame(
        salePrices.map((p) => new anchor.BN(p)),
        Buffer.from(dropDistribution),
        new anchor.BN(cooldownSec),
        searchProg.programId,
        craftingProg.programId,
        marketplaceProg.programId
      )
      .accounts({
        admin: deployer.publicKey,
        gameConfig: gameCfgAddress,
        mintAuthority: mintAuthAddress,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify persisted values
    const storedCfg = await resourceMgrProg.account.gameConfig.fetch(gameCfgAddress);
    expect(storedCfg.admin.toBase58()).to.equal(deployer.publicKey.toBase58());
    expect(storedCfg.searchCooldown.toNumber()).to.equal(cooldownSec);
    expect(storedCfg.resourceCount).to.equal(0);
  });

  it("creates all six resource mints and registers them in config", async () => {
    for (let idx = 0; idx < 6; idx++) {
      await resourceMgrProg.methods
        .initializeResource(idx, materialNames[idx], materialTickers[idx], `https://cossack.game/resource/${idx}.json`)
        .accounts({
          admin: deployer.publicKey,
          gameConfig: gameCfgAddress,
          mint: resMintKeypairs[idx].publicKey,
          mintAuthority: mintAuthAddress,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([resMintKeypairs[idx]])
        .rpc();
    }

    // After all 6, the config should store every mint pubkey
    const storedCfg = await resourceMgrProg.account.gameConfig.fetch(gameCfgAddress);
    expect(storedCfg.resourceCount).to.equal(6);
    for (let idx = 0; idx < 6; idx++) {
      expect(storedCfg.resourceMints[idx].toBase58()).to.equal(
        resMintKeypairs[idx].publicKey.toBase58()
      );
    }
  });

  it("creates the MagicToken (Token-2022) mint", async () => {
    const setup = require("./helpers/setup");
    await magicTokenProg.methods
      .initializeMagicToken(
        "MagicToken",
        "MAGIC",
        "https://cossack.game/magic.json",
        marketplaceProg.programId
      )
      .accounts({
        admin: deployer.publicKey,
        config: magicCfgAddress,
        mint: setup.magicMintKeypair.publicKey,
        mintAuthority: magicMintAuthAddress,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([setup.magicMintKeypair])
      .rpc();

    const magicCfg = await magicTokenProg.account.magicTokenConfig.fetch(magicCfgAddress);
    expect(magicCfg.mint.toBase58()).to.equal(setup.magicMintKeypair.publicKey.toBase58());
  });

  it("creates the ItemNft configuration account", async () => {
    await itemNftProg.methods
      .initializeItemNft(craftingProg.programId, marketplaceProg.programId)
      .accounts({
        admin: deployer.publicKey,
        config: nftCfgAddress,
        nftAuthority: nftAuthAddress,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const nftCfg = await itemNftProg.account.itemNftConfig.fetch(nftCfgAddress);
    expect(nftCfg.craftingProgram.toBase58()).to.equal(
      craftingProg.programId.toBase58()
    );
  });

  // ─── Reinitialisation guard ──────────────────────────────────────────

  it("prevents re-initialising the game config (already exists)", async () => {
    try {
      await resourceMgrProg.methods
        .initializeGame(
          salePrices.map((p) => new anchor.BN(p)),
          Buffer.from(dropDistribution),
          new anchor.BN(60),
          searchProg.programId,
          craftingProg.programId,
          marketplaceProg.programId
        )
        .accounts({
          admin: deployer.publicKey,
          gameConfig: gameCfgAddress,
          mintAuthority: mintAuthAddress,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Expected an error — config PDA already initialised");
    } catch (err) {
      expect(err).to.exist;
    }
  });

  // ─── Admin-only parameter updates ────────────────────────────────────

  it("lets the admin change rarity weights and restores originals", async () => {
    const updatedWeights = [25, 25, 20, 15, 10, 5];
    await resourceMgrProg.methods
      .updateRarityWeights(Buffer.from(updatedWeights))
      .accounts({
        admin: deployer.publicKey,
        gameConfig: gameCfgAddress,
      })
      .rpc();

    const afterUpdate = await resourceMgrProg.account.gameConfig.fetch(gameCfgAddress);
    expect(Array.from(afterUpdate.rarityWeights)).to.deep.equal(updatedWeights);

    // Restore the original weights so later tests are unaffected
    await resourceMgrProg.methods
      .updateRarityWeights(Buffer.from(dropDistribution))
      .accounts({
        admin: deployer.publicKey,
        gameConfig: gameCfgAddress,
      })
      .rpc();
  });

  it("rejects rarity weights whose total is not 100", async () => {
    try {
      await resourceMgrProg.methods
        .updateRarityWeights(Buffer.from([10, 10, 10, 10, 10, 10]))
        .accounts({
          admin: deployer.publicKey,
          gameConfig: gameCfgAddress,
        })
        .rpc();
      expect.fail("Expected InvalidRarityWeights error");
    } catch (err) {
      expect(err.toString()).to.include("InvalidRarityWeights");
    }
  });

  it("lets the admin change the search cooldown and restores it", async () => {
    await resourceMgrProg.methods
      .updateSearchCooldown(new anchor.BN(3))
      .accounts({
        admin: deployer.publicKey,
        gameConfig: gameCfgAddress,
      })
      .rpc();

    const afterUpdate = await resourceMgrProg.account.gameConfig.fetch(gameCfgAddress);
    expect(afterUpdate.searchCooldown.toNumber()).to.equal(3);

    // Restore original cooldown
    await resourceMgrProg.methods
      .updateSearchCooldown(new anchor.BN(cooldownSec))
      .accounts({
        admin: deployer.publicKey,
        gameConfig: gameCfgAddress,
      })
      .rpc();
  });

  it("rejects a cooldown of zero (must be positive)", async () => {
    try {
      await resourceMgrProg.methods
        .updateSearchCooldown(new anchor.BN(0))
        .accounts({
          admin: deployer.publicKey,
          gameConfig: gameCfgAddress,
        })
        .rpc();
      expect.fail("Expected InvalidCooldown error");
    } catch (err) {
      expect(err.toString()).to.include("InvalidCooldown");
    }
  });
});
