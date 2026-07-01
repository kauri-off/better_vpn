-- Initial schema for the Better VPN panel.

CREATE TABLE admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Column order matches crates/db/src/schema.rs (the hand-maintained source of
-- truth) so `diesel print-schema` against a fresh DB reproduces it 1:1.
CREATE TABLE vpn_users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,        -- the Hysteria stats `id`
    token_hash  TEXT NOT NULL UNIQUE,        -- sha256 of the issued auth token
    enabled     BOOLEAN NOT NULL DEFAULT 1,
    expires_at  TIMESTAMPTZ,                 -- NULL = never expires
    quota_bytes BIGINT NOT NULL DEFAULT 0,   -- 0 = unlimited
    used_bytes  BIGINT NOT NULL DEFAULT 0,   -- accumulated tx + rx since last reset
    note        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    token       TEXT,                        -- plaintext token, for re-displaying the URI/QR (NULL if unknown)
    total_tx    BIGINT NOT NULL DEFAULT 0,   -- lifetime tx, survives quota resets
    total_rx    BIGINT NOT NULL DEFAULT 0    -- lifetime rx, survives quota resets
);

-- token_hash is already UNIQUE above, which creates a backing index; no extra
-- index is needed for lookups by token_hash.

CREATE TABLE online_state (
    user_id     INTEGER PRIMARY KEY REFERENCES vpn_users (id) ON DELETE CASCADE,
    connections INTEGER NOT NULL DEFAULT 0,
    last_seen   TIMESTAMPTZ
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
