//! Process-level configuration read from the environment at startup.

use anyhow::Context;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub database_url: String,
    /// gRPC + gRPC-Web management listener (fronted by Caddy).
    pub grpc_addr: String,
    /// Hysteria `auth.type: http` backend listener. Bind to localhost.
    pub auth_addr: String,
    /// Secret used to sign admin JWTs.
    pub jwt_secret: String,
    /// systemd unit name of the Hysteria core, restarted via `systemctl` when
    /// the panel applies config/cert changes.
    pub core_service: String,
    /// Path to the Hysteria core binary. Used to detect the running version and
    /// as the replace target for panel-driven core updates. Must live in a
    /// directory writable by the panel user (the default matches the systemd
    /// unit, deploy/hysteria.service).
    pub core_bin: String,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL")
            .context("DATABASE_URL is required (path to the sqlite db file, e.g. /var/lib/better_vpn/panel.db)")?;

        let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
            let s = vpn_common::token::generate_token();
            tracing::warn!(
                "JWT_SECRET not set; generated an ephemeral one. \
                 Existing admin sessions will be invalidated on restart. \
                 Set JWT_SECRET in production."
            );
            s
        });

        Ok(Self {
            database_url,
            grpc_addr: std::env::var("GRPC_ADDR").unwrap_or_else(|_| "127.0.0.1:50051".into()),
            auth_addr: std::env::var("AUTH_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into()),
            jwt_secret,
            core_service: std::env::var("CORE_SERVICE")
                .unwrap_or_else(|_| "hysteria.service".into()),
            core_bin: std::env::var("CORE_BIN")
                .unwrap_or_else(|_| "/var/lib/better_vpn/bin/hysteria".into()),
        })
    }
}
