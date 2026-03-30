import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { anchorProvider, resourceMgrProg, searchProg, testWallet1, testWallet2, resMintKeypairs, searchCallerPda,
  cooldownSec, bootstrapTestEnv } from "../helpers/setup";
import { TOKEN_2022_PROGRAM_ID, createResourceAtas } from "../helpers/utils";

/**
 * Exercises the search flow:
 *   - A single search drops exactly 3 resources
 *   - Cooldown is enforced between consecutive searches
 *   - After the cooldown expires, the same player can search again
 *   - Different wallets are independent (no shared lock)
 */
describe("Resource Search", () => {
  let gameCfgAddress: PublicKey;
  let mintAuthAddress: PublicKey;
  let p1ResourceAtas: PublicKey[];

  before(async () => {
    await bootstrapTestEnv();
    const setup = require("./helpers/setup");
    gameCfgAddress = setup.gameConfigAddr;
    mintAuthAddress = setup.mintAuthAddr;

    // Ensure player 1 has ATAs for every resource mint
    p1ResourceAtas = await createResourceAtas(testWallet1.publicKey);
  });

  it("awards exactly 3 resources on a successful search", async () => {
    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player"), testWallet1.publicKey.toBuffer()],
      searchProg.programId
    );

    // Build the remaining accounts array: 6 mints + 6 ATAs
    const supplementalAccts = [
      ...resMintKeypairs.map((m) => ({
        pubkey: m.publicKey, isSigner: false, isWritable: true,
      })),
      ...p1ResourceAtas.map((a) => ({
        pubkey: a, isSigner: false, isWritable: true,
      })),
    ];

    await searchProg.methods
      .searchResources()
      .accounts({
        player: testWallet1.publicKey,
        playerAccount: playerPda,
        callerAuthority: searchCallerPda,
        gameConfig: gameCfgAddress,
        mintAuthority: mintAuthAddress,
        resourceManagerProgram: resourceMgrProg.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(supplementalAccts)
      .signers([testWallet1])
      .rpc();

    // Sum up token balances across all 6 resource ATAs
    let resourceTotal = 0;
    for (const ata of p1ResourceAtas) {
      const tokenInfo = await anchorProvider.connection.getTokenAccountBalance(ata);
      resourceTotal += parseInt(tokenInfo.value.amount);
    }
    expect(resourceTotal).to.equal(3);
  });

  it("rejects a search attempted before the cooldown expires", async () => {
    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player"), testWallet1.publicKey.toBuffer()],
      searchProg.programId
    );

    const supplementalAccts = [
      ...resMintKeypairs.map((m) => ({
        pubkey: m.publicKey, isSigner: false, isWritable: true,
      })),
      ...p1ResourceAtas.map((a) => ({
        pubkey: a, isSigner: false, isWritable: true,
      })),
    ];

    try {
      await searchProg.methods
        .searchResources()
        .accounts({
          player: testWallet1.publicKey,
          playerAccount: playerPda,
          callerAuthority: searchCallerPda,
          gameConfig: gameCfgAddress,
          mintAuthority: mintAuthAddress,
          resourceManagerProgram: resourceMgrProg.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(supplementalAccts)
        .signers([testWallet1])
        .rpc();
      expect.fail("Expected SearchCooldown error — cooldown still active");
    } catch (err) {
      expect(err.toString()).to.include("SearchCooldown");
    }
  });

  it("allows searching again once the cooldown has elapsed", async () => {
    // Wait for the cooldown window to pass
    await new Promise((resolve) => setTimeout(resolve, (cooldownSec + 1) * 1000));

    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player"), testWallet1.publicKey.toBuffer()],
      searchProg.programId
    );

    const supplementalAccts = [
      ...resMintKeypairs.map((m) => ({
        pubkey: m.publicKey, isSigner: false, isWritable: true,
      })),
      ...p1ResourceAtas.map((a) => ({
        pubkey: a, isSigner: false, isWritable: true,
      })),
    ];

    await searchProg.methods
      .searchResources()
      .accounts({
        player: testWallet1.publicKey,
        playerAccount: playerPda,
        callerAuthority: searchCallerPda,
        gameConfig: gameCfgAddress,
        mintAuthority: mintAuthAddress,
        resourceManagerProgram: resourceMgrProg.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(supplementalAccts)
      .signers([testWallet1])
      .rpc();

    // After two successful searches the total should be 6
    let resourceTotal = 0;
    for (const ata of p1ResourceAtas) {
      const tokenInfo = await anchorProvider.connection.getTokenAccountBalance(ata);
      resourceTotal += parseInt(tokenInfo.value.amount);
    }
    expect(resourceTotal).to.equal(6);
  });

  it("lets a second player search independently of the first", async () => {
    // Player 2 gets their own resource ATAs
    const p2ResourceAtas = await createResourceAtas(testWallet2.publicKey);
    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player"), testWallet2.publicKey.toBuffer()],
      searchProg.programId
    );

    const supplementalAccts = [
      ...resMintKeypairs.map((m) => ({
        pubkey: m.publicKey, isSigner: false, isWritable: true,
      })),
      ...p2ResourceAtas.map((a) => ({
        pubkey: a, isSigner: false, isWritable: true,
      })),
    ];

    await searchProg.methods
      .searchResources()
      .accounts({
        player: testWallet2.publicKey,
        playerAccount: playerPda,
        callerAuthority: searchCallerPda,
        gameConfig: gameCfgAddress,
        mintAuthority: mintAuthAddress,
        resourceManagerProgram: resourceMgrProg.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(supplementalAccts)
      .signers([testWallet2])
      .rpc();

    let resourceTotal = 0;
    for (const ata of p2ResourceAtas) {
      const tokenInfo = await anchorProvider.connection.getTokenAccountBalance(ata);
      resourceTotal += parseInt(tokenInfo.value.amount);
    }
    expect(resourceTotal).to.equal(3);
  });
});
