use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::GameConfig;
use crate::errors::GameError;

/// Account constraints for CPI-gated resource minting.
/// The `caller_authority` must be a PDA derived from the authorized search program,
/// ensuring that only the search program can trigger resource minting.
#[derive(Accounts)]
#[instruction(resource_id: u8)]
pub struct MintResource<'info> {
    /// PDA signer from the search program — verified against game_config.search_program
    #[account(
        seeds = [b"caller_authority"],
        bump,
        seeds::program = game_config.search_program,
    )]
    pub caller_authority: Signer<'info>,

    /// Read-only game config for looking up mint addresses and authority bumps
    #[account(seeds = [b"game_config"], bump = game_config.bump)]
    pub game_config: Account<'info, GameConfig>,

    /// The specific resource mint to issue tokens from — validated against game config
    #[account(
        mut,
        constraint = resource_mint.key() == game_config.resource_mints[resource_id as usize]
            @ GameError::MintMismatch,
    )]
    pub resource_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: PDA that holds mint authority over all resource mints
    #[account(seeds = [b"mint_authority"], bump = game_config.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    /// The player's associated token account to receive the minted resources
    #[account(mut)]
    pub player_ata: InterfaceAccount<'info, TokenAccount>,

    /// Token-2022 program for executing the mint_to instruction
    pub token_program: Interface<'info, TokenInterface>,
}
