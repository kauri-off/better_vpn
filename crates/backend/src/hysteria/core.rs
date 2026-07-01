//! Hysteria 2 core binary management: version detection and in-place updates.
//!
//! The panel runs unprivileged but owns the directory holding the core binary
//! (see deploy/hysteria.service), so it can probe `<bin> version` and swap the
//! binary for an updated release without root. The systemd unit is restarted
//! separately (grpc::restart_core) to pick up the new binary.

use std::time::Duration;

use anyhow::{bail, Context};

/// Run `<bin> version` and return the reported version (e.g. `v2.6.0`).
///
/// `hysteria version` prints a block of `Label: value` lines; we read the
/// `Version:` line. Returns `None` on any failure or when the binary reports an
/// empty / `Unknown` version (a core not built with release ldflags).
pub async fn detect_version(bin: &str) -> Option<String> {
    let run = tokio::process::Command::new(bin).arg("version").output();
    let out = tokio::time::timeout(Duration::from_secs(5), run).await.ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let version = parse_version(&stdout)?;
    if version.is_empty() || version.eq_ignore_ascii_case("unknown") {
        None
    } else {
        Some(version)
    }
}

/// Extract the value of the `Version:` line from `hysteria version` output.
fn parse_version(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.trim().strip_prefix("Version:"))
        .map(|v| v.trim().to_string())
}

/// Default release asset URL for the current architecture. Mirrors the manual
/// install step in the README.
pub fn default_download_url() -> String {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => other,
    };
    format!("https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-{arch}")
}

/// Download the core release at `url`, validate it, and atomically replace the
/// binary at `bin`. Returns the new version. The caller restarts the service.
///
/// The download lands in a sibling temp file (same directory => same
/// filesystem, so the final rename is atomic), is marked executable, and is
/// validated by running `version` on it before the swap — a corrupt download or
/// an HTML error page never replaces a working binary.
pub async fn update(bin: &str, url: &str) -> anyhow::Result<String> {
    let bin_path = std::path::Path::new(bin);
    let dir = bin_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .context("core binary path has no parent directory")?;
    let tmp = bin_path.with_extension("new");

    // Download (follows GitHub's latest/download redirect by default).
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .context("building http client")?;
    let resp = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("downloading core from {url}"))?
        .error_for_status()
        .with_context(|| format!("downloading core from {url}"))?;
    let bytes = resp.bytes().await.context("reading core download body")?;
    if bytes.len() < 1024 {
        bail!("downloaded core is implausibly small ({} bytes)", bytes.len());
    }

    // Write to the temp file and mark it executable.
    tokio::fs::write(&tmp, &bytes)
        .await
        .with_context(|| format!("writing {}", tmp.display()))?;
    set_executable(&tmp).await?;

    // Validate the freshly downloaded binary before swapping it in.
    let version = match detect_version(&tmp.to_string_lossy()).await {
        Some(v) => v,
        None => {
            let _ = tokio::fs::remove_file(&tmp).await;
            bail!("downloaded file is not a working hysteria binary");
        }
    };

    // Atomic replace. Renaming over a running binary is safe on Linux: the
    // running process keeps the old inode until it is restarted.
    tokio::fs::rename(&tmp, bin_path)
        .await
        .with_context(|| format!("replacing {} (is {} writable?)", bin_path.display(), dir.display()))?;

    Ok(version)
}

#[cfg(unix)]
async fn set_executable(path: &std::path::Path) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = tokio::fs::metadata(path).await?.permissions();
    perms.set_mode(0o755);
    tokio::fs::set_permissions(path, perms).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn set_executable(_path: &std::path::Path) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn parses_version_line() {
        let out = "Hysteria\nVersion:\tv2.6.0\nBuildDate:\t2024-01-01\n";
        assert_eq!(parse_version(out).as_deref(), Some("v2.6.0"));
    }

    #[test]
    fn missing_version_line() {
        assert_eq!(parse_version("no version here\n"), None);
    }
}
