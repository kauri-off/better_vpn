//! HTTP auth backend for Hysteria's `auth.type: http`.
//!
//! Hysteria POSTs `{ "addr": "ip:port", "auth": "<token>", "tx": <bytes/s> }`
//! on each new connection. We resolve the user by token hash and authorize
//! based on enabled / expiry / quota. A successful reply is
//! `200 { "ok": true, "id": "<username>" }`; the `id` becomes the key used by
//! the Traffic Stats API.

use crate::state::AppState;
use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use vpn_common::token::hash_token;
use vpn_db::queries;

#[derive(Debug, Deserialize)]
pub struct AuthRequest {
    #[allow(dead_code)]
    pub addr: String,
    pub auth: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub tx: i64,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub id: String,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/auth", post(handle_auth))
        .with_state(state)
}

async fn handle_auth(
    State(state): State<AppState>,
    Json(req): Json<AuthRequest>,
) -> Json<AuthResponse> {
    let deny = Json(AuthResponse {
        ok: false,
        id: String::new(),
    });

    let token_hash = hash_token(&req.auth);
    let mut conn = match state.pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("auth: db pool error: {e}");
            return deny;
        }
    };

    let user = match queries::user_by_token_hash(&mut conn, &token_hash) {
        Ok(Some(u)) => u,
        Ok(None) => return deny,
        Err(e) => {
            tracing::error!("auth: lookup error: {e}");
            return deny;
        }
    };

    if !user.enabled {
        return deny;
    }
    if let Some(exp) = user.expires_at {
        if exp <= chrono::Utc::now() {
            return deny;
        }
    }
    if user.quota_bytes > 0 && user.used_bytes >= user.quota_bytes {
        return deny;
    }

    Json(AuthResponse {
        ok: true,
        id: user.username,
    })
}
