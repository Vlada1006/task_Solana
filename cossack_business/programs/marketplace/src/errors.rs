use anchor_lang::prelude::*;

/// Errors specific to the Marketplace program operations.
#[error_code]
pub enum MarketError {
    #[msg("Listed price must be greater than zero")]
    InvalidPrice,
    #[msg("Transaction signer does not own this item")]
    NotOwner,
    #[msg("Provided seller account does not match the listing record")]
    SellerMismatch,
    #[msg("Item type index does not correspond to a valid game item")]
    InvalidItemType,
    #[msg("Provided mint does not match the expected configuration mint")]
    MintMismatch,
    #[msg("Incorrect number of remaining accounts for this instruction")]
    InvalidRemainingAccounts,
}
