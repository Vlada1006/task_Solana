use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};
use crate::state::{ItemNftConfig, ItemMetadata};
use crate::constants::MPL_TOKEN_METADATA_ID;

/// Account constraints for creating a new NFT item.
///
/// Access is CPI-gated to the authorized crafting program. The instruction
/// initializes a fresh mint (decimals = 0), creates the player's ATA, and
/// stores an on-chain `ItemMetadata` PDA linking the mint to the game item.
#[derive(Accounts)]
#[instruction(item_type: u8)]
pub struct CreateItem<'info> {
    /// PDA owned by the crafting program — proves the call originated from
    /// an authorized crafting transaction.
    #[account(
        seeds = [b"caller_authority"],
        bump,
        seeds::program = config.crafting_program,
    )]
    pub caller_authority: Signer<'info>,

    /// Singleton config holding the NFT authority bump and allowed programs.
    #[account(seeds = [b"item_nft_config"], bump = config.bump)]
    pub config: Account<'info, ItemNftConfig>,

    /// CHECK: PDA that serves as mint authority and Metaplex update authority.
    #[account(seeds = [b"nft_authority"], bump = config.nft_authority_bump)]
    pub nft_authority: UncheckedAccount<'info>,

    /// CHECK: Wallet address of the player who will receive the minted NFT.
    pub player: UncheckedAccount<'info>,

    /// Transaction fee payer (typically the player's signing wallet).
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Freshly initialized SPL mint for the new NFT (decimals = 0, supply will be 1).
    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = nft_authority,
        mint::freeze_authority = nft_authority,
    )]
    pub nft_mint: Account<'info, Mint>,

    /// Associated token account created for the player to hold the NFT.
    #[account(
        init,
        payer = payer,
        associated_token::mint = nft_mint,
        associated_token::authority = player,
    )]
    pub player_nft_ata: Account<'info, TokenAccount>,

    /// Game-level metadata PDA tracking item type, owner, mint, and bump.
    #[account(
        init,
        payer = payer,
        space = 8 + ItemMetadata::INIT_SPACE,
        seeds = [b"item_metadata", nft_mint.key().as_ref()],
        bump,
    )]
    pub item_metadata: Account<'info, ItemMetadata>,

    /// CHECK: Metaplex metadata PDA — address validated inside the Metaplex CPI.
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,

    /// CHECK: Metaplex master edition PDA — address validated inside the Metaplex CPI.
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    /// CHECK: Metaplex Token Metadata program address (hard-coded constant check).
    #[account(address = MPL_TOKEN_METADATA_ID)]
    pub metadata_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
