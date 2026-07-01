-- Admin auth moved from username/password rows in `admins` to a single access
-- token stored (SHA-256 hashed) under the `admin_token_hash` key in `settings`.
-- The table is no longer referenced by any code.
DROP TABLE IF EXISTS admins;
