//! Formatting + small input parsers for the console.

use anyhow::{anyhow, Result};
use chrono::{TimeZone, Utc};
use vpn_proto::panel as pb;

/// Format a unix timestamp; 0 renders as "never".
pub fn ts(secs: i64) -> String {
    if secs <= 0 {
        return "never".into();
    }
    Utc.timestamp_opt(secs, 0)
        .single()
        .map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| secs.to_string())
}

/// Human-readable byte count.
pub fn bytes(n: i64) -> String {
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{n} B")
    } else {
        format!("{v:.2} {}", UNITS[i])
    }
}

/// Parse "never" | "0" | "<N>d" | unix-timestamp into a unix seconds value.
pub fn parse_expires(s: &str) -> Result<i64> {
    let s = s.trim();
    if s.is_empty() || s == "never" || s == "0" {
        return Ok(0);
    }
    if let Some(days) = s.strip_suffix('d') {
        let d: i64 = days.parse().map_err(|_| anyhow!("invalid days: {s}"))?;
        if d < 0 {
            return Err(anyhow!("days must not be negative: {s}"));
        }
        let secs = d
            .checked_mul(86400)
            .and_then(|offset| Utc::now().timestamp().checked_add(offset))
            .ok_or_else(|| anyhow!("expiry too far in the future: {s}"))?;
        return Ok(secs);
    }
    s.parse::<i64>().map_err(|_| anyhow!("invalid expiry: {s}"))
}

/// Parse "0" | plain bytes | 10K/10M/10G/10T into a byte count.
pub fn parse_bytes(s: &str) -> Result<i64> {
    let s = s.trim();
    if s.is_empty() || s == "0" {
        return Ok(0);
    }
    let (num, mult) = match s.chars().last().unwrap().to_ascii_uppercase() {
        'K' => (&s[..s.len() - 1], 1024i64),
        'M' => (&s[..s.len() - 1], 1024i64.pow(2)),
        'G' => (&s[..s.len() - 1], 1024i64.pow(3)),
        'T' => (&s[..s.len() - 1], 1024i64.pow(4)),
        _ => (s, 1),
    };
    let n: f64 = num
        .trim()
        .parse()
        .map_err(|_| anyhow!("invalid size: {s}"))?;
    if !n.is_finite() || n < 0.0 {
        return Err(anyhow!("size must be a non-negative number: {s}"));
    }
    let bytes = n * mult as f64;
    if bytes > i64::MAX as f64 {
        return Err(anyhow!("size too large: {s}"));
    }
    Ok(bytes as i64)
}

pub fn print_users(users: &[pb::VpnUser]) {
    println!(
        "{:>4}  {:<20} {:<8} {:<6} {:<14} {:<20}",
        "ID", "USERNAME", "STATE", "CONN", "USED/QUOTA", "EXPIRES"
    );
    for u in users {
        let state = if u.enabled { "enabled" } else { "disabled" };
        let usage = if u.quota_bytes > 0 {
            format!("{}/{}", bytes(u.used_bytes), bytes(u.quota_bytes))
        } else {
            format!("{}/∞", bytes(u.used_bytes))
        };
        println!(
            "{:>4}  {:<20} {:<8} {:<6} {:<14} {:<20}",
            u.id,
            u.username,
            state,
            u.connections,
            usage,
            ts(u.expires_at)
        );
    }
}

/// Format a duration in seconds as a compact "Nd Nh Nm" string.
pub fn duration(secs: i64) -> String {
    if secs <= 0 {
        return "0s".into();
    }
    let d = secs / 86400;
    let h = (secs % 86400) / 3600;
    let m = (secs % 3600) / 60;
    let mut parts = Vec::new();
    if d > 0 {
        parts.push(format!("{d}d"));
    }
    if h > 0 {
        parts.push(format!("{h}h"));
    }
    if m > 0 || parts.is_empty() {
        parts.push(format!("{m}m"));
    }
    parts.join(" ")
}

pub fn print_stats(s: &pb::ServerStats) {
    println!("core running : {}", s.core_running);
    println!("core version : {}", s.core_version);
    println!(
        "users        : {} ({} online)",
        s.total_users, s.online_users
    );
    println!("traffic up   : {}", bytes(s.total_tx));
    println!("traffic down : {}", bytes(s.total_rx));
    println!(
        "cpu / mem    : {:.1}%  {} / {}",
        s.cpu_percent,
        bytes(s.mem_used),
        bytes(s.mem_total)
    );
    println!(
        "net rate     : ↑ {}/s  ↓ {}/s",
        bytes(s.net_tx_rate),
        bytes(s.net_rx_rate)
    );
    println!("sockets      : {} tcp  {} udp", s.tcp_conns, s.udp_conns);
    println!("uptime       : {}", duration(s.uptime_secs));
    if !s.ipv4.is_empty() {
        println!("ipv4         : {}", s.ipv4);
    }
    if !s.ipv6.is_empty() {
        println!("ipv6         : {}", s.ipv6);
    }
}

pub fn print_user_detail(u: &pb::VpnUser) {
    let usage = if u.quota_bytes > 0 {
        format!("{} / {}", bytes(u.used_bytes), bytes(u.quota_bytes))
    } else {
        format!("{} / ∞", bytes(u.used_bytes))
    };
    println!("id          : {}", u.id);
    println!("username    : {}", u.username);
    println!(
        "state       : {}",
        if u.enabled { "enabled" } else { "disabled" }
    );
    println!("connections : {}", u.connections);
    println!("used/quota  : {usage}");
    println!("expires     : {}", ts(u.expires_at));
    println!("last seen   : {}", ts(u.last_seen));
    println!("created     : {}", ts(u.created_at));
    if !u.note.is_empty() {
        println!("note        : {}", u.note);
    }
}

pub fn print_cert(c: &pb::CertInfo) {
    println!("cert path   : {}", c.cert_path);
    println!("key path    : {}", c.key_path);
    if !c.exists {
        println!("status      : (no cert file present)");
        return;
    }
    if !c.parse_error.is_empty() {
        println!("parse error : {}", c.parse_error);
        return;
    }
    println!("subject CN  : {}", c.subject_cn);
    if !c.sans.is_empty() {
        println!("SANs        : {}", c.sans.join(", "));
    }
    println!("valid from  : {}", ts(c.not_before));
    println!(
        "valid until : {}{}",
        ts(c.not_after),
        if c.expired { "  (EXPIRED)" } else { "" }
    );
    println!("fingerprint : {}", c.fingerprint_sha256);
}

pub fn print_settings(s: &pb::PanelSettings) {
    println!(
        "port : {}",
        if s.port.is_empty() {
            "(core listen port)"
        } else {
            &s.port
        }
    );
    println!(
        "sni  : {}",
        if s.sni.is_empty() { "(none)" } else { &s.sni }
    );
}

pub fn print_structured(s: &pb::HysteriaConfig) {
    println!("listen     : {}", s.listen);
    if let Some(tls) = &s.tls {
        if !tls.cert.is_empty() {
            println!("tls.cert   : {}", tls.cert);
            println!("tls.key    : {}", tls.key);
        }
    }
    if let Some(bw) = &s.bandwidth {
        if !bw.up.is_empty() || !bw.down.is_empty() {
            println!("bandwidth  : up={} down={}", bw.up, bw.down);
        }
    }
    if let Some(obfs) = &s.obfs {
        if !obfs.r#type.is_empty() {
            println!("obfs       : {}", obfs.r#type);
        }
    }
    if let Some(mq) = &s.masquerade {
        if !mq.r#type.is_empty() {
            println!("masquerade : {}", mq.r#type);
        }
    }
}
