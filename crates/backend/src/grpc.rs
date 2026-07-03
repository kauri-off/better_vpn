//! Implementation of the `PanelService` gRPC surface consumed by the console
//! and the web panel.

use crate::cert;
use crate::config::model::StructuredConfig;
use crate::config::ConfigManager;
use crate::managed;
use crate::settings::Settings;
use crate::state::AppState;
use chrono::{DateTime, TimeZone, Utc};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use qrcode::render::svg;
use qrcode::QrCode;
use std::path::Path;
use tonic::{Request, Response, Status};
use vpn_common::settings_keys as k;
use vpn_common::token::{generate_token, hash_token, verify_token};
use vpn_db::models::VpnUserChanges;
use vpn_db::queries;
use vpn_proto::panel as pb;
use vpn_proto::panel::panel_service_server::PanelService;

pub struct PanelSvc {
    pub state: AppState,
}

impl PanelSvc {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
}

// ---------------- helpers ----------------

/// Single throttle bucket key for admin login (there is exactly one token).
const THROTTLE_KEY: &str = "admin";

/// Authenticate a request by comparing the bearer token to the stored admin
/// token hash. The token itself is the credential (there is no session/JWT); an
/// unset hash means no token has been configured, so the panel is locked.
fn check_auth<T>(state: &AppState, req: &Request<T>) -> Result<(), Status> {
    let stored = Settings::admin_token_hash(&state.pool);
    if stored.is_empty() {
        return Err(Status::unauthenticated(
            "admin token is not configured; run `vpn-backend admin set-token`",
        ));
    }
    let header = req
        .metadata()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| Status::unauthenticated("missing authorization header"))?;
    let token = header.strip_prefix("Bearer ").unwrap_or(header);
    if verify_token(token, &stored) {
        Ok(())
    } else {
        Err(Status::unauthenticated("invalid token"))
    }
}

fn ts(dt: DateTime<Utc>) -> i64 {
    dt.timestamp()
}

fn opt_ts(dt: Option<DateTime<Utc>>) -> i64 {
    dt.map(|d| d.timestamp()).unwrap_or(0)
}

fn from_ts(secs: i64) -> Option<DateTime<Utc>> {
    if secs <= 0 {
        None
    } else {
        Utc.timestamp_opt(secs, 0).single()
    }
}

fn db_err<E: std::fmt::Display>(e: E) -> Status {
    Status::internal(format!("db error: {e}"))
}

/// Map a DB user row to its proto form, joining in the live connection count
/// from the in-memory online snapshot.
fn to_proto_user(u: vpn_db::models::VpnUser, state: &AppState) -> pb::VpnUser {
    pb::VpnUser {
        id: u.id,
        username: u.username,
        enabled: u.enabled,
        expires_at: opt_ts(u.expires_at),
        quota_bytes: u.quota_bytes,
        used_bytes: u.used_bytes,
        connections: state.connections_for(u.id),
        last_seen: opt_ts(u.last_seen),
        created_at: ts(u.created_at),
        note: u.note,
    }
}

/// Run a user search and assemble the paged `ListUsersResponse`.
fn build_users_response(
    state: &AppState,
    req: &pb::ListUsersRequest,
) -> Result<pb::ListUsersResponse, Status> {
    let limit = if req.limit <= 0 {
        100
    } else {
        req.limit as i64
    };
    let mut conn = state.pool.get().map_err(db_err)?;
    let (rows, total) =
        queries::list_users(&mut conn, &req.search, limit, req.offset as i64).map_err(db_err)?;
    drop(conn);
    let users = rows.into_iter().map(|u| to_proto_user(u, state)).collect();
    Ok(pb::ListUsersResponse {
        users,
        total: total as i32,
    })
}

/// Assemble the current `ServerStats` snapshot.
async fn build_server_stats(state: &AppState) -> Result<pb::ServerStats, Status> {
    let mut conn = state.pool.get().map_err(db_err)?;
    let (_, total_users) = queries::list_users(&mut conn, "", 0, 0).map_err(db_err)?;
    // All-time user traffic, split into uploaded (tx) / downloaded (rx).
    let (total_tx, total_rx) = queries::usage_totals(&mut conn).map_err(db_err)?;
    drop(conn);
    let online_users = state.online_count();
    let core_running = state.stats_client().is_alive().await;
    let sys = state.sys.snapshot();
    Ok(pb::ServerStats {
        total_users: total_users as i32,
        online_users,
        total_tx,
        total_rx,
        core_running,
        core_version: state.core_version().await,
        cpu_percent: sys.cpu_percent,
        mem_used: sys.mem_used as i64,
        mem_total: sys.mem_total as i64,
        uptime_secs: sys.uptime_secs as i64,
        net_rx_rate: sys.net_rx_rate as i64,
        net_tx_rate: sys.net_tx_rate as i64,
        reboot_tx: sys.reboot_tx as i64,
        reboot_rx: sys.reboot_rx as i64,
        tcp_conns: sys.tcp_conns as i32,
        udp_conns: sys.udp_conns as i32,
        ipv4: sys.ipv4,
        ipv6: sys.ipv6,
    })
}

impl PanelSvc {
    /// Restart the Hysteria core systemd unit. The panel runs unprivileged;
    /// this `systemctl restart` reaches systemd over D-Bus and is authorized by
    /// the deploy/polkit-better-vpn.rules rule.
    async fn restart_unit(&self) -> Result<(), Status> {
        let unit = Settings::core_service(&self.state.pool);
        let run = tokio::process::Command::new("systemctl")
            .arg("restart")
            .arg(&unit)
            .output();
        let output = tokio::time::timeout(std::time::Duration::from_secs(30), run)
            .await
            .map_err(|_| Status::deadline_exceeded(format!("restarting {unit} timed out")))?
            .map_err(|e| Status::internal(format!("could not run systemctl: {e}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = stderr.trim();
            let detail = if detail.is_empty() {
                "systemctl restart failed"
            } else {
                detail
            };
            return Err(Status::internal(format!("restart {unit} failed: {detail}")));
        }
        tracing::info!("restarted core unit {unit} from panel");
        Ok(())
    }

    /// Build a `hysteria2://` URI that v2rayN / v2rayNG (and the official
    /// Hysteria client) parse correctly. The address always carries an explicit
    /// port, the auth/remark/query values are percent-encoded, and obfs and a
    /// best-effort `insecure` flag are derived from the live core config so the
    /// link matches what the server actually expects.
    fn connection_uri(&self, token: &str, username: &str, link_host: &str) -> String {
        let sni = Settings::sni(&self.state.pool);

        // Pull obfs / port / cert mode from the managed Hysteria config.
        let sc = ConfigManager::new(Settings::core_config(&self.state.pool))
            .structured_view()
            .unwrap_or_default();

        // The link's @host is the host the admin is browsing the panel on (passed
        // by the web client). The SSH console can't know that, so it falls back to
        // the detected public IP. The port is configured in panel settings; empty
        // borrows the core's listen port.
        let host = {
            let h = host_only(link_host);
            if h.is_empty() {
                self.state.sys.snapshot().ipv4
            } else {
                h
            }
        };
        let port = {
            let p = Settings::port(&self.state.pool);
            let p = p.trim();
            if p.is_empty() {
                listen_port(&sc.listen).to_string()
            } else {
                p.to_string()
            }
        };
        let address = format!("{host}:{port}");

        // Token is URL-safe base64, but encode it anyway to stay correct if the
        // generator ever changes.
        let auth = utf8_percent_encode(token, URI_COMPONENT);
        let mut uri = format!("hy2://{auth}@{address}");

        let mut params = Vec::new();
        if !sni.is_empty() {
            params.push(format!("sni={}", utf8_percent_encode(&sni, URI_COMPONENT)));
        }
        // Salamander obfuscation must be advertised to the client or the
        // handshake fails outright.
        if sc.obfs_type.eq_ignore_ascii_case("salamander") {
            params.push("obfs=salamander".to_string());
            if !sc.obfs_password.is_empty() {
                params.push(format!(
                    "obfs-password={}",
                    utf8_percent_encode(&sc.obfs_password, URI_COMPONENT)
                ));
            }
        }
        // The panel uses a self-signed cert, so the client must be told to trust
        // it. Emit `pinSHA256` with `insecure=0`
        // (i.e. no `insecure` param). On the real target clients — v2rayNG /
        // v2rayN / Xray — the pin *replaces* certificate verification, so a
        // no-SAN cert is accepted purely by fingerprint and any SNI works.
        // IMPORTANT: do NOT add `insecure=1` here. On these clients v2rayNG
        // connects with `insecure=0` + `pinSHA256` and FAILS with
        // `insecure=1` (it disables the pin path). The official hysteria *CLI*
        // behaves oppositely (it needs `insecure=1` because its pin is an
        // additional check, not a replacement) — but the panel targets the GUI
        // clients, so optimise for them. Fall back to `insecure=1` only if the
        // cert file can't be read, so a link is never silently un-pinnable.
        match cert::cert_pin_sha256(&sc.tls_cert) {
            // The colon-delimited fingerprint is left literal (colons are legal in
            // a query component) to match what v2rayN/v2rayNG emit and expect.
            Some(pin) => params.push(format!("pinSHA256={pin}")),
            None => params.push("insecure=1".to_string()),
        }

        if !params.is_empty() {
            uri.push('?');
            uri.push_str(&params.join("&"));
        }
        uri.push('#');
        uri.push_str(&utf8_percent_encode(username, URI_COMPONENT).to_string());
        uri
    }

    /// Render `uri` as a standalone QR-code SVG for the client apps to scan.
    fn qr_svg(uri: &str) -> String {
        match QrCode::new(uri.as_bytes()) {
            Ok(code) => code
                .render::<svg::Color>()
                .min_dimensions(220, 220)
                .quiet_zone(true)
                .dark_color(svg::Color("#000000"))
                .light_color(svg::Color("#ffffff"))
                .build(),
            Err(_) => String::new(),
        }
    }
}

/// Percent-encode set for URI components: everything but the RFC 3986
/// unreserved characters.
const URI_COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

/// Bare host from a possibly-`host:port`/`[ipv6]:port` value, with surrounding
/// brackets stripped. The browser passes `window.location.hostname` (already
/// bare), but be defensive so a stray port can't end up doubled in the link.
fn host_only(addr: &str) -> String {
    let a = addr.trim();
    match a.rfind(']') {
        Some(close) => a[..=close].trim_matches(['[', ']']).to_string(), // [ipv6](:port)
        None if a.contains(':') => a[..a.find(':').unwrap()].to_string(), // host:port
        None => a.to_string(),
    }
}

/// Extract the port from a Hysteria `listen` value (e.g. `:443`, `0.0.0.0:8443`,
/// `[::]:443`), defaulting to 443 when absent or unparseable.
fn listen_port(listen: &str) -> u16 {
    listen
        .rsplit(':')
        .next()
        .and_then(|p| p.parse().ok())
        .filter(|&p| p != 0)
        .unwrap_or(443)
}

/// Replace the port in a Hysteria `listen` value while preserving the host /
/// interface prefix. The port is the segment after the final `:`; everything
/// before it (a bind IP, a bracketed IPv6, or nothing for a wildcard bind) is
/// kept as-is. Examples: `:443` -> `:8443`, `1.2.3.4:443` -> `1.2.3.4:8443`,
/// `[::]:443` -> `[::]:8443`, `` -> `:8443`.
fn set_listen_port(listen: &str, port: &str) -> String {
    let listen = listen.trim();
    let host = match listen.rfind(':') {
        Some(i) => &listen[..i],
        None => listen,
    };
    format!("{host}:{port}")
}

#[cfg(test)]
mod uri_tests {
    use super::*;

    #[test]
    fn extracts_bare_host() {
        assert_eq!(host_only("10.0.0.5"), "10.0.0.5");
        assert_eq!(host_only("10.0.0.5:443"), "10.0.0.5");
        assert_eq!(host_only("vpn.example.com:443"), "vpn.example.com");
        assert_eq!(host_only("[2001:db8::1]:443"), "2001:db8::1");
        assert_eq!(host_only("[2001:db8::1]"), "2001:db8::1");
        assert_eq!(host_only("  10.0.0.5 "), "10.0.0.5");
    }

    #[test]
    fn parses_listen_port_with_default() {
        assert_eq!(listen_port(":443"), 443);
        assert_eq!(listen_port("0.0.0.0:8443"), 8443);
        assert_eq!(listen_port("[::]:443"), 443);
        assert_eq!(listen_port(""), 443);
        assert_eq!(listen_port("garbage"), 443);
    }

    #[test]
    fn sets_listen_port_preserving_host() {
        assert_eq!(set_listen_port(":443", "8443"), ":8443");
        assert_eq!(set_listen_port("0.0.0.0:443", "8443"), "0.0.0.0:8443");
        assert_eq!(set_listen_port("1.2.3.4:443", "8443"), "1.2.3.4:8443");
        assert_eq!(set_listen_port("[::]:443", "8443"), "[::]:8443");
        // No existing port / empty listen: produce a wildcard bind on the port.
        assert_eq!(set_listen_port("", "8443"), ":8443");
        assert_eq!(set_listen_port("1.2.3.4", "8443"), "1.2.3.4:8443");
    }

    #[test]
    fn encodes_uri_components() {
        // Spaces and reserved chars are escaped; unreserved chars pass through.
        assert_eq!(
            utf8_percent_encode("my pass#1", URI_COMPONENT).to_string(),
            "my%20pass%231"
        );
        assert_eq!(
            utf8_percent_encode("a.b-c_d~e", URI_COMPONENT).to_string(),
            "a.b-c_d~e"
        );
    }

    #[test]
    fn renders_scannable_qr_svg() {
        let svg = PanelSvc::qr_svg("hy2://tok@host:443#name");
        assert!(svg.starts_with("<?xml") || svg.contains("<svg"));
    }
}

#[tonic::async_trait]
impl PanelService for PanelSvc {
    async fn login(
        &self,
        request: Request<pb::LoginRequest>,
    ) -> Result<Response<pb::LoginResponse>, Status> {
        let req = request.into_inner();
        // A single token means a single throttle bucket, defending the one
        // secret that protects everything against online brute force.
        if let Err(remaining) = self.state.login_throttle.check(THROTTLE_KEY) {
            return Err(Status::resource_exhausted(format!(
                "too many failed login attempts; try again in {}s",
                remaining.as_secs()
            )));
        }
        let stored = Settings::admin_token_hash(&self.state.pool);
        if stored.is_empty() {
            return Err(Status::failed_precondition(
                "admin token is not configured; run `vpn-backend admin set-token`",
            ));
        }
        if !verify_token(&req.token, &stored) {
            self.state.login_throttle.record_failure(THROTTLE_KEY);
            return Err(Status::unauthenticated("invalid token"));
        }
        self.state.login_throttle.record_success(THROTTLE_KEY);
        Ok(Response::new(pb::LoginResponse {}))
    }

    async fn who_am_i(&self, request: Request<pb::Empty>) -> Result<Response<pb::Empty>, Status> {
        check_auth(&self.state, &request)?;
        Ok(Response::new(pb::Empty {}))
    }

    async fn set_admin_token(
        &self,
        request: Request<pb::SetAdminTokenRequest>,
    ) -> Result<Response<pb::SetAdminTokenResponse>, Status> {
        check_auth(&self.state, &request)?;
        let req = request.into_inner();
        // Empty => mint a strong random token; otherwise honour the operator's
        // choice. Only the hash is stored; the plaintext is returned once.
        let token = {
            let t = req.token.trim();
            if t.is_empty() {
                generate_token()
            } else {
                t.to_string()
            }
        };
        let hash = hash_token(&token);
        let mut conn = self.state.pool.get().map_err(db_err)?;
        queries::set_setting(&mut conn, k::ADMIN_TOKEN_HASH, &hash).map_err(db_err)?;
        // Any previously issued token no longer matches the stored hash, so all
        // other sessions are effectively logged out on their next request.
        tracing::info!("admin access token rotated");
        Ok(Response::new(pb::SetAdminTokenResponse { token }))
    }

    async fn list_users(
        &self,
        request: Request<pb::ListUsersRequest>,
    ) -> Result<Response<pb::ListUsersResponse>, Status> {
        check_auth(&self.state, &request)?;
        let req = request.into_inner();
        Ok(Response::new(build_users_response(&self.state, &req)?))
    }

    async fn get_user(
        &self,
        request: Request<pb::GetUserRequest>,
    ) -> Result<Response<pb::VpnUser>, Status> {
        check_auth(&self.state, &request)?;
        let id = request.into_inner().id;
        let mut conn = self.state.pool.get().map_err(db_err)?;
        let u =
            queries::user_by_id(&mut conn, id).map_err(|_| Status::not_found("user not found"))?;
        Ok(Response::new(to_proto_user(u, &self.state)))
    }

    async fn create_user(
        &self,
        request: Request<pb::CreateUserRequest>,
    ) -> Result<Response<pb::CreateUserResponse>, Status> {
        check_auth(&self.state, &request)?;
        let req = request.into_inner();
        if req.username.trim().is_empty() {
            return Err(Status::invalid_argument("username is required"));
        }
        let token = generate_token();
        let new = vpn_db::models::NewVpnUser {
            username: &req.username,
            enabled: req.enabled,
            expires_at: from_ts(req.expires_at),
            quota_bytes: req.quota_bytes,
            note: &req.note,
            token: &token,
        };
        let mut conn = self.state.pool.get().map_err(db_err)?;
        let u = queries::create_user(&mut conn, new)
            .map_err(|e| Status::already_exists(format!("could not create user: {e}")))?;
        let uri = self.connection_uri(&token, &u.username, &req.link_host);
        let qr_svg = Self::qr_svg(&uri);
        let user = to_proto_user(u, &self.state);
        Ok(Response::new(pb::CreateUserResponse {
            user: Some(user),
            auth_token: token,
            connection_uri: uri,
            qr_svg,
        }))
    }

    async fn get_user_config(
        &self,
        request: Request<pb::GetUserRequest>,
    ) -> Result<Response<pb::UserConfigResponse>, Status> {
        check_auth(&self.state, &request)?;
        let req = request.into_inner();
        let id = req.id;
        let mut conn = self.state.pool.get().map_err(db_err)?;
        let u =
            queries::user_by_id(&mut conn, id).map_err(|_| Status::not_found("user not found"))?;
        let uri = self.connection_uri(&u.token, &u.username, &req.link_host);
        let qr_svg = Self::qr_svg(&uri);
        let (auth_token, connection_uri) = (u.token, uri);
        Ok(Response::new(pb::UserConfigResponse {
            username: u.username,
            auth_token,
            connection_uri,
            qr_svg,
        }))
    }

    async fn update_user(
        &self,
        request: Request<pb::UpdateUserRequest>,
    ) -> Result<Response<pb::VpnUser>, Status> {
        check_auth(&self.state, &request)?;
        let req = request.into_inner();
        let changes = VpnUserChanges {
            enabled: req.enabled,
            expires_at: req.expires_at.map(from_ts),
            quota_bytes: req.quota_bytes,
            used_bytes: None,
            note: req.note,
        };
        let mut conn = self.state.pool.get().map_err(db_err)?;
        let u = queries::update_user(&mut conn, req.id, changes)
            .map_err(|_| Status::not_found("user not found"))?;
        Ok(Response::new(to_proto_user(u, &self.state)))
    }

    async fn delete_user(
        &self,
        request: Request<pb::GetUserRequest>,
    ) -> Result<Response<pb::Empty>, Status> {
        check_auth(&self.state, &request)?;
        let id = request.into_inner().id;
        let mut conn = self.state.pool.get().map_err(db_err)?;
        queries::delete_user(&mut conn, id).map_err(db_err)?;
        Ok(Response::new(pb::Empty {}))
    }

    async fn kick_user(
        &self,
        request: Request<pb::GetUserRequest>,
    ) -> Result<Response<pb::Empty>, Status> {
        check_auth(&self.state, &request)?;
        let id = request.into_inner().id;
        let mut conn = self.state.pool.get().map_err(db_err)?;
        let u =
            queries::user_by_id(&mut conn, id).map_err(|_| Status::not_found("user not found"))?;
        drop(conn);
        self.state
            .stats_client()
            .kick(&[u.username])
            .await
            .map_err(|e| Status::internal(format!("kick failed: {e}")))?;
        Ok(Response::new(pb::Empty {}))
    }

    async fn reset_user_usage(
        &self,
        request: Request<pb::GetUserRequest>,
    ) -> Result<Response<pb::VpnUser>, Status> {
        check_auth(&self.state, &request)?;
        let id = request.into_inner().id;
        let mut conn = self.state.pool.get().map_err(db_err)?;
        let u = queries::reset_usage(&mut conn, id).map_err(db_err)?;
        Ok(Response::new(to_proto_user(u, &self.state)))
    }

    async fn get_server_stats(
        &self,
        request: Request<pb::Empty>,
    ) -> Result<Response<pb::ServerStats>, Status> {
        check_auth(&self.state, &request)?;
        Ok(Response::new(build_server_stats(&self.state).await?))
    }

    async fn restart_core(
        &self,
        request: Request<pb::Empty>,
    ) -> Result<Response<pb::Empty>, Status> {
        check_auth(&self.state, &request)?;
        self.restart_unit().await?;
        // The new process may be a different binary; force a re-probe.
        self.state.invalidate_core_version().await;
        Ok(Response::new(pb::Empty {}))
    }

    async fn update_core(
        &self,
        request: Request<pb::Empty>,
    ) -> Result<Response<pb::UpdateCoreResponse>, Status> {
        check_auth(&self.state, &request)?;
        let url = Settings::core_download_url(&self.state.pool);
        let version = crate::hysteria::core::update(&Settings::core_bin(&self.state.pool), &url)
            .await
            .map_err(|e| Status::internal(format!("core update failed: {e:#}")))?;
        tracing::info!("updated core binary to {version} from panel");
        // Restart the service so the running process is the new binary.
        self.restart_unit().await?;
        self.state.set_core_version(version.clone()).await;
        Ok(Response::new(pb::UpdateCoreResponse { version }))
    }

    async fn get_config(
        &self,
        request: Request<pb::Empty>,
    ) -> Result<Response<pb::ConfigResponse>, Status> {
        check_auth(&self.state, &request)?;
        let mgr = ConfigManager::new(Settings::core_config(&self.state.pool));
        let raw = mgr
            .read_raw()
            .map_err(|e| Status::internal(e.to_string()))?;
        let sc = mgr
            .structured_view()
            .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(pb::ConfigResponse {
            raw_yaml: raw,
            structured: Some(structured_to_proto(&sc)),
            managed_blocks_reasserted: false,
        }))
    }

    async fn update_config(
        &self,
        request: Request<pb::UpdateConfigRequest>,
    ) -> Result<Response<pb::ConfigResponse>, Status> {
        check_auth(&self.state, &request)?;
        let req = request.into_inner();
        let sc = proto_to_structured(req.structured.unwrap_or_default());
        let mgr = ConfigManager::new(Settings::core_config(&self.state.pool));
        let managed = managed::managed_blocks(&self.state);
        let reasserted = mgr
            .apply_structured(&sc, &managed)
            .map_err(|e| Status::invalid_argument(e.to_string()))?;
        let raw = mgr
            .read_raw()
            .map_err(|e| Status::internal(e.to_string()))?;
        let view = mgr
            .structured_view()
            .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(pb::ConfigResponse {
            raw_yaml: raw,
            structured: Some(structured_to_proto(&view)),
            managed_blocks_reasserted: reasserted,
        }))
    }

    async fn update_raw_config(
        &self,
        request: Request<pb::UpdateRawConfigRequest>,
    ) -> Result<Response<pb::ConfigResponse>, Status> {
        check_auth(&self.state, &request)?;
        let raw_in = request.into_inner().raw_yaml;
        let mgr = ConfigManager::new(Settings::core_config(&self.state.pool));
        let managed = managed::managed_blocks(&self.state);
        let reasserted = mgr
            .apply_raw(&raw_in, &managed)
            .map_err(|e| Status::invalid_argument(e.to_string()))?;
        let raw = mgr
            .read_raw()
            .map_err(|e| Status::internal(e.to_string()))?;
        let view = mgr
            .structured_view()
            .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(pb::ConfigResponse {
            raw_yaml: raw,
            structured: Some(structured_to_proto(&view)),
            managed_blocks_reasserted: reasserted,
        }))
    }

    async fn get_cert_info(
        &self,
        request: Request<pb::Empty>,
    ) -> Result<Response<pb::CertInfo>, Status> {
        check_auth(&self.state, &request)?;
        let core_config = Settings::core_config(&self.state.pool);
        let sc = ConfigManager::new(&core_config)
            .structured_view()
            .map_err(|e| Status::internal(e.to_string()))?;
        let (cert_path, key_path) =
            resolve_cert_paths(&core_config, &sc.tls_cert, &sc.tls_key, "", "");
        let summary = cert::inspect(&cert_path);
        Ok(Response::new(cert_summary_to_proto(
            &summary, &cert_path, &key_path,
        )))
    }

    async fn generate_cert(
        &self,
        request: Request<pb::GenerateCertRequest>,
    ) -> Result<Response<pb::CertInfo>, Status> {
        check_auth(&self.state, &request)?;
        let req = request.into_inner();

        // The cert carries NO SAN by default. Clients trust it by `pinSHA256`
        // (the cert's own fingerprint), not by hostname, so a SAN list buys
        // nothing — and an *empty* SAN set is what frees the SNI: Hysteria's
        // default `tls.sniGuard: dns-san` only validates the client SNI when the
        // cert has a DNS-type SAN, so with no SAN any SNI is accepted. That's how
        // the SNI becomes a pure client-side DPI-camouflage value, decoupled from
        // the cert and the dialed address. We honour only explicit operator SANs.
        let mut sans: Vec<String> = Vec::new();
        for c in req.sans.iter().map(|s| s.trim()) {
            if !c.is_empty() && !sans.iter().any(|e| e.eq_ignore_ascii_case(c)) {
                sans.push(c.to_string());
            }
        }
        let validity_days = if req.validity_days <= 0 {
            3650
        } else {
            req.validity_days as u32
        };

        let core_config = Settings::core_config(&self.state.pool);
        let mgr = ConfigManager::new(&core_config);
        let mut sc = mgr
            .structured_view()
            .map_err(|e| Status::internal(e.to_string()))?;
        let (cert_path, key_path) = resolve_cert_paths(
            &core_config,
            &sc.tls_cert,
            &sc.tls_key,
            &req.cert_path,
            &req.key_path,
        );
        // The destination is admin-controlled, but reject path traversal /
        // relative paths so a malformed override can't clobber a file outside
        // an intended absolute location.
        validate_cert_dest(&req.cert_path).map_err(Status::invalid_argument)?;
        validate_cert_dest(&req.key_path).map_err(Status::invalid_argument)?;

        let (cert_pem, key_pem) = cert::generate_self_signed(&sans, validity_days)
            .map_err(|e| Status::invalid_argument(format!("generating certificate: {e}")))?;
        cert::write_pems(&cert_path, &key_path, &cert_pem, &key_pem)
            .map_err(|e| Status::internal(format!("writing certificate: {e}")))?;

        // Point the config at the new cert (apply_structured drops any acme block).
        sc.tls_cert = cert_path.clone();
        sc.tls_key = key_path.clone();
        let managed = managed::managed_blocks(&self.state);
        mgr.apply_structured(&sc, &managed)
            .map_err(|e| Status::internal(format!("updating config: {e}")))?;

        let summary = cert::inspect(&cert_path);
        Ok(Response::new(cert_summary_to_proto(
            &summary, &cert_path, &key_path,
        )))
    }

    async fn get_settings(
        &self,
        request: Request<pb::Empty>,
    ) -> Result<Response<pb::PanelSettings>, Status> {
        check_auth(&self.state, &request)?;
        Ok(Response::new(pb::PanelSettings {
            port: Settings::port(&self.state.pool),
            sni: Settings::sni(&self.state.pool),
        }))
    }

    async fn update_settings(
        &self,
        request: Request<pb::PanelSettings>,
    ) -> Result<Response<pb::PanelSettings>, Status> {
        check_auth(&self.state, &request)?;
        let s = request.into_inner();
        let port = s.port.trim();

        // An explicit port now drives the core's actual `listen` bind (below), so
        // it must be a real port number. Empty keeps the current behaviour: don't
        // manage `listen`, and let client links borrow whatever the core listens on.
        if !port.is_empty() && !matches!(port.parse::<u16>(), Ok(p) if p != 0) {
            return Err(Status::invalid_argument(format!(
                "port must be a number between 1 and 65535: {port}"
            )));
        }

        let mut conn = self
            .state
            .pool
            .get()
            .map_err(|e| Status::internal(e.to_string()))?;
        queries::set_setting(&mut conn, k::PORT, port)
            .map_err(|e| Status::internal(e.to_string()))?;
        queries::set_setting(&mut conn, k::SNI, s.sni.trim())
            .map_err(|e| Status::internal(e.to_string()))?;
        drop(conn);

        // Sync the port into the Hysteria `config.yaml` `listen:` field so the
        // daemon actually binds the configured port — the DB setting alone only
        // affected the advertised client-link port. Preserve any host/interface
        // prefix on `listen` (e.g. a specific bind IP) and only swap the port.
        // A restart is required for the core to rebind, so only do it when the
        // listen value actually changed (avoid dropping live connections on a
        // no-op save).
        if !port.is_empty() {
            let mgr = ConfigManager::new(Settings::core_config(&self.state.pool));
            let sc = mgr
                .structured_view()
                .map_err(|e| Status::internal(e.to_string()))?;
            let new_listen = set_listen_port(&sc.listen, port);
            if new_listen != sc.listen {
                let mut updated = sc.clone();
                updated.listen = new_listen;
                let managed = managed::managed_blocks(&self.state);
                mgr.apply_structured(&updated, &managed)
                    .map_err(|e| Status::internal(e.to_string()))?;
                self.restart_unit().await?;
                self.state.invalidate_core_version().await;
            }
        }

        Ok(Response::new(pb::PanelSettings {
            port: Settings::port(&self.state.pool),
            sni: Settings::sni(&self.state.pool),
        }))
    }
}

// ---------------- certificate helpers ----------------

/// Resolve the cert/key paths to use. Precedence: explicit request override,
/// then the value already in the config, then a default next to the Hysteria
/// `config.yaml` (`fullchain.pem` / `privkey.pem`).
fn resolve_cert_paths(
    core_config: &str,
    cfg_cert: &str,
    cfg_key: &str,
    req_cert: &str,
    req_key: &str,
) -> (String, String) {
    let dir = Path::new(core_config).parent();
    let default = |name: &str| {
        dir.map(|d| d.join(name).to_string_lossy().into_owned())
            .unwrap_or_else(|| name.to_string())
    };
    let cert = first_non_empty(&[req_cert, cfg_cert]).unwrap_or_else(|| default("fullchain.pem"));
    let key = first_non_empty(&[req_key, cfg_key]).unwrap_or_else(|| default("privkey.pem"));
    (cert, key)
}

/// Validate an admin-supplied cert/key path override. Empty is fine (the
/// override is optional). A provided path must be absolute and free of `..`
/// traversal components so it cannot be resolved against an unexpected CWD or
/// escape its intended directory.
fn validate_cert_dest(p: &str) -> Result<(), String> {
    let p = p.trim();
    if p.is_empty() {
        return Ok(());
    }
    let path = Path::new(p);
    if !path.is_absolute() {
        return Err(format!("cert/key path must be absolute: {p}"));
    }
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!("cert/key path must not contain '..': {p}"));
    }
    Ok(())
}

fn first_non_empty(candidates: &[&str]) -> Option<String> {
    candidates
        .iter()
        .map(|s| s.trim())
        .find(|s| !s.is_empty())
        .map(String::from)
}

fn cert_summary_to_proto(s: &cert::CertSummary, cert_path: &str, key_path: &str) -> pb::CertInfo {
    pb::CertInfo {
        exists: s.exists,
        cert_path: cert_path.to_string(),
        key_path: key_path.to_string(),
        subject_cn: s.subject_cn.clone(),
        sans: s.sans.clone(),
        not_before: s.not_before,
        not_after: s.not_after,
        fingerprint_sha256: s.fingerprint_sha256.clone(),
        expired: s.expired,
        parse_error: s.parse_error.clone(),
    }
}

// ---------------- proto <-> struct conversions ----------------

fn structured_to_proto(sc: &StructuredConfig) -> pb::HysteriaConfig {
    pb::HysteriaConfig {
        listen: sc.listen.clone(),
        tls: Some(pb::TlsConfig {
            cert: sc.tls_cert.clone(),
            key: sc.tls_key.clone(),
        }),
        obfs: Some(pb::ObfsConfig {
            r#type: sc.obfs_type.clone(),
            password: sc.obfs_password.clone(),
        }),
        bandwidth: Some(pb::Bandwidth {
            up: sc.bandwidth_up.clone(),
            down: sc.bandwidth_down.clone(),
        }),
        masquerade: Some(pb::Masquerade {
            r#type: sc.masquerade_type.clone(),
            proxy_url: sc.masquerade_proxy_url.clone(),
            string_content: sc.masquerade_string_content.clone(),
        }),
        acl: Some(pb::Acl {
            inline: sc.acl_inline.clone(),
        }),
        resolver: Some(pb::Resolver {
            r#type: sc.resolver_type.clone(),
            addr: sc.resolver_addr.clone(),
            timeout: sc.resolver_timeout.clone(),
            sni: sc.resolver_sni.clone(),
        }),
    }
}

fn proto_to_structured(c: pb::HysteriaConfig) -> StructuredConfig {
    let tls = c.tls.unwrap_or_default();
    let obfs = c.obfs.unwrap_or_default();
    let bw = c.bandwidth.unwrap_or_default();
    let mq = c.masquerade.unwrap_or_default();
    let acl = c.acl.unwrap_or_default();
    let rv = c.resolver.unwrap_or_default();
    StructuredConfig {
        listen: c.listen,
        tls_cert: tls.cert,
        tls_key: tls.key,
        obfs_type: obfs.r#type,
        obfs_password: obfs.password,
        bandwidth_up: bw.up,
        bandwidth_down: bw.down,
        masquerade_type: mq.r#type,
        masquerade_proxy_url: mq.proxy_url,
        masquerade_string_content: mq.string_content,
        acl_inline: acl
            .inline
            .into_iter()
            .map(|r| r.trim().to_string())
            .filter(|r| !r.is_empty())
            .collect(),
        resolver_type: rv.r#type,
        resolver_addr: rv.addr,
        resolver_timeout: rv.timeout,
        resolver_sni: rv.sni,
    }
}
