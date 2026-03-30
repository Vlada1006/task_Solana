use anchor_lang::prelude::*;
use crate::state::MagicTokenConfig;

/// Account constraints for one-time MagicToken mint initialization.
/// Creates the config PDA and derives the mint authority PDA.
#[derive(Accounts)]
pub struct InitializeMagicToken<'info> {
    /// The deploying admin who pays for account creation
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Configuration PDA storing the MagicToken program state
    #[account(
        init,
        payer = admin,
        space = 8 + MagicTokenConfig::INIT_SPACE,
        seeds = [b"magic_config"],
        bump,
    )]
    pub config: Account<'info, MagicTokenConfig>,

    /// Fresh keypair for the MagicToken mint (must sign for create_account)
    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: PDA that will serve as the mint authority for MagicToken.
    /// Derived from "magic_mint_authority" seed.
    #[account(seeds = [b"magic_mint_authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    /// CHECK: Must be the Token-2022 program (validated by address constraint)
    #[account(address = spl_token_2022::ID)]
    pub token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
