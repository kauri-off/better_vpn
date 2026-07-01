//! Stats page: one-shot server stats with a manual refresh.

use vpn_proto::panel as pb;

use crate::ctx::{authed, Ctx};
use crate::{fmt, ui};

pub fn page(ctx: &mut Ctx) {
    loop {
        let Some(req) = ui::report(authed(pb::Empty {})) else {
            return;
        };
        let Some(s) = ui::report(ctx.call(|mut c| async move { c.get_server_stats(req).await }))
        else {
            return;
        };

        ui::header("Server stats");
        fmt::print_stats(&s);

        match ui::menu("", &["Refresh", "Back"]) {
            Some(0) => continue,
            _ => return,
        }
    }
}
