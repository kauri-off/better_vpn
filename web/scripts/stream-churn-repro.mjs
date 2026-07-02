// Repro harness for the intermittent "[unknown] missing trailer" on the Stats
// stream. Speaks raw gRPC-web over fetch (no deps, Node >= 18) and mimics the
// panel's logout/login churn: abort the open StreamServerStats, (optionally)
// call Login, immediately open a new stream, and watch how it dies.
//
// Usage:
//   node scripts/stream-churn-repro.mjs
//   BASE=http://192.168.1.98/panel/api TOKEN=dev MODE=login ITERS=30 node scripts/stream-churn-repro.mjs
//
// MODE=login   abort stream -> Login RPC -> new stream   (panel logout/login)
// MODE=reload  abort stream -> new stream                (page reload)
// MODE=calm    abort stream -> 1s pause -> new stream    (control, expect 0%)
//
// Outcomes per iteration:
//   ok              stream alive with >=1 message after the watch window
//   missing-trailer body ended cleanly without a gRPC-web trailer frame
//                   (exactly what connect-web surfaces as "[unknown] missing trailer")
//   grpc-error      trailer arrived with grpc-status != 0
//   http-error      non-200 response
//   network-error   fetch/read threw
//   no-message      no data frame within the watch window

const BASE = (process.env.BASE ?? "http://192.168.1.98/panel/api").replace(/\/$/, "");
const TOKEN = process.env.TOKEN ?? "dev";
const ITERS = Number(process.env.ITERS ?? 30);
const WATCH_MS = Number(process.env.WATCH_MS ?? 3000);
const MODE = process.env.MODE ?? "login";

const TRAILER_FLAG = 0x80;

/** 5-byte gRPC-web envelope around a payload. */
function envelope(flags, payload) {
  const buf = new Uint8Array(5 + payload.length);
  buf[0] = flags;
  new DataView(buf.buffer).setUint32(1, payload.length, false);
  buf.set(payload, 5);
  return buf;
}

/** LoginRequest { token = 1 } — field 1, wire type 2 (len-delimited string). */
function encodeLoginRequest(token) {
  const t = new TextEncoder().encode(token);
  if (t.length > 127) throw new Error("token too long for this tiny encoder");
  return new Uint8Array([0x0a, t.length, ...t]);
}

function grpcWebHeaders(withAuth) {
  const h = {
    "content-type": "application/grpc-web+proto",
    "x-grpc-web": "1",
  };
  if (withAuth) h["authorization"] = `Bearer ${TOKEN}`;
  return h;
}

/** Incremental gRPC-web frame parser over a fetch body. */
async function* frames(body) {
  const reader = body.getReader();
  let buf = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const next = new Uint8Array(buf.length + value.length);
    next.set(buf);
    next.set(value, buf.length);
    buf = next;
    while (buf.length >= 5) {
      const len = new DataView(buf.buffer, buf.byteOffset).getUint32(1, false);
      if (buf.length < 5 + len) break;
      yield { flags: buf[0], data: buf.slice(5, 5 + len) };
      buf = buf.slice(5 + len);
    }
  }
}

function parseTrailer(data) {
  const text = new TextDecoder().decode(data);
  const out = {};
  for (const line of text.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

async function login() {
  const res = await fetch(`${BASE}/panel.PanelService/Login`, {
    method: "POST",
    headers: grpcWebHeaders(false),
    body: envelope(0, encodeLoginRequest(TOKEN)),
  });
  if (res.status !== 200) throw new Error(`Login HTTP ${res.status}`);
  let trailer;
  for await (const f of frames(res.body)) {
    if (f.flags & TRAILER_FLAG) trailer = parseTrailer(f.data);
  }
  const status = trailer?.["grpc-status"] ?? res.headers.get("grpc-status");
  if (status !== "0") throw new Error(`Login grpc-status ${status}: ${trailer?.["grpc-message"] ?? ""}`);
}

/**
 * Open StreamServerStats and consume it in the background, mutating `state`
 * as messages/trailers/errors arrive. Mirrors connect-web's classification:
 * clean body end without a trailer frame == "missing trailer".
 */
function openStream() {
  const ctrl = new AbortController();
  const state = {
    ctrl,
    outcome: "no-message",
    messages: 0,
    detail: "",
    startedAt: Date.now(),
    endedAtMs: null,
  };
  state.done = (async () => {
    try {
      const res = await fetch(`${BASE}/panel.PanelService/StreamServerStats`, {
        method: "POST",
        headers: grpcWebHeaders(true),
        body: envelope(0, new Uint8Array(0)), // Empty message
        signal: ctrl.signal,
      });
      if (res.status !== 200) {
        state.outcome = "http-error";
        state.detail = `HTTP ${res.status}`;
        return;
      }
      let sawTrailer = false;
      for await (const f of frames(res.body)) {
        if (f.flags & TRAILER_FLAG) {
          sawTrailer = true;
          const t = parseTrailer(f.data);
          if (t["grpc-status"] !== "0") {
            state.outcome = "grpc-error";
            state.detail = `grpc-status ${t["grpc-status"]}: ${t["grpc-message"] ?? ""}`;
          }
        } else {
          state.messages++;
          if (state.outcome === "no-message") state.outcome = "ok";
        }
      }
      // Body ended. An infinite stream should never get here on its own.
      if (!sawTrailer && !ctrl.signal.aborted) {
        state.outcome = "missing-trailer";
        state.endedAtMs = Date.now() - state.startedAt;
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        state.outcome = "network-error";
        state.detail = String(err?.cause ?? err);
        state.endedAtMs = Date.now() - state.startedAt;
      }
    }
  })();
  return state;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tally = {};
let prev = null;

console.log(`mode=${MODE} iters=${ITERS} watch=${WATCH_MS}ms base=${BASE}`);
await login(); // make sure the token works before measuring

for (let i = 1; i <= ITERS; i++) {
  // "Log out": kill the previous stream like the Stats page unmount does.
  if (prev) prev.ctrl.abort();
  if (MODE === "calm") await sleep(1000);
  if (MODE === "login") await login();

  // "Land on Stats": open the new stream and let it live for the watch window.
  const s = openStream();
  await sleep(WATCH_MS);

  const key = s.outcome;
  tally[key] = (tally[key] ?? 0) + 1;
  const extra = [
    s.messages ? `${s.messages} msg` : null,
    s.endedAtMs != null ? `died after ${s.endedAtMs}ms` : null,
    s.detail || null,
  ].filter(Boolean).join(", ");
  console.log(`#${String(i).padStart(2)} ${key}${extra ? `  (${extra})` : ""}`);
  prev = s;
}

if (prev) prev.ctrl.abort();
console.log("\n---- tally ----");
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(16)} ${v}/${ITERS}  (${((v / ITERS) * 100).toFixed(0)}%)`);
}
