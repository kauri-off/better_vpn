//! vpnctl — interactive console client for the better_vpn panel.
//!
//! Talks to the backend over gRPC (default http://127.0.0.1:50051). Safe to use
//! over SSH. Launches a nested `dialoguer` menu; on first use it prompts for the
//! admin login and stores a short-lived token that later sessions reuse.
//!
//! Endpoint resolution: `--server <url>` flag, else `$VPNCTL_ADDR`, else the
//! default above.

mod ctx;
mod fmt;
mod pages;
mod token_store;
mod ui;

use anyhow::Result;
use console::style;
use vpn_proto::panel as pb;

use ctx::{authed, Ctx};

const DEFAULT_ADDR: &str = "http://127.0.0.1:50051";

fn resolve_server() -> String {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if let Some(v) = arg.strip_prefix("--server=") {
            return v.to_string();
        }
        if arg == "--server" {
            if let Some(v) = args.next() {
                return v;
            }
        }
    }
    std::env::var("VPNCTL_ADDR").unwrap_or_else(|_| DEFAULT_ADDR.to_string())
}

fn main() -> Result<()> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let server = resolve_server();

    println!("{}", style(format!("better_vpn console — {server}")).bold());

    let mut ctx = match Ctx::connect(rt, server) {
        Ok(c) => c,
        Err(e) => {
            ui::error(format!("{e:#}"));
            std::process::exit(1);
        }
    };

    if let Err(e) = ctx.ensure_logged_in() {
        ui::error(format!("{e:#}"));
        std::process::exit(1);
    }

    main_menu(&mut ctx);
    println!("bye.");
    Ok(())
}

fn main_menu(ctx: &mut Ctx) {
    loop {
        let items = [
            "Users",
            "Stats",
            "Config",
            "Certificate",
            "Panel settings",
            "Core",
            "Whoami",
            "Quit",
        ];
        match ui::menu("Main menu", &items) {
            Some(0) => pages::users::page(ctx),
            Some(1) => pages::stats::page(ctx),
            Some(2) => pages::config::page(ctx),
            Some(3) => pages::cert::page(ctx),
            Some(4) => pages::settings::page(ctx),
            Some(5) => pages::core::page(ctx),
            Some(6) => whoami(ctx),
            _ => return,
        }
    }
}

fn whoami(ctx: &mut Ctx) {
    let Some(req) = ui::report(authed(pb::Empty {})) else { return };
    if let Some(a) = ui::report(ctx.call(|mut c| async move { c.who_am_i(req).await })) {
        ui::header("Whoami");
        println!("#{} {}  (since {})", a.id, a.username, fmt::ts(a.created_at));
        ui::pause();
    }
}
