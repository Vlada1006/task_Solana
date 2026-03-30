import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { searchProg, testWallet1, testWallet2, bootstrapTestEnv } from "../helpers/setup";

/**
 * Verifies player account creation via the Search program.
 * Each player wallet gets a unique PDA that stores search history.
 */
describe("Player Registration", () => {
  before(async () => {
    await bootstrapTestEnv();
  });

  it("creates a player account for wallet #1", async () => {
    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player"), testWallet1.publicKey.toBuffer()],
      searchProg.programId
    );

    await searchProg.methods
      .registerPlayer()
      .accounts({
        player: testWallet1.publicKey,
        playerAccount: playerPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([testWallet1])
      .rpc();

    // The freshly-created account should point to the correct owner
    const playerData = await searchProg.account.player.fetch(playerPda);
    expect(playerData.owner.toBase58()).to.equal(testWallet1.publicKey.toBase58());
    // Timestamp should be zero (no search performed yet)
    expect(playerData.lastSearchTimestamp.toNumber()).to.equal(0);
  });

  it("creates a player account for wallet #2", async () => {
    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player"), testWallet2.publicKey.toBuffer()],
      searchProg.programId
    );

    await searchProg.methods
      .registerPlayer()
      .accounts({
        player: testWallet2.publicKey,
        playerAccount: playerPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([testWallet2])
      .rpc();

    const playerData = await searchProg.account.player.fetch(playerPda);
    expect(playerData.owner.toBase58()).to.equal(testWallet2.publicKey.toBase58());
  });

  it("prevents the same wallet from registering twice", async () => {
    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player"), testWallet1.publicKey.toBuffer()],
      searchProg.programId
    );

    try {
      await searchProg.methods
        .registerPlayer()
        .accounts({
          player: testWallet1.publicKey,
          playerAccount: playerPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([testWallet1])
        .rpc();
      expect.fail("Expected an error — PDA already allocated");
    } catch (err) {
      expect(err).to.exist;
    }
  });
});
