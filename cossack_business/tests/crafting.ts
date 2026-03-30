import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { expect } from "chai";
import { anchorProvider, resourceMgrProg, itemNftProg, craftingProg, testWallet1, resMintKeypairs, craftCallerPda, bootstrapTestEnv } from "../helpers/setup";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, METAPLEX_PROGRAM_ID, RECIPES,
  findMetadataPda, findMasterEditionPda, doMultipleSearches } from "../helpers/utils";

/**
 * Verifies the crafting pipeline:
 *   - Accumulate resources via repeated searches
 *   - Find the first recipe the player can afford
 *   - Craft the NFT and confirm resource deductions
 */
describe("Item Crafting", () => {
  let gameCfgAddress: PublicKey;
  let mintAuthAddress: PublicKey;
  let nftCfgAddress: PublicKey;
  let nftAuthAddress: PublicKey;

  before(async () => {
    await bootstrapTestEnv();
    const setup = require("./helpers/setup");
    gameCfgAddress = setup.gameConfigAddr;
    mintAuthAddress = setup.mintAuthAddr;
    nftCfgAddress = setup.nftConfigAddr;
    nftAuthAddress = setup.nftAuthAddr;

    // Perform many searches so the player accumulates enough resources
    await doMultipleSearches(testWallet1, 10, gameCfgAddress, mintAuthAddress);
  });

  it("burns the correct resources and mints an NFT for the first affordable recipe", async () => {
    // Snapshot current resource balances
    const balancesBefore: number[] = [];
    for (let idx = 0; idx < 6; idx++) {
      const ata = getAssociatedTokenAddressSync(
        resMintKeypairs[idx].publicKey,
        testWallet1.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      const tokenInfo = await anchorProvider.connection.getTokenAccountBalance(ata);
      balancesBefore.push(parseInt(tokenInfo.value.amount));
    }
    console.log("Resource snapshot before craft:", balancesBefore);

    // Determine which recipe the player can afford
    let selectedRecipe = -1;
    for (let r = 0; r < RECIPES.length; r++) {
      let canAfford = true;
      for (let idx = 0; idx < 6; idx++) {
        if (balancesBefore[idx] < RECIPES[r][idx]) { canAfford = false; break; }
      }
      if (canAfford) { selectedRecipe = r; break; }
    }

    if (selectedRecipe === -1) {
      console.log("Skipping — random search drops were insufficient for any recipe");
      return;
    }

    console.log("Selected recipe index:", selectedRecipe);

    const itemMintKp = Keypair.generate();

    // Identify which resource indices the recipe needs (non-zero cost)
    const neededResIds: number[] = [];
    for (let idx = 0; idx < 6; idx++) {
      if (RECIPES[selectedRecipe][idx] > 0) neededResIds.push(idx);
    }

    // Build remaining accounts: pairs of (resourceMint, playerATA)
    const resAccountEntries = neededResIds.flatMap((rid) => {
      const mintPk = resMintKeypairs[rid].publicKey;
      const ataPk = getAssociatedTokenAddressSync(
        mintPk, testWallet1.publicKey, true, TOKEN_2022_PROGRAM_ID
      );
      return [
        { pubkey: mintPk, isSigner: false, isWritable: true },
        { pubkey: ataPk, isSigner: false, isWritable: true },
      ];
    });

    // Derive NFT-related PDAs
    const [itemMetaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("item_metadata"), itemMintKp.publicKey.toBuffer()],
      itemNftProg.programId
    );
    const playerNftAta = getAssociatedTokenAddressSync(
      itemMintKp.publicKey, testWallet1.publicKey, false, TOKEN_PROGRAM_ID
    );
    const metadataAddr = findMetadataPda(itemMintKp.publicKey);
    const masterEdAddr = findMasterEditionPda(itemMintKp.publicKey);

    const nftAccountEntries = [
      { pubkey: itemMintKp.publicKey, isSigner: true, isWritable: true },
      { pubkey: playerNftAta, isSigner: false, isWritable: true },
      { pubkey: metadataAddr, isSigner: false, isWritable: true },
      { pubkey: masterEdAddr, isSigner: false, isWritable: true },
      { pubkey: METAPLEX_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: itemMetaPda, isSigner: false, isWritable: true },
      { pubkey: nftCfgAddress, isSigner: false, isWritable: false },
      { pubkey: nftAuthAddress, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];

    await craftingProg.methods
      .craftItem(selectedRecipe, Buffer.from(neededResIds))
      .accounts({
        player: testWallet1.publicKey,
        callerAuthority: craftCallerPda,
        gameConfig: gameCfgAddress,
        resourceManagerProgram: resourceMgrProg.programId,
        itemNftProgram: itemNftProg.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([...resAccountEntries, ...nftAccountEntries])
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ])
      .signers([testWallet1, itemMintKp])
      .rpc();

    // The player should now hold exactly 1 NFT
    const nftBalance = await anchorProvider.connection.getTokenAccountBalance(playerNftAta);
    expect(parseInt(nftBalance.value.amount)).to.equal(1);

    // Verify that the recipe cost was deducted from each resource
    const balancesAfter: number[] = [];
    for (let idx = 0; idx < 6; idx++) {
      const ata = getAssociatedTokenAddressSync(
        resMintKeypairs[idx].publicKey,
        testWallet1.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      const tokenInfo = await anchorProvider.connection.getTokenAccountBalance(ata);
      balancesAfter.push(parseInt(tokenInfo.value.amount));
    }
    for (let idx = 0; idx < 6; idx++) {
      expect(balancesAfter[idx]).to.equal(balancesBefore[idx] - RECIPES[selectedRecipe][idx]);
    }
  });
});
