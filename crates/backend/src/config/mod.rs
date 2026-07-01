//! Hysteria server config management: typed view of panel-managed fields,
//! YAML round-trip that preserves unknown/manual keys, validation, and
//! reassertion of the panel-required blocks.

pub mod manager;
pub mod model;

pub use manager::ConfigManager;
