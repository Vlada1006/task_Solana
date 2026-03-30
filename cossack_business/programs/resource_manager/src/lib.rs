use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::{invoke, invoke_signed},
    system_instruction,
};
use spl_token_2022::{extension::ExtensionType, instruction::initialize_mint2};
use spl_token_metadata_interface::state::TokenMetadata;
use spl_type_length_value::variable_len_pack::VariableLenPack;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;

// Resource Manager — central on-chain program that manages the game world configuration,
// resource token mints (Token-2022 with MetadataPointer), and provides CPI-gated
// mint/burn endpoints for the search and crafting programs respectively.
declare_id!("4dNQgKi74dCATTf84YuMEyHESoJAPQunsC44WqE1nC8v");

#[program]
pub mod resource_manager {
    use super::*;

    /// Sets up the core game configuration PDA with all admin-tunable parameters.
    /// This is called once during deployment and stores authorized program IDs,
    /// item sell prices, weighted drop rates for resources, and the search timer.
    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        item_prices: [u64; 4],
        rarity_weights: [u8; 6],
        search_cooldown: i64,
        search_program: Pubkey,
        crafting_program: Pubkey,
        marketplace_program: Pubkey,
    ) -> Result<()> {
        // Validate that rarity drop weights add up to exactly 100 (percentage-based)
        let weight_sum: u16 = rarity_weights.iter().map(|&w| w as u16).sum();
        require!(weight_sum == 100, GameError::InvalidRarityWeights);

        // Cooldown between searches must be a positive number of seconds
        require!(search_cooldown > 0, GameError::InvalidCooldown);

        // Persist all configuration into the game_config PDA
        let game_cfg = &mut ctx.accounts.game_config;
        game_cfg.admin = ctx.accounts.admin.key();
        game_cfg.item_prices = item_prices;
        game_cfg.rarity_weights = rarity_weights;
        game_cfg.search_cooldown = search_cooldown;
        game_cfg.search_program = search_program;
        game_cfg.crafting_program = crafting_program;
        game_cfg.marketplace_program = marketplace_program;
        game_cfg.resource_count = 0;
        game_cfg.bump = ctx.bumps.game_config;
        game_cfg.mint_authority_bump = ctx.bumps.mint_authority;
        Ok(())
    }

    /// Creates a new Token-2022 mint for a game resource with on-chain metadata.
    /// Resources must be initialized sequentially (id 0 through 5) to maintain
    /// consistent ordering in the game_config.resource_mints array.
    ///
    /// Each resource mint uses the MetadataPointer extension so that metadata
    /// lives directly on the mint account rather than a separate PDA.
    pub fn initialize_resource(
        ctx: Context<InitializeResource>,
        id: u8,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        // Ensure the resource ID is within the valid range (0..5)
        require!(id < RESOURCE_COUNT as u8, GameError::InvalidResourceId);
        // Enforce sequential initialization order
        require!(
            id == ctx.accounts.game_config.resource_count,
            GameError::OutOfOrder
        );

        let resource_mint_pubkey = ctx.accounts.mint.key();
        let mint_auth_pubkey = ctx.accounts.mint_authority.key();

        // Calculate the account space needed for Token-2022 mint with MetadataPointer
        let required_mint_space =
            ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&[
                ExtensionType::MetadataPointer,
            ])
            .map_err(|_| GameError::SpaceCalculationFailed)?;

        let rent = Rent::get()?;
        let initial_lamports = rent.minimum_balance(required_mint_space);

        // Step 1: Allocate the mint account owned by Token-2022
        invoke(
            &system_instruction::create_account(
                &ctx.accounts.admin.key(),
                &resource_mint_pubkey,
                initial_lamports,
                required_mint_space as u64,
                &spl_token_2022::ID,
            ),
            &[
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.mint.to_account_info(),
            ],
        )?;

        // Step 2: Initialize the MetadataPointer extension on the mint
        invoke(
            &spl_token_2022::extension::metadata_pointer::instruction::initialize(
                &spl_token_2022::ID,
                &resource_mint_pubkey,
                Some(mint_auth_pubkey),
                Some(resource_mint_pubkey),
            )?,
            &[ctx.accounts.mint.to_account_info()],
        )?;

        // Step 3: Initialize the mint itself (0 decimals for fungible resources)
        invoke(
            &initialize_mint2(
                &spl_token_2022::ID,
                &resource_mint_pubkey,
                &mint_auth_pubkey,
                None,
                0,
            )?,
            &[ctx.accounts.mint.to_account_info()],
        )?;

        // Build the token metadata struct to calculate space for on-chain metadata
        let on_chain_metadata = TokenMetadata {
            name: name.clone(),
            symbol: symbol.clone(),
            uri: uri.clone(),
            mint: resource_mint_pubkey,
            update_authority: Some(mint_auth_pubkey).try_into().unwrap(),
            additional_metadata: vec![],
        };
        let metadata_packed_len = on_chain_metadata.get_packed_len().unwrap_or(256);

        // The total space is: mint space + TLV discriminator (12 bytes) + metadata
        let total_required_space = required_mint_space + 12 + metadata_packed_len;
        let additional_lamports = rent
            .minimum_balance(total_required_space)
            .saturating_sub(initial_lamports);

        // Transfer additional rent if the metadata extends beyond initial allocation
        if additional_lamports > 0 {
            invoke(
                &system_instruction::transfer(
                    &ctx.accounts.admin.key(),
                    &resource_mint_pubkey,
                    additional_lamports,
                ),
                &[
                    ctx.accounts.admin.to_account_info(),
                    ctx.accounts.mint.to_account_info(),
                ],
            )?;
        }

        // Step 4: Write metadata using the PDA mint authority as signer
        let authority_bump_seed = ctx.accounts.game_config.mint_authority_bump;
        let pda_signer_seeds: &[&[u8]] = &[b"mint_authority", &[authority_bump_seed]];
        invoke_signed(
            &spl_token_metadata_interface::instruction::initialize(
                &spl_token_2022::ID,
                &resource_mint_pubkey,
                &mint_auth_pubkey,
                &resource_mint_pubkey,
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

        // Register this mint in the game config and increment the counter
        let game_cfg = &mut ctx.accounts.game_config;
        game_cfg.resource_mints[id as usize] = resource_mint_pubkey;
        game_cfg.resource_count += 1;
        Ok(())
    }

    /// Mints resource tokens to a player's associated token account.
    /// This endpoint is CPI-gated — only the authorized search program can call
    /// it via its `caller_authority` PDA, ensuring players cannot mint directly.
    pub fn mint_resource(ctx: Context<MintResource>, resource_id: u8, amount: u64) -> Result<()> {
        require!(resource_id < RESOURCE_COUNT as u8, GameError::InvalidResourceId);
        require!(amount > 0, GameError::InvalidAmount);

        // Reconstruct the PDA signer seeds for the mint authority
        let authority_bump_seed = ctx.accounts.game_config.mint_authority_bump;
        let pda_signer_seeds: &[&[u8]] = &[b"mint_authority", &[authority_bump_seed]];

        // Execute the Token-2022 mint_to CPI with PDA signature
        anchor_spl::token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_2022::MintTo {
                    mint: ctx.accounts.resource_mint.to_account_info(),
                    to: ctx.accounts.player_ata.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[pda_signer_seeds],
            ),
            amount,
        )
    }

    /// Burns resource tokens from a player's token account during crafting.
    /// CPI-gated — only the authorized crafting program can invoke this
    /// through its `caller_authority` PDA. The player must also sign.
    pub fn burn_resource(ctx: Context<BurnResource>, resource_id: u8, amount: u64) -> Result<()> {
        require!(resource_id < RESOURCE_COUNT as u8, GameError::InvalidResourceId);
        require!(amount > 0, GameError::InvalidAmount);

        // Burn uses the player's signature directly (no PDA needed)
        anchor_spl::token_2022::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_2022::Burn {
                    mint: ctx.accounts.resource_mint.to_account_info(),
                    from: ctx.accounts.player_ata.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            amount,
        )
    }

    /// Allows the admin to reconfigure the weighted drop rates for resources.
    /// The weights array must contain exactly 6 entries that sum to 100,
    /// representing percentage chances for each resource type.
    pub fn update_rarity_weights(ctx: Context<AdminOnly>, new_weights: [u8; 6]) -> Result<()> {
        let weight_sum: u16 = new_weights.iter().map(|&w| w as u16).sum();
        require!(weight_sum == 100, GameError::InvalidRarityWeights);
        ctx.accounts.game_config.rarity_weights = new_weights;
        Ok(())
    }

    /// Allows the admin to adjust the minimum time (in seconds) between searches.
    /// Must be a positive value to prevent spam.
    pub fn update_search_cooldown(ctx: Context<AdminOnly>, new_cooldown: i64) -> Result<()> {
        require!(new_cooldown > 0, GameError::InvalidCooldown);
        ctx.accounts.game_config.search_cooldown = new_cooldown;
        Ok(())
    }
}
