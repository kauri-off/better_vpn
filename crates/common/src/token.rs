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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_roundtrip_is_stable() {
        let t = generate_token();
        assert_eq!(hash_token(&t), hash_token(&t));
        assert_ne!(hash_token(&t), hash_token(&generate_token()));
    }
}
