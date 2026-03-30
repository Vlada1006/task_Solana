use anchor_lang::prelude::*;
use crate::state::ItemNftConfig;

/// Account constraints for the one-time `initialize_item_nft` instruction.
///
/// Creates the singleton config PDA and records the NFT authority bump.
#[derive(Accounts)]
pub struct InitializeItemNft<'info> {
    /// Deployer wallet that pays for account creation.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Singleton config PDA — stores authorized program addresses.
    #[account(
        init,
        payer = admin,
        space = 8 + ItemNftConfig::INIT_SPACE,
        seeds = [b"item_nft_config"],
        bump,
    )]
    pub config: Account<'info, ItemNftConfig>,

    /// CHECK: PDA that acts as mint authority and update authority for all item NFTs.
    /// Not deserialized because it holds no data — only the address matters.
    #[account(seeds = [b"nft_authority"], bump)]
    pub nft_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
