//! Persists the admin bearer token between invocations.
//!
//! Resolution order for the path: `$VPNCTL_TOKEN_FILE`, else
//! `$HOME/.config/vpnctl/token` (or `%USERPROFILE%` on Windows). A token given
//! directly via `$VPNCTL_TOKEN` takes precedence on load.

use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;

fn token_path() -> PathBuf {
    if let Ok(p) = std::env::var("VPNCTL_TOKEN_FILE") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".config").join("vpnctl").join("token")
}

pub fn load() -> Result<String> {
    if let Ok(t) = std::env::var("VPNCTL_TOKEN") {
        if !t.is_empty() {
            return Ok(t);
        }
    }
    let path = token_path();
    let t = fs::read_to_string(&path)
        .with_context(|| format!("reading token from {}", path.display()))?;
    Ok(t.trim().to_string())
}

pub fn save(token: &str) -> Result<()> {
    let path = token_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    write_token(&path, token)
        .with_context(|| format!("writing token to {}", path.display()))?;
    Ok(())
}

#[cfg(unix)]
fn write_token(path: &std::path::Path, token: &str) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    // Create with 0600 *before* writing the token so it is never momentarily
    // world-readable. Remove any stale file first so the mode applies to a
    // freshly created inode rather than reusing loose permissions.
    fs::remove_file(path).ok();
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(token.as_bytes())?;
    Ok(())
}

#[cfg(not(unix))]
fn write_token(path: &std::path::Path, token: &str) -> Result<()> {
    fs::write(path, token)?;
    Ok(())
}
