// config.mjs — frozen free-tier facts (confirm-date 2026-07-08) + dialects + sampling.
// Numbers are the PREDICTED limits (see PREREGISTRATION.md). The experiment measures reality against them.

// Verified free-tier limits per provider (do not silently edit; changes are amendments).
export const LIMITS = {
  supabase: { dialect: 'pg', storageWall: '500MB database size (not disk)', readOnly: true, notes: 'Nano 500MB RAM; IPv6-only direct → session pooler 5432; 2 active projects cap' },
  neon:     { dialect: 'pg', storageWall: '0.5GB / project', suspendMaybe: true, historyWindowHours: 6, notes: 'storage = logical + WAL history; hourly meter; DELETE fails at cap; recovery = shrink restore window (control-plane)' },
  turso:    { dialect: 'sqlite', storageWall: '5GB total', monthly: { rowsRead: 500_000_000, rowsWritten: 10_000_000 }, notes: 'BLOCKED on quota (Free-applicability = measured); VACUUM disabled; INTEGER PK only / no secondary index for fill' },
  d1:       { dialect: 'sqlite', storageWall: '500MB / DB', daily: { rowsRead: 5_000_000, rowsWritten: 100_000 }, resetUTC: '00:00', maxRowBytes: 2_000_000, notes: 'storage blocks writes/DDL (SELECT continues); daily rows-read wall blocks ALL queries (account-scoped); REST fill: 100 bound params & 100KB SQL per query' },
};

// Which wall each target drives in the Core (1-1.5 day) run. Row-size is NOT frozen (calibrated).
export const WALLS = {
  supabase: [{ kind: 'storage', cap: '500MB' }],
  neon:     [{ kind: 'storage', cap: '0.5GB' }],
  turso:    [{ kind: 'storage', cap: '5GB', fallback: 'bounded-run + extrapolate if >3h projected' }],
  d1:       [{ kind: 'storage', cap: '500MB/DB' }, { kind: 'daily_read', cap: '5M rows/day', order: 'LAST' }],
};

// Dialect-specific SQL. pg payload is bytea with STORAGE EXTERNAL (skip TOAST compression so high-entropy
// bytes actually count toward the wall). sqlite payload is BLOB. Fill table: bench(k INTEGER PK, v <blob/bytea>).
export const DIALECTS = {
  pg: {
    dialect: 'pg',
    schema: [
      'CREATE TABLE IF NOT EXISTS bench (k bigint PRIMARY KEY, v bytea)',
      'ALTER TABLE bench ALTER COLUMN v SET STORAGE EXTERNAL',
      // sentinel table: written before fill, excluded from wall budget, never touched by probes
      'CREATE TABLE IF NOT EXISTS sentinel (k bigint PRIMARY KEY, v bytea, h text)',
      // dedicated disjoint probe targets
      'CREATE TABLE IF NOT EXISTS probe_target (k bigint PRIMARY KEY, v bytea)',
    ],
    nativeSize: "SELECT pg_database_size(current_database()) AS bytes",
    verifyStorage: "SELECT attstorage FROM pg_attribute WHERE attrelid='bench'::regclass AND attname='v'", // expect 'e' (EXTERNAL)
    insert: 'INSERT INTO bench(k, v) VALUES ($1, $2)',
    readOnlyProbe: { sql: 'SELECT count(*) AS n FROM bench', params: [] },
    // recovery recipe = Supabase official (session read-write → delete → vacuum → disable read-only)
  },
  sqlite: {
    dialect: 'sqlite',
    schema: [
      'CREATE TABLE IF NOT EXISTS bench (k INTEGER PRIMARY KEY, v BLOB)', // INTEGER PK only, no secondary index (Turso rows-written)
      'CREATE TABLE IF NOT EXISTS sentinel (k INTEGER PRIMARY KEY, v BLOB, h TEXT)',
      'CREATE TABLE IF NOT EXISTS probe_target (k INTEGER PRIMARY KEY, v BLOB)',
      'CREATE TABLE IF NOT EXISTS readwall (k INTEGER PRIMARY KEY, v INTEGER)', // small table for the D1 daily-read wall
    ],
    integrityCheck: 'PRAGMA integrity_check',
    unindexedScan: { sql: 'SELECT sum(k) AS s FROM readwall', params: [] }, // aggregate, tiny payload, big scan
  },
};

// Sampling / calibration / adaptive stop. Freeze the PROCEDURE, not a row count.
export const SAMPLING = {
  CALIBRATE_ROWS: 5000,        // insert K, read native_size + meter, derive bytes/row and meter/native ratio
  ROW_BYTES: { pg: 8 * 1024, sqlite_d1: 12 * 1024, sqlite_turso: 2 * 1024 }, // starting payload sizes (calibrated/adjusted)
  COARSE_FRACTION: 0.90,       // meter-driven up to 90% of cap
  MEDIUM_FRACTION: 0.98,       // then smaller steps
  FINE_STEP_ROWS: 8,           // near the wall: error-driven, smallest increment
  D1_READ_TARGET: 5_000_000,   // daily read wall; adaptive from meta.rows_read
  D1_BATCH: (bindCols) => Math.floor(100 / bindCols), // 100 bound params/query cap
  HARD_MAX_ITERS: 2_000_000,   // backstop
};

export const SEED = 0x9e3779b9; // frozen generator seed (deterministic payloads)
