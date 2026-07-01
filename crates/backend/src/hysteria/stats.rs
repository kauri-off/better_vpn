//! Background poller: pulls traffic + online state from the Hysteria Traffic
//! Stats API, accumulates usage into Postgres, and enforces quota/expiry by
//! kicking offending clients.

use crate::settings::Settings;
use crate::state::AppState;
use std::time::Duration;
use vpn_db::queries;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        loop {
            let interval = Settings::poll_interval_secs(&state.pool).max(2);
            if let Err(e) = tick(&state).await {
                tracing::warn!("stats poll error: {e}");
            }
            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}

async fn tick(state: &AppState) -> anyhow::Result<()> {
    let client = state.stats_client();

    // 1. Traffic deltas (clear=1 so we accumulate since last poll).
    let traffic = client.traffic(true).await?;
    let online = client.online().await?;

    let mut to_kick: Vec<String> = Vec::new();
    let mut online_ids: Vec<i32> = Vec::new();

    {
        let mut conn = state.pool.get()?;

        for (username, t) in &traffic {
            let delta = t.tx.saturating_add(t.rx);
            if delta == 0 {
                continue;
            }
            let Some(user) = queries::user_by_username(&mut conn, username)? else {
                continue;
            };
            queries::add_traffic(&mut conn, user.id, t.tx, t.rx)?;
        }

        // 2. Online presence.
        let now = chrono::Utc::now();
        for (username, &connections) in &online {
            let Some(user) = queries::user_by_username(&mut conn, username)? else {
                continue;
            };
            queries::upsert_online(&mut conn, user.id, connections, Some(now))?;
            online_ids.push(user.id);

            // 3. Enforce expiry/quota on currently-online users.
            let expired = user.expires_at.map(|e| e <= now).unwrap_or(false);
            let over_quota = user.quota_bytes > 0 && user.used_bytes >= user.quota_bytes;
            if !user.enabled || expired || over_quota {
                to_kick.push(username.clone());
            }
        }

        // Zero out connection counts for users no longer reported online.
        queries::clear_online_except(&mut conn, &online_ids)?;
    }

    if !to_kick.is_empty() {
        tracing::info!("kicking {} client(s) over limit/disabled", to_kick.len());
        if let Err(e) = client.kick(&to_kick).await {
            tracing::warn!("kick failed: {e}");
        }
    }

    Ok(())
}
