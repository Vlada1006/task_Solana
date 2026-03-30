use anchor_lang::prelude::*;

/// Errors that may be thrown during the crafting process.
#[error_code]
pub enum CraftError {
    #[msg("Item type index out of range — must match a valid recipe (0–3)")]
    InvalidItemType,
    #[msg("Remaining accounts count does not match the expected layout")]
    InvalidRemainingAccounts,
    #[msg("A required resource for this recipe was not included in the transaction")]
    MissingResource,
    #[msg("The same resource ID was supplied more than once in resource_ids")]
    DuplicateResourceId,
}
