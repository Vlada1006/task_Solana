use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::{invoke, invoke_signed},
    system_instruction,
};
use spl_token_2022::{extension::ExtensionType, instruction::initialize_mint2};
use spl_token_metadata_interface::state::TokenMetadata;
use spl_type_length_value::variable_len_pack::VariableLenPack;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
pub use state::*;

// MagicToken — the in-game currency program. Creates a single Token-2022 mint
// with on-chain metadata and exposes a CPI-gated minting endpoint that only
// the marketplace program can call (to pay sellers when items are sold).
declare_id!("9XB3axXHPNswG2kJXRBTYipk65JP2bsFTtMtTZm2BXAs");

#[program]
pub mod magic_token {
    use super::*;

    /// Sets up the MagicToken mint as a Token-2022 token with embedded metadata.
    /// Called once during deployment to create the currency mint and record the
    /// authorized marketplace program that may trigger minting via CPI.
    pub fn initialize_magic_token(
        ctx: Context<InitializeMagicToken>,
        name: String,
        symbol: String,
        uri: String,
        marketplace_program: Pubkey,
    ) -> Result<()> {
        let token_mint_pubkey = ctx.accounts.mint.key();
        let mint_auth_pubkey = ctx.accounts.mint_authority.key();

        // Calculate required space for Token-2022 mint with MetadataPointer extension
        let required_mint_space =
            ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&[
                ExtensionType::MetadataPointer,
            ])
            .map_err(|_| MagicError::SpaceCalculationFailed)?;

        let rent = Rent::get()?;
        let initial_lamports = rent.minimum_balance(required_mint_space);

        // Allocate the mint account owned by the Token-2022 program
        invoke(
            &system_instruction::create_account(
                &ctx.accounts.admin.key(),
                &token_mint_pubkey,
                initial_lamports,
                required_mint_space as u64,
                &spl_token_2022::ID,
            ),
            &[
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.mint.to_account_info(),
            ],
        )?;

        // Enable the MetadataPointer extension on the mint
        invoke(
            &spl_token_2022::extension::metadata_pointer::instruction::initialize(
                &spl_token_2022::ID,
                &token_mint_pubkey,
                Some(mint_auth_pubkey),
                Some(token_mint_pubkey),
            )?,
            &[ctx.accounts.mint.to_account_info()],
        )?;

        // Initialize the mint with 0 decimals (MagicToken is a whole-number currency)
        invoke(
            &initialize_mint2(
                &spl_token_2022::ID,
                &token_mint_pubkey,
                &mint_auth_pubkey,
                None,
                0,
            )?,
            &[ctx.accounts.mint.to_account_info()],
        )?;

        // Build metadata to calculate the additional space needed
        let on_chain_metadata = TokenMetadata {
            name: name.clone(),
            symbol: symbol.clone(),
            uri: uri.clone(),
            mint: token_mint_pubkey,
            update_authority: Some(mint_auth_pubkey).try_into().unwrap(),
            additional_metadata: vec![],
        };
        let metadata_packed_len = on_chain_metadata.get_packed_len().unwrap_or(256);
        let total_required_space = required_mint_space + 12 + metadata_packed_len;
        let additional_lamports = rent
            .minimum_balance(total_required_space)
            .saturating_sub(initial_lamports);

        // Top up rent if metadata storage requires more lamports
        if additional_lamports > 0 {
            invoke(
                &system_instruction::transfer(
                    &ctx.accounts.admin.key(),
                    &token_mint_pubkey,
                    additional_lamports,
                ),
                &[
                    ctx.accounts.admin.to_account_info(),
                    ctx.accounts.mint.to_account_info(),
                ],
            )?;
        }

        // Write token metadata using the PDA as a signed authority
        let authority_bump_seed = ctx.bumps.mint_authority;
        let pda_signer_seeds: &[&[u8]] = &[b"magic_mint_authority", &[authority_bump_seed]];
        invoke_signed(
            &spl_token_metadata_interface::instruction::initialize(
                &spl_token_2022::ID,
                &token_mint_pubkey,
                &mint_auth_pubkey,
                &token_mint_pubkey,
                &mint_auth_pubkey,
                name,
                symbol,
                uri,
            ),
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.mint_authority.to_account_info(),
            ],
            &[pda_signer_seeds],
        )?;

        // Persist the configuration into the magic_config PDA
        let magic_cfg = &mut ctx.accounts.config;
        magic_cfg.admin = ctx.accounts.admin.key();
        magic_cfg.mint = token_mint_pubkey;
        magic_cfg.marketplace_program = marketplace_program;
        magic_cfg.bump = ctx.bumps.config;
        magic_cfg.mint_authority_bump = ctx.bumps.mint_authority;
        Ok(())
    }

    /// Mints MagicToken to a recipient's token account.
    /// CPI-gated — only the authorized marketplace program can invoke this
    /// through its `caller_authority` PDA. Used for paying sellers when items
    /// are sold to the game at fixed prices.
    pub fn mint_magic_token(
        ctx: Context<MintMagicToken>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, MagicError::InvalidAmount);

        // Reconstruct PDA signer seeds for the magic mint authority
        let authority_bump_seed = ctx.accounts.config.mint_authority_bump;
        let pda_signer_seeds: &[&[u8]] = &[b"magic_mint_authority", &[authority_bump_seed]];

        // Execute the Token-2022 mint_to CPI with PDA signature
        anchor_spl::token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_2022::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_ata.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[pda_signer_seeds],
            ),
            amount,
        )
    }
}
