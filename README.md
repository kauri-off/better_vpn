<p align="center">
  <img src="assets/wordmark.svg" alt="Better VPN" width="320" />
</p>

<p align="center">
  A self-hosted management panel for a <b>single</b>
  <a href="https://v2.hysteria.network/">Hysteria 2</a> server.
</p>

## Deploy

Nothing here is automated for you. These are Ubuntu commands; adapt them for
your distro. Run them from a clone of the repo.

### Clone the repo

```bash
git clone https://github.com/kauri-off/better_vpn.git
cd better_vpn
```

### System user and directories

```bash
sudo useradd --system --home /var/lib/better_vpn --shell /usr/sbin/nologin better_vpn
sudo mkdir -p /var/lib/better_vpn/bin /etc/hysteria /etc/better_vpn /var/www/better_vpn
sudo chown -R better_vpn:better_vpn /var/lib/better_vpn /etc/hysteria
```

### Hysteria core

```bash
curl -L -o /tmp/hysteria   https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-amd64
sudo install -o better_vpn -g better_vpn /tmp/hysteria /var/lib/better_vpn/bin/hysteria

sudo cp deploy/config.example.yaml /etc/hysteria/config.yaml
sudo chown better_vpn:better_vpn /etc/hysteria/config.yaml
```

### Backend

```bash
curl -L https://github.com/kauri-off/better_vpn/releases/latest/download/better-vpn-backend-x86_64-unknown-linux-gnu.tar.gz | tar -xz
sudo install vpn-backend /usr/local/bin/vpn-backend
sudo install vpnctl /usr/local/bin/vpnctl

sudo cp deploy/panel.env.example /etc/better_vpn/panel.env

ENVF=/etc/better_vpn/panel.env
# Set the admin access token (this single token logs into the panel and vpnctl).
# Omit the value to have a strong random one generated. The token is printed
# once and stored only as a hash — copy it now.
sudo -u better_vpn vpn-backend --env-file $ENVF admin set-token
sudo -u better_vpn vpn-backend --env-file $ENVF set port 1935
sudo -u better_vpn vpn-backend --env-file $ENVF set sni google.com

# Optional: every DB-backed setting with its default (see panel.env.example).
# sudo -u better_vpn vpn-backend --env-file $ENVF set stats_url          http://127.0.0.1:9999 # Traffic Stats API base URL
# sudo -u better_vpn vpn-backend --env-file $ENVF set core_config        /etc/hysteria/config.yaml # Hysteria config.yaml path
# sudo -u better_vpn vpn-backend --env-file $ENVF set poll_interval_secs 10                    # stats poll interval (seconds)
# sudo -u better_vpn vpn-backend --env-file $ENVF set grpc_addr          127.0.0.1:50051       # management listener (restart to apply)
# sudo -u better_vpn vpn-backend --env-file $ENVF set auth_addr          127.0.0.1:8080        # Hysteria auth listener (restart to apply)
# sudo -u better_vpn vpn-backend --env-file $ENVF set core_service       hysteria.service      # systemd unit restarted by the panel
# sudo -u better_vpn vpn-backend --env-file $ENVF set core_bin           /var/lib/better_vpn/bin/hysteria # core binary path
```

### systemd

```bash
sudo cp deploy/hysteria.service deploy/vpn-panel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vpn-panel
sudo systemctl enable --now hysteria
```

#### Restart-core button (optional)

```bash
sudo cp deploy/polkit-better-vpn.rules /etc/polkit-1/rules.d/49-better-vpn.rules
sudo systemctl restart polkit
```

The unit name is `hysteria.service` by default; override it with
`vpn-backend --env-file $ENVF set core_service <unit>` (and match it in the rule).

### (Optional) Web panel + Caddy (subpath)

```bash
sudo apt-get update && sudo apt-get install -y caddy
curl -L https://github.com/kauri-off/better_vpn/releases/latest/download/better-vpn-webpanel.tar.gz | sudo tar -xz --no-same-owner -C /var/www/better_vpn
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
```

**Edit** `/etc/caddy/Caddyfile`: replace `vpn.example.com` with your real domain (it must have a DNS A/AAAA record pointing at this server for HTTPS to work).

```bash
sudo systemctl reload caddy
```

Open `https://vpn.example.com/panel/` and log in.

---

## Update

### Backend + vpnctl

```bash
sudo systemctl stop vpn-panel
curl -L https://github.com/kauri-off/better_vpn/releases/latest/download/better-vpn-backend-x86_64-unknown-linux-gnu.tar.gz | tar -xz
sudo install vpn-backend /usr/local/bin/vpn-backend
sudo install vpnctl /usr/local/bin/vpnctl
sudo systemctl start vpn-panel
```

Database migrations run automatically on startup.

### Web panel

```bash
curl -L https://github.com/kauri-off/better_vpn/releases/latest/download/better-vpn-webpanel.tar.gz | sudo tar -xz --no-same-owner -C /var/www/better_vpn
sudo systemctl reload caddy
```

### Hysteria core

Run `vpnctl` -> `Core` -> `Update core`. This downloads the latest release,
replaces the binary, and restarts `hysteria.service` for you.

---

## Using the console over SSH

`vpnctl` is an interactive menu — just run it:

```bash
vpnctl
```
