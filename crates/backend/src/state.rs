//! Shared application state passed to the gRPC service, auth endpoint, and
//! background poller.

use crate::app_config::AppConfig;
use crate::auth::AuthKeys;
use crate::hysteria::client::StatsClient;
use crate::login_throttle::LoginThrottle;
use crate::settings::Settings;
use crate::sysmon::SysMonitor;
use std::sync::Arc;
use tokio::sync::RwLock;
use vpn_db::DbPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: DbPool,
    pub keys: AuthKeys,
    pub config: Arc<AppConfig>,
    pub sys: SysMonitor,
    /// Brute-force throttle for admin login (process-local).
    pub login_throttle: Arc<LoginThrottle>,
    /// Cached result of probing `<core_bin> version`. `None` => not yet probed
    /// (or invalidated after a restart/update); `Some("")` => probe failed, so
    /// we don't re-spawn the binary on every stats poll.
    core_version: Arc<RwLock<Option<String>>>,
}

impl AppState {
    pub fn new(pool: DbPool, config: AppConfig) -> Self {
        // Admin session signing secret, persisted in the DB and generated on
        // first run.
        let keys = AuthKeys::new(&Settings::ensure_jwt_secret(&pool));
        Self {
            pool,
            keys,
            config: Arc::new(config),
            sys: SysMonitor::new(),
            login_throttle: Arc::new(LoginThrottle::new()),
            core_version: Arc::new(RwLock::new(None)),
        }
    }

    /// The running core's version, detected by probing the binary and cached.
    /// Returns `""` when the binary is missing or doesn't report a version
    /// (the panel renders this as "version unknown").
    pub async fn core_version(&self) -> String {
        if let Some(v) = self.core_version.read().await.as_ref() {
            return v.clone();
        }
        let detected = crate::hysteria::core::detect_version(&self.config.core_bin)
            .await
            .unwrap_or_default();
        *self.core_version.write().await = Some(detected.clone());
        detected
    }

    /// Force a re-probe on the next `core_version()` call (after a core restart
    /// or update). `set` seeds a known value to skip the probe.
    pub async fn invalidate_core_version(&self) {
        *self.core_version.write().await = None;
    }

    pub async fn set_core_version(&self, version: String) {
        *self.core_version.write().await = Some(version);
    }

    /// Build a Traffic Stats API client from current settings.
    pub fn stats_client(&self) -> StatsClient {
        StatsClient::new(
            Settings::stats_url(&self.pool),
            Settings::stats_secret(&self.pool),
        )
    }
}
