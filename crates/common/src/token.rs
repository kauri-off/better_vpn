//! Auth-token generation and hashing.
//!
//! With Hysteria's `auth.type: http`, the client sends an opaque `auth` string.
//! We issue a random token per user, store only its SHA-256 hash, and resolve
//! the username by hashing the incoming credential and looking it up.

use rand::Rng;
use sha2::{Digest, Sha256};

/// Generate a new random URL-safe auth token (32 bytes of entropy).
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// SHA-256 hash of a token, hex-encoded. Used as the DB lookup key.
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Constant-time check that `token` hashes to `stored_hash` (a hex SHA-256 as
/// produced by [`hash_token`]). Used to authenticate the single admin token.
///
/// The comparison is over the *hashes*, so a timing side-channel can't leak the
/// real token; the constant-time walk is defence-in-depth. A 256-bit random
/// token can't be brute-forced offline, so a plain SHA-256 (no argon2) is the
/// right primitive here.
pub fn verify_token(token: &str, stored_hash: &str) -> bool {
    if stored_hash.is_empty() {
        return false;
    }
    let computed = hash_token(token);
    let a = computed.as_bytes();
    let b = stored_hash.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_roundtrip_is_stable() {
        let t = generate_token();
        assert_eq!(hash_token(&t), hash_token(&t));
        assert_ne!(hash_token(&t), hash_token(&generate_token()));
    }

    #[test]
    fn verify_token_matches_only_the_right_token() {
        let t = generate_token();
        let h = hash_token(&t);
        assert!(verify_token(&t, &h));
        assert!(!verify_token(&generate_token(), &h));
        assert!(!verify_token(&t, ""));
        assert!(!verify_token(&t, "not-a-hash"));
    }
}
