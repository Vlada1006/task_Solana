use anchor_lang::prelude::*;

/// Domain errors emitted by the Search program.
#[error_code]
pub enum SearchError {
    #[msg("Search cooldown has not elapsed — please wait before searching again")]
    SearchCooldown,
    #[msg("Arithmetic overflow while computing time difference")]
    TimerOverflow,
    #[msg("Transaction signer is not the owner of this player account")]
    NotOwner,
    #[msg("Expected exactly 12 remaining accounts (6 resource mints + 6 player ATAs)")]
    InvalidRemainingAccounts,
}
