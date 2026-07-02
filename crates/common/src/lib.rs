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
    // SHA-256 hash (hex) of the single admin access token. The token itself is
    // never stored. Empty/absent => the panel is locked (no valid token) until
    // `vpn-backend admin set-token` is run.
    pub const ADMIN_TOKEN_HASH: &str = "admin_token_hash";
    pub const STATS_URL: &str = "stats_url";
    pub const CORE_CONFIG: &str = "core_config";
    // Optional override of the core release asset URL for panel-driven updates.
    pub const CORE_DOWNLOAD_URL: &str = "core_download_url";
    pub const PORT: &str = "port"; // port for client URIs (host comes from the panel URL)
    pub const SNI: &str = "sni";
    pub const POLL_INTERVAL_SECS: &str = "poll_interval_secs";
    // gRPC + gRPC-Web management listener (fronted by Caddy). Read once at startup.
    pub const GRPC_ADDR: &str = "grpc_addr";
    // Hysteria `auth.type: http` backend listener. Authoritative source for the
    // core's `auth.http.url`, which the panel derives from this on every save.
    pub const AUTH_ADDR: &str = "auth_addr";
    // systemd unit of the Hysteria core, restarted via `systemctl` on config/cert changes.
    pub const CORE_SERVICE: &str = "core_service";
    // Path to the Hysteria core binary (version probe + panel-driven update target).
    pub const CORE_BIN: &str = "core_bin";
}

/// Connection info needed to build a hysteria2:// client URI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnInfo {
    pub address: String, // host:port
    pub sni: Option<String>,
    pub obfs_password: Option<String>,
    pub insecure: bool,
}
