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

# Set the admin access token (logs into the panel, vpnctl and the app). Omit the
# value to generate a strong random one. It is printed once and stored only as
# a hash — copy it now.
sudo -u better_vpn vpn-backend --env-file /etc/better_vpn/panel.env admin set-token
```

Everything else (port, SNI, paths, listeners) is configured after login in the
panel's **Server** and **Panel** tabs or in `vpnctl`. See [Settings](#settings)
for the full list and CLI equivalents.

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

The rule matches `hysteria.service`; if you rename the unit in Panel → Hysteria
core, edit the rule to match.

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

---

## Settings

Three places hold configuration:

| Where | What | Edit with |
|---|---|---|
| `/etc/better_vpn/panel.env` | `DATABASE_URL`, `RUST_LOG` | text editor, then restart `vpn-panel` |
| `/etc/hysteria/config.yaml` | everything Hysteria itself reads: port, TLS, obfs, bandwidth, masquerade, ACL, resolver | **Server** tab, `vpnctl` → Config, or by hand (the panel keeps the `auth` and `trafficStats` blocks in step) |
| SQLite `settings` table | panel runtime settings below | **Panel** tab, `vpnctl` → Panel settings, or `vpn-backend --env-file /etc/better_vpn/panel.env set <key> <value>` |

| Key | Default | Meaning |
|---|---|---|
| `sni` | *(none)* | TLS SNI written into client links |
| `stats_url` | `http://127.0.0.1:9999` | Hysteria Traffic Stats API base URL |
| `poll_interval_secs` | `10` | how often the panel polls stats (min 2) |
| `grpc_addr` | `127.0.0.1:50051` | panel API listener; restart `vpn-panel` to apply |
| `auth_addr` | `127.0.0.1:8080` | Hysteria auth backend listener; restart `vpn-panel` to apply |
| `core_service` | `hysteria.service` | systemd unit the panel restarts |
| `core_bin` | `/var/lib/better_vpn/bin/hysteria` | core binary path |
| `core_config` | `/etc/hysteria/config.yaml` | Hysteria config path |
| `core_download_url` | *(latest release)* | override for **Update core** |

Unknown keys and malformed values are rejected by `set`.

---

## Clients

The panel issues two representations of every user's connection, both pinned
to the server's self-signed certificate so `insecure` is never needed:

- **`hy2://` link / QR** for v2rayN, v2rayNG and the official Hysteria client.
  The cert is pinned with `pinSHA256` (SHA-256 of the whole certificate).
- **sing-box outbound JSON** for sing-box 1.13+. sing-box does not read
  `pinSHA256`; it pins by `tls.certificate_public_key_sha256` (base64 SHA-256 of
  the certificate's public key), so the panel emits a ready outbound with that
  value. Both hashes are shown on the Server → TLS certificate card, click to
  copy. Regenerating the cert invalidates both.
