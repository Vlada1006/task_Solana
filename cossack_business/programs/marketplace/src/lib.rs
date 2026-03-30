use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
pub use state::*;

// Marketplace — enables players to trade NFT items for MagicToken currency.
// Supports four operations:
//   1. sell_item  — immediate sale to the game (burn NFT, receive MagicToken)
//   2. list_item  — escrow-based P2P listing
//   3. buy_item   — purchase a listed item (MagicToken to seller, NFT to buyer)
//   4. delist_item — cancel a listing, return NFT from escrow
declare_id!("91mqUcMbs89f8CDoG1mBWKyeC1FbPSFAdhcE8yD5DQdC");

#[program]
pub mod marketplace {
    use super::*;

    /// Sells an item directly to the game at the admin-configured fixed price.
    ///
    /// Flow:
    /// 1. Look up the price from `GameConfig.item_prices[item_type]`.
    /// 2. Burn the player's NFT via CPI to `item_nft::burn_item`.
    /// 3. Mint the corresponding amount of MagicToken to the seller
    ///    via CPI to `magic_token::mint_magic_token`.
    ///
    /// Remaining accounts (4):
    ///   [metadata_account, master_edition, metadata_program, sysvar_instructions]
    pub fn sell_item<'info>(
        ctx: Context<'_, '_, 'info, 'info, SellItem<'info>>,
    ) -> Result<()> {
        let item_type = ctx.accounts.item_metadata.item_type;
        require!(
            (item_type as usize) < ctx.accounts.game_config.item_prices.len(),
            MarketError::InvalidItemType
        );
        let sale_price = ctx.accounts.game_config.item_prices[item_type as usize];

        // Prepare CPI signer seeds
        let caller_bump = ctx.bumps.caller_authority;
        let caller_pda_seeds: &[&[u8]] = &[b"caller_authority", &[caller_bump]];

        // Unpack the Metaplex-related accounts from remaining_accounts
        let extra_accounts = ctx.remaining_accounts;
        require!(extra_accounts.len() >= 4, MarketError::InvalidRemainingAccounts);

        let metadata_account = extra_accounts[0].to_account_info();
        let master_edition = extra_accounts[1].to_account_info();
        let metadata_program = extra_accounts[2].to_account_info();
        let sysvar_instructions = extra_accounts[3].to_account_info();

        // Step 1: Burn the NFT through item_nft CPI
        item_nft::cpi::burn_item(
            CpiContext::new_with_signer(
                ctx.accounts.item_nft_program.to_account_info(),
                item_nft::cpi::accounts::BurnItem {
                    caller_authority: ctx.accounts.caller_authority.to_account_info(),
                    config: ctx.accounts.item_nft_config.to_account_info(),
                    player: ctx.accounts.seller.to_account_info(),
                    item_metadata: ctx.accounts.item_metadata.to_account_info(),
                    nft_mint: ctx.accounts.nft_mint.to_account_info(),
                    player_nft_ata: ctx.accounts.seller_nft_ata.to_account_info(),
                    metadata_account,
                    master_edition,
                    metadata_program,
                    sysvar_instructions,
                    token_program: ctx.accounts.token_program.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                &[caller_pda_seeds],
            ),
        )?;

        // Step 2: Mint MagicToken as payment to the seller
        magic_token::cpi::mint_magic_token(
            CpiContext::new_with_signer(
                ctx.accounts.magic_token_program.to_account_info(),
                magic_token::cpi::accounts::MintMagicToken {
                    caller_authority: ctx.accounts.caller_authority.to_account_info(),
                    config: ctx.accounts.magic_token_config.to_account_info(),
                    mint: ctx.accounts.magic_token_mint.to_account_info(),
                    mint_authority: ctx.accounts.magic_mint_authority.to_account_info(),
                    recipient_ata: ctx.accounts.seller_magic_ata.to_account_info(),
                    token_program: ctx.accounts.token_2022_program.to_account_info(),
                },
                &[caller_pda_seeds],
            ),
            sale_price,
        )?;

        Ok(())
    }

    /// Lists an NFT for sale on the peer-to-peer marketplace.
    ///
    /// The NFT is transferred from the seller's ATA to an escrow ATA controlled
    /// by a PDA, and a `Listing` record is created that stores the sale price.
    /// Price must be greater than zero.
    pub fn list_item(ctx: Context<ListItem>, price: u64) -> Result<()> {
        require!(price > 0, MarketError::InvalidPrice);

        // Transfer the NFT to escrow
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_nft_ata.to_account_info(),
                    to: ctx.accounts.escrow_nft_ata.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            1,
        )?;

        // Populate the listing account with sale details
        let listing_record = &mut ctx.accounts.listing;
        listing_record.seller = ctx.accounts.seller.key();
        listing_record.item_mint = ctx.accounts.nft_mint.key();
        listing_record.item_type = ctx.accounts.item_metadata.item_type;
        listing_record.price = price;
        listing_record.bump = ctx.bumps.listing;
        listing_record.escrow_bump = ctx.bumps.escrow_authority;

        Ok(())
    }

    /// Purchases a listed item from another player.
    ///
    /// Flow:
    /// 1. Transfer MagicToken from buyer to seller (payment).
    /// 2. Transfer the escrowed NFT from the escrow ATA to the buyer's ATA.
    /// 3. Update the on-chain item ownership via `item_nft::transfer_item_ownership`.
    /// 4. The listing PDA is closed and rent returned to the seller.
    pub fn buy_item(ctx: Context<BuyItem>) -> Result<()> {
        let listed_price = ctx.accounts.listing.price;
        let listed_mint = ctx.accounts.listing.item_mint;
        let escrow_bump = ctx.accounts.listing.escrow_bump;

        // Step 1: Transfer MagicToken from buyer → seller
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_2022_program.to_account_info(),
                anchor_spl::token_2022::TransferChecked {
                    from: ctx.accounts.buyer_magic_ata.to_account_info(),
                    mint: ctx.accounts.magic_token_mint.to_account_info(),
                    to: ctx.accounts.seller_magic_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            listed_price,
            0,
        )?;

        // Step 2: Release NFT from escrow to the buyer
        let escrow_pda_seeds: &[&[u8]] = &[b"escrow", listed_mint.as_ref(), &[escrow_bump]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_nft_ata.to_account_info(),
                    to: ctx.accounts.buyer_nft_ata.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                },
                &[escrow_pda_seeds],
            ),
            1,
        )?;

        // Step 3: Update the ItemMetadata owner to reflect the new holder
        let caller_bump = ctx.bumps.caller_authority;
        let caller_pda_seeds: &[&[u8]] = &[b"caller_authority", &[caller_bump]];

        item_nft::cpi::transfer_item_ownership(
            CpiContext::new_with_signer(
                ctx.accounts.item_nft_program.to_account_info(),
                item_nft::cpi::accounts::TransferItemOwnership {
                    caller_authority: ctx.accounts.caller_authority.to_account_info(),
                    config: ctx.accounts.item_nft_config.to_account_info(),
                    item_metadata: ctx.accounts.item_metadata.to_account_info(),
                },
                &[caller_pda_seeds],
            ),
            ctx.accounts.buyer.key(),
        )?;

        Ok(())
    }

    /// Cancels an active listing and returns the NFT from escrow to the seller.
    /// Only the original seller can delist.  The Listing PDA is closed and
    /// its rent returned to the seller.
    pub fn delist_item(ctx: Context<DelistItem>) -> Result<()> {
        let listed_mint = ctx.accounts.listing.item_mint;
        let escrow_bump = ctx.accounts.listing.escrow_bump;

        let escrow_pda_seeds: &[&[u8]] = &[b"escrow", listed_mint.as_ref(), &[escrow_bump]];

        // Return the NFT from escrow to the seller's wallet
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_nft_ata.to_account_info(),
                    to: ctx.accounts.seller_nft_ata.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                },
                &[escrow_pda_seeds],
            ),
            1,
        )?;

        Ok(())
    }
}
