//! Runtime settings stored in the `settings` DB table, with defaults so the
//! panel boots before any are set.

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

    pub fn default_for(key: &str) -> &'static str {
        match key {
            k::STATS_URL => "http://127.0.0.1:9999",
            k::CORE_CONFIG => "/etc/hysteria/config.yaml",
            k::POLL_INTERVAL_SECS => "10",
            k::GRPC_ADDR => "127.0.0.1:50051",
            k::AUTH_ADDR => "127.0.0.1:8080",
            k::CORE_SERVICE => "hysteria.service",
            k::CORE_BIN => "/var/lib/better_vpn/bin/hysteria",
            _ => "",
        }
    }

    pub fn get(pool: &DbPool, key: &str) -> String {
        Self::get_or(pool, key, Self::default_for(key))
    }

    /// Check an operator-supplied value for an editable key and return it trimmed.
    pub fn validate(key: &str, value: &str) -> Result<String, String> {
        let v = value.trim();
        if !k::EDITABLE.contains(&key) {
            return Err(format!("unknown setting `{key}`; known: {}", k::EDITABLE.join(", ")));
        }
        match key {
            k::POLL_INTERVAL_SECS => match v.parse::<u64>() {
                Ok(n) if n >= 2 => {}
                _ => return Err("poll_interval_secs must be an integer >= 2".into()),
            },
            k::GRPC_ADDR | k::AUTH_ADDR => {
                if v.parse::<std::net::SocketAddr>().is_err() {
                    return Err(format!("{key} must be an ip:port, e.g. 127.0.0.1:8080"));
                }
            }
            k::STATS_URL => {
                if !v.starts_with("http://") && !v.starts_with("https://") {
                    return Err("stats_url must start with http:// or https://".into());
                }
            }
            k::CORE_BIN | k::CORE_CONFIG => {
                if !v.starts_with('/') {
                    return Err(format!("{key} must be an absolute path"));
                }
            }
            k::CORE_SERVICE => {
                if v.is_empty() {
                    return Err("core_service must not be empty".into());
                }
            }
            _ => {}
        }
        Ok(v.to_string())
    }

    /// One-time migration: the link port used to be a DB setting; it is now the
    /// core's `listen` port. Move it into config.yaml and drop the key.
    pub fn migrate_legacy_port(pool: &DbPool) {
        let port = Self::get(pool, k::LEGACY_PORT);
        if port.is_empty() {
            return;
        }
        let mgr = crate::config::ConfigManager::new(Self::core_config(pool));
        if let Ok(sc) = mgr.structured_view() {
            let listen = crate::config::set_listen_port(&sc.listen, &port);
            if listen != sc.listen {
                let mut updated = sc.clone();
                updated.listen = listen;
                let managed = crate::managed::managed_blocks(pool);
                match mgr.apply_structured(&updated, &managed) {
                    Ok(_) => tracing::info!("moved legacy port setting {port} into config.yaml listen"),
                    Err(e) => {
                        tracing::warn!("could not move legacy port setting into config.yaml: {e}");
                        return;
                    }
                }
            }
        }
        if let Ok(mut conn) = pool.get() {
            let _ = queries::delete_setting(&mut conn, k::LEGACY_PORT);
        }
    }

    pub fn stats_url(pool: &DbPool) -> String {
        Self::get(pool, k::STATS_URL)
    }

    pub fn stats_secret(pool: &DbPool) -> String {
        Self::get(pool, k::STATS_SECRET)
    }

    /// Return the stats-API secret, generating and persisting one on first use.
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

    /// SHA-256 hex of the admin token; empty means the panel is locked.
    pub fn admin_token_hash(pool: &DbPool) -> String {
        Self::get(pool, k::ADMIN_TOKEN_HASH)
    }

    pub fn core_config(pool: &DbPool) -> String {
        Self::get(pool, k::CORE_CONFIG)
    }

    /// Empty => the latest release for the current architecture.
    pub fn core_download_url(pool: &DbPool) -> String {
        let url = Self::get(pool, k::CORE_DOWNLOAD_URL);
        if url.is_empty() {
            crate::hysteria::core::default_download_url()
        } else {
            url
        }
    }

    pub fn sni(pool: &DbPool) -> String {
        Self::get(pool, k::SNI)
    }

    pub fn poll_interval_secs(pool: &DbPool) -> u64 {
        Self::get(pool, k::POLL_INTERVAL_SECS).parse().unwrap_or(10)
    }

    /// Read once at startup.
    pub fn grpc_addr(pool: &DbPool) -> String {
        Self::get(pool, k::GRPC_ADDR)
    }

    /// Read once at startup; the managed `auth.http.url` is derived from it.
    pub fn auth_addr(pool: &DbPool) -> String {
        Self::get(pool, k::AUTH_ADDR)
    }

    /// If you change this, update deploy/polkit-better-vpn.rules to match.
    pub fn core_service(pool: &DbPool) -> String {
        Self::get(pool, k::CORE_SERVICE)
    }

    pub fn core_bin(pool: &DbPool) -> String {
        Self::get(pool, k::CORE_BIN)
    }
}
