//! Shared application state passed to the gRPC service, auth endpoint, and
//! background poller.

use crate::hysteria::client::StatsClient;
use crate::login_throttle::LoginThrottle;
use crate::settings::Settings;
use crate::sysmon::SysMonitor;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use vpn_db::DbPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: DbPool,
    pub sys: SysMonitor,
    /// Brute-force throttle for admin login (process-local).
    pub login_throttle: Arc<LoginThrottle>,
    /// Cached result of probing `<core_bin> version`. `None` => not yet probed
    /// (or invalidated after a restart/update); `Some("")` => probe failed, so
    /// we don't re-spawn the binary on every stats poll.
    core_version: Arc<RwLock<Option<String>>>,
    /// user_id -> live connection count. Replaced wholesale by the stats poller
    /// each tick, so readers only ever see a complete snapshot. std (not tokio)
    /// lock: it is never held across an await.
    online: Arc<std::sync::RwLock<HashMap<i32, i32>>>,
}

impl AppState {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            sys: SysMonitor::new(),
            login_throttle: Arc::new(LoginThrottle::new()),
            core_version: Arc::new(RwLock::new(None)),
            online: Arc::new(std::sync::RwLock::new(HashMap::new())),
        }
    }

    /// Replace the online snapshot with this tick's poll result.
    pub fn set_online(&self, map: HashMap<i32, i32>) {
        *self.online.write().unwrap() = map;
    }

    /// Live connection count for a user (0 = offline).
    pub fn connections_for(&self, user_id: i32) -> i32 {
        self.online
            .read()
            .unwrap()
            .get(&user_id)
            .copied()
            .unwrap_or(0)
    }

    /// Number of users currently online.
    pub fn online_count(&self) -> i32 {
        self.online
            .read()
            .unwrap()
            .values()
            .filter(|&&c| c > 0)
            .count() as i32
    }

    /// The running core's version, detected by probing the binary and cached.
    /// Returns `""` when the binary is missing or doesn't report a version
    /// (the panel renders this as "version unknown").
    pub async fn core_version(&self) -> String {
        if let Some(v) = self.core_version.read().await.as_ref() {
            return v.clone();
        }
        let detected = crate::hysteria::core::detect_version(&Settings::core_bin(&self.pool))
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
