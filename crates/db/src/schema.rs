// @generated-style Diesel schema. Kept in sync with migrations by hand
// (no diesel CLI required at build time).

diesel::table! {
    vpn_users (id) {
        id -> Int4,
        username -> Text,
        enabled -> Bool,
        expires_at -> Nullable<TimestamptzSqlite>,
        quota_bytes -> Int8,
        used_bytes -> Int8,
        note -> Text,
        created_at -> TimestamptzSqlite,
        token -> Text,
        total_tx -> Int8,
        total_rx -> Int8,
        last_seen -> Nullable<TimestamptzSqlite>,
    }
}

diesel::table! {
    settings (key) {
        key -> Text,
        value -> Text,
    }
}

diesel::allow_tables_to_appear_in_same_query!(vpn_users, settings,);
