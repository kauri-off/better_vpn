//! Diesel models (queryable rows + insertable/updatable structs).

use crate::schema::*;
use chrono::{DateTime, Utc};
use diesel::prelude::*;

#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = vpn_users)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct VpnUser {
    pub id: i32,
    pub username: String,
    pub enabled: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub quota_bytes: i64,
    pub used_bytes: i64,
    pub note: String,
    pub created_at: DateTime<Utc>,
    /// Plaintext auth token. Persisted so the panel can re-show the connection
    /// URI/QR, and used directly as the Hysteria auth lookup key.
    pub token: String,
    /// Lifetime uploaded/downloaded bytes. Unlike `used_bytes`, these are never
    /// zeroed by a quota reset and feed the panel's all-time traffic totals.
    pub total_tx: i64,
    pub total_rx: i64,
    /// Last time the stats poller saw this user online. NULL = never.
    pub last_seen: Option<DateTime<Utc>>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = vpn_users)]
pub struct NewVpnUser<'a> {
    pub username: &'a str,
    pub enabled: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub quota_bytes: i64,
    pub note: &'a str,
    pub token: &'a str,
}

#[derive(Debug, Default, AsChangeset)]
#[diesel(table_name = vpn_users)]
pub struct VpnUserChanges {
    pub enabled: Option<bool>,
    // Note: double Option lets us set the column to NULL (Some(None)) vs leave
    // it unchanged (None).
    pub expires_at: Option<Option<DateTime<Utc>>>,
    pub quota_bytes: Option<i64>,
    pub used_bytes: Option<i64>,
    pub note: Option<String>,
    pub token: Option<String>,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable)]
#[diesel(table_name = settings)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Setting {
    pub key: String,
    pub value: String,
}
