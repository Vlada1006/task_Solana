use anchor_lang::prelude::*;

/// Represents an active marketplace listing where an NFT is held in escrow.
///
/// Created when a player lists an item for sale, and closed (with rent refund)
/// when the item is bought or the listing is cancelled.
/// PDA seed: `["listing", item_mint_pubkey]`.
#[account]
#[derive(InitSpace)]
pub struct Listing {
    /// Address of the wallet that created the listing.
    pub seller: Pubkey,
    /// SPL mint address of the escrowed NFT.
    pub item_mint: Pubkey,
    /// Numeric category of the item (matches `ItemMetadata.item_type`).
    pub item_type: u8,
    /// Asking price in MagicToken units.
    pub price: u64,
    /// Bump seed for the listing PDA.
    pub bump: u8,
    /// Bump seed for the escrow authority PDA that holds the NFT.
    pub escrow_bump: u8,
}
