//! Admin authentication: argon2 password hashing + JWT issuing/verifying.
//!
//! Enforcement is per-handler: every management RPC calls `check_auth` (see
//! `grpc.rs`) before doing work. There is intentionally no Tonic interceptor —
//! `login` must stay unauthenticated, so the check is applied explicitly in
//! each authenticated handler rather than structurally.

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

const TOKEN_TTL_SECS: i64 = 60 * 60 * 12; // 12h

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: i32, // admin id
    pub username: String,
    pub exp: i64, // unix seconds
}

#[derive(Clone)]
pub struct AuthKeys {
    encoding: EncodingKey,
    decoding: DecodingKey,
}

impl AuthKeys {
    pub fn new(secret: &str) -> Self {
        Self {
            encoding: EncodingKey::from_secret(secret.as_bytes()),
            decoding: DecodingKey::from_secret(secret.as_bytes()),
        }
    }

    pub fn issue(&self, admin_id: i32, username: &str) -> anyhow::Result<(String, i64)> {
        let exp = chrono::Utc::now().timestamp() + TOKEN_TTL_SECS;
        let claims = Claims {
            sub: admin_id,
            username: username.to_string(),
            exp,
        };
        let token = encode(&Header::new(Algorithm::HS256), &claims, &self.encoding)?;
        Ok((token, exp))
    }

    pub fn verify(&self, token: &str) -> anyhow::Result<Claims> {
        let data = decode::<Claims>(token, &self.decoding, &Validation::new(Algorithm::HS256))?;
        Ok(data.claims)
    }
}

/// Hash a plaintext password for storage.
pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hash error: {e}"))
}

/// Verify a plaintext password against a stored hash.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}
