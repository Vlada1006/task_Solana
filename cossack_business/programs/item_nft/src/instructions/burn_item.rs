use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{
    state::{ItemNftConfig, ItemMetadata},
    errors::ItemError,
    constants::MPL_TOKEN_METADATA_ID,
};

/// Account constraints for permanently destroying an NFT item.
///
/// CPI-gated to the marketplace program: when a player sells an item
/// back to the game, the marketplace invokes this endpoint to burn the token
/// and close the on-chain metadata PDA (returning rent to the player).
#[derive(Accounts)]
pub struct BurnItem<'info> {
    /// PDA from the marketplace program proving CPI authorization.
    #[account(
        seeds = [b"caller_authority"],
        bump,
        seeds::program = config.marketplace_program,
    )]
    pub caller_authority: Signer<'info>,

    /// Singleton config with the marketplace program ID for the CPI gate.
    #[account(seeds = [b"item_nft_config"], bump = config.bump)]
    pub config: Account<'info, ItemNftConfig>,

    /// Player who owns the NFT — must sign and will receive rent refund.
    #[account(mut)]
    pub player: Signer<'info>,

    /// Game-level metadata PDA that links the mint to its owner.
    /// The `close = player` directive returns lamports after burning.
    /// Ownership check prevents unauthorized burns.
    #[account(
        mut,
        close = player,
        seeds = [b"item_metadata", nft_mint.key().as_ref()],
        bump = item_metadata.bump,
        constraint = item_metadata.owner == player.key() @ ItemError::NotOwner,
    )]
    pub item_metadata: Account<'info, ItemMetadata>,

    /// The SPL mint of the NFT being destroyed.
    #[account(mut)]
    pub nft_mint: Account<'info, Mint>,

    /// Player's token account holding the NFT (must hold exactly 1).
    #[account(
        mut,
        token::mint = nft_mint,
        token::authority = player,
    )]
    pub player_nft_ata: Account<'info, TokenAccount>,

    /// CHECK: Metaplex metadata PDA — validated inside the Metaplex BurnV1 CPI.
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,

    /// CHECK: Metaplex master edition PDA — validated inside the Metaplex BurnV1 CPI.
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    /// CHECK: Metaplex Token Metadata on-chain program (address verified by constant).
    #[account(address = MPL_TOKEN_METADATA_ID)]
    pub metadata_program: UncheckedAccount<'info>,

    /// CHECK: Solana Instructions sysvar required by Metaplex burn logic.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
