//! Panel settings page: view/edit the DB-backed link settings (port, sni).

use vpn_proto::panel as pb;

use crate::ctx::{authed, Ctx};
use crate::{fmt, ui};

pub fn page(ctx: &mut Ctx) {
    loop {
        match ui::menu("Panel settings", &["View", "Edit", "Back"]) {
            Some(0) => view(ctx),
            Some(1) => edit(ctx),
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
