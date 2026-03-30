pub mod initialize_game;
pub mod initialize_resource;
pub mod mint_resource;
pub mod burn_resource;
pub mod admin_only;

// Re-export all instruction account structs for convenient access from lib.rs
pub use initialize_game::*;
pub use initialize_resource::*;
pub use mint_resource::*;
pub use burn_resource::*;
pub use admin_only::*;
