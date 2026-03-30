use anchor_lang::prelude::*;

/// Custom error codes used throughout the resource_manager program.
/// Each variant maps to a specific validation failure with a human-readable message.
#[error_code]
pub enum GameError {
    #[msg("Resource ID out of range — must be between 0 and 5 inclusive")]
    InvalidResourceId,
    #[msg("Resources must be created sequentially starting from index 0")]
    OutOfOrder,
    #[msg("Token amount must be greater than zero")]
    InvalidAmount,
    #[msg("Provided resource mint does not match the one stored in game config")]
    MintMismatch,
    #[msg("Only the game administrator can perform this action")]
    Unauthorized,
    #[msg("Drop weight percentages must add up to exactly 100")]
    InvalidRarityWeights,
    #[msg("Search cooldown duration must be a positive value")]
    InvalidCooldown,
    #[msg("Could not compute the required account space for the mint")]
    SpaceCalculationFailed,
}
