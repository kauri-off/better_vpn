//! Client for the Hysteria 2 Traffic Stats API.
//!
//! Endpoints (see https://v2.hysteria.network/docs/advanced/Traffic-Stats-API/):
//!   GET  /traffic?clear=1  -> { "<id>": { "tx": N, "rx": N }, ... }
//!   GET  /online           -> { "<id>": <connections>, ... }
//!   POST /kick             body ["id1","id2"]
//!
//! When a secret is configured the `Authorization: <secret>` header is required.

use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Traffic {
    #[serde(default)]
    pub tx: i64,
    #[serde(default)]
    pub rx: i64,
}

#[derive(Clone)]
pub struct StatsClient {
    http: reqwest::Client,
    base: String,
    secret: String,
}

impl StatsClient {
    pub fn new(base: String, secret: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("reqwest client");
        Self { http, base: base.trim_end_matches('/').to_string(), secret }
    }

    fn req(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let b = self.http.request(method, format!("{}{}", self.base, path));
        if self.secret.is_empty() {
            b
        } else {
            b.header(reqwest::header::AUTHORIZATION, &self.secret)
        }
    }

    /// Fetch and (with `clear`) reset per-user traffic counters. Returns a map
    /// of Hysteria client id -> cumulative-since-last-clear bytes.
    pub async fn traffic(&self, clear: bool) -> anyhow::Result<HashMap<String, Traffic>> {
        let path = if clear { "/traffic?clear=1" } else { "/traffic" };
        let resp = self.req(reqwest::Method::GET, path).send().await?;
        let resp = resp.error_for_status()?;
        Ok(resp.json().await?)
    }

    /// Map of online client id -> number of connections (devices).
    pub async fn online(&self) -> anyhow::Result<HashMap<String, i32>> {
        let resp = self.req(reqwest::Method::GET, "/online").send().await?;
        let resp = resp.error_for_status()?;
        Ok(resp.json().await?)
    }

    /// Force-disconnect the given client ids. They may reconnect unless also
    /// disabled in the DB (which the auth backend then rejects).
    pub async fn kick(&self, ids: &[String]) -> anyhow::Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        self.req(reqwest::Method::POST, "/kick")
            .json(ids)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Lightweight liveness probe: is the stats API (hence the core) reachable?
    pub async fn is_alive(&self) -> bool {
        self.req(reqwest::Method::GET, "/online")
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}
