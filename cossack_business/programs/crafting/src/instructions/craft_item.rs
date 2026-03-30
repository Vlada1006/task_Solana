use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::Token,
    token_interface::TokenInterface,
};
use item_nft::program::ItemNft;
use resource_manager::{
    self as rm,
    program::ResourceManager,
};

/// Account layout for the `craft_item` instruction.
///
/// Includes the player wallet, a caller_authority PDA (for CPI signing),
/// the resource_manager game config (to validate resource burns), and
/// program references for both resource_manager and item_nft CPIs.
///
/// Resource mints/ATAs and NFT accounts are passed through `remaining_accounts`
/// because the set of involved resources varies per recipe.
#[derive(Accounts)]
pub struct CraftItem<'info> {
    /// Player wallet — pays for all operations and signs the transaction.
    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: This program's CPI authority PDA used to sign cross-program
    /// invocations to resource_manager and item_nft.
    #[account(seeds = [b"caller_authority"], bump)]
    pub caller_authority: UncheckedAccount<'info>,

    /// Game configuration from resource_manager (validates resource IDs during burns).
    #[account(
        seeds = [b"game_config"],
        bump = game_config.bump,
        seeds::program = resource_manager_program.key(),
    )]
    pub game_config: Account<'info, rm::GameConfig>,

    pub resource_manager_program: Program<'info, ResourceManager>,
    pub item_nft_program: Program<'info, ItemNft>,
    /// Standard SPL Token program (used for the NFT mint via item_nft CPI).
    pub token_program: Program<'info, Token>,
    /// Token-2022 program (used for resource burns via resource_manager CPI).
    pub token_2022_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
