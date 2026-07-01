//! Generated gRPC types and services for the Better VPN panel.
//!
//! The `.proto` is the single source of truth shared by the backend (server),
//! the console (client) and the web panel (Connect-ES, generated separately).

pub mod panel {
    tonic::include_proto!("panel");
}

pub use panel::*;
