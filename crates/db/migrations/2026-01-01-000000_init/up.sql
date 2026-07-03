-- Initial schema for the Better VPN panel.

-- Column order matches crates/db/src/schema.rs (the hand-maintained source of
-- truth) so `diesel print-schema` against a fresh DB reproduces it 1:1.
CREATE TABLE vpn_users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,        -- the Hysteria stats `id`
    enabled     BOOLEAN NOT NULL DEFAULT 1,
    expires_at  TIMESTAMPTZ,                 -- NULL = never expires
    quota_bytes BIGINT NOT NULL DEFAULT 0,   -- 0 = unlimited
    used_bytes  BIGINT NOT NULL DEFAULT 0,   -- accumulated tx + rx since last reset
    note        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    token       TEXT NOT NULL UNIQUE,        -- plaintext auth token; also the auth lookup key
    total_tx    BIGINT NOT NULL DEFAULT 0,   -- lifetime tx, survives quota resets
    total_rx    BIGINT NOT NULL DEFAULT 0    -- lifetime rx, survives quota resets
);

-- token is already UNIQUE above, which creates a backing index; no extra index
-- is needed for the hot-path auth lookup by token.

CREATE TABLE online_state (
    user_id     INTEGER PRIMARY KEY REFERENCES vpn_users (id) ON DELETE CASCADE,
    connections INTEGER NOT NULL DEFAULT 0,
    last_seen   TIMESTAMPTZ
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
