use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::Listing;
use crate::errors::MarketError;

/// Account layout for cancelling an active listing.
///
/// Returns the escrowed NFT to the seller and closes the Listing PDA.
/// Only the original seller may invoke this instruction.
#[derive(Accounts)]
pub struct DelistItem<'info> {
    /// The seller requesting cancellation (must match the listing record).
    #[account(mut)]
    pub seller: Signer<'info>,

    /// The listing PDA being cancelled.  Closed on success with rent → seller.
    #[account(
        mut,
        seeds = [b"listing", listing.item_mint.as_ref()],
        bump = listing.bump,
        constraint = listing.seller == seller.key() @ MarketError::NotOwner,
        close = seller,
    )]
    pub listing: Account<'info, Listing>,

    /// SPL mint of the escrowed NFT.
    pub nft_mint: Account<'info, Mint>,

    /// CHECK: Escrow authority PDA that controls the escrow ATA.
    #[account(
        seeds = [b"escrow", nft_mint.key().as_ref()],
        bump = listing.escrow_bump,
    )]
    pub escrow_authority: UncheckedAccount<'info>,

    /// Escrow ATA holding the NFT — will be drained during delist.
    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = escrow_authority,
    )]
    pub escrow_nft_ata: Account<'info, TokenAccount>,

    /// Seller's ATA that will receive the NFT back.
    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = seller,
    )]
    pub seller_nft_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
