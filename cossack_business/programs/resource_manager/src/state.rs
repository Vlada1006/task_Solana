use anchor_lang::prelude::*;

/// The main game configuration account stored as a single PDA.
/// This holds all the global state needed by the game ecosystem:
/// - Admin wallet address (the only account authorized to change settings)
/// - Array of 6 resource mint public keys (populated during initialization)
/// - Authorized program IDs for search, crafting, and marketplace (CPI gating)
/// - Fixed sell prices for each of the 4 craftable item types
/// - Weighted probability distribution for resource drops (must sum to 100)
/// - Configurable cooldown timer between player searches
/// - Counters and PDA bump seeds for deterministic derivation
#[account]
#[derive(InitSpace)]
pub struct GameConfig {
    /// The administrator who deployed and controls the game world
    pub admin: Pubkey,
    /// Public keys of the 6 resource Token-2022 mints (Wood, Iron, Gold, etc.)
    pub resource_mints: [Pubkey; 6],
    /// Program ID authorized to trigger resource minting via CPI
    pub search_program: Pubkey,
    /// Program ID authorized to trigger resource burning via CPI
    pub crafting_program: Pubkey,
    /// Program ID authorized to interact with item_nft and magic_token
    pub marketplace_program: Pubkey,
    /// Fixed MagicToken prices paid when selling each item type to the game
    pub item_prices: [u64; 4],
    /// Percentage-based drop weights per resource (indices 0..5, sum = 100)
    pub rarity_weights: [u8; 6],
    /// Minimum seconds a player must wait between consecutive searches
    pub search_cooldown: i64,
    /// How many resource mints have been initialized so far (0..6)
    pub resource_count: u8,
    /// Bump seed for the game_config PDA derivation
    pub bump: u8,
    /// Bump seed for the mint_authority PDA derivation
    pub mint_authority_bump: u8,
}
