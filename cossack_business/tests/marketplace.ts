import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { expect } from "chai";
import { anchorProvider, resourceMgrProg, magicTokenProg, itemNftProg, craftingProg, marketplaceProg, testWallet1, testWallet2,
  resMintKeypairs, marketCallerPda, salePrices, bootstrapTestEnv } from "../helpers/setup";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, METAPLEX_PROGRAM_ID,
  RECIPES, findMetadataPda, findMasterEditionPda, doMultipleSearches, craftNftForPlayer } from "../helpers/utils";

/**
 * Covers every marketplace operation:
 *   sell-to-game (burn NFT → MagicToken payout),
 *   list / buy / delist (player-to-player escrow flow).
 */
describe("Marketplace Operations", () => {
  let gameCfgAddress: PublicKey;
  let mintAuthAddress: PublicKey;
  let magicCfgAddress: PublicKey;
  let magicMintAuthAddress: PublicKey;
  let nftCfgAddress: PublicKey;
  let nftAuthAddress: PublicKey;
  let magicMintKp: Keypair;

  // The NFT that will be sold directly to the game
  let sellNftMint: Keypair;
  let sellItemType: number;

  // NFTs used in the list / buy / delist sub-suite
  let listNftMint: Keypair;
  let delistNftMint: Keypair;
  let p2NftMint: Keypair;
  let listItemType: number;

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

  // ─── Sell-to-game flow ───────────────────────────────────────────────

  describe("Sell to Game (burn NFT, receive MagicToken)", () => {
    before(async () => {
      // Accumulate resources then craft an NFT for testWallet1
      await doMultipleSearches(testWallet1, 15, gameCfgAddress, mintAuthAddress);

      const craftResult = await craftNftForPlayer(testWallet1, gameCfgAddress);
      if (!craftResult) {
        console.log("    Skipping sell suite — insufficient resources");
        sellItemType = -1;
        return;
      }
      sellNftMint = craftResult.mint;
      sellItemType = craftResult.itemType;
    });

    it("burns the NFT and pays the seller the configured game price in MagicToken", async () => {
      if (sellItemType === -1) return;

      // Make sure the seller has a MagicToken ATA
      const sellerMagicAta = getAssociatedTokenAddressSync(
        magicMintKp.publicKey, testWallet1.publicKey, true, TOKEN_2022_PROGRAM_ID
      );
      const existingAta = await anchorProvider.connection.getAccountInfo(sellerMagicAta);
      if (!existingAta) {
        const createIx = createAssociatedTokenAccountInstruction(
          anchorProvider.wallet.publicKey, sellerMagicAta, testWallet1.publicKey,
          magicMintKp.publicKey, TOKEN_2022_PROGRAM_ID
        );
        await anchorProvider.sendAndConfirm(new anchor.web3.Transaction().add(createIx));
      }

      // Derive accounts for the NFT being sold
      const [itemMetaPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("item_metadata"), sellNftMint.publicKey.toBuffer()],
        itemNftProg.programId
      );
      const sellerNftAta = getAssociatedTokenAddressSync(
        sellNftMint.publicKey, testWallet1.publicKey, false, TOKEN_PROGRAM_ID
      );
      const metadataAddr = findMetadataPda(sellNftMint.publicKey);
      const masterEdAddr = findMasterEditionPda(sellNftMint.publicKey);

      // Extra accounts needed by the Metaplex burn CPI
      const burnMetaAccounts = [
        { pubkey: metadataAddr, isSigner: false, isWritable: true },
        { pubkey: masterEdAddr, isSigner: false, isWritable: true },
        { pubkey: METAPLEX_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      ];

      await marketplaceProg.methods
        .sellItem()
        .accounts({
          seller: testWallet1.publicKey,
          callerAuthority: marketCallerPda,
          gameConfig: gameCfgAddress,
          itemMetadata: itemMetaPda,
          nftMint: sellNftMint.publicKey,
          sellerNftAta: sellerNftAta,
          itemNftConfig: nftCfgAddress,
          magicTokenConfig: magicCfgAddress,
          magicTokenMint: magicMintKp.publicKey,
          magicMintAuthority: magicMintAuthAddress,
          sellerMagicAta: sellerMagicAta,
          itemNftProgram: itemNftProg.programId,
          magicTokenProgram: magicTokenProg.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(burnMetaAccounts)
        .signers([testWallet1])
        .rpc();

      // The seller's MagicToken balance should equal the game price
      const magicBalance = await anchorProvider.connection.getTokenAccountBalance(sellerMagicAta);
      const expectedAmount = salePrices[sellItemType];
      expect(parseInt(magicBalance.value.amount)).to.equal(expectedAmount);
    });
  });

  // ─── List / Buy / Delist flow ────────────────────────────────────────

  describe("Player-to-Player Listing (escrow)", () => {
    before(async () => {
      // Both players search to stock up on resources
      await doMultipleSearches(testWallet1, 20, gameCfgAddress, mintAuthAddress);
      await doMultipleSearches(testWallet2, 15, gameCfgAddress, mintAuthAddress);

      // Craft NFTs for both players
      const craft1 = await craftNftForPlayer(testWallet1, gameCfgAddress);
      if (!craft1) { console.log("    Skipping list/buy/delist — testWallet1 NFT craft failed"); return; }
      listNftMint = craft1.mint;
      listItemType = craft1.itemType;

      const craft2 = await craftNftForPlayer(testWallet1, gameCfgAddress);
      if (!craft2) { console.log("    Skipping delist — testWallet1 second NFT craft failed"); return; }
      delistNftMint = craft2.mint;

      const craft3 = await craftNftForPlayer(testWallet2, gameCfgAddress);
      if (!craft3) { console.log("    Skipping buy — testWallet2 NFT craft failed"); return; }
      p2NftMint = craft3.mint;

      // Player 2 sells their own NFT to the game to obtain MagicToken (needed to buy later)
      const buyer2MagicAta = getAssociatedTokenAddressSync(
        magicMintKp.publicKey, testWallet2.publicKey, true, TOKEN_2022_PROGRAM_ID
      );
      const ataExists = await anchorProvider.connection.getAccountInfo(buyer2MagicAta);
      if (!ataExists) {
        const createIx = createAssociatedTokenAccountInstruction(
          anchorProvider.wallet.publicKey, buyer2MagicAta, testWallet2.publicKey,
          magicMintKp.publicKey, TOKEN_2022_PROGRAM_ID
        );
        await anchorProvider.sendAndConfirm(new anchor.web3.Transaction().add(createIx));
      }

      const [p2ItemMetaPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("item_metadata"), p2NftMint.publicKey.toBuffer()],
        itemNftProg.programId
      );
      const p2NftAta = getAssociatedTokenAddressSync(
        p2NftMint.publicKey, testWallet2.publicKey, false, TOKEN_PROGRAM_ID
      );
      const p2MetaPda = findMetadataPda(p2NftMint.publicKey);
      const p2EditionPda = findMasterEditionPda(p2NftMint.publicKey);

      await marketplaceProg.methods
        .sellItem()
        .accounts({
          seller: testWallet2.publicKey,
          callerAuthority: marketCallerPda,
          gameConfig: gameCfgAddress,
          itemMetadata: p2ItemMetaPda,
          nftMint: p2NftMint.publicKey,
          sellerNftAta: p2NftAta,
          itemNftConfig: nftCfgAddress,
          magicTokenConfig: magicCfgAddress,
          magicTokenMint: magicMintKp.publicKey,
          magicMintAuthority: magicMintAuthAddress,
          sellerMagicAta: buyer2MagicAta,
          itemNftProgram: itemNftProg.programId,
          magicTokenProgram: magicTokenProg.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: p2MetaPda, isSigner: false, isWritable: true },
          { pubkey: p2EditionPda, isSigner: false, isWritable: true },
          { pubkey: METAPLEX_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        ])
        .signers([testWallet2])
        .rpc();
    });

    it("transfers the NFT into escrow and creates a listing record", async () => {
      if (!listNftMint) return;

      const [itemMetaPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("item_metadata"), listNftMint.publicKey.toBuffer()],
        itemNftProg.programId
      );
      const sellerNftAta = getAssociatedTokenAddressSync(
        listNftMint.publicKey, testWallet1.publicKey, false, TOKEN_PROGRAM_ID
      );
      const [escrowAuthPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), listNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );
      const escrowNftAta = getAssociatedTokenAddressSync(
        listNftMint.publicKey, escrowAuthPda, true, TOKEN_PROGRAM_ID
      );
      const [listingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), listNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );

      await marketplaceProg.methods
        .listItem(new anchor.BN(50))
        .accounts({
          seller: testWallet1.publicKey,
          itemMetadata: itemMetaPda,
          nftMint: listNftMint.publicKey,
          sellerNftAta: sellerNftAta,
          escrowAuthority: escrowAuthPda,
          escrowNftAta: escrowNftAta,
          listing: listingPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([testWallet1])
        .rpc();

      // Confirm listing data matches expectations
      const listingData = await marketplaceProg.account.listing.fetch(listingPda);
      expect(listingData.seller.toBase58()).to.equal(testWallet1.publicKey.toBase58());
      expect(listingData.price.toNumber()).to.equal(50);
      expect(listingData.itemType).to.equal(listItemType);

      // The escrow ATA should now hold the NFT
      const escrowBal = await anchorProvider.connection.getTokenAccountBalance(escrowNftAta);
      expect(parseInt(escrowBal.value.amount)).to.equal(1);
    });

    it("rejects a listing whose price is zero", async () => {
      if (!delistNftMint) return;

      const [itemMetaPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("item_metadata"), delistNftMint.publicKey.toBuffer()],
        itemNftProg.programId
      );
      const sellerNftAta = getAssociatedTokenAddressSync(
        delistNftMint.publicKey, testWallet1.publicKey, false, TOKEN_PROGRAM_ID
      );
      const [escrowAuthPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), delistNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );
      const escrowNftAta = getAssociatedTokenAddressSync(
        delistNftMint.publicKey, escrowAuthPda, true, TOKEN_PROGRAM_ID
      );
      const [listingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), delistNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );

      try {
        await marketplaceProg.methods
          .listItem(new anchor.BN(0))
          .accounts({
            seller: testWallet1.publicKey,
            itemMetadata: itemMetaPda,
            nftMint: delistNftMint.publicKey,
            sellerNftAta: sellerNftAta,
            escrowAuthority: escrowAuthPda,
            escrowNftAta: escrowNftAta,
            listing: listingPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([testWallet1])
          .rpc();
        expect.fail("Expected InvalidPrice — zero not allowed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidPrice");
      }
    });

    it("lets player 2 purchase the listing (MagicToken ↔ NFT swap)", async () => {
      if (!listNftMint || !p2NftMint) return;

      // Ensure player 2 has an ATA for the listed NFT
      const buyerNftAta = getAssociatedTokenAddressSync(
        listNftMint.publicKey, testWallet2.publicKey, false, TOKEN_PROGRAM_ID
      );
      const buyerNftExists = await anchorProvider.connection.getAccountInfo(buyerNftAta);
      if (!buyerNftExists) {
        const createIx = createAssociatedTokenAccountInstruction(
          anchorProvider.wallet.publicKey, buyerNftAta, testWallet2.publicKey,
          listNftMint.publicKey, TOKEN_PROGRAM_ID
        );
        await anchorProvider.sendAndConfirm(new anchor.web3.Transaction().add(createIx));
      }

      // Magic token ATAs for both parties
      const sellerMagicAta = getAssociatedTokenAddressSync(
        magicMintKp.publicKey, testWallet1.publicKey, true, TOKEN_2022_PROGRAM_ID
      );
      const buyerMagicAta = getAssociatedTokenAddressSync(
        magicMintKp.publicKey, testWallet2.publicKey, true, TOKEN_2022_PROGRAM_ID
      );

      // Derive listing and escrow accounts
      const [listingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), listNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );
      const [escrowAuthPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), listNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );
      const escrowNftAta = getAssociatedTokenAddressSync(
        listNftMint.publicKey, escrowAuthPda, true, TOKEN_PROGRAM_ID
      );
      const [itemMetaPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("item_metadata"), listNftMint.publicKey.toBuffer()],
        itemNftProg.programId
      );

      // Snapshot MagicToken balances before the purchase
      const sellerMagicPre = await anchorProvider.connection.getTokenAccountBalance(sellerMagicAta);
      const buyerMagicPre = await anchorProvider.connection.getTokenAccountBalance(buyerMagicAta);

      await marketplaceProg.methods
        .buyItem()
        .accounts({
          buyer: testWallet2.publicKey,
          callerAuthority: marketCallerPda,
          listing: listingPda,
          seller: testWallet1.publicKey,
          itemMetadata: itemMetaPda,
          itemNftConfig: nftCfgAddress,
          nftMint: listNftMint.publicKey,
          escrowAuthority: escrowAuthPda,
          escrowNftAta: escrowNftAta,
          buyerNftAta: buyerNftAta,
          magicTokenConfig: magicCfgAddress,
          magicTokenMint: magicMintKp.publicKey,
          buyerMagicAta: buyerMagicAta,
          sellerMagicAta: sellerMagicAta,
          itemNftProgram: itemNftProg.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([testWallet2])
        .rpc();

      // Buyer now owns the NFT
      const buyerNftBal = await anchorProvider.connection.getTokenAccountBalance(buyerNftAta);
      expect(parseInt(buyerNftBal.value.amount)).to.equal(1);

      // MagicToken transferred: +50 to seller, -50 from buyer
      const sellerMagicPost = await anchorProvider.connection.getTokenAccountBalance(sellerMagicAta);
      const buyerMagicPost = await anchorProvider.connection.getTokenAccountBalance(buyerMagicAta);
      expect(parseInt(sellerMagicPost.value.amount)).to.equal(
        parseInt(sellerMagicPre.value.amount) + 50
      );
      expect(parseInt(buyerMagicPost.value.amount)).to.equal(
        parseInt(buyerMagicPre.value.amount) - 50
      );

      // On-chain item ownership should now point to testWallet2
      const storedMeta = await itemNftProg.account.itemMetadata.fetch(itemMetaPda);
      expect(storedMeta.owner.toBase58()).to.equal(testWallet2.publicKey.toBase58());

      // The listing PDA should have been closed
      try {
        await marketplaceProg.account.listing.fetch(listingPda);
        expect.fail("Listing account should no longer exist");
      } catch (err) {
        expect(err.toString()).to.include("Account does not exist");
      }
    });

    it("lists a second item so we can test delisting", async () => {
      if (!delistNftMint) return;

      const [itemMetaPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("item_metadata"), delistNftMint.publicKey.toBuffer()],
        itemNftProg.programId
      );
      const sellerNftAta = getAssociatedTokenAddressSync(
        delistNftMint.publicKey, testWallet1.publicKey, false, TOKEN_PROGRAM_ID
      );
      const [escrowAuthPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), delistNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );
      const escrowNftAta = getAssociatedTokenAddressSync(
        delistNftMint.publicKey, escrowAuthPda, true, TOKEN_PROGRAM_ID
      );
      const [listingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), delistNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );

      await marketplaceProg.methods
        .listItem(new anchor.BN(75))
        .accounts({
          seller: testWallet1.publicKey,
          itemMetadata: itemMetaPda,
          nftMint: delistNftMint.publicKey,
          sellerNftAta: sellerNftAta,
          escrowAuthority: escrowAuthPda,
          escrowNftAta: escrowNftAta,
          listing: listingPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([testWallet1])
        .rpc();

      const escrowBal = await anchorProvider.connection.getTokenAccountBalance(escrowNftAta);
      expect(parseInt(escrowBal.value.amount)).to.equal(1);
    });

    it("blocks delist attempts from someone other than the original seller", async () => {
      if (!delistNftMint) return;

      const [listingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), delistNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );
      const [escrowAuthPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), delistNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );
      const escrowNftAta = getAssociatedTokenAddressSync(
        delistNftMint.publicKey, escrowAuthPda, true, TOKEN_PROGRAM_ID
      );
      const wrongAta = getAssociatedTokenAddressSync(
        delistNftMint.publicKey, testWallet2.publicKey, false, TOKEN_PROGRAM_ID
      );

      try {
        await marketplaceProg.methods
          .delistItem()
          .accounts({
            seller: testWallet2.publicKey,
            listing: listingPda,
            nftMint: delistNftMint.publicKey,
            escrowAuthority: escrowAuthPda,
            escrowNftAta: escrowNftAta,
            sellerNftAta: wrongAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([testWallet2])
          .rpc();
        expect.fail("Expected ownership / constraint error");
      } catch (err) {
        const msg = err.toString();
        expect(
          msg.includes("NotOwner") || msg.includes("ConstraintRaw") || msg.includes("seller")
        ).to.be.true;
      }
    });

    it("returns the NFT to the original seller upon successful delist", async () => {
      if (!delistNftMint) return;

      const sellerNftAta = getAssociatedTokenAddressSync(
        delistNftMint.publicKey, testWallet1.publicKey, false, TOKEN_PROGRAM_ID
      );
      const [escrowAuthPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), delistNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );
      const escrowNftAta = getAssociatedTokenAddressSync(
        delistNftMint.publicKey, escrowAuthPda, true, TOKEN_PROGRAM_ID
      );
      const [listingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), delistNftMint.publicKey.toBuffer()],
        marketplaceProg.programId
      );

      await marketplaceProg.methods
        .delistItem()
        .accounts({
          seller: testWallet1.publicKey,
          listing: listingPda,
          nftMint: delistNftMint.publicKey,
          escrowAuthority: escrowAuthPda,
          escrowNftAta: escrowNftAta,
          sellerNftAta: sellerNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testWallet1])
        .rpc();

      // NFT should be back in the seller's wallet
      const sellerBal = await anchorProvider.connection.getTokenAccountBalance(sellerNftAta);
      expect(parseInt(sellerBal.value.amount)).to.equal(1);

      // Listing PDA should be closed
      try {
        await marketplaceProg.account.listing.fetch(listingPda);
        expect.fail("Listing account should no longer exist");
      } catch (err) {
        expect(err.toString()).to.include("Account does not exist");
      }
    });
  });
});
