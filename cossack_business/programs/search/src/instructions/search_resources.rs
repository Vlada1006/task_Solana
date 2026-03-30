use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenInterface;
use resource_manager::{
    self as rm,
    program::ResourceManager,
};
use crate::state::Player;
use crate::errors::SearchError;

/// Account layout for the `search_resources` instruction.
///
/// Requires the player account for cooldown enforcement, the resource_manager's
/// game config (read-only) for rarity weights, and a caller_authority PDA so
/// the resource_manager can verify CPI origin.
///
/// The 12 remaining accounts (6 mints + 6 ATAs) are passed dynamically
/// because the number of resources is a constant, not hardcoded into the struct.
#[derive(Accounts)]
pub struct SearchResources<'info> {
    /// The player performing the search (must sign).
    #[account(mut)]
    pub player: Signer<'info>,

    /// Player PDA with ownership check and cooldown timestamp.
    #[account(
        mut,
        seeds = [b"player", player.key().as_ref()],
        bump = player_account.bump,
        constraint = player_account.owner == player.key() @ SearchError::NotOwner,
    )]
    pub player_account: Account<'info, Player>,

    /// CHECK: This program's PDA used as the CPI signer when calling
    /// `resource_manager::mint_resource`.  The resource_manager validates
    /// that this PDA belongs to an authorized search program.
    #[account(
        seeds = [b"caller_authority"],
        bump,
    )]
    pub caller_authority: UncheckedAccount<'info>,

    /// Game configuration from resource_manager (provides rarity weights and cooldown).
    #[account(
        seeds = [b"game_config"],
        bump = game_config.bump,
        seeds::program = resource_manager_program.key(),
    )]
    pub game_config: Account<'info, rm::GameConfig>,

    /// CHECK: Mint authority PDA from resource_manager (required by MintResource CPI).
    #[account(
        seeds = [b"mint_authority"],
        bump = game_config.mint_authority_bump,
        seeds::program = resource_manager_program.key(),
    )]
    pub mint_authority: UncheckedAccount<'info>,

    pub resource_manager_program: Program<'info, ResourceManager>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
