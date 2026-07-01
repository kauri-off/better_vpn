//! Better VPN backend daemon.
//!
//! Subcommands:
//!   (default / `serve`)  run the gRPC+web API, Hysteria auth endpoint, poller
//!   `admin create`       bootstrap an admin (direct DB access)
//!   `set <key> <value>`  seed a runtime setting (stats secret, paths, ...)

mod app_config;
mod auth;
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
    /// Load environment (DATABASE_URL, GRPC_ADDR, ...) from this file before
    /// running, so bootstrap commands don't need it exported. Lines are
    /// `KEY=VALUE`; blanks and `#` comments are ignored. Variables already set
    /// in the real environment are left untouched.
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
    /// Manage admins directly in the database (bootstrap).
    Admin {
        #[command(subcommand)]
        action: AdminAction,
    },
    /// Set a runtime setting in the database.
    Set { key: String, value: String },
}

#[derive(Subcommand)]
enum AdminAction {
    /// Create an admin user.
    Create {
        #[arg(long)]
        username: String,
        #[arg(long)]
        password: String,
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
            action: AdminAction::Create { username, password },
        } => {
            let mut conn = pool.get()?;
            let hash = auth::hash_password(&password)?;
            let admin = queries::create_admin(&mut conn, &username, &hash)?;
            println!("created admin #{} '{}'", admin.id, admin.username);
            Ok(())
        }
        Command::Set { key, value } => {
            let mut conn = pool.get()?;
            queries::set_setting(&mut conn, &key, &value)?;
            println!("set {key}");
            Ok(())
        }
        Command::Serve => serve(cfg, pool).await,
    }
}

async fn serve(cfg: AppConfig, pool: vpn_db::DbPool) -> anyhow::Result<()> {
    let state = AppState::new(pool, cfg.clone());

    // The stats-API secret is a localhost-only shared secret between the panel
    // and the core's trafficStats endpoint, so there's no reason for an operator
    // to pick it. Generate one on first startup and persist it; being persisted,
    // it stays stable across restarts, so the reassert below applies it to
    // config.yaml exactly once and the core never needs it changed again.
    // Best-effort seed; ensure_stats_secret is idempotent and self-heals on the
    // next reassert if the DB is unreachable right now (see managed_blocks).
    settings::Settings::ensure_stats_secret(&state.pool);

    // Reassert managed config blocks on startup (best-effort; the config file
    // may not exist yet during first setup).
    {
        let managed = managed::managed_blocks(&state);
        let mgr = config::ConfigManager::new(settings::Settings::core_config(&state.pool));
        if mgr.path().exists() {
            match mgr.ensure_managed(&managed) {
                Ok(true) => tracing::info!("reasserted panel-managed config blocks on startup"),
                Ok(false) => {}
                Err(e) => tracing::warn!("could not reassert managed config blocks: {e}"),
            }
        }
    }

    // Background stats poller.
    hysteria::stats::spawn(state.clone());

    // Background host-metrics sampler (CPU/RAM/network/sockets/public IP).
    state.sys.spawn();

    // Hysteria HTTP auth backend (axum) on AUTH_ADDR.
    let auth_addr: SocketAddr = cfg.auth_addr.parse()?;
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

    // gRPC + gRPC-Web management API on GRPC_ADDR.
    let grpc_addr: SocketAddr = cfg.grpc_addr.parse()?;
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
