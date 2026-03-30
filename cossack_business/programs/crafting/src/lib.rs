use anchor_lang::prelude::*;
use resource_manager::{self as rm, cpi::accounts::BurnResource};

pub mod constants;
pub mod errors;
pub mod instructions;

pub use constants::*;
pub use errors::*;
pub use instructions::*;

// Crafting — transforms raw resources into unique NFT items.
// The player provides the required resources (as Token-2022 tokens) which
// get burned via resource_manager CPI, and a new NFT is minted through
// item_nft CPI on successful recipe validation.
declare_id!("HHnXL9vfkMWgLAA8q5iSp4pD7ip5A3DXQgTTgus44w29");

#[program]
pub mod crafting {
    use super::*;

    /// Craft a game item by burning the required resources and minting an NFT.
    ///
    /// The instruction uses `remaining_accounts` for dynamic account layout.
    /// The first section contains (mint, ATA) pairs for each resource that
    /// has a non-zero requirement in the recipe, followed by 9 fixed NFT-related
    /// accounts needed for the Metaplex CPI.
    ///
    /// Remaining accounts layout:
    ///   [resource_mint_0, resource_ata_0, resource_mint_1, resource_ata_1, ...]
    ///   [nft_mint, player_nft_ata, metadata_account, master_edition,
    ///    metadata_program, item_metadata, item_nft_config, nft_authority, rent_sysvar]
    ///
    /// `resource_ids` identifies which resource types are included (same order
    /// as the pairs in remaining_accounts). Only resources with required > 0
    /// should appear.
    pub fn craft_item<'info>(
        ctx: Context<'_, '_, 'info, 'info, CraftItem<'info>>,
        item_type: u8,
        resource_ids: Vec<u8>,
    ) -> Result<()> {
        // Validate the requested item type against available recipes
        require!((item_type as usize) < RECIPES.len(), CraftError::InvalidItemType);
        let recipe = RECIPES[item_type as usize];

        // ---  Duplicate detection  ---
        // Prevent the same resource ID from appearing twice, which would let
        // an attacker burn fewer tokens than actually required.
        let mut already_seen = [false; RESOURCE_COUNT];
        for &rid in resource_ids.iter() {
            require!((rid as usize) < RESOURCE_COUNT, CraftError::InvalidItemType);
            require!(!already_seen[rid as usize], CraftError::DuplicateResourceId);
            already_seen[rid as usize] = true;
        }

        // Verify every resource with a non-zero recipe requirement is present
        for (rid, &amount_needed) in recipe.iter().enumerate() {
            if amount_needed > 0 {
                require!(
                    resource_ids.contains(&(rid as u8)),
                    CraftError::MissingResource
                );
            }
        }

        // Prepare CPI signer seeds for this program's caller_authority PDA
        let caller_bump = ctx.bumps.caller_authority;
        let caller_pda_seeds: &[&[u8]] = &[b"caller_authority", &[caller_bump]];

        let extra_accounts = ctx.remaining_accounts;
        let resource_pair_count = resource_ids.len();
        require!(
            extra_accounts.len() >= resource_pair_count * 2 + 9,
            CraftError::InvalidRemainingAccounts
        );

        // --- Burn each required resource via CPI to resource_manager --- //
        for (pair_idx, &resource_id) in resource_ids.iter().enumerate() {
            let amount_needed = recipe[resource_id as usize];
            if amount_needed == 0 {
                continue;
            }

            let mint_account = extra_accounts[pair_idx * 2].to_account_info();
            let ata_account = extra_accounts[pair_idx * 2 + 1].to_account_info();

            rm::cpi::burn_resource(
                CpiContext::new_with_signer(
                    ctx.accounts.resource_manager_program.to_account_info(),
                    BurnResource {
                        caller_authority: ctx.accounts.caller_authority.to_account_info(),
                        player: ctx.accounts.player.to_account_info(),
                        game_config: ctx.accounts.game_config.to_account_info(),
                        resource_mint: mint_account,
                        player_ata: ata_account,
                        token_program: ctx.accounts.token_2022_program.to_account_info(),
                    },
                    &[caller_pda_seeds],
                ),
                resource_id,
                amount_needed as u64,
            )?;
        }

        // --- Mint the NFT item via CPI to item_nft --- //
        let nft_accounts_start = resource_pair_count * 2;
        let nft_mint = extra_accounts[nft_accounts_start].to_account_info();
        let player_nft_ata = extra_accounts[nft_accounts_start + 1].to_account_info();
        let metadata_account = extra_accounts[nft_accounts_start + 2].to_account_info();
        let master_edition = extra_accounts[nft_accounts_start + 3].to_account_info();
        let metadata_program = extra_accounts[nft_accounts_start + 4].to_account_info();
        let item_metadata = extra_accounts[nft_accounts_start + 5].to_account_info();
        let item_nft_config = extra_accounts[nft_accounts_start + 6].to_account_info();
        let nft_authority = extra_accounts[nft_accounts_start + 7].to_account_info();
        let rent_sysvar = extra_accounts[nft_accounts_start + 8].to_account_info();

        item_nft::cpi::create_item(
            CpiContext::new_with_signer(
                ctx.accounts.item_nft_program.to_account_info(),
                item_nft::cpi::accounts::CreateItem {
                    caller_authority: ctx.accounts.caller_authority.to_account_info(),
                    config: item_nft_config,
                    nft_authority,
                    player: ctx.accounts.player.to_account_info(),
                    payer: ctx.accounts.player.to_account_info(),
                    nft_mint,
                    player_nft_ata,
                    item_metadata,
                    metadata_account,
                    master_edition,
                    metadata_program,
                    token_program: ctx.accounts.token_program.to_account_info(),
                    associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: rent_sysvar,
                },
                &[caller_pda_seeds],
            ),
            item_type,
        )?;

        Ok(())
    }
}
