use anchor_lang::prelude::*;
use crate::state::GameConfig;

/// Account constraints for the one-time game world initialization.
/// Creates the `game_config` PDA that stores all global game parameters
/// and derives the `mint_authority` PDA used to sign token operations.
#[derive(Accounts)]
pub struct InitializeGame<'info> {
    /// The admin wallet that will own and control the game configuration
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The game configuration PDA — seeded by "game_config", initialized once
    #[account(
        init,
        payer = admin,
        space = 8 + GameConfig::INIT_SPACE,
        seeds = [b"game_config"],
        bump,
    )]
    pub game_config: Account<'info, GameConfig>,

    /// CHECK: Deterministic PDA that serves as the mint/freeze authority
    /// for all resource Token-2022 mints. Not read or written directly.
    #[account(seeds = [b"mint_authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
