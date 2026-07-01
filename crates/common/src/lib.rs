//! Small shared helpers used by more than one crate.

pub mod token;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommonError {
    #[error("invalid token")]
    InvalidToken,
}

/// Settings keys persisted in the `settings` table.
pub mod settings_keys {
    pub const STATS_SECRET: &str = "stats_secret";
    // Admin session (JWT) signing secret. Generated and persisted on first run
    // unless overridden by the JWT_SECRET env var.
    pub const JWT_SECRET: &str = "jwt_secret";
    pub const STATS_URL: &str = "stats_url";
    pub const CORE_CONFIG: &str = "core_config";
    // Optional override of the core release asset URL for panel-driven updates.
    pub const CORE_DOWNLOAD_URL: &str = "core_download_url";
    pub const PORT: &str = "port"; // port for client URIs (host comes from the panel URL)
    pub const SNI: &str = "sni";
    pub const POLL_INTERVAL_SECS: &str = "poll_interval_secs";
}

/// Connection info needed to build a hysteria2:// client URI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnInfo {
    pub address: String, // host:port
    pub sni: Option<String>,
    pub obfs_password: Option<String>,
    pub insecure: bool,
}
