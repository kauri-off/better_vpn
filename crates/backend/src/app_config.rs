//! Process-level configuration read from the environment at startup.
//!
//! Only `DATABASE_URL` lives here: it is needed to reach the database before any
//! DB-backed setting can be read. Everything else (listener addresses, core
//! service/binary paths) is a runtime setting in the `settings` table, editable
//! with `vpn-backend set <key> <value>` — see [`crate::settings::Settings`].

use anyhow::Context;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub database_url: String,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL")
            .context("DATABASE_URL is required (path to the sqlite db file, e.g. /var/lib/better_vpn/panel.db)")?;

        Ok(Self { database_url })
    }
}
