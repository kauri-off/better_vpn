//! Typed query helpers. All take a `&mut DbConn`.

use crate::models::*;
use crate::schema::{online_state, settings, vpn_users};
use crate::{DbConn, DbError};
use chrono::{DateTime, Utc};
use diesel::prelude::*;

// ---------------- vpn users ----------------

pub fn list_users(
    conn: &mut DbConn,
    search: &str,
    limit: i64,
    offset: i64,
) -> Result<(Vec<VpnUser>, i64), DbError> {
    let pattern = format!("%{search}%");
    let mut q = vpn_users::table.into_boxed();
    let mut cq = vpn_users::table.into_boxed();
    if !search.is_empty() {
        q = q.filter(vpn_users::username.like(pattern.clone()));
        cq = cq.filter(vpn_users::username.like(pattern));
    }
    let total: i64 = cq.count().get_result(conn)?;
    let rows = q
        .order(vpn_users::id.asc())
        .limit(limit)
        .offset(offset)
        .select(VpnUser::as_select())
        .load(conn)?;
    Ok((rows, total))
}

pub fn user_by_id(conn: &mut DbConn, id: i32) -> Result<VpnUser, DbError> {
    vpn_users::table
        .find(id)
        .select(VpnUser::as_select())
        .first(conn)
        .optional()?
        .ok_or(DbError::NotFound)
}

pub fn user_by_username(conn: &mut DbConn, name: &str) -> Result<Option<VpnUser>, DbError> {
    Ok(vpn_users::table
        .filter(vpn_users::username.eq(name))
        .select(VpnUser::as_select())
        .first(conn)
        .optional()?)
}

/// Resolve a user by their plaintext auth token. Hot path for the Hysteria
/// auth endpoint.
pub fn user_by_token(conn: &mut DbConn, token: &str) -> Result<Option<VpnUser>, DbError> {
    Ok(vpn_users::table
        .filter(vpn_users::token.eq(token))
        .select(VpnUser::as_select())
        .first(conn)
        .optional()?)
}

pub fn create_user(conn: &mut DbConn, new: NewVpnUser<'_>) -> Result<VpnUser, DbError> {
    Ok(diesel::insert_into(vpn_users::table)
        .values(new)
        .returning(VpnUser::as_returning())
        .get_result(conn)?)
}

pub fn update_user(
    conn: &mut DbConn,
    id: i32,
    changes: VpnUserChanges,
) -> Result<VpnUser, DbError> {
    Ok(diesel::update(vpn_users::table.find(id))
        .set(changes)
        .returning(VpnUser::as_returning())
        .get_result(conn)?)
}

pub fn delete_user(conn: &mut DbConn, id: i32) -> Result<(), DbError> {
    diesel::delete(vpn_users::table.find(id)).execute(conn)?;
    Ok(())
}

/// Apply a traffic delta to a user's counters: the resettable `used_bytes`
/// (tx+rx, enforced against quota) plus the lifetime `total_tx`/`total_rx`
/// that survive quota resets and feed the all-time totals.
pub fn add_traffic(conn: &mut DbConn, id: i32, tx: i64, rx: i64) -> Result<(), DbError> {
    diesel::update(vpn_users::table.find(id))
        .set((
            vpn_users::used_bytes.eq(vpn_users::used_bytes + (tx + rx)),
            vpn_users::total_tx.eq(vpn_users::total_tx + tx),
            vpn_users::total_rx.eq(vpn_users::total_rx + rx),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn reset_usage(conn: &mut DbConn, id: i32) -> Result<VpnUser, DbError> {
    Ok(diesel::update(vpn_users::table.find(id))
        .set(vpn_users::used_bytes.eq(0))
        .returning(VpnUser::as_returning())
        .get_result(conn)?)
}

// ---------------- usage totals ----------------

/// All-time traffic totals across all users: (sum total_tx, sum total_rx).
/// Survives per-user quota resets, which only zero `vpn_users.used_bytes`.
/// The explicit CAST keeps the result typed as `BigInt` (i64) to match the
/// declared `sql::<BigInt>` type.
pub fn usage_totals(conn: &mut DbConn) -> Result<(i64, i64), DbError> {
    use diesel::dsl::sql;
    use diesel::sql_types::BigInt;
    let totals: (i64, i64) = vpn_users::table
        .select((
            sql::<BigInt>("CAST(COALESCE(SUM(total_tx), 0) AS BIGINT)"),
            sql::<BigInt>("CAST(COALESCE(SUM(total_rx), 0) AS BIGINT)"),
        ))
        .first(conn)?;
    Ok(totals)
}

// ---------------- online state ----------------

pub fn upsert_online(
    conn: &mut DbConn,
    user_id: i32,
    connections: i32,
    last_seen: Option<DateTime<Utc>>,
) -> Result<(), DbError> {
    diesel::insert_into(online_state::table)
        .values((
            online_state::user_id.eq(user_id),
            online_state::connections.eq(connections),
            online_state::last_seen.eq(last_seen),
        ))
        .on_conflict(online_state::user_id)
        .do_update()
        .set((
            online_state::connections.eq(connections),
            online_state::last_seen.eq(last_seen),
        ))
        .execute(conn)?;
    Ok(())
}

/// Set connection counts to zero for users not currently online.
pub fn clear_online_except(conn: &mut DbConn, keep: &[i32]) -> Result<(), DbError> {
    diesel::update(online_state::table.filter(online_state::user_id.ne_all(keep.to_vec())))
        .set(online_state::connections.eq(0))
        .execute(conn)?;
    Ok(())
}

pub fn online_for(conn: &mut DbConn, user_id: i32) -> Result<Option<OnlineState>, DbError> {
    Ok(online_state::table
        .find(user_id)
        .select(OnlineState::as_select())
        .first(conn)
        .optional()?)
}

pub fn online_count(conn: &mut DbConn) -> Result<i64, DbError> {
    Ok(online_state::table
        .filter(online_state::connections.gt(0))
        .count()
        .get_result(conn)?)
}

// ---------------- settings ----------------

pub fn get_setting(conn: &mut DbConn, key: &str) -> Result<Option<String>, DbError> {
    Ok(settings::table
        .find(key)
        .select(settings::value)
        .first::<String>(conn)
        .optional()?)
}

pub fn set_setting(conn: &mut DbConn, key: &str, value: &str) -> Result<(), DbError> {
    diesel::insert_into(settings::table)
        .values(Setting {
            key: key.to_string(),
            value: value.to_string(),
        })
        .on_conflict(settings::key)
        .do_update()
        .set(settings::value.eq(value))
        .execute(conn)?;
    Ok(())
}

pub fn all_settings(conn: &mut DbConn) -> Result<Vec<Setting>, DbError> {
    Ok(settings::table.select(Setting::as_select()).load(conn)?)
}
