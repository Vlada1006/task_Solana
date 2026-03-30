use anchor_lang::prelude::*;
use crate::state::{ItemNftConfig, ItemMetadata};

/// Account constraints for updating the owner field in an ItemMetadata PDA.
///
/// CPI-gated to the marketplace program: called during item purchases so the
/// on-chain ownership record stays consistent with the actual token holder.
#[derive(Accounts)]
pub struct TransferItemOwnership<'info> {
    /// PDA proving the call originates from the marketplace program.
    #[account(
        seeds = [b"caller_authority"],
        bump,
        seeds::program = config.marketplace_program,
    )]
    pub caller_authority: Signer<'info>,

    /// Singleton item-NFT config with the marketplace program address.
    #[account(seeds = [b"item_nft_config"], bump = config.bump)]
    pub config: Account<'info, ItemNftConfig>,

    /// The metadata PDA whose `owner` field will be overwritten.
    #[account(
        mut,
        seeds = [b"item_metadata", item_metadata.mint.as_ref()],
        bump = item_metadata.bump,
    )]
    pub item_metadata: Account<'info, ItemMetadata>,
}
