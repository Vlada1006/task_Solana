import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { anchorProvider, resourceMgrProg, searchProg, craftingProg, itemNftProg, deployer, resMintKeypairs,
  searchCallerPda, craftCallerPda, nftAuthAddr, nftConfigAddr } from "./setup";

export { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };

// Metaplex Token Metadata program address (mainnet / localnet)
export const METAPLEX_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Crafting recipe table (mirrors the on-chain RECIPES constant)
// Each row: [WOOD, IRON, GOLD, LEATHER, STONE, DIAMOND]
export const RECIPES = [
  [1, 3, 0, 1, 0, 0], // Cossack Saber
  [2, 0, 1, 0, 0, 1], // Elder Staff
  [0, 2, 1, 4, 0, 0], // Mage Armor
  [0, 4, 2, 0, 0, 2], // Battle Bracelet
];

/**
 * Derives the Metaplex metadata PDA for a given mint.
 */
export function findMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METAPLEX_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METAPLEX_PROGRAM_ID
  )[0];
}

/**
 * Derives the Metaplex master edition PDA for a given mint.
 */
export function findMasterEditionPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METAPLEX_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    METAPLEX_PROGRAM_ID
  )[0];
}

/**
 * Ensures an associated token account exists for every resource mint
 * under the given player wallet.  Creates missing ATAs on the fly.
 */
export async function createResourceAtas(ownerPubkey: PublicKey): Promise<PublicKey[]> {
  const ataAddrs: PublicKey[] = [];
  for (let i = 0; i < 6; i++) {
    const ata = getAssociatedTokenAddressSync(
      resMintKeypairs[i].publicKey,
      ownerPubkey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    ataAddrs.push(ata);

    // Only send a tx if the ATA doesn't exist yet
    const existingInfo = await anchorProvider.connection.getAccountInfo(ata);
    if (!existingInfo) {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        anchorProvider.wallet.publicKey,
        ata,
        ownerPubkey,
        resMintKeypairs[i].publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const tx = new anchor.web3.Transaction().add(createAtaIx);
      await anchorProvider.sendAndConfirm(tx);
    }
  }
  return ataAddrs;
}

/**
 * Runs multiple search rounds for the given player, temporarily lowering
 * the cooldown to 1 second so the loop finishes quickly.
 */
export async function doMultipleSearches(
  playerKp: Keypair,
  rounds: number,
  gameCfgAddr: PublicKey,
  mintAuthority: PublicKey,
) {
  // Temporarily reduce cooldown for fast consecutive searches
  await resourceMgrProg.methods
    .updateSearchCooldown(new anchor.BN(1))
    .accounts({ admin: deployer.publicKey, gameConfig: gameCfgAddr })
    .rpc();

  const [playerAcctPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), playerKp.publicKey.toBuffer()],
    searchProg.programId
  );

  // Prepare resource ATAs for the player
  const playerTokenAccts: PublicKey[] = [];
  for (let i = 0; i < 6; i++) {
    playerTokenAccts.push(
      getAssociatedTokenAddressSync(
        resMintKeypairs[i].publicKey,
        playerKp.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  // Build remaining accounts array (6 mints + 6 ATAs)
  const supplementalAccts = [
    ...resMintKeypairs.map((m) => ({
      pubkey: m.publicKey, isSigner: false, isWritable: true,
    })),
    ...playerTokenAccts.map((a) => ({
      pubkey: a, isSigner: false, isWritable: true,
    })),
  ];

  for (let iter = 0; iter < rounds; iter++) {
    // Wait slightly longer than the 1-second cooldown
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      await searchProg.methods
        .searchResources()
        .accounts({
          player: playerKp.publicKey,
          playerAccount: playerAcctPda,
          callerAuthority: searchCallerPda,
          gameConfig: gameCfgAddr,
          mintAuthority: mintAuthority,
          resourceManagerProgram: resourceMgrProg.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(supplementalAccts)
        .signers([playerKp])
        .rpc();
    } catch {
      // If cooldown triggered, wait a bit more and retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await searchProg.methods
        .searchResources()
        .accounts({
          player: playerKp.publicKey,
          playerAccount: playerAcctPda,
          callerAuthority: searchCallerPda,
          gameConfig: gameCfgAddr,
          mintAuthority: mintAuthority,
          resourceManagerProgram: resourceMgrProg.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(supplementalAccts)
        .signers([playerKp])
        .rpc();
    }
  }

  // Restore original cooldown (2s for other tests)
  await resourceMgrProg.methods
    .updateSearchCooldown(new anchor.BN(2))
    .accounts({ admin: deployer.publicKey, gameConfig: gameCfgAddr })
    .rpc();
}

/**
 * Checks whether the player can afford any recipe and, if so, crafts the
 * first affordable item.  Returns the NFT mint keypair and item type,
 * or null if no recipe is affordable.
 */
export async function craftNftForPlayer( playerKp: Keypair, gameCfgAddr: PublicKey ): Promise<{ mint: Keypair; itemType: number } | null> {
  // Read current resource balances
  const playerTokenAccts: PublicKey[] = [];
  const balanceAmounts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const ata = getAssociatedTokenAddressSync(resMintKeypairs[i].publicKey, playerKp.publicKey,
      true, TOKEN_2022_PROGRAM_ID);
    playerTokenAccts.push(ata);
    const info = await anchorProvider.connection.getTokenAccountBalance(ata);
    balanceAmounts.push(parseInt(info.value.amount));
  }

  // Find the first affordable recipe
  let selectedRecipe = -1;
  for (let r = 0; r < RECIPES.length; r++) {
    let canAfford = true;
    for (let i = 0; i < 6; i++) {
      if (balanceAmounts[i] < RECIPES[r][i]) { canAfford = false; break; }
    }
    if (canAfford) { selectedRecipe = r; break; }
  }

  if (selectedRecipe === -1) return null;

  const newNftMint = Keypair.generate();

  // Determine which resource IDs are needed (non-zero requirement)
  const neededResIds: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (RECIPES[selectedRecipe][i] > 0) neededResIds.push(i);
  }

  // Build resource (mint, ATA) pairs for remaining_accounts
  const resAccountEntries = neededResIds.flatMap((rid) => {
    const mintPk = resMintKeypairs[rid].publicKey;
    const ataPk = getAssociatedTokenAddressSync(
      mintPk, playerKp.publicKey, true, TOKEN_2022_PROGRAM_ID
    );
    return [
      { pubkey: mintPk, isSigner: false, isWritable: true },
      { pubkey: ataPk, isSigner: false, isWritable: true },
    ];
  });

  // Build NFT-related remaining accounts
  const [itemMetaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("item_metadata"), newNftMint.publicKey.toBuffer()],
    itemNftProg.programId
  );
  const playerNftAta = getAssociatedTokenAddressSync(
    newNftMint.publicKey, playerKp.publicKey, false, TOKEN_PROGRAM_ID
  );
  const metadataAddr = findMetadataPda(newNftMint.publicKey);
  const masterEdAddr = findMasterEditionPda(newNftMint.publicKey);

  const nftAccountEntries = [
    { pubkey: newNftMint.publicKey, isSigner: true, isWritable: true },
    { pubkey: playerNftAta, isSigner: false, isWritable: true },
    { pubkey: metadataAddr, isSigner: false, isWritable: true },
    { pubkey: masterEdAddr, isSigner: false, isWritable: true },
    { pubkey: METAPLEX_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: itemMetaPda, isSigner: false, isWritable: true },
    { pubkey: nftConfigAddr, isSigner: false, isWritable: false },
    { pubkey: nftAuthAddr, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  await craftingProg.methods
    .craftItem(selectedRecipe, Buffer.from(neededResIds))
    .accounts({
      player: playerKp.publicKey,
      callerAuthority: craftCallerPda,
      gameConfig: gameCfgAddr,
      resourceManagerProgram: resourceMgrProg.programId,
      itemNftProgram: itemNftProg.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .remainingAccounts([...resAccountEntries, ...nftAccountEntries])
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ])
    .signers([playerKp, newNftMint])
    .rpc();

  return { mint: newNftMint, itemType: selectedRecipe };
}
