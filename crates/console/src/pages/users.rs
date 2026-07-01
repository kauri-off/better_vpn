//! Users page: list/manage existing users and create new ones.

use qrcode::render::unicode;
use qrcode::QrCode;
use vpn_proto::panel as pb;

use crate::ctx::{authed, Ctx};
use crate::{fmt, ui};

pub fn page(ctx: &mut Ctx) {
    loop {
        match ui::menu("Users", &["List / manage", "Create user", "Back"]) {
            Some(0) => list(ctx),
            Some(1) => create(ctx),
            _ => return,
        }
    }
}

fn list(ctx: &mut Ctx) {
    let Ok(search) = ui::input("search (blank = all)") else {
        return;
    };
    let Some(req) = ui::report(authed(pb::ListUsersRequest {
        search,
        limit: 0,
        offset: 0,
    })) else {
        return;
    };
    let Some(resp) = ui::report(ctx.call(|mut c| async move { c.list_users(req).await })) else {
        return;
    };

    ui::header("Users");
    fmt::print_users(&resp.users);
    println!("total: {}", resp.total);

    if resp.users.is_empty() {
        ui::pause();
        return;
    }

    let mut labels: Vec<String> = resp
        .users
        .iter()
        .map(|u| {
            format!(
                "#{} {} — {}",
                u.id,
                u.username,
                if u.enabled { "enabled" } else { "disabled" }
            )
        })
        .collect();
    labels.push("Back".into());
    let refs: Vec<&str> = labels.iter().map(String::as_str).collect();

    if let Some(i) = ui::menu("Select a user to manage", &refs) {
        if let Some(u) = resp.users.get(i) {
            detail(ctx, u.id);
        }
    }
}

fn detail(ctx: &mut Ctx, id: i32) {
    loop {
        let Some(req) = ui::report(authed(pb::GetUserRequest {
            id,
            link_host: String::new(),
        })) else {
            return;
        };
        let Some(u) = ui::report(ctx.call(|mut c| async move { c.get_user(req).await })) else {
            return;
        };

        ui::header(&format!("User #{} {}", u.id, u.username));
        fmt::print_user_detail(&u);

        let toggle = if u.enabled { "Disable" } else { "Enable" };
        let items = [
            toggle,
            "Edit (expires / quota / note)",
            "Show share URI + QR",
            "Reset usage",
            "Kick",
            "Delete",
            "Back",
        ];
        match ui::menu("Action", &items) {
            Some(0) => set_enabled(ctx, id, !u.enabled),
            Some(1) => edit(ctx, id),
            Some(2) => share(ctx, id),
            Some(3) => reset(ctx, id),
            Some(4) => kick(ctx, id),
            Some(5) => {
                if delete(ctx, id) {
                    return;
                }
            }
            _ => return,
        }
    }
}

fn set_enabled(ctx: &mut Ctx, id: i32, enabled: bool) {
    let msg = pb::UpdateUserRequest {
        id,
        enabled: Some(enabled),
        expires_at: None,
        quota_bytes: None,
        note: None,
    };
    let Some(req) = ui::report(authed(msg)) else {
        return;
    };
    if ui::report(ctx.call(|mut c| async move { c.update_user(req).await })).is_some() {
        ui::success(format!(
            "user #{id} {}",
            if enabled { "enabled" } else { "disabled" }
        ));
    }
}

fn edit(ctx: &mut Ctx, id: i32) {
    let Ok(expires_s) = ui::input("expires (blank = unchanged; never / <N>d / timestamp)") else {
        return;
    };
    let expires_at = match parse_opt(&expires_s, fmt::parse_expires) {
        Ok(v) => v,
        Err(e) => return ui::error(e),
    };

    let Ok(quota_s) = ui::input("quota (blank = unchanged; 0 / 50G / 500M)") else {
        return;
    };
    let quota_bytes = match parse_opt(&quota_s, fmt::parse_bytes) {
        Ok(v) => v,
        Err(e) => return ui::error(e),
    };

    let Ok(note_s) = ui::input("note (blank = unchanged)") else {
        return;
    };
    let note = if note_s.trim().is_empty() {
        None
    } else {
        Some(note_s)
    };

    if expires_at.is_none() && quota_bytes.is_none() && note.is_none() {
        println!("nothing to change.");
        return;
    }

    let msg = pb::UpdateUserRequest {
        id,
        enabled: None,
        expires_at,
        quota_bytes,
        note,
    };
    let Some(req) = ui::report(authed(msg)) else {
        return;
    };
    if let Some(u) = ui::report(ctx.call(|mut c| async move { c.update_user(req).await })) {
        ui::success(format!("updated user #{} '{}'", u.id, u.username));
    }
}

fn reset(ctx: &mut Ctx, id: i32) {
    if !matches!(
        ui::confirm(&format!("reset usage counter for #{id}?")),
        Ok(true)
    ) {
        return;
    }
    let Some(req) = ui::report(authed(pb::GetUserRequest {
        id,
        link_host: String::new(),
    })) else {
        return;
    };
    if let Some(u) = ui::report(ctx.call(|mut c| async move { c.reset_user_usage(req).await })) {
        ui::success(format!("reset usage for #{} '{}'", u.id, u.username));
    }
}

fn kick(ctx: &mut Ctx, id: i32) {
    if !matches!(
        ui::confirm(&format!("kick active sessions for #{id}?")),
        Ok(true)
    ) {
        return;
    }
    let Some(req) = ui::report(authed(pb::GetUserRequest {
        id,
        link_host: String::new(),
    })) else {
        return;
    };
    if ui::report(ctx.call(|mut c| async move { c.kick_user(req).await })).is_some() {
        ui::success(format!("kicked user #{id}"));
    }
}

/// Returns true if the user was deleted (so the detail loop should exit).
fn delete(ctx: &mut Ctx, id: i32) -> bool {
    if !matches!(
        ui::confirm(&format!("permanently delete user #{id}?")),
        Ok(true)
    ) {
        return false;
    }
    let Some(req) = ui::report(authed(pb::GetUserRequest {
        id,
        link_host: String::new(),
    })) else {
        return false;
    };
    if ui::report(ctx.call(|mut c| async move { c.delete_user(req).await })).is_some() {
        ui::success(format!("deleted user #{id}"));
        return true;
    }
    false
}

fn share(ctx: &mut Ctx, id: i32) {
    let Some(req) = ui::report(authed(pb::GetUserRequest {
        id,
        link_host: String::new(),
    })) else {
        return;
    };
    let Some(cfg) = ui::report(ctx.call(|mut c| async move { c.get_user_config(req).await }))
    else {
        return;
    };
    if cfg.connection_uri.is_empty() {
        println!(
            "no stored token for '{}' (legacy user); nothing to share.",
            cfg.username
        );
        ui::pause();
        return;
    }
    show_connection(&cfg.username, &cfg.auth_token, &cfg.connection_uri);
}

fn create(ctx: &mut Ctx) {
    let Ok(username) = ui::input_required("username") else {
        return;
    };
    let Ok(expires_s) = ui::input_default("expires (never / <N>d / timestamp)", "never") else {
        return;
    };
    let expires_at = match fmt::parse_expires(&expires_s) {
        Ok(v) => v,
        Err(e) => return ui::error(e),
    };
    let Ok(quota_s) = ui::input_default("quota (0 = unlimited, e.g. 50G)", "0") else {
        return;
    };
    let quota_bytes = match fmt::parse_bytes(&quota_s) {
        Ok(v) => v,
        Err(e) => return ui::error(e),
    };
    let Ok(note) = ui::input("note (optional)") else {
        return;
    };
    let Ok(enabled) = ui::confirm_default("enabled?", true) else {
        return;
    };

    let msg = pb::CreateUserRequest {
        username,
        expires_at,
        quota_bytes,
        note,
        enabled,
        link_host: String::new(),
    };
    let Some(req) = ui::report(authed(msg)) else {
        return;
    };
    let Some(resp) = ui::report(ctx.call(|mut c| async move { c.create_user(req).await })) else {
        return;
    };

    let u = resp.user.unwrap_or_default();
    ui::success(format!("created user #{} '{}'", u.id, u.username));
    show_connection(&u.username, &resp.auth_token, &resp.connection_uri);
    println!("(the token is shown once; store it now)");
}

/// Print a user's auth token + connection URI and render the URI as a QR code.
fn show_connection(username: &str, token: &str, uri: &str) {
    println!("user       : {username}");
    if !token.is_empty() {
        println!("auth token : {token}");
    }
    println!("connect URI: {uri}");
    match QrCode::new(uri.as_bytes()) {
        Ok(code) => {
            // Inverted colours so the QR scans against a dark terminal background.
            let img = code
                .render::<unicode::Dense1x2>()
                .dark_color(unicode::Dense1x2::Light)
                .light_color(unicode::Dense1x2::Dark)
                .quiet_zone(true)
                .build();
            println!("{img}");
        }
        Err(e) => ui::error(format!("could not render QR: {e}")),
    }
    ui::pause();
}

/// Parse an optional field: blank → `None`, else run `f` and wrap in `Some`.
fn parse_opt<F>(s: &str, f: F) -> anyhow::Result<Option<i64>>
where
    F: FnOnce(&str) -> anyhow::Result<i64>,
{
    if s.trim().is_empty() {
        Ok(None)
    } else {
        f(s).map(Some)
    }
}
