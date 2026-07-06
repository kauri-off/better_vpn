// Formatting helpers for proto values (int64 -> bigint). Ported from
// web/src/api.ts so both frontends render byte counts, rates and times the
// same way.

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
