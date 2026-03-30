use anchor_lang::prelude::*;
use crate::state::GameConfig;
use crate::errors::GameError;

/// Account constraints for creating a new Token-2022 resource mint.
/// The `id` instruction argument determines which resource slot to fill;
/// it must equal the current `resource_count` to enforce sequential order.
#[derive(Accounts)]
#[instruction(id: u8)]
pub struct InitializeResource<'info> {
    /// Admin signer — verified against game_config.admin
    #[account(
        mut,
        constraint = admin.key() == game_config.admin @ GameError::Unauthorized,
    )]
    pub admin: Signer<'info>,

    /// Mutable game config PDA where the new mint will be registered
    #[account(
        mut,
        seeds = [b"game_config"],
        bump = game_config.bump,
    )]
    pub game_config: Account<'info, GameConfig>,

    /// Fresh keypair for the new resource mint — must sign the transaction
    /// because `create_account` requires the new account to be a signer
    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: PDA mint authority derived from "mint_authority" seed.
    /// Used as the authority for the Token-2022 mint.
    #[account(seeds = [b"mint_authority"], bump = game_config.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    /// CHECK: Must be the Token-2022 program (validated by address constraint)
    #[account(address = spl_token_2022::ID)]
    pub token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
