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
