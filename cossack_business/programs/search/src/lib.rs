use anchor_lang::prelude::*;
use resource_manager::{self as rm, cpi::accounts::MintResource};

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;

// Search — the main player-facing program that lets registered players
// forage for in-game resources.  Uses a cooldown timer and weighted
// randomness (admin-configured rarity weights) to select which resources
// drop each time.  Actual minting is delegated to resource_manager via CPI.
declare_id!("C1uqnbu6fqij8NPidvFMfks7A37x97M5xm9WYpyxRtWA");

#[program]
pub mod search {
    use super::*;

    /// Creates a fresh player PDA that tracks the wallet address and the
    /// last search timestamp (initially zero, meaning the first search
    /// is always allowed immediately).
    pub fn register_player(ctx: Context<RegisterPlayer>) -> Result<()> {
        let player_data = &mut ctx.accounts.player_account;
        player_data.owner = ctx.accounts.player.key();
        player_data.last_search_timestamp = 0;
        player_data.bump = ctx.bumps.player_account;
        Ok(())
    }

    /// Performs a resource search for the calling player.
    ///
    /// Enforces a configurable cooldown stored in the resource_manager
    /// `GameConfig`.  On success, generates 3 weighted-random resource IDs
    /// using on-chain slot data + player key as randomness, then mints one
    /// token of each chosen resource to the player through CPI.
    ///
    /// Remaining accounts layout (12 total):
    ///   [0..5]  — the 6 resource mint accounts
    ///   [6..11] — the corresponding player ATAs for each resource
    pub fn search_resources<'info>(
        ctx: Context<'_, '_, 'info, 'info, SearchResources<'info>>,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let player_data = &mut ctx.accounts.player_account;

        // ---- Cooldown enforcement ---- //
        let cooldown_seconds = ctx.accounts.game_config.search_cooldown;
        let time_since_last = clock
            .unix_timestamp
            .checked_sub(player_data.last_search_timestamp)
            .ok_or(SearchError::TimerOverflow)?;
        require!(time_since_last >= cooldown_seconds, SearchError::SearchCooldown);

        // ---- Build deterministic randomness from on-chain data ---- //
        let randomness_input = [
            clock.slot.to_le_bytes().as_ref(),
            clock.unix_timestamp.to_le_bytes().as_ref(),
            ctx.accounts.player.key().as_ref(),
        ]
        .concat();
        let random_hash = solana_program::hash::hashv(&[&randomness_input]);
        let drop_weights = ctx.accounts.game_config.rarity_weights;

        // ---- Prepare CPI signer seeds ---- //
        let caller_bump = ctx.bumps.caller_authority;
        let caller_pda_seeds: &[&[u8]] = &[b"caller_authority", &[caller_bump]];

        // Validate remaining accounts length
        let extra_accounts = ctx.remaining_accounts;
        require!(
            extra_accounts.len() == RESOURCE_COUNT * 2,
            SearchError::InvalidRemainingAccounts
        );

        // ---- Mint one token per search drop via CPI ---- //
        for drop_idx in 0..RESOURCES_PER_SEARCH {
            let resource_id = pick_weighted_resource(random_hash.to_bytes()[drop_idx], &drop_weights);
            let mint_acct_idx = resource_id as usize;
            let ata_acct_idx = RESOURCE_COUNT + resource_id as usize;

            rm::cpi::mint_resource(
                CpiContext::new_with_signer(
                    ctx.accounts.resource_manager_program.to_account_info(),
                    MintResource {
                        caller_authority: ctx.accounts.caller_authority.to_account_info(),
                        game_config: ctx.accounts.game_config.to_account_info(),
                        resource_mint: extra_accounts[mint_acct_idx].to_account_info(),
                        mint_authority: ctx.accounts.mint_authority.to_account_info(),
                        player_ata: extra_accounts[ata_acct_idx].to_account_info(),
                        token_program: ctx.accounts.token_program.to_account_info(),
                    },
                    &[caller_pda_seeds],
                ),
                resource_id,
                1,
            )?;
        }

        // Record the current timestamp so the cooldown restarts
        player_data.last_search_timestamp = clock.unix_timestamp;
        Ok(())
    }
}

/// Selects a resource ID by treating `rand_byte` mod 100 as a percentile roll
/// and walking through the cumulative weight distribution.
///
/// If the weights don't sum to 100 the function gracefully falls back to
/// resource 0 (the most common type).
fn pick_weighted_resource(rand_byte: u8, drop_weights: &[u8; 6]) -> u8 {
    let roll = rand_byte % 100;
    let mut running_total = 0u8;
    for (idx, &w) in drop_weights.iter().enumerate() {
        running_total = running_total.saturating_add(w);
        if roll < running_total {
            return idx as u8;
        }
    }
    // Fallback: if weights are misconfigured, default to the first resource
    0
}
