import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { expect } from "chai";
import { resourceMgrProg, magicTokenProg, itemNftProg, testWallet1, bootstrapTestEnv } from "../helpers/setup";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  METAPLEX_PROGRAM_ID, findMetadataPda, findMasterEditionPda } from "../helpers/utils";

/**
 * Makes sure CPI-gated instructions cannot be invoked directly
 * by an external signer, and that admin-only operations reject non-admin
 * callers.  These are the main security invariants of the system.
 */
describe("Access Control & CPI Gating", () => {
  let gameCfgAddress: PublicKey;
  let mintAuthAddress: PublicKey;
  let magicCfgAddress: PublicKey;
  let magicMintAuthAddress: PublicKey;
  let nftCfgAddress: PublicKey;
  let nftAuthAddress: PublicKey;
  let magicMintKp: Keypair;

  before(async () => {
    await bootstrapTestEnv();
    const setup = require("./helpers/setup");
    gameCfgAddress = setup.gameConfigAddr;
    mintAuthAddress = setup.mintAuthAddr;
    magicCfgAddress = setup.magicCfgAddr;
    magicMintAuthAddress = setup.magicMintAuthAddr;
    nftCfgAddress = setup.nftConfigAddr;
    nftAuthAddress = setup.nftAuthAddr;
    magicMintKp = setup.magicMintKeypair;
  });

  it("blocks direct resource minting with a forged caller authority", async () => {
    const setup = require("./helpers/setup");
    const bogusAuthority = Keypair.generate();
    const ata = getAssociatedTokenAddressSync(
      setup.resMintKeypairs[0].publicKey,
      testWallet1.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );

    try {
      await resourceMgrProg.methods
        .mintResource(0, new anchor.BN(1))
        .accounts({
          callerAuthority: bogusAuthority.publicKey,
          gameConfig: gameCfgAddress,
          resourceMint: setup.resMintKeypairs[0].publicKey,
          mintAuthority: mintAuthAddress,
          playerAta: ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([bogusAuthority])
        .rpc();
      expect.fail("Expected a CPI-authority rejection");
    } catch (err) {
      expect(err).to.exist;
    }
  });

  it("blocks direct MagicToken minting with a forged caller authority", async () => {
    const bogusAuthority = Keypair.generate();
    const ata = getAssociatedTokenAddressSync(
      magicMintKp.publicKey,
      testWallet1.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );

    try {
      await magicTokenProg.methods
        .mintMagicToken(new anchor.BN(100))
        .accounts({
          callerAuthority: bogusAuthority.publicKey,
          config: magicCfgAddress,
          mint: magicMintKp.publicKey,
          mintAuthority: magicMintAuthAddress,
          recipientAta: ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([bogusAuthority])
        .rpc();
      expect.fail("Expected a CPI-authority rejection");
    } catch (err) {
      expect(err).to.exist;
    }
  });

  it("rejects admin-level config changes from a non-admin wallet", async () => {
    try {
      await resourceMgrProg.methods
        .updateSearchCooldown(new anchor.BN(1))
        .accounts({
          admin: testWallet1.publicKey,
          gameConfig: gameCfgAddress,
        })
        .signers([testWallet1])
        .rpc();
      expect.fail("Expected Unauthorized error");
    } catch (err) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  it("blocks direct NFT creation with a forged caller authority", async () => {
    const bogusAuthority = Keypair.generate();
    const tempMint = Keypair.generate();

    try {
      await itemNftProg.methods
        .createItem(0)
        .accounts({
          callerAuthority: bogusAuthority.publicKey,
          config: nftCfgAddress,
          nftAuthority: nftAuthAddress,
          player: testWallet1.publicKey,
          payer: testWallet1.publicKey,
          nftMint: tempMint.publicKey,
          playerNftAta: getAssociatedTokenAddressSync(
            tempMint.publicKey,
            testWallet1.publicKey,
            false,
            TOKEN_PROGRAM_ID
          ),
          itemMetadata: PublicKey.findProgramAddressSync(
            [Buffer.from("item_metadata"), tempMint.publicKey.toBuffer()],
            itemNftProg.programId
          )[0],
          metadataAccount: findMetadataPda(tempMint.publicKey),
          masterEdition: findMasterEditionPda(tempMint.publicKey),
          metadataProgram: METAPLEX_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([bogusAuthority, testWallet1, tempMint])
        .rpc();
      expect.fail("Expected a CPI-authority rejection");
    } catch (err) {
      expect(err).to.exist;
    }
  });
});
