// SQLite via node:sqlite — no native module to compile, nothing to install.
//
// Loaded through createRequire rather than `import`: Vitest's module runner
// strips the `node:` prefix from builtins, and `sqlite` is one of the few
// builtins that only exists WITH the prefix. A require call is left alone by
// both Vitest and esbuild.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export type Database = DatabaseSyncType;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  self_group_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);

-- Every group, row, entry and event of every account. The id is globally
-- unique; parent_id and shared are copies of what is in fields, kept as
-- columns because access decisions read them for every record.
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  parent_id TEXT,
  shared INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  fields TEXT NOT NULL,
  clocks TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS records_owner ON records(owner);

CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  grantee TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (owner, subject_kind, subject_id, grantee)
);
CREATE INDEX IF NOT EXISTS grants_grantee ON grants(grantee);

-- Mutual, so stored in both directions: one lookup per account either way.
CREATE TABLE IF NOT EXISTS connections (
  a TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  b TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);

CREATE TABLE IF NOT EXISTS connection_requests (
  from_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS dismissed_suggestions (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  suggested_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, suggested_id)
);

-- Capability tokens are stored hashed: a copy of this database is not a
-- bag of working invite links.
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject_kind TEXT,
  subject_id TEXT,
  role TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_by TEXT
);
CREATE INDEX IF NOT EXISTS invites_owner ON invites(owner);

CREATE TABLE IF NOT EXISTS public_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS public_links_owner ON public_links(owner);

-- WebAuthn credentials. The id is the credential id (base64url) the
-- authenticator made up; the public key is all the server ever holds, so a
-- copy of this table signs nobody in.
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys(account_id);
`;

// Columns added after a table first shipped. `CREATE TABLE IF NOT EXISTS`
// leaves an existing table alone, so a new column on an old table has to be
// added explicitly — once, and harmlessly on every later start.
const ADDED_COLUMNS: Array<[table: string, column: string, declaration: string]> = [
  // When this session last proved who it is (signing in, or confirming with
  // a password or passkey) — what "confirm it's you" checks.
  ["sessions", "verified_at", "INTEGER"],
];

function addMissingColumns(db: DatabaseSyncType): void {
  for (const [table, column, declaration] of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((existing) => existing.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
    }
  }
}

// `:memory:` for tests; otherwise a file in dataDir, which in production is
// a CapRover persistent directory.
export function openDatabase(dataDir: string | ":memory:"): Database {
  let path = ":memory:";
  if (dataDir !== ":memory:") {
    mkdirSync(dataDir, { recursive: true });
    path = join(dataDir, "chronicle.db");
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  addMissingColumns(db);
  return db;
}

// One write transaction. node:sqlite is synchronous, so nothing else can
// interleave inside `work` — the transaction is about atomicity on a crash
// and about not paying one fsync per statement.
export function transaction<T>(db: Database, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
