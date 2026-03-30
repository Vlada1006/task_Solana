use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::token_interface::{
    Mint as MintInterface,
    TokenAccount as TokenAccountInterface,
    TokenInterface,
};
use item_nft::program::ItemNft;
use magic_token::program::MagicToken;
use resource_manager::{self as rm};
use crate::errors::MarketError;

/// Account layout for the `sell_item` instruction (instant game-buy).
///
/// The player sells an item directly to the game at the admin-configured price.
/// The NFT is burned through item_nft CPI, and MagicToken is minted as payment.
#[derive(Accounts)]
pub struct SellItem<'info> {
    /// Seller wallet — must own the NFT and will receive MagicToken.
    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: This program's CPI authority PDA for signing into item_nft and magic_token.
    #[account(seeds = [b"caller_authority"], bump)]
    pub caller_authority: UncheckedAccount<'info>,

    /// Game config from resource_manager — contains the item_prices array.
    #[account(
        seeds = [b"game_config"],
        bump = game_config.bump,
        seeds::program = resource_manager::ID,
    )]
    pub game_config: Box<Account<'info, rm::GameConfig>>,

    /// The item's on-chain metadata record (provides item_type for price lookup).
    #[account(mut)]
    pub item_metadata: Box<Account<'info, item_nft::ItemMetadata>>,

    /// SPL mint of the NFT being sold/burned.
    #[account(mut)]
    pub nft_mint: Account<'info, Mint>,

    /// Seller's token account holding the NFT.
    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = seller,
    )]
    pub seller_nft_ata: Account<'info, TokenAccount>,

    /// ItemNFT program config (needed by the burn CPI).
    #[account(
        seeds = [b"item_nft_config"],
        bump = item_nft_config.bump,
        seeds::program = item_nft_program.key(),
    )]
    pub item_nft_config: Box<Account<'info, item_nft::ItemNftConfig>>,

    /// MagicToken program config (needed for mint and authority lookup).
    #[account(
        seeds = [b"magic_config"],
        bump = magic_token_config.bump,
        seeds::program = magic_token_program.key(),
    )]
    pub magic_token_config: Box<Account<'info, magic_token::MagicTokenConfig>>,

    /// Token-2022 mint account for MagicToken (verified against config).
    #[account(
        mut,
        constraint = magic_token_mint.key() == magic_token_config.mint @ MarketError::MintMismatch,
    )]
    pub magic_token_mint: InterfaceAccount<'info, MintInterface>,

    /// CHECK: PDA that has mint authority over MagicToken.
    #[account(
        seeds = [b"magic_mint_authority"],
        bump = magic_token_config.mint_authority_bump,
        seeds::program = magic_token_program.key(),
    )]
    pub magic_mint_authority: UncheckedAccount<'info>,

    /// Seller's associated token account for MagicToken (payment destination).
    #[account(mut)]
    pub seller_magic_ata: InterfaceAccount<'info, TokenAccountInterface>,

    pub item_nft_program: Program<'info, ItemNft>,
    pub magic_token_program: Program<'info, MagicToken>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
