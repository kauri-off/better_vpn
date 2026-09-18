//! Hysteria server config management: typed view of panel-managed fields,
//! YAML round-trip that preserves unknown/manual keys, validation, and
//! reassertion of the panel-required blocks.

pub mod manager;
pub mod model;

pub use manager::ConfigManager;

/// Port from a Hysteria `listen` value (`:443`, `0.0.0.0:8443`, `[::]:443`); 443 if absent.
pub fn listen_port(listen: &str) -> u16 {
    listen
        .rsplit(':')
        .next()
        .and_then(|p| p.parse().ok())
        .filter(|&p| p != 0)
        .unwrap_or(443)
}

/// Replace the port in a `listen` value, keeping any bind host prefix.
pub fn set_listen_port(listen: &str, port: &str) -> String {
    let listen = listen.trim();
    let host = match listen.rfind(':') {
        Some(i) => &listen[..i],
        None => listen,
    };
    format!("{host}:{port}")
}

#[cfg(test)]
mod listen_tests {
    use super::*;

    #[test]
    fn parses_listen_port_with_default() {
        assert_eq!(listen_port(":443"), 443);
        assert_eq!(listen_port("0.0.0.0:8443"), 8443);
        assert_eq!(listen_port("[::]:443"), 443);
        assert_eq!(listen_port(""), 443);
        assert_eq!(listen_port("garbage"), 443);
    }

    #[test]
    fn sets_listen_port_preserving_host() {
        assert_eq!(set_listen_port(":443", "8443"), ":8443");
        assert_eq!(set_listen_port("1.2.3.4:443", "8443"), "1.2.3.4:8443");
        assert_eq!(set_listen_port("[::]:443", "8443"), "[::]:8443");
        assert_eq!(set_listen_port("", "8443"), ":8443");
    }
}
