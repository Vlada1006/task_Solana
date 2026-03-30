use anchor_lang::prelude::*;

/// Configuration PDA for the MagicToken program.
/// Stores the mint address, authorized marketplace program ID,
/// and bump seeds for deterministic PDA derivation.
/// Only the marketplace program can CPI into `mint_magic_token`.
#[account]
#[derive(InitSpace)]
pub struct MagicTokenConfig {
    /// The administrator who deployed the MagicToken program
    pub admin: Pubkey,
    /// Public key of the MagicToken Token-2022 mint
    pub mint: Pubkey,
    /// The only program allowed to trigger minting via CPI
    pub marketplace_program: Pubkey,
    /// Bump seed for the magic_config PDA
    pub bump: u8,
    /// Bump seed for the magic_mint_authority PDA
    pub mint_authority_bump: u8,
}
