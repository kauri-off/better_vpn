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
    pub const ADMIN_TOKEN_HASH: &str = "admin_token_hash";
    pub const STATS_URL: &str = "stats_url";
    pub const CORE_CONFIG: &str = "core_config";
    pub const CORE_DOWNLOAD_URL: &str = "core_download_url";
    pub const SNI: &str = "sni";
    pub const POLL_INTERVAL_SECS: &str = "poll_interval_secs";
    pub const GRPC_ADDR: &str = "grpc_addr";
    pub const AUTH_ADDR: &str = "auth_addr";
    pub const CORE_SERVICE: &str = "core_service";
    pub const CORE_BIN: &str = "core_bin";
    /// Legacy key: the link port used to live here; now it is the core's `listen` port.
    pub const LEGACY_PORT: &str = "port";

    /// Keys accepted by `vpn-backend set`.
    pub const EDITABLE: &[&str] = &[
        SNI,
        STATS_URL,
        POLL_INTERVAL_SECS,
        GRPC_ADDR,
        AUTH_ADDR,
        CORE_SERVICE,
        CORE_BIN,
        CORE_CONFIG,
        CORE_DOWNLOAD_URL,
    ];
}

/// Connection info needed to build a hysteria2:// client URI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnInfo {
    pub address: String, // host:port
    pub sni: Option<String>,
    pub obfs_password: Option<String>,
    pub insecure: bool,
}
