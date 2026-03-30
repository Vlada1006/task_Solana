/// Total distinct resource types available in the game economy.
pub const RESOURCE_COUNT: usize = 6;

/// Crafting recipes table.
///
/// Each row specifies how many of each resource are consumed to produce
/// the corresponding item.  Resource order is:
///   Index 0 = WOOD, 1 = IRON, 2 = GOLD, 3 = LEATHER, 4 = STONE, 5 = DIAMOND
///
/// Items:
///   0 — Cossack Saber:   1 Wood, 3 Iron, 1 Leather
///   1 — Elder Staff:      2 Wood, 1 Gold, 1 Diamond
///   2 — Mage Armor:       2 Iron, 1 Gold, 4 Leather
///   3 — Battle Bracelet:  4 Iron, 2 Gold, 2 Diamond
pub const RECIPES: [[u8; RESOURCE_COUNT]; 4] = [
    [1, 3, 0, 1, 0, 0],
    [2, 0, 1, 0, 0, 1],
    [0, 2, 1, 4, 0, 0],
    [0, 4, 2, 0, 0, 2],
];
