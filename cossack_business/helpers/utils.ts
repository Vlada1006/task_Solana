import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { provider, rmProgram, searchProgram, craftProgram, inProgram, admin, resourceMints, searchCallerAuth,
  craftCallerAuth, nftAuthorityPda, itemNftConfigPda } from "./setup";

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
export async function createResourceAtas(playerWallet: PublicKey): Promise<PublicKey[]> {
  const ataList: PublicKey[] = [];
  for (let i = 0; i < 6; i++) {
    const ata = getAssociatedTokenAddressSync(
      resourceMints[i].publicKey,
      playerWallet,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    ataList.push(ata);

    // Only send a tx if the ATA doesn't exist yet
    const existingInfo = await provider.connection.getAccountInfo(ata);
    if (!existingInfo) {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        ata,
        playerWallet,
        resourceMints[i].publicKey,
        TOKEN_2022_PROGRAM_ID
      );
      const tx = new anchor.web3.Transaction().add(createAtaIx);
      await provider.sendAndConfirm(tx);
    }
  }
  return ataList;
}

/**
 * Runs multiple search rounds for the given player, temporarily lowering
 * the cooldown to 1 second so the loop finishes quickly.
 */
export async function doMultipleSearches(
  playerKp: Keypair,
  searchCount: number,
  gameConfigPda: PublicKey,
  mintAuthorityPda: PublicKey,
) {
  // Temporarily reduce cooldown for fast consecutive searches
  await rmProgram.methods
    .updateSearchCooldown(new anchor.BN(1))
    .accounts({ admin: admin.publicKey, gameConfig: gameConfigPda })
    .rpc();

  const [playerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), playerKp.publicKey.toBuffer()],
    searchProgram.programId
  );

  // Prepare resource ATAs for the player
  const playerAtas: PublicKey[] = [];
  for (let i = 0; i < 6; i++) {
    playerAtas.push(
      getAssociatedTokenAddressSync(
        resourceMints[i].publicKey,
        playerKp.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  // Build remaining accounts array (6 mints + 6 ATAs)
  const extraAccounts = [
    ...resourceMints.map((m) => ({
      pubkey: m.publicKey, isSigner: false, isWritable: true,
    })),
    ...playerAtas.map((a) => ({
      pubkey: a, isSigner: false, isWritable: true,
    })),
  ];

  for (let round = 0; round < searchCount; round++) {
    // Wait slightly longer than the 1-second cooldown
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      await searchProgram.methods
        .searchResources()
        .accounts({
          player: playerKp.publicKey,
          playerAccount: playerPda,
          callerAuthority: searchCallerAuth,
          gameConfig: gameConfigPda,
          mintAuthority: mintAuthorityPda,
          resourceManagerProgram: rmProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(extraAccounts)
        .signers([playerKp])
        .rpc();
    } catch {
      // If cooldown triggered, wait a bit more and retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await searchProgram.methods
        .searchResources()
        .accounts({
          player: playerKp.publicKey,
          playerAccount: playerPda,
          callerAuthority: searchCallerAuth,
          gameConfig: gameConfigPda,
          mintAuthority: mintAuthorityPda,
          resourceManagerProgram: rmProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(extraAccounts)
        .signers([playerKp])
        .rpc();
    }
  }

  // Restore original cooldown (2s for other tests)
  await rmProgram.methods
    .updateSearchCooldown(new anchor.BN(2))
    .accounts({ admin: admin.publicKey, gameConfig: gameConfigPda })
    .rpc();
}

/**
 * Checks whether the player can afford any recipe and, if so, crafts the
 * first affordable item.  Returns the NFT mint keypair and item type,
 * or null if no recipe is affordable.
 */
export async function craftNftForPlayer(
  playerKp: Keypair,
  gameConfigPda: PublicKey,
): Promise<{ mint: Keypair; itemType: number } | null> {
  // Read current resource balances
  const playerAtas: PublicKey[] = [];
  const currentBalances: number[] = [];
  for (let i = 0; i < 6; i++) {
    const ata = getAssociatedTokenAddressSync(
      resourceMints[i].publicKey,
      playerKp.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    playerAtas.push(ata);
    const info = await provider.connection.getTokenAccountBalance(ata);
    currentBalances.push(parseInt(info.value.amount));
  }

  // Find the first affordable recipe
  let chosenRecipe = -1;
  for (let r = 0; r < RECIPES.length; r++) {
    let affordable = true;
    for (let i = 0; i < 6; i++) {
      if (currentBalances[i] < RECIPES[r][i]) { affordable = false; break; }
    }
    if (affordable) { chosenRecipe = r; break; }
  }

  if (chosenRecipe === -1) return null;

  const nftMintKeypair = Keypair.generate();

  // Determine which resource IDs are needed (non-zero requirement)
  const requiredResourceIds: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (RECIPES[chosenRecipe][i] > 0) requiredResourceIds.push(i);
  }

  // Build resource (mint, ATA) pairs for remaining_accounts
  const resourceAccounts = requiredResourceIds.flatMap((rid) => {
    const mintPk = resourceMints[rid].publicKey;
    const ataPk = getAssociatedTokenAddressSync(
      mintPk, playerKp.publicKey, true, TOKEN_2022_PROGRAM_ID
    );
    return [
      { pubkey: mintPk, isSigner: false, isWritable: true },
      { pubkey: ataPk, isSigner: false, isWritable: true },
    ];
  });

  // Build NFT-related remaining accounts
  const [itemMetadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("item_metadata"), nftMintKeypair.publicKey.toBuffer()],
    inProgram.programId
  );
  const playerNftAta = getAssociatedTokenAddressSync(
    nftMintKeypair.publicKey, playerKp.publicKey, false, TOKEN_PROGRAM_ID
  );
  const metadataPda = findMetadataPda(nftMintKeypair.publicKey);
  const masterEdPda = findMasterEditionPda(nftMintKeypair.publicKey);

  const nftAccounts = [
    { pubkey: nftMintKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: playerNftAta, isSigner: false, isWritable: true },
    { pubkey: metadataPda, isSigner: false, isWritable: true },
    { pubkey: masterEdPda, isSigner: false, isWritable: true },
    { pubkey: METAPLEX_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: itemMetadataPda, isSigner: false, isWritable: true },
    { pubkey: itemNftConfigPda, isSigner: false, isWritable: false },
    { pubkey: nftAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  await craftProgram.methods
    .craftItem(chosenRecipe, Buffer.from(requiredResourceIds))
    .accounts({
      player: playerKp.publicKey,
      callerAuthority: craftCallerAuth,
      gameConfig: gameConfigPda,
      resourceManagerProgram: rmProgram.programId,
      itemNftProgram: inProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .remainingAccounts([...resourceAccounts, ...nftAccounts])
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ])
    .signers([playerKp, nftMintKeypair])
    .rpc();

  return { mint: nftMintKeypair, itemType: chosenRecipe };
}
