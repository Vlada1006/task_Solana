use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::MagicTokenConfig;
use crate::errors::MagicError;

/// Account constraints for CPI-gated MagicToken minting.
/// The `caller_authority` must be a PDA derived from the authorized marketplace
/// program, preventing unauthorized minting of the in-game currency.
#[derive(Accounts)]
pub struct MintMagicToken<'info> {
    /// PDA signer from the marketplace — verified against config.marketplace_program
    #[account(
        seeds = [b"caller_authority"],
        bump,
        seeds::program = config.marketplace_program,
    )]
    pub caller_authority: Signer<'info>,

    /// Read-only config for looking up the mint address and authority bump
    #[account(seeds = [b"magic_config"], bump = config.bump)]
    pub config: Account<'info, MagicTokenConfig>,

    /// The MagicToken mint — validated against the stored config.mint
    #[account(
        mut,
        constraint = mint.key() == config.mint @ MagicError::MintMismatch,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: PDA with mint authority over the MagicToken mint
    #[account(seeds = [b"magic_mint_authority"], bump = config.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    /// Recipient's associated token account to receive the minted tokens
    #[account(mut)]
    pub recipient_ata: InterfaceAccount<'info, TokenAccount>,

    /// Token-2022 program for executing mint_to
    pub token_program: Interface<'info, TokenInterface>,
}
