//! Core control page: restart or update the Hysteria core.

use vpn_proto::panel as pb;

use crate::ctx::{authed, Ctx};
use crate::ui;

pub fn page(ctx: &mut Ctx) {
    loop {
        match ui::menu("Core", &["Restart core", "Update core", "Back"]) {
            Some(0) => restart(ctx),
            Some(1) => update(ctx),
            _ => return,
        }
    }
}

fn restart(ctx: &mut Ctx) {
    if !matches!(ui::confirm("restart the Hysteria core now?"), Ok(true)) {
        return;
    }
    let Some(req) = ui::report(authed(pb::Empty {})) else { return };
    if ui::report(ctx.call(|mut c| async move { c.restart_core(req).await })).is_some() {
        ui::success("core restarted.");
    }
}

fn update(ctx: &mut Ctx) {
    if !matches!(ui::confirm("download the latest core, replace the binary, and restart?"), Ok(true))
    {
        return;
    }
    let Some(req) = ui::report(authed(pb::Empty {})) else { return };
    if let Some(resp) = ui::report(ctx.call(|mut c| async move { c.update_core(req).await })) {
        ui::success(format!("core updated to {}", resp.version));
    }
}
