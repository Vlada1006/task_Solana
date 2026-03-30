use anchor_lang::prelude::*;

/// Domain errors for NFT item operations.
#[error_code]
pub enum ItemError {
    #[msg("Item type out of range — expected a value between 0 and 3 inclusive")]
    InvalidItemType,
    #[msg("Transaction signer does not match the recorded item owner")]
    NotOwner,
}
