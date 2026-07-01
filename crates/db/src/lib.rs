//! Database layer: Diesel models, schema, a connection pool, embedded
//! migrations, and typed query helpers used by the backend.

pub mod models;
pub mod queries;
pub mod schema;

use diesel::pg::PgConnection;
use diesel::r2d2::{ConnectionManager, Pool, PooledConnection};
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

pub use diesel;
pub use diesel::result::Error as DieselError;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

pub type DbPool = Pool<ConnectionManager<PgConnection>>;
pub type DbConn = PooledConnection<ConnectionManager<PgConnection>>;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("pool error: {0}")]
    Pool(#[from] r2d2::Error),
    #[error("query error: {0}")]
    Query(#[from] diesel::result::Error),
    #[error("migration error: {0}")]
    Migration(String),
    #[error("not found")]
    NotFound,
}

/// Build a connection pool from a Postgres URL.
pub fn build_pool(database_url: &str, max_size: u32) -> Result<DbPool, DbError> {
    let manager = ConnectionManager::<PgConnection>::new(database_url);
    let pool = Pool::builder().max_size(max_size).build(manager)?;
    Ok(pool)
}

/// Apply all pending embedded migrations. Run once on backend startup.
pub fn run_migrations(pool: &DbPool) -> Result<(), DbError> {
    let mut conn = pool.get()?;
    conn.run_pending_migrations(MIGRATIONS)
        .map_err(|e| DbError::Migration(e.to_string()))?;
    tracing::info!("database migrations applied");
    Ok(())
}
