use anchor_lang::prelude::*;

/// Top-level configuration account for the Item-NFT program.
///
/// Stores the addresses of programs that are authorized to invoke CPI
/// endpoints such as `create_item`, `burn_item`, and `transfer_item_ownership`.
/// The PDA seed is `"item_nft_config"` (singleton, one per deployment).
#[account]
#[derive(InitSpace)]
pub struct ItemNftConfig {
    /// Deployment administrator who initialized this config.
    pub admin: Pubkey,
    /// The Crafting program — allowed to create new NFT items.
    pub crafting_program: Pubkey,
    /// The Marketplace program — allowed to burn and transfer items.
    pub marketplace_program: Pubkey,
    /// Bump seed used when deriving this config PDA.
    pub bump: u8,
    /// Bump seed for the `nft_authority` PDA used as mint/update authority.
    pub nft_authority_bump: u8,
}

/// Per-NFT metadata stored on-chain as a PDA seeded by `["item_metadata", mint]`.
///
/// Each crafted item gets one of these records linking the SPL mint
/// to the in-game item type and current owner address.
#[account]
#[derive(InitSpace)]
pub struct ItemMetadata {
    /// Numeric item category (index into ITEM_NAMES / ITEM_SYMBOLS).
    pub item_type: u8,
    /// Current owner of this item within the game world.
    pub owner: Pubkey,
    /// The SPL mint address of the underlying NFT token.
    pub mint: Pubkey,
    /// Bump seed for this PDA derivation.
    pub bump: u8,
}
