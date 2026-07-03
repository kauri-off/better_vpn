//! Config page: view/edit the panel-managed Hysteria config.

use vpn_proto::panel as pb;

use crate::ctx::{authed, Ctx};
use crate::{fmt, ui};

pub fn page(ctx: &mut Ctx) {
    loop {
        let items = [
            "View summary",
            "View raw YAML",
            "Edit fields",
            "Replace raw YAML from file",
            "Back",
        ];
        match ui::menu("Config", &items) {
            Some(0) => view(ctx, false),
            Some(1) => view(ctx, true),
            Some(2) => edit(ctx),
            Some(3) => set_raw(ctx),
            _ => return,
        }
    }
}

fn view(ctx: &mut Ctx, raw: bool) {
    let Some(req) = ui::report(authed(pb::Empty {})) else {
        return;
    };
    let Some(c) = ui::report(ctx.call(|mut c| async move { c.get_config(req).await })) else {
        return;
    };
    ui::header("Config");
    if raw {
        println!("{}", c.raw_yaml);
    } else if let Some(s) = &c.structured {
        fmt::print_structured(s);
    } else {
        println!("(no structured view available)");
    }
    ui::pause();
}

fn edit(ctx: &mut Ctx) {
    // Start from the current structured view so untouched fields round-trip.
    let Some(req) = ui::report(authed(pb::Empty {})) else {
        return;
    };
    let Some(c) = ui::report(ctx.call(|mut c| async move { c.get_config(req).await })) else {
        return;
    };
    let mut s = c.structured.unwrap_or_default();

    let Ok(listen) = ui::input_default("listen", &s.listen) else {
        return;
    };
    s.listen = listen;

    // tls
    let mut tls = s.tls.clone().unwrap_or_default();
    let Ok(cert) = ui::input_default("tls cert path", &tls.cert) else {
        return;
    };
    let Ok(key) = ui::input_default("tls key path", &tls.key) else {
        return;
    };
    tls.cert = cert;
    tls.key = key;
    s.tls = Some(tls);

    // obfs
    let mut obfs = s.obfs.clone().unwrap_or_default();
    let Ok(otype) = ui::input_default("obfs type (blank = off; salamander)", &obfs.r#type) else {
        return;
    };
    obfs.r#type = otype.trim().to_string();
    if !obfs.r#type.is_empty() {
        let Ok(pw) = ui::input_default("obfs password", &obfs.password) else {
            return;
        };
        obfs.password = pw;
    } else {
        obfs.password.clear();
    }
    s.obfs = Some(obfs);

    // bandwidth
    let mut bw = s.bandwidth.clone().unwrap_or_default();
    let Ok(up) = ui::input_default("bandwidth up (e.g. 100 mbps, blank = none)", &bw.up) else {
        return;
    };
    let Ok(down) = ui::input_default("bandwidth down", &bw.down) else {
        return;
    };
    bw.up = up;
    bw.down = down;
    s.bandwidth = Some(bw);

    // masquerade
    let mut mq = s.masquerade.clone().unwrap_or_default();
    let Ok(mtype) = ui::input_default(
        "masquerade type (blank / proxy / string / file)",
        &mq.r#type,
    ) else {
        return;
    };
    mq.r#type = mtype.trim().to_string();
    match mq.r#type.as_str() {
        "proxy" => {
            let Ok(url) = ui::input_default("masquerade proxy url", &mq.proxy_url) else {
                return;
            };
            mq.proxy_url = url;
        }
        "string" => {
            let Ok(content) = ui::input_default("masquerade string content", &mq.string_content)
            else {
                return;
            };
            mq.string_content = content;
        }
        _ => {}
    }
    s.masquerade = Some(mq);

    // acl (inline rules; ';' separator since rules contain commas)
    let acl = s.acl.clone().unwrap_or_default();
    let Ok(rules) = ui::input_default(
        "acl inline rules (';'-separated, blank = none)",
        &acl.inline.join("; "),
    ) else {
        return;
    };
    s.acl = Some(pb::Acl {
        inline: rules
            .split(';')
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(str::to_string)
            .collect(),
    });

    // resolver
    let mut rv = s.resolver.clone().unwrap_or_default();
    let Ok(rtype) = ui::input_default(
        "resolver type (blank = none; dns/udp/tcp/tls/https)",
        &rv.r#type,
    ) else {
        return;
    };
    rv.r#type = rtype.trim().to_string();
    if rv.r#type.is_empty() {
        rv.addr.clear();
        rv.timeout.clear();
        rv.sni.clear();
    } else {
        let Ok(addr) = ui::input_default("resolver addr (e.g. 1.1.1.1:443)", &rv.addr) else {
            return;
        };
        let Ok(timeout) = ui::input_default("resolver timeout (e.g. 10s, blank = default)", &rv.timeout)
        else {
            return;
        };
        rv.addr = addr;
        rv.timeout = timeout;
        if matches!(rv.r#type.as_str(), "tls" | "https") {
            let Ok(sni) = ui::input_default("resolver sni", &rv.sni) else {
                return;
            };
            rv.sni = sni;
        } else {
            rv.sni.clear();
        }
    }
    s.resolver = Some(rv);

    let Some(req) = ui::report(authed(pb::UpdateConfigRequest {
        structured: Some(s),
    })) else {
        return;
    };
    if let Some(c) = ui::report(ctx.call(|mut c| async move { c.update_config(req).await })) {
        ui::success("config updated.");
        if c.managed_blocks_reasserted {
            println!("note: panel-managed auth/trafficStats blocks were reasserted.");
        }
    }
}

fn set_raw(ctx: &mut Ctx) {
    let Ok(file) = ui::input_required("path to YAML file") else {
        return;
    };
    let raw_yaml = match std::fs::read_to_string(&file) {
        Ok(s) => s,
        Err(e) => return ui::error(format!("reading {file}: {e}")),
    };
    let Some(req) = ui::report(authed(pb::UpdateRawConfigRequest { raw_yaml })) else {
        return;
    };
    if let Some(c) = ui::report(ctx.call(|mut c| async move { c.update_raw_config(req).await })) {
        ui::success("config updated.");
        if c.managed_blocks_reasserted {
            println!("note: panel-managed auth/trafficStats blocks were reasserted.");
        }
    }
}
