use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::{self, MintTo};

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;

// ItemNFT — manages the creation, burning, and ownership tracking of craftable
// game items represented as standard SPL NFTs with Metaplex metadata.
// All mutating endpoints are CPI-gated to authorized programs only.
declare_id!("ABef4SCxwM4oWm5YNuRsCeFg1pv9NrUkxNK3GPEuCG8w");

#[program]
pub mod item_nft {
    use super::*;

    /// Stores the authorized crafting and marketplace program IDs in the config PDA.
    /// Called once during deployment to set up the CPI authorization table.
    pub fn initialize_item_nft(
        ctx: Context<InitializeItemNft>,
        crafting_program: Pubkey,
        marketplace_program: Pubkey,
    ) -> Result<()> {
        let nft_cfg = &mut ctx.accounts.config;
        nft_cfg.admin = ctx.accounts.admin.key();
        nft_cfg.crafting_program = crafting_program;
        nft_cfg.marketplace_program = marketplace_program;
        nft_cfg.bump = ctx.bumps.config;
        nft_cfg.nft_authority_bump = ctx.bumps.nft_authority;
        Ok(())
    }

    /// Creates a new NFT for the specified item type via Metaplex.
    /// CPI-gated: only the authorized crafting program can call this.
    ///
    /// Flow:
    /// 1. Mint exactly 1 token to the player's associated token account
    /// 2. Create Metaplex metadata with item name/symbol from constants
    /// 3. Create a master edition (supply = 0, making it a unique NFT)
    /// 4. Store an on-chain ItemMetadata PDA linking mint, owner, and type
    pub fn create_item(ctx: Context<CreateItem>, item_type: u8) -> Result<()> {
        require!(item_type < ITEM_COUNT as u8, ItemError::InvalidItemType);

        // Derive PDA signer seeds for the NFT authority
        let nft_authority_bump = ctx.accounts.config.nft_authority_bump;
        let nft_signer_seeds: &[&[u8]] = &[b"nft_authority", &[nft_authority_bump]];

        // Step 1: Mint a single token (NFT) to the player
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.nft_mint.to_account_info(),
                    to: ctx.accounts.player_nft_ata.to_account_info(),
                    authority: ctx.accounts.nft_authority.to_account_info(),
                },
                &[nft_signer_seeds],
            ),
            1,
        )?;

        // Look up display name and symbol from the constants table
        let item_name = ITEM_NAMES[item_type as usize].to_string();
        let item_symbol = ITEM_SYMBOLS[item_type as usize].to_string();
        let item_uri = String::new();

        // Step 2: Create Metaplex metadata v3 for the NFT
        let metadata_account_infos = vec![
            ctx.accounts.metadata_account.to_account_info(),
            ctx.accounts.nft_mint.to_account_info(),
            ctx.accounts.nft_authority.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.nft_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ];

        let create_metadata_ix = mpl_token_metadata::instructions::CreateMetadataAccountV3Builder::new()
            .metadata(ctx.accounts.metadata_account.key())
            .mint(ctx.accounts.nft_mint.key())
            .mint_authority(ctx.accounts.nft_authority.key())
            .payer(ctx.accounts.payer.key())
            .update_authority(ctx.accounts.nft_authority.key(), true)
            .system_program(ctx.accounts.system_program.key())
            .rent(Some(ctx.accounts.rent.key()))
            .data(mpl_token_metadata::types::DataV2 {
                name: item_name,
                symbol: item_symbol,
                uri: item_uri,
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            })
            .is_mutable(true)
            .instruction();

        invoke_signed(&create_metadata_ix, &metadata_account_infos, &[nft_signer_seeds])?;

        // Step 3: Create master edition (max supply = 0 means unique)
        let edition_account_infos = vec![
            ctx.accounts.master_edition.to_account_info(),
            ctx.accounts.nft_mint.to_account_info(),
            ctx.accounts.nft_authority.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.metadata_account.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ];

        let create_edition_ix = mpl_token_metadata::instructions::CreateMasterEditionV3Builder::new()
            .edition(ctx.accounts.master_edition.key())
            .mint(ctx.accounts.nft_mint.key())
            .update_authority(ctx.accounts.nft_authority.key())
            .mint_authority(ctx.accounts.nft_authority.key())
            .payer(ctx.accounts.payer.key())
            .metadata(ctx.accounts.metadata_account.key())
            .token_program(ctx.accounts.token_program.key())
            .system_program(ctx.accounts.system_program.key())
            .rent(Some(ctx.accounts.rent.key()))
            .max_supply(0)
            .instruction();

        invoke_signed(&create_edition_ix, &edition_account_infos, &[nft_signer_seeds])?;

        // Step 4: Store the game-level item metadata PDA
        let item_meta = &mut ctx.accounts.item_metadata;
        item_meta.item_type = item_type;
        item_meta.owner = ctx.accounts.player.key();
        item_meta.mint = ctx.accounts.nft_mint.key();
        item_meta.bump = ctx.bumps.item_metadata;

        Ok(())
    }

    /// Burns an NFT item using the Metaplex BurnV1 instruction.
    /// CPI-gated: only the marketplace program can invoke this (for sell-to-game flow).
    /// Also closes the associated ItemMetadata PDA and returns rent to the player.
    pub fn burn_item(ctx: Context<BurnItem>) -> Result<()> {
        let nft_authority_bump = ctx.accounts.config.nft_authority_bump;
        let nft_signer_seeds: &[&[u8]] = &[b"nft_authority", &[nft_authority_bump]];

        // Collect all account infos required by the Metaplex burn instruction
        let burn_account_infos = vec![
            ctx.accounts.metadata_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.nft_mint.to_account_info(),
            ctx.accounts.player_nft_ata.to_account_info(),
            ctx.accounts.master_edition.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.sysvar_instructions.to_account_info(),
        ];

        // Build and invoke the Metaplex BurnV1 instruction with PDA signing
        let burn_instruction = mpl_token_metadata::instructions::BurnV1Builder::new()
            .authority(ctx.accounts.player.key())
            .metadata(ctx.accounts.metadata_account.key())
            .edition(Some(ctx.accounts.master_edition.key()))
            .mint(ctx.accounts.nft_mint.key())
            .token(ctx.accounts.player_nft_ata.key())
            .spl_token_program(ctx.accounts.token_program.key())
            .system_program(ctx.accounts.system_program.key())
            .sysvar_instructions(ctx.accounts.sysvar_instructions.key())
            .instruction();

        invoke_signed(&burn_instruction, &burn_account_infos, &[nft_signer_seeds])?;

        Ok(())
    }

    /// Transfers the on-chain ownership record in the ItemMetadata PDA to a new player.
    /// CPI-gated: only the marketplace program can invoke this (during buy flow).
    /// Does NOT move the actual NFT token — that is handled separately.
    pub fn transfer_item_ownership(
        ctx: Context<TransferItemOwnership>,
        new_owner: Pubkey,
    ) -> Result<()> {
        ctx.accounts.item_metadata.owner = new_owner;
        Ok(())
    }
}
