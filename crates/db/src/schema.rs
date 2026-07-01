// @generated-style Diesel schema. Kept in sync with migrations by hand
// (no diesel CLI required at build time).

diesel::table! {
    admins (id) {
        id -> Int4,
        username -> Text,
        password_hash -> Text,
        created_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    vpn_users (id) {
        id -> Int4,
        username -> Text,
        token_hash -> Text,
        enabled -> Bool,
        expires_at -> Nullable<TimestamptzSqlite>,
        quota_bytes -> Int8,
        used_bytes -> Int8,
        note -> Text,
        created_at -> TimestamptzSqlite,
        token -> Nullable<Text>,
        total_tx -> Int8,
        total_rx -> Int8,
    }
}

diesel::table! {
    online_state (user_id) {
        user_id -> Int4,
        connections -> Int4,
        last_seen -> Nullable<TimestamptzSqlite>,
    }
}

diesel::table! {
    settings (key) {
        key -> Text,
        value -> Text,
    }
}

diesel::joinable!(online_state -> vpn_users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    admins,
    vpn_users,
    online_state,
    settings,
);
