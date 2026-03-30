use anchor_lang::prelude::*;

/// Error codes specific to the MagicToken program.
#[error_code]
pub enum MagicError {
    #[msg("Mint amount must be greater than zero")]
    InvalidAmount,
    #[msg("Provided mint does not match the one stored in config")]
    MintMismatch,
    #[msg("Could not compute the required account size for the mint")]
    SpaceCalculationFailed,
}
