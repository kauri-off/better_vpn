//! Builds the panel-managed config blocks (auth + trafficStats) that the panel
//! reasserts into the Hysteria config on every save and on startup.

use crate::config::model::ManagedBlocks;
use crate::settings::Settings;
use vpn_db::DbPool;

pub fn managed_blocks(pool: &DbPool) -> ManagedBlocks {
    ManagedBlocks {
        auth_url: format!("http://{}/auth", Settings::auth_addr(pool)),
        stats_listen: stats_listen_from_url(&Settings::stats_url(pool)),
        stats_secret: Settings::ensure_stats_secret(pool),
    }
}

/// Turn `http://127.0.0.1:9999` into the `host:port` form Hysteria listens on.
/// Any path/query/fragment is dropped: Hysteria's `trafficStats.listen` is a
/// bare `host:port`, so `http://127.0.0.1:9999/metrics` must still yield
/// `127.0.0.1:9999` rather than an unparseable value that breaks the core.
fn stats_listen_from_url(url: &str) -> String {
    let no_scheme = url
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://");
    // Cut at the first path/query/fragment delimiter.
    no_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_scheme_and_path() {
        assert_eq!(
            stats_listen_from_url("http://127.0.0.1:9999"),
            "127.0.0.1:9999"
        );
        assert_eq!(
            stats_listen_from_url("https://127.0.0.1:9999/"),
            "127.0.0.1:9999"
        );
        assert_eq!(
            stats_listen_from_url("http://127.0.0.1:9999/metrics"),
            "127.0.0.1:9999"
        );
        assert_eq!(
            stats_listen_from_url("127.0.0.1:9999/x?y#z"),
            "127.0.0.1:9999"
        );
    }
}
