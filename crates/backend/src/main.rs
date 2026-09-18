//! Better VPN backend daemon.
//!
//! Subcommands:
//!   (default / `serve`)  run the gRPC+web API, Hysteria auth endpoint, poller
//!   `admin set-token`    set/generate the single admin access token
//!   `set <key> <value>`  seed a runtime setting (stats secret, paths, ...)

mod app_config;
mod cert;
mod config;
mod grpc;
mod hysteria;
mod login_throttle;
mod managed;
mod settings;
mod state;
mod sysmon;

use anyhow::Context;
use app_config::AppConfig;
use clap::{Parser, Subcommand};
use state::AppState;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use tonic::transport::Server;
use tonic_web::GrpcWebLayer;
use tower_http::cors::CorsLayer;
use vpn_db::queries;
use vpn_proto::panel::panel_service_server::PanelServiceServer;

#[derive(Parser)]
#[command(name = "vpn-backend", version)]
struct Cli {
    /// Load KEY=VALUE lines (DATABASE_URL, RUST_LOG) from this file; variables
    /// already set in the environment win.
    #[arg(long, value_name = "PATH", global = true)]
    env_file: Option<PathBuf>,

    #[command(subcommand)]
    command: Option<Command>,
}

/// Load `KEY=VALUE` lines from `path` into the process environment, without
/// overriding variables that are already set.
fn load_env_file(path: &Path) -> anyhow::Result<()> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("reading env file {}", path.display()))?;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, val)) = line.split_once('=') {
            let key = key.trim();
            let val = val.trim().trim_matches('"').trim_matches('\'');
            if std::env::var_os(key).is_none() {
                std::env::set_var(key, val);
            }
        }
    }
    Ok(())
}

#[derive(Subcommand)]
enum Command {
    /// Run the daemon (default).
    Serve,
    /// Manage admin access directly in the database (bootstrap).
    Admin {
        #[command(subcommand)]
        action: AdminAction,
    },
    /// Set a runtime setting in the database (see `vpn-backend set --help`).
    Set {
        /// One of: sni, stats_url, poll_interval_secs, grpc_addr, auth_addr,
        /// core_service, core_bin, core_config, core_download_url
        key: String,
        value: String,
    },
}

#[derive(Subcommand)]
enum AdminAction {
    /// Set the single admin access token, storing only its SHA-256 hash. Omit
    /// the token to generate a strong random one. The plaintext is printed once
    /// (it is not recoverable afterwards) — use it to log into the panel/console.
    SetToken {
        /// The token to set. Omit to generate a random one.
        token: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cli = Cli::parse();
    if let Some(path) = &cli.env_file {
        load_env_file(path)?;
    }
    let cfg = AppConfig::from_env()?;
    let pool = vpn_db::build_pool(&cfg.database_url, 16)?;
    vpn_db::run_migrations(&pool)?;

    match cli.command.unwrap_or(Command::Serve) {
        Command::Admin {
            action: AdminAction::SetToken { token },
        } => {
            // Honour an explicit token; otherwise mint a strong random one.
            let token = match token {
                Some(t) if !t.trim().is_empty() => t.trim().to_string(),
                _ => vpn_common::token::generate_token(),
            };
            let hash = vpn_common::token::hash_token(&token);
            let mut conn = pool.get()?;
            queries::set_setting(
                &mut conn,
                vpn_common::settings_keys::ADMIN_TOKEN_HASH,
                &hash,
            )?;
            println!(
                "admin access token set. Store it now — it is not recoverable:\n\n    {token}\n"
            );
            Ok(())
        }
        Command::Set { key, value } => {
            let value = settings::Settings::validate(&key, &value).map_err(anyhow::Error::msg)?;
            let mut conn = pool.get()?;
            queries::set_setting(&mut conn, &key, &value)?;
            println!("set {key} = {value}");
            Ok(())
        }
        Command::Serve => serve(pool).await,
    }
}

async fn serve(pool: vpn_db::DbPool) -> anyhow::Result<()> {
    let state = AppState::new(pool);

    settings::Settings::ensure_stats_secret(&state.pool);
    settings::Settings::migrate_legacy_port(&state.pool);

    // Reassert managed blocks and make sure a TLS cert exists so the core can start.
    {
        let managed = managed::managed_blocks(&state.pool);
        let mgr = config::ConfigManager::new(settings::Settings::core_config(&state.pool));
        if mgr.path().exists() {
            match mgr.ensure_managed(&managed) {
                Ok(true) => tracing::info!("reasserted panel-managed config blocks on startup"),
                Ok(false) => {}
                Err(e) => tracing::warn!("could not reassert managed config blocks: {e}"),
            }
            match mgr.structured_view() {
                Ok(sc) if !sc.tls_cert.trim().is_empty() && !sc.tls_key.trim().is_empty() => {
                    match cert::ensure_default_cert(&sc.tls_cert, &sc.tls_key) {
                        Ok(true) => tracing::info!(
                            "generated a default self-signed TLS cert at {} so the core can \
                             start; regenerate it from the panel (Server -> TLS) to customise",
                            sc.tls_cert
                        ),
                        Ok(false) => {}
                        Err(e) => tracing::warn!("could not generate default TLS cert: {e}"),
                    }
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("could not read core config to check TLS cert: {e}"),
            }
        }
    }

    // Background stats poller.
    hysteria::stats::spawn(state.clone());

    // Background host-metrics sampler (CPU/RAM/network/sockets/public IP).
    state.sys.spawn();

    // Hysteria HTTP auth backend (axum) on the configured auth listener. This
    // setting is authoritative: the managed config block derives the core's
    // `auth.http.url` from the same value (see managed::managed_blocks).
    let auth_addr: SocketAddr = settings::Settings::auth_addr(&state.pool).parse()?;
    let auth_router = hysteria::auth::router(state.clone());
    let auth_handle = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(auth_addr)
            .await
            .expect("bind auth addr");
        tracing::info!("hysteria auth backend listening on http://{auth_addr}/auth");
        axum::serve(listener, auth_router)
            .await
            .expect("auth server");
    });

    // gRPC + gRPC-Web management API on the configured management listener.
    let grpc_addr: SocketAddr = settings::Settings::grpc_addr(&state.pool).parse()?;
    let svc = grpc::PanelSvc::new(state);
    tracing::info!("panel gRPC/gRPC-Web API listening on {grpc_addr}");

    let grpc_handle = tokio::spawn(async move {
        Server::builder()
            .accept_http1(true)
            .layer(CorsLayer::very_permissive())
            .layer(GrpcWebLayer::new())
            .add_service(PanelServiceServer::new(svc))
            .serve(grpc_addr)
            .await
            .expect("grpc server");
    });

    tokio::select! {
        _ = auth_handle => {}
        _ = grpc_handle => {}
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("shutting down");
        }
    }
    Ok(())
}
