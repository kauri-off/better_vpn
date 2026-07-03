//! Typed view of the panel-managed subset of the Hysteria config. Only these
//! fields are surfaced/edited via the structured form; everything else in the
//! file is preserved verbatim.

#[derive(Debug, Default, Clone)]
pub struct StructuredConfig {
    pub listen: String,
    pub tls_cert: String,
    pub tls_key: String,
    pub obfs_type: String,
    pub obfs_password: String,
    pub bandwidth_up: String,
    pub bandwidth_down: String,
    pub masquerade_type: String,
    pub masquerade_proxy_url: String,
    pub masquerade_string_content: String,
    pub acl_inline: Vec<String>,
    pub resolver_type: String,
    pub resolver_addr: String,
    pub resolver_timeout: String,
    pub resolver_sni: String,
}

/// Parameters for the blocks the panel manages and reasserts on every save.
#[derive(Debug, Clone)]
pub struct ManagedBlocks {
    /// e.g. `http://127.0.0.1:8080/auth`
    pub auth_url: String,
    /// e.g. `127.0.0.1:9999`
    pub stats_listen: String,
    pub stats_secret: String,
}
