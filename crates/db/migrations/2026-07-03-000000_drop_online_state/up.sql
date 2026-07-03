-- Online presence (connection counts) moves to backend memory; only last_seen
-- is worth persisting, so it becomes a vpn_users column.
ALTER TABLE vpn_users ADD COLUMN last_seen TIMESTAMPTZ;

UPDATE vpn_users SET last_seen =
    (SELECT last_seen FROM online_state WHERE online_state.user_id = vpn_users.id);

DROP TABLE online_state;
