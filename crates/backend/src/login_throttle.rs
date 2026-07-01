//! In-memory brute-force throttle for admin login.
//!
//! Argon2 makes each guess expensive, but nothing otherwise bounds the number
//! of attempts. This adds a simple per-username lockout: after
//! `MAX_FAILURES` consecutive failures the account is locked for
//! `LOCKOUT` before further attempts are accepted. A successful login clears
//! the record. State is process-local (not shared across panel instances),
//! which is sufficient for the single-node deployment this panel targets.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_FAILURES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(15 * 60);
/// Drop a record after this much inactivity so the map can't grow unbounded.
const IDLE_EVICT: Duration = Duration::from_secs(60 * 60);

struct Record {
    failures: u32,
    locked_until: Option<Instant>,
    last_seen: Instant,
}

#[derive(Default)]
pub struct LoginThrottle {
    inner: Mutex<HashMap<String, Record>>,
}

impl LoginThrottle {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns `Err(remaining)` if the username is currently locked out.
    pub fn check(&self, username: &str) -> Result<(), Duration> {
        let now = Instant::now();
        let map = self.inner.lock().unwrap();
        if let Some(rec) = map.get(username) {
            if let Some(until) = rec.locked_until {
                if until > now {
                    return Err(until - now);
                }
            }
        }
        Ok(())
    }

    /// Record a failed attempt; locks the account once the threshold is hit.
    pub fn record_failure(&self, username: &str) {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap();
        evict_idle(&mut map, now);
        let rec = map.entry(username.to_string()).or_insert(Record {
            failures: 0,
            locked_until: None,
            last_seen: now,
        });
        rec.last_seen = now;
        // A previously expired lockout starts a fresh count.
        if rec.locked_until.map(|u| u <= now).unwrap_or(false) {
            rec.failures = 0;
            rec.locked_until = None;
        }
        rec.failures += 1;
        if rec.failures >= MAX_FAILURES {
            rec.locked_until = Some(now + LOCKOUT);
        }
    }

    /// Clear any failure record for a username after a successful login.
    pub fn record_success(&self, username: &str) {
        self.inner.lock().unwrap().remove(username);
    }
}

fn evict_idle(map: &mut HashMap<String, Record>, now: Instant) {
    map.retain(|_, rec| {
        let active_lock = rec.locked_until.map(|u| u > now).unwrap_or(false);
        active_lock || now.duration_since(rec.last_seen) < IDLE_EVICT
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locks_after_threshold_and_clears_on_success() {
        let t = LoginThrottle::new();
        assert!(t.check("admin").is_ok());
        for _ in 0..MAX_FAILURES {
            t.record_failure("admin");
        }
        assert!(t.check("admin").is_err(), "should be locked out");
        t.record_success("admin");
        assert!(t.check("admin").is_ok(), "success clears the lockout");
    }

    #[test]
    fn unrelated_users_are_independent() {
        let t = LoginThrottle::new();
        for _ in 0..MAX_FAILURES {
            t.record_failure("a");
        }
        assert!(t.check("a").is_err());
        assert!(t.check("b").is_ok());
    }
}
