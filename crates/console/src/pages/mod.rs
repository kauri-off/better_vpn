//! Nested menu pages. Each module exposes `page(ctx)` — a loop that renders its
//! own `Select` and dispatches to the matching RPCs, returning to the caller
//! (the parent menu) on "Back"/Esc.

pub mod cert;
pub mod config;
pub mod core;
pub mod settings;
pub mod stats;
pub mod users;
