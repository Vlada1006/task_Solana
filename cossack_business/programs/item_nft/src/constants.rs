use anchor_lang::prelude::*;

/// Total number of distinct craftable item types in the game.
pub const ITEM_COUNT: usize = 4;

/// Display names attached to each NFT item via Metaplex metadata.
pub const ITEM_NAMES: [&str; ITEM_COUNT] = [
    "Cossack Saber",
    "Elder Staff",
    "Mage Armor",
    "Battle Bracelet",
];

/// Short ticker symbols for each item type (used in Metaplex metadata).
pub const ITEM_SYMBOLS: [&str; ITEM_COUNT] = ["SABER", "STAFF", "ARMOR", "BRACLT"];

/// On-chain address of the Metaplex Token Metadata program.
pub const MPL_TOKEN_METADATA_ID: Pubkey =
    anchor_lang::pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
