use anchor_lang::prelude::*;

/// Persistent on-chain record for a registered player.
///
/// Seeded by `["player", wallet_pubkey]` so each wallet can only have
/// one player account.  The `last_search_timestamp` enforces cooldowns
/// between consecutive resource searches.
#[account]
#[derive(InitSpace)]
pub struct Player {
    /// The wallet public key that owns this player account.
    pub owner: Pubkey,
    /// Unix timestamp of the most recent search (0 means never searched).
    pub last_search_timestamp: i64,
    /// Bump seed for PDA derivation.
    pub bump: u8,
}
