use anchor_lang::prelude::*;
use crate::state::Player;

/// Account layout for the `register_player` instruction.
///
/// The player PDA is seeded by `["player", wallet_pubkey]` so each wallet
/// address maps to exactly one player account (idempotent registration).
#[derive(Accounts)]
pub struct RegisterPlayer<'info> {
    /// Wallet that will own the new player record (also pays rent).
    #[account(mut)]
    pub player: Signer<'info>,

    /// The player PDA to be created and populated by the handler.
    #[account(
        init,
        payer = player,
        space = 8 + Player::INIT_SPACE,
        seeds = [b"player", player.key().as_ref()],
        bump,
    )]
    pub player_account: Account<'info, Player>,

    pub system_program: Program<'info, System>,
}
