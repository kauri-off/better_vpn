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
        let resolver_type = nested_str(&m, &["resolver", "type"]);
        let (resolver_addr, resolver_timeout, resolver_sni) = if resolver_type.is_empty() {
            (String::new(), String::new(), String::new())
        } else {
            let t = resolver_type.as_str();
            (
                nested_str(&m, &["resolver", t, "addr"]),
                nested_str(&m, &["resolver", t, "timeout"]),
                nested_str(&m, &["resolver", t, "sni"]),
            )
        };
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
            acl_inline: nested_str_list(&m, &["acl", "inline"]),
            resolver_type,
            resolver_addr,
            resolver_timeout,
            resolver_sni,
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

        // ACL: only `acl.inline` is managed; `acl.file` and other subkeys are
        // preserved, and the `acl` mapping is dropped once nothing remains.
        if sc.acl_inline.is_empty() {
            remove_nested_and_prune(m, "acl", "inline");
        } else {
            set_nested_str_list(m, &["acl", "inline"], &sc.acl_inline);
        }

        if sc.resolver_type.is_empty() {
            m.remove(Value::from("resolver"));
        } else {
            if sc.resolver_addr.is_empty() {
                anyhow::bail!("resolver address is required when a resolver is enabled");
            }
            set_nested(m, &["resolver", "type"], &sc.resolver_type);
            let t = sc.resolver_type.as_str();
            set_nested(m, &["resolver", t, "addr"], &sc.resolver_addr);
            set_nested(m, &["resolver", t, "timeout"], &sc.resolver_timeout);
            if matches!(t, "tls" | "https") {
                set_nested(m, &["resolver", t, "sni"], &sc.resolver_sni);
            }
            // Drop the blocks of previously selected types so a type change
            // doesn't leave two competing configurations behind.
            if let Some(Value::Mapping(r)) = m.get_mut(Value::from("resolver")) {
                for other in RESOLVER_TYPES.iter().filter(|o| **o != t) {
                    r.remove(Value::from(*other));
                }
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

/// Resolver types Hysteria supports; the settings block lives under the key
/// matching the type (e.g. `resolver.https.addr`).
const RESOLVER_TYPES: [&str; 5] = ["dns", "udp", "tcp", "tls", "https"];

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

/// Read a nested value as a list of scalar strings. Missing key or a
/// non-sequence value yields an empty list; non-string items are skipped.
fn nested_str_list(m: &Mapping, path: &[&str]) -> Vec<String> {
    let (leaf, parents) = path.split_last().expect("non-empty path");
    let mut cur = m;
    for key in parents {
        match cur.get(Value::from(*key)) {
            Some(Value::Mapping(next)) => cur = next,
            _ => return Vec::new(),
        }
    }
    match cur.get(Value::from(*leaf)) {
        Some(Value::Sequence(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

/// Set a nested sequence-of-strings value, creating intermediate mappings.
/// An empty slice removes the leaf.
fn set_nested_str_list(m: &mut Mapping, path: &[&str], vals: &[String]) {
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
    if vals.is_empty() {
        cur.remove(&leaf_key);
    } else {
        let seq = vals.iter().map(|v| Value::from(v.as_str())).collect();
        cur.insert(leaf_key, Value::Sequence(seq));
    }
}

/// Remove `child` from the mapping at `parent`, dropping `parent` itself if it
/// ends up empty.
fn remove_nested_and_prune(m: &mut Mapping, parent: &str, child: &str) {
    let parent_key = Value::from(parent);
    if let Some(Value::Mapping(inner)) = m.get_mut(&parent_key) {
        inner.remove(Value::from(child));
        if inner.is_empty() {
            m.remove(&parent_key);
        }
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
            "listen: \":443\"\nmyCustomKey:\n  keep: yes\nignoreClientBandwidth: true\n",
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

    fn test_managed() -> ManagedBlocks {
        ManagedBlocks {
            auth_url: "http://127.0.0.1:8080/auth".into(),
            stats_listen: "127.0.0.1:9999".into(),
            stats_secret: "s3cret".into(),
        }
    }

    fn test_mgr(name: &str, yaml: &str) -> (ConfigManager, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("cfgtest-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.yaml");
        std::fs::write(&path, yaml).unwrap();
        (ConfigManager::new(&path), dir)
    }

    #[test]
    fn acl_inline_round_trip() {
        let (mgr, dir) = test_mgr(
            "acl",
            "listen: \":443\"\nacl:\n  file: /etc/rules.txt\n  inline:\n    - reject(10.0.0.0/8)\n",
        );

        let mut sc = mgr.structured_view().unwrap();
        assert_eq!(sc.acl_inline, vec!["reject(10.0.0.0/8)".to_string()]);

        sc.acl_inline.push("direct(all)".into());
        mgr.apply_structured(&sc, &test_managed()).unwrap();

        let sc2 = mgr.structured_view().unwrap();
        assert_eq!(
            sc2.acl_inline,
            vec!["reject(10.0.0.0/8)".to_string(), "direct(all)".to_string()]
        );
        let raw = mgr.read_raw().unwrap();
        assert!(raw.contains("/etc/rules.txt"), "acl.file must survive:\n{raw}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn acl_cleared_keeps_file_and_prunes_empty_acl() {
        // With a sibling `file` key, clearing inline keeps `acl`.
        let (mgr, dir) = test_mgr(
            "acl-clear",
            "acl:\n  file: /etc/rules.txt\n  inline:\n    - direct(all)\n",
        );
        let mut sc = mgr.structured_view().unwrap();
        sc.acl_inline.clear();
        mgr.apply_structured(&sc, &test_managed()).unwrap();
        let raw = mgr.read_raw().unwrap();
        assert!(raw.contains("/etc/rules.txt"));
        assert!(!raw.contains("inline"));
        let _ = std::fs::remove_dir_all(&dir);

        // With inline only, clearing it prunes the whole `acl` mapping.
        let (mgr, dir) = test_mgr("acl-prune", "acl:\n  inline:\n    - direct(all)\n");
        let mut sc = mgr.structured_view().unwrap();
        sc.acl_inline.clear();
        mgr.apply_structured(&sc, &test_managed()).unwrap();
        let raw = mgr.read_raw().unwrap();
        assert!(!raw.contains("acl"), "empty acl mapping must be pruned:\n{raw}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolver_extract_apply_switch_off() {
        let (mgr, dir) = test_mgr(
            "resolver",
            "resolver:\n  type: https\n  https:\n    addr: 1.1.1.1:443\n    sni: cloudflare-dns.com\n    timeout: 10s\n",
        );

        let mut sc = mgr.structured_view().unwrap();
        assert_eq!(sc.resolver_type, "https");
        assert_eq!(sc.resolver_addr, "1.1.1.1:443");
        assert_eq!(sc.resolver_sni, "cloudflare-dns.com");
        assert_eq!(sc.resolver_timeout, "10s");

        // Switching the type must drop the old type's block.
        sc.resolver_type = "udp".into();
        sc.resolver_addr = "8.8.8.8:53".into();
        mgr.apply_structured(&sc, &test_managed()).unwrap();
        let raw = mgr.read_raw().unwrap();
        assert!(raw.contains("udp"));
        assert!(raw.contains("8.8.8.8:53"));
        assert!(!raw.contains("https:"), "stale https block must go:\n{raw}");

        // Blank type removes the resolver entirely.
        let mut sc = mgr.structured_view().unwrap();
        sc.resolver_type = String::new();
        mgr.apply_structured(&sc, &test_managed()).unwrap();
        let raw = mgr.read_raw().unwrap();
        assert!(!raw.contains("resolver"), "resolver must be removed:\n{raw}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolver_requires_addr() {
        let (mgr, dir) = test_mgr("resolver-addr", "listen: \":443\"\n");
        let mut sc = mgr.structured_view().unwrap();
        sc.resolver_type = "https".into();
        assert!(mgr.apply_structured(&sc, &test_managed()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolver_unknown_subkey_preserved() {
        let (mgr, dir) = test_mgr(
            "resolver-extra",
            "resolver:\n  type: https\n  https:\n    addr: 1.1.1.1:443\n    insecure: true\n",
        );
        let mut sc = mgr.structured_view().unwrap();
        sc.resolver_timeout = "5s".into();
        mgr.apply_structured(&sc, &test_managed()).unwrap();
        let raw = mgr.read_raw().unwrap();
        assert!(raw.contains("insecure"), "unmanaged subkey must survive:\n{raw}");
        assert!(raw.contains("5s"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
