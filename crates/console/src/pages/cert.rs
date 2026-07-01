//! Certificate page: inspect and (re)generate the self-signed TLS cert.

use vpn_proto::panel as pb;

use crate::ctx::{authed, Ctx};
use crate::{fmt, ui};

pub fn page(ctx: &mut Ctx) {
    loop {
        match ui::menu("Certificate", &["View info", "Generate new cert", "Back"]) {
            Some(0) => view(ctx),
            Some(1) => generate(ctx),
            _ => return,
        }
    }
}

fn view(ctx: &mut Ctx) {
    let Some(req) = ui::report(authed(pb::Empty {})) else { return };
    let Some(info) = ui::report(ctx.call(|mut c| async move { c.get_cert_info(req).await }))
    else {
        return;
    };
    ui::header("Certificate");
    fmt::print_cert(&info);
    ui::pause();
}

fn generate(ctx: &mut Ctx) {
    let Ok(common_name) = ui::input("common name (blank = default)") else { return };
    let Ok(sans_s) = ui::input("SANs, comma-separated (blank = none)") else { return };
    let sans: Vec<String> = sans_s
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    let Ok(days_s) = ui::input_default("validity days", "3650") else { return };
    let validity_days: i32 = match days_s.trim().parse() {
        Ok(n) => n,
        Err(_) => return ui::error(format!("invalid days: {days_s}")),
    };
    let Ok(cert_path) = ui::input("cert path (blank = default)") else { return };
    let Ok(key_path) = ui::input("key path (blank = default)") else { return };

    if !matches!(ui::confirm("generate and overwrite the current cert?"), Ok(true)) {
        return;
    }

    let msg = pb::GenerateCertRequest {
        common_name,
        sans,
        validity_days,
        cert_path,
        key_path,
    };
    let Some(req) = ui::report(authed(msg)) else { return };
    if let Some(info) = ui::report(ctx.call(|mut c| async move { c.generate_cert(req).await })) {
        ui::success("certificate generated. Restart the core to apply.");
        fmt::print_cert(&info);
        ui::pause();
    }
}
