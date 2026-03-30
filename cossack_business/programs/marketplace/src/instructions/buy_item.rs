use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
    token_interface::{
        Mint as MintInterface,
        TokenAccount as TokenAccountInterface,
        TokenInterface,
    },
};
use item_nft::program::ItemNft;
use crate::state::Listing;
use crate::errors::MarketError;

/// Account layout for buying a listed item.
///
/// Transfers MagicToken from the buyer to the seller, releases the escrowed
/// NFT to the buyer, and updates the item's on-chain ownership record.
/// The Listing PDA is closed afterwards, returning rent to the seller.
#[derive(Accounts)]
pub struct BuyItem<'info> {
    /// The buyer's wallet — pays MagicToken and receives the NFT.
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: This program's CPI authority PDA (for item_nft ownership transfer).
    #[account(seeds = [b"caller_authority"], bump)]
    pub caller_authority: UncheckedAccount<'info>,

    /// Active listing to be fulfilled. Closed after purchase (rent → seller).
    #[account(
        mut,
        seeds = [b"listing", listing.item_mint.as_ref()],
        bump = listing.bump,
        close = seller,
    )]
    pub listing: Box<Account<'info, Listing>>,

    /// CHECK: The original seller wallet — validated against the listing record.
    /// Receives the MagicToken payment and the listing rent refund.
    #[account(
        mut,
        constraint = seller.key() == listing.seller @ MarketError::SellerMismatch,
    )]
    pub seller: UncheckedAccount<'info>,

    /// Item metadata PDA — ownership will be transferred from seller to buyer.
    #[account(
        mut,
        seeds = [b"item_metadata", listing.item_mint.as_ref()],
        bump,
        seeds::program = item_nft::ID,
    )]
    pub item_metadata: Box<Account<'info, item_nft::ItemMetadata>>,

    /// Singleton item_nft config (needed for the ownership-transfer CPI).
    #[account(
        seeds = [b"item_nft_config"],
        bump = item_nft_config.bump,
        seeds::program = item_nft_program.key(),
    )]
    pub item_nft_config: Box<Account<'info, item_nft::ItemNftConfig>>,

    /// SPL mint of the NFT being purchased (verified against the listing).
    #[account(
        constraint = nft_mint.key() == listing.item_mint @ MarketError::MintMismatch,
    )]
    pub nft_mint: Box<Account<'info, Mint>>,

    /// CHECK: Escrow authority PDA that currently controls the escrowed NFT.
    #[account(
        seeds = [b"escrow", nft_mint.key().as_ref()],
        bump = listing.escrow_bump,
    )]
    pub escrow_authority: UncheckedAccount<'info>,

    /// Escrow ATA holding the NFT during the listing period.
    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = escrow_authority,
    )]
    pub escrow_nft_ata: Box<Account<'info, TokenAccount>>,

    /// Buyer's ATA that will receive the NFT.
    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = buyer,
    )]
    pub buyer_nft_ata: Box<Account<'info, TokenAccount>>,

    /// MagicToken config (for mint address verification).
    #[account(
        seeds = [b"magic_config"],
        bump = magic_token_config.bump,
        seeds::program = magic_token::ID,
    )]
    pub magic_token_config: Box<Account<'info, magic_token::MagicTokenConfig>>,

    /// MagicToken mint — verified via config constraint.
    #[account(
        constraint = magic_token_mint.key() == magic_token_config.mint @ MarketError::MintMismatch,
    )]
    pub magic_token_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// Buyer's MagicToken ATA (source of payment).
    #[account(mut)]
    pub buyer_magic_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// Seller's MagicToken ATA (destination of payment).
    #[account(mut)]
    pub seller_magic_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub item_nft_program: Program<'info, ItemNft>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
