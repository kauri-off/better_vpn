//! Host system-metrics monitor.
//!
//! A single background task samples CPU, memory, network throughput and socket
//! counts every few seconds and publishes the latest snapshot behind a mutex,
//! so `GetServerStats` can read it cheaply without blocking on a fresh probe.
//! Public IPs are resolved out-of-band and refreshed infrequently.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{Networks, System};

/// How often the metrics loop ticks. Also the window over which CPU% and the
/// network rates are measured.
const TICK: Duration = Duration::from_secs(2);
/// Re-resolve public IPs roughly every 5 minutes (150 ticks * 2s).
const IP_REFRESH_TICKS: u64 = 150;

#[derive(Clone, Default)]
pub struct SysSnapshot {
    pub cpu_percent: f64,
    pub mem_used: u64,
    pub mem_total: u64,
    pub uptime_secs: u64,
    pub net_rx_rate: u64,
    pub net_tx_rate: u64,
    pub reboot_rx: u64,
    pub reboot_tx: u64,
    pub tcp_conns: u32,
    pub udp_conns: u32,
    pub ipv4: String,
    pub ipv6: String,
}

#[derive(Clone)]
pub struct SysMonitor {
    inner: Arc<Mutex<SysSnapshot>>,
}

impl SysMonitor {
    pub fn new() -> Self {
        Self { inner: Arc::new(Mutex::new(SysSnapshot::default())) }
    }

    /// Latest sampled metrics. Returns a zeroed snapshot until the first tick.
    pub fn snapshot(&self) -> SysSnapshot {
        self.inner.lock().expect("sysmon mutex").clone()
    }

    /// Start the background sampling loop. Call once, after entering the Tokio
    /// runtime.
    pub fn spawn(&self) {
        let inner = self.inner.clone();
        tokio::spawn(run(inner));
    }
}

impl Default for SysMonitor {
    fn default() -> Self {
        Self::new()
    }
}

async fn run(inner: Arc<Mutex<SysSnapshot>>) {
    let mut sys = System::new();
    let mut nets = Networks::new_with_refreshed_list();
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .expect("sysmon http client");

    // Prime CPU usage so the first computed value is meaningful.
    sys.refresh_cpu_usage();
    let mut last = Instant::now();
    let mut ip_age = IP_REFRESH_TICKS; // force a resolve on the first tick
    let (mut ipv4, mut ipv6) = (String::new(), String::new());

    loop {
        tokio::time::sleep(TICK).await;
        let elapsed = last.elapsed().as_secs_f64().max(0.001);
        last = Instant::now();

        sys.refresh_cpu_usage();
        sys.refresh_memory();
        nets.refresh(true);

        let (mut tot_rx, mut tot_tx, mut d_rx, mut d_tx) = (0u64, 0u64, 0u64, 0u64);
        for (name, data) in &nets {
            if name == "lo" {
                continue; // loopback is not real throughput
            }
            tot_rx += data.total_received();
            tot_tx += data.total_transmitted();
            d_rx += data.received();
            d_tx += data.transmitted();
        }

        let (tcp_conns, udp_conns) = count_sockets();

        if ip_age >= IP_REFRESH_TICKS {
            ip_age = 0;
            ipv4 = resolve_ip(&http, "https://api.ipify.org").await;
            ipv6 = resolve_ip(&http, "https://api6.ipify.org").await;
        }
        ip_age += 1;

        let snap = SysSnapshot {
            cpu_percent: sys.global_cpu_usage() as f64,
            mem_used: sys.used_memory(),
            mem_total: sys.total_memory(),
            uptime_secs: System::uptime(),
            net_rx_rate: (d_rx as f64 / elapsed) as u64,
            net_tx_rate: (d_tx as f64 / elapsed) as u64,
            reboot_rx: tot_rx,
            reboot_tx: tot_tx,
            tcp_conns,
            udp_conns,
            ipv4: ipv4.clone(),
            ipv6: ipv6.clone(),
        };
        *inner.lock().expect("sysmon mutex") = snap;
    }
}

/// Best-effort public IP lookup; empty string on any failure.
async fn resolve_ip(http: &reqwest::Client, url: &str) -> String {
    match http.get(url).send().await {
        Ok(resp) => match resp.error_for_status() {
            Ok(resp) => resp.text().await.unwrap_or_default().trim().to_string(),
            Err(_) => String::new(),
        },
        Err(_) => String::new(),
    }
}

/// Count entries in the kernel's TCP and UDP socket tables (IPv4 + IPv6).
/// Linux-only; returns (0, 0) elsewhere.
#[cfg(target_os = "linux")]
fn count_sockets() -> (u32, u32) {
    fn rows(path: &str) -> u32 {
        std::fs::read_to_string(path)
            .map(|s| s.lines().count().saturating_sub(1) as u32) // drop header row
            .unwrap_or(0)
    }
    let tcp = rows("/proc/net/tcp") + rows("/proc/net/tcp6");
    let udp = rows("/proc/net/udp") + rows("/proc/net/udp6");
    (tcp, udp)
}

#[cfg(not(target_os = "linux"))]
fn count_sockets() -> (u32, u32) {
    (0, 0)
}
