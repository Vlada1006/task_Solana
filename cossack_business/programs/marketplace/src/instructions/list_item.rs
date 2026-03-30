use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};
use crate::state::Listing;
use crate::errors::MarketError;

/// Account layout for the `list_item` instruction (P2P marketplace listing).
///
/// Creates an escrow + listing record.  The NFT is transferred from the
/// seller's ATA to an escrow ATA owned by a per-mint PDA.  The seller
/// can later delist, or another player can buy.
#[derive(Accounts)]
pub struct ListItem<'info> {
    /// The player listing the item (must own it per ItemMetadata).
    #[account(mut)]
    pub seller: Signer<'info>,

    /// On-chain item metadata — the ownership check ensures only the true
    /// owner can create a listing.
    #[account(
        constraint = item_metadata.owner == seller.key() @ MarketError::NotOwner,
    )]
    pub item_metadata: Account<'info, item_nft::ItemMetadata>,

    /// SPL mint of the NFT being listed.
    pub nft_mint: Account<'info, Mint>,

    /// Seller's token account currently holding the NFT.
    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = seller,
    )]
    pub seller_nft_ata: Account<'info, TokenAccount>,

    /// CHECK: Escrow authority PDA seeded by `["escrow", mint_pubkey]`.
    /// Serves as the authority over the escrow token account.
    #[account(
        seeds = [b"escrow", nft_mint.key().as_ref()],
        bump,
    )]
    pub escrow_authority: UncheckedAccount<'info>,

    /// Escrow ATA that will custody the NFT while the listing is active.
    #[account(
        init,
        payer = seller,
        associated_token::mint = nft_mint,
        associated_token::authority = escrow_authority,
    )]
    pub escrow_nft_ata: Account<'info, TokenAccount>,

    /// Listing PDA that records sale details (seller, price, item type, bumps).
    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [b"listing", nft_mint.key().as_ref()],
        bump,
    )]
    pub listing: Account<'info, Listing>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
