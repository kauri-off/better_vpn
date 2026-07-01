//! Runtime settings stored in the `settings` DB table (editable from the panel
//! and console) with sane defaults so the panel boots before they are set.

use vpn_common::settings_keys as k;
use vpn_db::{queries, DbPool};

pub struct Settings;

impl Settings {
    fn get_or(pool: &DbPool, key: &str, default: &str) -> String {
        let mut conn = match pool.get() {
            Ok(c) => c,
            Err(_) => return default.to_string(),
        };
        queries::get_setting(&mut conn, key)
            .ok()
            .flatten()
            .unwrap_or_else(|| default.to_string())
    }

    /// Base URL of the Hysteria Traffic Stats API, e.g. `http://127.0.0.1:9999`.
    pub fn stats_url(pool: &DbPool) -> String {
        Self::get_or(pool, k::STATS_URL, "http://127.0.0.1:9999")
    }

    /// Shared secret for the Traffic Stats API `Authorization` header.
    pub fn stats_secret(pool: &DbPool) -> String {
        Self::get_or(pool, k::STATS_SECRET, "")
    }

    /// Return the stats-API secret, generating and persisting one on first use.
    /// This is idempotent and self-healing: if the DB was unreachable at the
    /// boot-time seed attempt, the next caller retries instead of leaving the
    /// secret empty (which would bake a blank secret into the core config).
    /// Returns an empty string only if the DB is still unreachable.
    pub fn ensure_stats_secret(pool: &DbPool) -> String {
        let existing = Self::stats_secret(pool);
        if !existing.is_empty() {
            return existing;
        }
        let mut conn = match pool.get() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("could not get a DB connection to seed stats secret: {e}");
                return String::new();
            }
        };
        let secret = vpn_common::token::generate_token();
        match queries::set_setting(&mut conn, k::STATS_SECRET, &secret) {
            Ok(()) => {
                tracing::info!("generated a random stats-API secret");
                secret
            }
            Err(e) => {
                tracing::warn!("could not persist generated stats secret: {e}");
                String::new()
            }
        }
    }

    /// SHA-256 hash (hex) of the single admin access token, or an empty string
    /// when no token has been set yet (in which case the panel is locked and
    /// every authenticated RPC is rejected). Set via `admin set-token` or the
    /// `SetAdminToken` RPC; the plaintext token is never stored.
    pub fn admin_token_hash(pool: &DbPool) -> String {
        Self::get_or(pool, k::ADMIN_TOKEN_HASH, "")
    }

    pub fn core_config(pool: &DbPool) -> String {
        Self::get_or(pool, k::CORE_CONFIG, "/etc/hysteria/config.yaml")
    }

    /// Release asset URL the panel downloads when updating the core. Empty
    /// (the default) => the latest release for the current architecture.
    pub fn core_download_url(pool: &DbPool) -> String {
        let url = Self::get_or(pool, k::CORE_DOWNLOAD_URL, "");
        if url.is_empty() {
            crate::hysteria::core::default_download_url()
        } else {
            url
        }
    }

    /// Port clients dial. Empty by default; callers fall back to the core's
    /// listen port. The host half of the link comes from the panel URL.
    pub fn port(pool: &DbPool) -> String {
        Self::get_or(pool, k::PORT, "")
    }

    pub fn sni(pool: &DbPool) -> String {
        Self::get_or(pool, k::SNI, "")
    }

    pub fn poll_interval_secs(pool: &DbPool) -> u64 {
        Self::get_or(pool, k::POLL_INTERVAL_SECS, "10")
            .parse()
            .unwrap_or(10)
    }
}
