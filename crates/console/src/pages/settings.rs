//! Panel settings page: view/edit the DB-backed link settings (port, sni).

use vpn_proto::panel as pb;

use crate::ctx::{authed, Ctx};
use crate::{fmt, token_store, ui};

pub fn page(ctx: &mut Ctx) {
    loop {
        match ui::menu(
            "Panel settings",
            &["View", "Edit", "Change admin token", "Back"],
        ) {
            Some(0) => view(ctx),
            Some(1) => edit(ctx),
            Some(2) => change_token(ctx),
            _ => return,
        }
    }
}

fn view(ctx: &mut Ctx) {
    let Some(req) = ui::report(authed(pb::Empty {})) else {
        return;
    };
    let Some(s) = ui::report(ctx.call(|mut c| async move { c.get_settings(req).await })) else {
        return;
    };
    ui::header("Panel settings");
    fmt::print_settings(&s);
    ui::pause();
}

fn edit(ctx: &mut Ctx) {
    let Some(req) = ui::report(authed(pb::Empty {})) else {
        return;
    };
    let Some(cur) = ui::report(ctx.call(|mut c| async move { c.get_settings(req).await })) else {
        return;
    };

    let Ok(port) = ui::input_default("port (blank = core listen port)", &cur.port) else {
        return;
    };
    let Ok(sni) = ui::input_default("sni (blank = none)", &cur.sni) else {
        return;
    };

    let Some(req) = ui::report(authed(pb::PanelSettings { port, sni })) else {
        return;
    };
    if let Some(s) = ui::report(ctx.call(|mut c| async move { c.update_settings(req).await })) {
        ui::success("settings updated.");
        fmt::print_settings(&s);
    }
}

fn change_token(ctx: &mut Ctx) {
    ui::header("Change admin token");
    println!("Rotating the token logs out every other session. Blank = generate a random one.");
    let Ok(token) = ui::password("new token (blank = generate)") else {
        return;
    };
    if !token.is_empty() {
        let Ok(confirm) = ui::password("confirm new token") else {
            return;
        };
        if confirm != token {
            ui::error("tokens do not match; aborted.");
            return;
        }
    }
    let Some(req) = ui::report(authed(pb::SetAdminTokenRequest { token })) else {
        return;
    };
    if let Some(resp) = ui::report(ctx.call(|mut c| async move { c.set_admin_token(req).await })) {
        // Persist the new token so THIS session keeps working after the rotation.
        if let Err(e) = token_store::save(&resp.token) {
            ui::error(format!(
                "token changed but could not store it locally: {e:#}"
            ));
        }
        ui::success("admin token changed; stored for this session.");
        println!("\n    {}\n", resp.token);
        println!("Store it now — it is not recoverable. Other sessions must log in again.");
        ui::pause();
    }
}
