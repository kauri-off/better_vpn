//! Self-signed TLS certificate management for the Hysteria core.
//!
//! Generation uses `rcgen` (pure Rust, `ring` backend) to mint an Ed25519
//! self-signed cert — matching the README's manual `openssl … -newkey ed25519`
//! recipe — and `x509-parser` to inspect an existing cert for the panel UI.
//! The SHA-256 fingerprint helpers are the single source of the `pinSHA256`
//! value the panel pins into `hysteria2://` connection links.

use anyhow::{Context, Result};
use base64::Engine as _;
use rcgen::{CertificateParams, DistinguishedName, KeyPair, SanType, PKCS_ED25519};
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use std::path::Path;

/// Inspected state of a certificate file for the panel UI.
#[derive(Debug, Default, Clone)]
pub struct CertSummary {
    pub exists: bool,
    pub subject_cn: String,
    pub sans: Vec<String>,
    pub not_before: i64,
    pub not_after: i64,
    pub fingerprint_sha256: String,
    pub expired: bool,
    /// Non-empty when the file is present but couldn't be parsed.
    pub parse_error: String,
}

/// Mint an Ed25519 self-signed certificate. The subject is left empty (no
/// Common Name): clients trust the cert by `pinSHA256`, not by name, so a CN is
/// cosmetic and an empty subject leaks nothing to a prober inspecting the cert.
/// Each SAN is classified as an IP address when it parses as one, otherwise a
/// DNS name — mirroring the `IP:…,DNS:…` split a hand-rolled `openssl` SAN list
/// would use. Returns the PEM-encoded `(certificate, private_key)`.
pub fn generate_self_signed(sans: &[String], validity_days: u32) -> Result<(String, String)> {
    let mut params = CertificateParams::default();

    // rcgen's default params carry a placeholder Common Name; clear the subject
    // outright so the generated cert has no CN (it's cosmetic under pinning).
    params.distinguished_name = DistinguishedName::new();

    params.subject_alt_names = sans
        .iter()
        .map(|s| match s.parse::<IpAddr>() {
            Ok(ip) => Ok(SanType::IpAddress(ip)),
            Err(_) => Ok(SanType::DnsName(s.as_str().try_into()?)),
        })
        .collect::<Result<Vec<_>, rcgen::Error>>()
        .context("invalid SAN entry")?;

    let now = time::OffsetDateTime::now_utc();
    params.not_before = now;
    params.not_after = now + time::Duration::days(validity_days as i64);

    let key_pair = KeyPair::generate_for(&PKCS_ED25519).context("generating Ed25519 key")?;
    let cert = params
        .self_signed(&key_pair)
        .context("self-signing certificate")?;

    Ok((cert.pem(), key_pair.serialize_pem()))
}

/// Ensure a usable TLS cert/key pair exists at `cert_path`/`key_path`, minting
/// a default self-signed one if either file is missing. The defaults mirror the
/// panel's `generate_cert` (empty subject, no SAN so any client SNI is accepted,
/// ~10y validity) so the core can start on first boot, before an operator has visited
/// the panel. Returns `true` when a cert was generated, `false` when both files
/// already existed. Regenerating from the panel later replaces this in place.
pub fn ensure_default_cert(cert_path: &str, key_path: &str) -> Result<bool> {
    if Path::new(cert_path).exists() && Path::new(key_path).exists() {
        return Ok(false);
    }
    let (cert_pem, key_pem) = generate_self_signed(&[], 3650)?;
    write_pems(cert_path, key_path, &cert_pem, &key_pem)?;
    Ok(true)
}

/// Inspect the certificate at `cert_path`. Never errors: a missing file yields
/// `exists: false`, and a present-but-unparseable file is reported via
/// `parse_error` so the UI can explain instead of the RPC failing.
pub fn inspect(cert_path: &str) -> CertSummary {
    let data = match std::fs::read(cert_path) {
        Ok(d) => d,
        Err(_) => return CertSummary::default(),
    };
    let mut summary = CertSummary {
        exists: true,
        ..Default::default()
    };
    if let Some(pin) = cert_pin_sha256(cert_path) {
        summary.fingerprint_sha256 = pin;
    }

    match parse_summary(&data) {
        Ok((cn, sans, not_before, not_after)) => {
            summary.subject_cn = cn;
            summary.sans = sans;
            summary.not_before = not_before;
            summary.not_after = not_after;
            let now = time::OffsetDateTime::now_utc().unix_timestamp();
            summary.expired = now < not_before || now > not_after;
        }
        Err(e) => summary.parse_error = e.to_string(),
    }
    summary
}

/// Parse subject CN, SANs and validity window from PEM cert bytes.
fn parse_summary(pem_bytes: &[u8]) -> Result<(String, Vec<String>, i64, i64)> {
    use x509_parser::extensions::GeneralName;
    use x509_parser::prelude::*;

    let (_, pem) = parse_x509_pem(pem_bytes).context("not a valid PEM certificate")?;
    let cert = pem.parse_x509().context("not a valid X.509 certificate")?;

    let subject_cn = cert
        .subject()
        .iter_common_name()
        .next()
        .and_then(|cn| cn.as_str().ok())
        .unwrap_or("")
        .to_string();

    let mut sans = Vec::new();
    if let Ok(Some(ext)) = cert.subject_alternative_name() {
        for name in &ext.value.general_names {
            match name {
                GeneralName::DNSName(d) => sans.push(d.to_string()),
                GeneralName::IPAddress(bytes) => {
                    if let Some(ip) = ip_from_bytes(bytes) {
                        sans.push(ip.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    let not_before = cert.validity().not_before.timestamp();
    let not_after = cert.validity().not_after.timestamp();
    Ok((subject_cn, sans, not_before, not_after))
}

/// Render a SAN IP-address extension value (4 or 16 raw bytes) as an `IpAddr`.
fn ip_from_bytes(bytes: &[u8]) -> Option<IpAddr> {
    match bytes.len() {
        4 => {
            let b: [u8; 4] = bytes.try_into().ok()?;
            Some(IpAddr::from(b))
        }
        16 => {
            let b: [u8; 16] = bytes.try_into().ok()?;
            Some(IpAddr::from(b))
        }
        _ => None,
    }
}

/// SHA-256 fingerprint of the leaf certificate in `cert_path` (a PEM file),
/// formatted as uppercase colon-separated hex (e.g. `AB:CD:…`) — the value
/// Hysteria clients expect in the `pinSHA256` URI parameter. Returns `None` if
/// the file is missing/unreadable or holds no certificate, so the caller can
/// fall back to the legacy `insecure` flag.
pub fn cert_pin_sha256(cert_path: &str) -> Option<String> {
    let pem = std::fs::read_to_string(cert_path).ok()?;
    let der = pem_first_cert_der(&pem)?;
    let digest = Sha256::digest(&der);
    Some(
        digest
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect::<Vec<_>>()
            .join(":"),
    )
}

/// Decode the DER bytes of the first `CERTIFICATE` block in PEM text. Hysteria
/// pins the leaf certificate, which is the first block in a `fullchain.pem`.
pub fn pem_first_cert_der(pem: &str) -> Option<Vec<u8>> {
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";
    let start = pem.find(BEGIN)? + BEGIN.len();
    let end = pem[start..].find(END)? + start;
    let body: String = pem[start..end].split_whitespace().collect();
    base64::engine::general_purpose::STANDARD.decode(body).ok()
}

/// Write `cert_pem`/`key_pem` to their paths atomically (temp file + rename),
/// creating the parent directory if needed. The private key is written with
/// `0600` permissions on unix so only the panel/core user can read it.
pub fn write_pems(cert_path: &str, key_path: &str, cert_pem: &str, key_pem: &str) -> Result<()> {
    write_atomic(Path::new(cert_path), cert_pem.as_bytes(), false)
        .with_context(|| format!("writing {cert_path}"))?;
    write_atomic(Path::new(key_path), key_pem.as_bytes(), true)
        .with_context(|| format!("writing {key_path}"))?;
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8], private: bool) -> Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let tmp = path.with_extension("pem.tmp");
    // Remove any stale temp file so the create below applies the restrictive
    // mode to a freshly created inode rather than reusing loose permissions.
    std::fs::remove_file(&tmp).ok();
    // Create the temp file with restrictive permissions *before* writing the
    // key material, so there is no window where the private key is on disk
    // world-readable.
    let mut f = open_private(&tmp, private)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(unix)]
fn open_private(path: &Path, private: bool) -> Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    if private {
        opts.mode(0o600);
    }
    Ok(opts.open(path)?)
}

#[cfg(not(unix))]
fn open_private(path: &Path, _private: bool) -> Result<std::fs::File> {
    Ok(std::fs::File::create(path)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_leaf_cert_fingerprint() {
        // PEM whose single block decodes to b"hello" (base64 "aGVsbG8=").
        let pem = "-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----\n";
        assert_eq!(pem_first_cert_der(pem).unwrap(), b"hello");

        let path = std::env::temp_dir().join(format!("bvpn-pin-{}.pem", std::process::id()));
        std::fs::write(&path, pem).unwrap();
        let pin = cert_pin_sha256(path.to_str().unwrap()).unwrap();
        std::fs::remove_file(&path).ok();

        // SHA-256("hello"), uppercased and colon-separated.
        assert_eq!(
            pin,
            "2C:F2:4D:BA:5F:B0:A3:0E:26:E8:3B:2A:C5:B9:E2:9E:1B:16:1E:5C:1F:A7:42:5E:73:04:33:62:93:8B:98:24"
        );

        // A missing cert yields None so the caller falls back to insecure=1.
        assert!(cert_pin_sha256("/no/such/cert.pem").is_none());
    }

    #[test]
    fn generate_round_trips_through_inspect() {
        let sans = vec!["10.0.0.5".to_string(), "vpn.local".to_string()];
        let (cert_pem, key_pem) = generate_self_signed(&sans, 3650).unwrap();
        assert!(cert_pem.contains("BEGIN CERTIFICATE"));
        assert!(key_pem.contains("PRIVATE KEY"));

        let dir = std::env::temp_dir().join(format!("bvpn-cert-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cert_path = dir.join("fullchain.pem");
        let key_path = dir.join("privkey.pem");
        write_pems(
            cert_path.to_str().unwrap(),
            key_path.to_str().unwrap(),
            &cert_pem,
            &key_pem,
        )
        .unwrap();

        let info = inspect(cert_path.to_str().unwrap());
        assert!(info.exists);
        assert!(
            info.parse_error.is_empty(),
            "parse error: {}",
            info.parse_error
        );
        // No Common Name is set on generated certs.
        assert!(info.subject_cn.is_empty());
        // SANs round-trip (IP classified as IP, name as DNS).
        assert!(info.sans.contains(&"10.0.0.5".to_string()));
        assert!(info.sans.contains(&"vpn.local".to_string()));
        assert!(!info.expired);
        // ~3650 days of validity (allow a day of slack).
        let span_days = (info.not_after - info.not_before) / 86_400;
        assert!(
            (3649..=3651).contains(&span_days),
            "span_days = {span_days}"
        );
        assert!(!info.fingerprint_sha256.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_default_cert_mints_once_with_empty_subject() {
        let dir = std::env::temp_dir().join(format!("bvpn-ensure-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cert_path = dir.join("fullchain.pem");
        let key_path = dir.join("privkey.pem");
        let c = cert_path.to_str().unwrap();
        let k = key_path.to_str().unwrap();

        // First call mints the pair with an empty subject and no SAN.
        assert!(ensure_default_cert(c, k).unwrap());
        let info = inspect(c);
        assert!(info.exists && info.parse_error.is_empty());
        assert!(info.subject_cn.is_empty());
        assert!(info.sans.is_empty());
        assert!(!info.expired);

        // Second call is a no-op once both files are present.
        assert!(!ensure_default_cert(c, k).unwrap());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn inspect_missing_file() {
        let info = inspect("/no/such/cert.pem");
        assert!(!info.exists);
        assert!(info.subject_cn.is_empty());
    }
}
