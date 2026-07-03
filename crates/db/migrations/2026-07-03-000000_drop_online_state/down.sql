CREATE TABLE online_state (
    user_id     INTEGER PRIMARY KEY REFERENCES vpn_users (id) ON DELETE CASCADE,
    connections INTEGER NOT NULL DEFAULT 0,
    last_seen   TIMESTAMPTZ
);

INSERT INTO online_state (user_id, connections, last_seen)
SELECT id, 0, last_seen FROM vpn_users WHERE last_seen IS NOT NULL;

ALTER TABLE vpn_users DROP COLUMN last_seen;
