-- QBCAM schema 0001 (spec §11.1) — forward-only migrations.
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS identity (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  embedding BLOB,
  thumb_path TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  quality REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_image (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identity(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  quality REAL NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS consent_record (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identity(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  statement TEXT NOT NULL,
  attested_at INTEGER NOT NULL,
  app_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  preset_id TEXT,
  camera_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  stats_json TEXT
);

CREATE TABLE IF NOT EXISTS session_binding (
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES identity(id),
  face_selector TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recording (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES session(id),
  path TEXT NOT NULL UNIQUE,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  codec TEXT NOT NULL DEFAULT 'h264',
  container TEXT NOT NULL DEFAULT 'mp4',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES session(id),
  path TEXT NOT NULL UNIQUE,
  w INTEGER NOT NULL DEFAULT 0,
  h INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT 'png',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provenance (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  signer TEXT NOT NULL,
  signed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS preset (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  params_json TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS model (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  license TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  installed INTEGER NOT NULL DEFAULT 0,
  byo_path TEXT
);

CREATE TABLE IF NOT EXISTS model_file (
  model_id TEXT NOT NULL REFERENCES model(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  preset_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identity_image_identity ON identity_image(identity_id);
CREATE INDEX IF NOT EXISTS idx_consent_identity ON consent_record(identity_id);
CREATE INDEX IF NOT EXISTS idx_recording_created ON recording(created_at);
CREATE INDEX IF NOT EXISTS idx_snapshot_created ON snapshot(created_at);
CREATE INDEX IF NOT EXISTS idx_job_state ON job(state);
