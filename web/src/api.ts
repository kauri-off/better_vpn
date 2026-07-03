import { Code, ConnectError, createClient, type Client, type Interceptor } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { PanelService } from "./gen/panel_pb";

const TOKEN_KEY = "vpn_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// API lives under `./api` relative to the page, so the panel works behind any
// Caddy subpath (e.g. /panel/api) without rebuilding.
function apiBaseUrl(): string {
  return new URL("api", document.baseURI).toString();
}

const authInterceptor: Interceptor = (next) => async (req) => {
  const token = getToken();
  if (token) req.header.set("authorization", `Bearer ${token}`);
  try {
    return await next(req);
  } catch (err) {
    // A stale token (e.g. after the admin token was rotated elsewhere) is
    // rejected with Unauthenticated. Drop it and reload so App renders the login
    // page instead of leaking "invalid token" into every page. Guard on `token`
    // so a failed login (no token) still shows its own error inline.
    if (token && err instanceof ConnectError && err.code === Code.Unauthenticated) {
      clearToken();
      window.location.reload();
    }
    throw err;
  }
};

export const transport = createGrpcWebTransport({
  baseUrl: apiBaseUrl(),
  interceptors: [authInterceptor],
});

export const client: Client<typeof PanelService> = createClient(PanelService, transport);

// UI polling cadence for live data (dashboard, users table). The backend's
// stats poller refreshes its data on a >=2s interval, so 3s here means the UI
// is at most one tick stale.
export const POLL_MS = 3000;

// ---- formatting helpers (proto int64 -> bigint) ----

export function fmtBytes(n: bigint | number): string {
  let v = Number(n);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${v} B` : `${v.toFixed(2)} ${units[i]}`;
}

export function fmtRate(bytesPerSec: bigint | number): string {
  return `${fmtBytes(bytesPerSec)}/s`;
}

// Compact uptime like "28d 2h 46m" (drops leading zero units).
export function fmtDuration(secs: bigint | number): string {
  let s = Number(secs);
  if (s <= 0) return "0m";
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export function fmtTs(secs: bigint | number): string {
  const s = Number(secs);
  if (s <= 0) return "never";
  return new Date(s * 1000).toLocaleString();
}

// Compact signed relative time against now: future → "in 3d", past → "4h ago".
// 0 / negative epoch → "never". Used for expiry ("in 3d" / "expired 2d ago")
// and last-seen ("seen 4h ago") — callers add the surrounding verb.
export function fmtRelative(secs: bigint | number): string {
  const s = Number(secs);
  if (s <= 0) return "never";
  const deltaSec = s - Date.now() / 1000;
  const future = deltaSec >= 0;
  let d = Math.abs(deltaSec);
  const unit = (n: number, u: string) => (future ? `in ${n}${u}` : `${n}${u} ago`);
  if (d < 60) return future ? "in <1m" : "just now";
  if (d < 3600) return unit(Math.floor(d / 60), "m");
  if (d < 86400) return unit(Math.floor(d / 3600), "h");
  d = Math.floor(d / 86400);
  if (d < 30) return unit(d, "d");
  if (d < 365) return unit(Math.floor(d / 30), "mo");
  return unit(Math.floor(d / 365), "y");
}
