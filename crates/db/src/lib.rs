//! Database layer: Diesel models, schema, a connection pool, embedded
//! migrations, and typed query helpers used by the backend.

pub mod models;
pub mod queries;
pub mod schema;

use diesel::connection::SimpleConnection;
use diesel::r2d2::{ConnectionManager, CustomizeConnection, Pool, PooledConnection};
use diesel::sqlite::SqliteConnection;
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

pub use diesel;
pub use diesel::result::Error as DieselError;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;
pub type DbConn = PooledConnection<ConnectionManager<SqliteConnection>>;

/// Per-connection SQLite setup. SQLite needs these set on every connection (the
/// pool opens up to `max_size`): `busy_timeout` so concurrent writers (the stats
/// poller alongside gRPC handlers) wait instead of erroring "database is locked",
/// WAL for reader/writer concurrency, and `foreign_keys` because SQLite defaults
/// it OFF (no current table relies on it, but any future FK should just work).
#[derive(Debug)]
struct SqlitePragmas;

impl CustomizeConnection<SqliteConnection, diesel::r2d2::Error> for SqlitePragmas {
    fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), diesel::r2d2::Error> {
        conn.batch_execute(
            "PRAGMA busy_timeout = 5000; \
             PRAGMA journal_mode = WAL; \
             PRAGMA foreign_keys = ON;",
        )
        .map_err(diesel::r2d2::Error::QueryError)
    }
}

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

/// Build a connection pool from a SQLite database file path.
pub fn build_pool(database_url: &str, max_size: u32) -> Result<DbPool, DbError> {
    let manager = ConnectionManager::<SqliteConnection>::new(database_url);
    let pool = Pool::builder()
        .max_size(max_size)
        .connection_customizer(Box::new(SqlitePragmas))
        .build(manager)?;
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
