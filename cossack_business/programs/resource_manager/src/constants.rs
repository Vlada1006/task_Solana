/// Total number of distinct resource types in the Cossack Business game world.
/// Each resource has its own Token-2022 mint with on-chain metadata.
pub const RESOURCE_COUNT: usize = 6;

/// Human-readable display names for each of the six gatherable resources.
pub const RESOURCE_NAMES: [&str; RESOURCE_COUNT] =
    ["Wood", "Iron", "Gold", "Leather", "Stone", "Diamond"];

/// Ticker symbols used in the token metadata for each resource mint.
pub const RESOURCE_SYMBOLS: [&str; RESOURCE_COUNT] =
    ["WOOD", "IRON", "GOLD", "LEATHER", "STONE", "DIAMOND"];
