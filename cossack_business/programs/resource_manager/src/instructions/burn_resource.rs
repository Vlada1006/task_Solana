use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::GameConfig;
use crate::errors::GameError;

/// Account constraints for CPI-gated resource burning during item crafting.
/// The `caller_authority` must be derived from the authorized crafting program.
/// The player must also sign, as they are the token account owner.
#[derive(Accounts)]
#[instruction(resource_id: u8)]
pub struct BurnResource<'info> {
    /// PDA signer from the crafting program — verified against game_config.crafting_program
    #[account(
        seeds = [b"caller_authority"],
        bump,
        seeds::program = game_config.crafting_program,
    )]
    pub caller_authority: Signer<'info>,

    /// The player who owns the resource tokens being burned
    pub player: Signer<'info>,

    /// Read-only game config for validating the resource mint address
    #[account(seeds = [b"game_config"], bump = game_config.bump)]
    pub game_config: Account<'info, GameConfig>,

    /// The resource mint whose tokens are being burned — verified against config
    #[account(
        mut,
        constraint = resource_mint.key() == game_config.resource_mints[resource_id as usize]
            @ GameError::MintMismatch,
    )]
    pub resource_mint: InterfaceAccount<'info, Mint>,

    /// The player's token account holding the resources to burn
    #[account(
        mut,
        token::mint = resource_mint,
        token::authority = player,
    )]
    pub player_ata: InterfaceAccount<'info, TokenAccount>,

    /// Token-2022 program for executing the burn instruction
    pub token_program: Interface<'info, TokenInterface>,
}
