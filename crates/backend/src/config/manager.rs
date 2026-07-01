//! Reads and writes the Hysteria `config.yaml` while preserving any keys the
//! panel does not manage. All writes are validated and written atomically
//! (temp file + rename).

use super::model::{ManagedBlocks, StructuredConfig};
use anyhow::{Context, Result};
use serde_norway::{Mapping, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Serializes the read-modify-write cycle on `config.yaml`. `ConfigManager` is
/// constructed per-request (so a per-instance lock would protect nothing); the
/// panel manages a single config file, so one process-wide lock is sufficient
/// to stop a concurrent save from clobbering another's edits.
static CONFIG_WRITE_LOCK: Mutex<()> = Mutex::new(());

pub struct ConfigManager {
    path: PathBuf,
}

impl ConfigManager {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn read_raw(&self) -> Result<String> {
        if !self.path.exists() {
            return Ok(String::new());
        }
        fs::read_to_string(&self.path).with_context(|| format!("reading {}", self.path.display()))
    }

    fn read_value(&self) -> Result<Value> {
        let raw = self.read_raw()?;
        let raw = strip_bom(&raw);
        if raw.trim().is_empty() {
            return Ok(Value::Mapping(Mapping::new()));
        }
        let v: Value = serde_norway::from_str(raw).context("config.yaml is not valid YAML")?;
        match v {
            Value::Mapping(_) => Ok(v),
            _ => Ok(Value::Mapping(Mapping::new())),
        }
    }

    /// Extract the panel-managed fields for the structured editor.
    pub fn structured_view(&self) -> Result<StructuredConfig> {
        let v = self.read_value()?;
        let m = v.as_mapping().cloned().unwrap_or_default();
        Ok(StructuredConfig {
            listen: get_str(&m, "listen"),
            tls_cert: nested_str(&m, &["tls", "cert"]),
            tls_key: nested_str(&m, &["tls", "key"]),
            obfs_type: nested_str(&m, &["obfs", "type"]),
            obfs_password: nested_str(&m, &["obfs", "salamander", "password"]),
            bandwidth_up: nested_str(&m, &["bandwidth", "up"]),
            bandwidth_down: nested_str(&m, &["bandwidth", "down"]),
            masquerade_type: nested_str(&m, &["masquerade", "type"]),
            masquerade_proxy_url: nested_str(&m, &["masquerade", "proxy", "url"]),
            masquerade_string_content: nested_str(&m, &["masquerade", "string", "content"]),
        })
    }

    /// Apply the structured editor form, preserving unmanaged keys.
    /// Returns whether the managed (auth/trafficStats) blocks had to be reasserted.
    pub fn apply_structured(&self, sc: &StructuredConfig, managed: &ManagedBlocks) -> Result<bool> {
        let _guard = CONFIG_WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut v = self.read_value()?;
        let m = v.as_mapping_mut().expect("mapping");

        set_or_remove(m, "listen", &sc.listen);

        set_nested(m, &["tls", "cert"], &sc.tls_cert);
        set_nested(m, &["tls", "key"], &sc.tls_key);

        // The panel uses static self-signed certs only; drop any `acme` block so
        // it can never conflict with `tls` (Hysteria rejects having both).
        m.remove(Value::from("acme"));

        if sc.obfs_type.is_empty() {
            m.remove(Value::from("obfs"));
        } else {
            set_nested(m, &["obfs", "type"], &sc.obfs_type);
            set_nested(m, &["obfs", "salamander", "password"], &sc.obfs_password);
        }

        set_nested(m, &["bandwidth", "up"], &sc.bandwidth_up);
        set_nested(m, &["bandwidth", "down"], &sc.bandwidth_down);

        if sc.masquerade_type.is_empty() {
            m.remove(Value::from("masquerade"));
        } else {
            set_nested(m, &["masquerade", "type"], &sc.masquerade_type);
            if !sc.masquerade_proxy_url.is_empty() {
                set_nested(m, &["masquerade", "proxy", "url"], &sc.masquerade_proxy_url);
            }
            if !sc.masquerade_string_content.is_empty() {
                set_nested(
                    m,
                    &["masquerade", "string", "content"],
                    &sc.masquerade_string_content,
                );
            }
        }

        let reasserted = reassert_managed(m, managed);
        self.validate_and_write(&v)?;
        Ok(reasserted)
    }

    /// Replace the whole file from raw YAML text (still reasserting managed blocks).
    pub fn apply_raw(&self, raw: &str, managed: &ManagedBlocks) -> Result<bool> {
        let _guard = CONFIG_WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut v: Value =
            serde_norway::from_str(strip_bom(raw)).context("submitted YAML is invalid")?;
        if v.as_mapping().is_none() {
            anyhow::bail!("config root must be a YAML mapping");
        }
        let m = v.as_mapping_mut().unwrap();
        let reasserted = reassert_managed(m, managed);
        self.validate_and_write(&v)?;
        Ok(reasserted)
    }

    /// Reassert managed blocks against the on-disk file without other edits.
    /// Used after manual edits or migrations. Returns whether anything changed.
    pub fn ensure_managed(&self, managed: &ManagedBlocks) -> Result<bool> {
        let _guard = CONFIG_WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut v = self.read_value()?;
        let m = v.as_mapping_mut().unwrap();
        let changed = reassert_managed(m, managed);
        if changed {
            self.validate_and_write(&v)?;
        }
        Ok(changed)
    }

    fn validate_and_write(&self, v: &Value) -> Result<()> {
        validate(v)?;
        let yaml = serde_norway::to_string(v).context("serializing config")?;

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).ok();
        }
        let tmp = self.path.with_extension("yaml.tmp");
        fs::write(&tmp, yaml.as_bytes()).context("writing temp config")?;
        fs::rename(&tmp, &self.path).context("swapping config into place")?;
        Ok(())
    }
}

/// Ensure the panel-required `auth` and `trafficStats` blocks are present and
/// correct so manual edits can't sever the panel<->core integration. Returns
/// true if any value had to be (re)set.
pub fn reassert_managed(m: &mut Mapping, managed: &ManagedBlocks) -> bool {
    let mut changed = false;

    changed |= set_nested(m, &["auth", "type"], "http");
    changed |= set_nested(m, &["auth", "http", "url"], &managed.auth_url);
    changed |= set_nested(m, &["trafficStats", "listen"], &managed.stats_listen);
    if !managed.stats_secret.is_empty() {
        changed |= set_nested(m, &["trafficStats", "secret"], &managed.stats_secret);
    }

    changed
}

/// Lightweight validation: valid YAML mapping with the required blocks. We do
/// not start the core here (no official dry-run); reassertion guarantees the
/// integration blocks exist.
pub fn validate(v: &Value) -> Result<()> {
    let m = v.as_mapping().context("config root must be a mapping")?;
    if nested_str(m, &["auth", "type"]) != "http" {
        anyhow::bail!("auth.type must be 'http' for the panel to manage users");
    }
    if nested_str(m, &["trafficStats", "listen"]).is_empty() {
        anyhow::bail!("trafficStats.listen is required for statistics");
    }
    Ok(())
}

/// Strip a leading UTF-8 BOM, which serde_norway rejects. Hand-editors on some
/// platforms (and PowerShell's `utf8` encoding) prepend one.
fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

// ---------------- YAML mapping helpers ----------------

fn get_str(m: &Mapping, key: &str) -> String {
    m.get(Value::from(key))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn nested_str(m: &Mapping, path: &[&str]) -> String {
    let mut cur = m;
    for (i, key) in path.iter().enumerate() {
        match cur.get(Value::from(*key)) {
            Some(v) if i == path.len() - 1 => return v.as_str().unwrap_or("").to_string(),
            Some(Value::Mapping(next)) => cur = next,
            _ => return String::new(),
        }
    }
    String::new()
}

fn set_or_remove(m: &mut Mapping, key: &str, val: &str) {
    if val.is_empty() {
        m.remove(Value::from(key));
    } else {
        m.insert(Value::from(key), Value::from(val));
    }
}

/// Set a nested string value, creating intermediate mappings. Empty value
/// removes the leaf. Returns true if the resulting value differs from before.
fn set_nested(m: &mut Mapping, path: &[&str], val: &str) -> bool {
    let (leaf, parents) = path.split_last().expect("non-empty path");
    let mut cur = m;
    for key in parents {
        let entry = cur
            .entry(Value::from(*key))
            .or_insert_with(|| Value::Mapping(Mapping::new()));
        if !entry.is_mapping() {
            *entry = Value::Mapping(Mapping::new());
        }
        cur = entry.as_mapping_mut().unwrap();
    }
    let leaf_key = Value::from(*leaf);
    if val.is_empty() {
        cur.remove(&leaf_key).is_some()
    } else {
        let new = Value::from(val);
        match cur.get(&leaf_key) {
            Some(existing) if existing == &new => false,
            _ => {
                cur.insert(leaf_key, new);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_preserves_unknown_keys() {
        let dir = std::env::temp_dir().join(format!("cfgtest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.yaml");
        std::fs::write(
            &path,
            "listen: \":443\"\nmyCustomKey:\n  keep: yes\nresolver:\n  type: udp\n",
        )
        .unwrap();

        let mgr = ConfigManager::new(&path);
        let managed = ManagedBlocks {
            auth_url: "http://127.0.0.1:8080/auth".into(),
            stats_listen: "127.0.0.1:9999".into(),
            stats_secret: "s3cret".into(),
        };
        let mut sc = mgr.structured_view().unwrap();
        sc.bandwidth_up = "100 mbps".into();
        mgr.apply_structured(&sc, &managed).unwrap();

        let raw = mgr.read_raw().unwrap();
        assert!(raw.contains("myCustomKey"), "manual key must survive");
        assert!(raw.contains("keep"));
        assert!(raw.contains("100 mbps"));
        assert!(raw.contains("trafficStats"));
        assert!(raw.contains("s3cret"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn existing_acme_block_is_dropped_on_save() {
        let dir = std::env::temp_dir().join(format!("cfgtest-acme-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.yaml");
        // A hand-written acme block must be removed on save so it can't conflict
        // with the static tls cert the panel manages.
        std::fs::write(
            &path,
            "listen: \":443\"\nacme:\n  domains:\n    - vpn.example.com\n  email: a@b.c\n",
        )
        .unwrap();

        let mgr = ConfigManager::new(&path);
        let managed = ManagedBlocks {
            auth_url: "http://127.0.0.1:8080/auth".into(),
            stats_listen: "127.0.0.1:9999".into(),
            stats_secret: "s3cret".into(),
        };
        // Mimic generate_cert: set a static tls cert.
        let mut sc = mgr.structured_view().unwrap();
        sc.tls_cert = "/etc/hysteria/fullchain.pem".into();
        sc.tls_key = "/etc/hysteria/privkey.pem".into();
        mgr.apply_structured(&sc, &managed).unwrap();

        let raw = mgr.read_raw().unwrap();
        assert!(raw.contains("fullchain.pem"), "tls cert must be set");
        assert!(!raw.contains("acme"), "acme block must be dropped:\n{raw}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
