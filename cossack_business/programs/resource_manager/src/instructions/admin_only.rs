use anchor_lang::prelude::*;
use crate::state::GameConfig;
use crate::errors::GameError;

/// Shared account context used by all admin-only configuration update instructions.
/// Verifies that the signer matches the admin stored in the game_config PDA.
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    /// The admin wallet — must match game_config.admin to proceed
    #[account(
        constraint = admin.key() == game_config.admin @ GameError::Unauthorized,
    )]
    pub admin: Signer<'info>,

    /// Mutable game config for updating tunable parameters
    #[account(
        mut,
        seeds = [b"game_config"],
        bump = game_config.bump,
    )]
    pub game_config: Account<'info, GameConfig>,
}
