/** bun:sqlite store with forward-only migrations (spec §11.3). */
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class Store {
  readonly db: Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, "qbcam.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate(join(import.meta.dir, "migrations"));
  }

  private migrate(dir: string) {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
    );
    const applied = new Set(
      this.db.query("SELECT name FROM _migrations").all().map((r) => (r as { name: string }).name),
    );
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    } catch {
      return;
    }
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      this.db.transaction(() => {
        this.db.exec(sql);
        this.db
          .prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)")
          .run(file, Date.now());
      })();
    }
  }

  // ---- identity (TS-01: consent is mandatory at creation) ----

  insertIdentity(identity: {
    id: string;
    name: string;
    embedding: Uint8Array | null;
    thumbPath: string | null;
    tags: string[];
    quality: number;
    createdAt: number;
  }) {
    this.db
      .prepare(
        "INSERT INTO identity (id, name, embedding, thumb_path, tags, quality, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        identity.id,
        identity.name,
        identity.embedding,
        identity.thumbPath,
        JSON.stringify(identity.tags),
        identity.quality,
        identity.createdAt,
      );
  }

  insertIdentityImage(img: {
    id: string;
    identityId: string;
    path: string;
    quality: number;
    isPrimary: boolean;
  }) {
    this.db
      .prepare(
        "INSERT INTO identity_image (id, identity_id, path, quality, is_primary) VALUES (?,?,?,?,?)",
      )
      .run(img.id, img.identityId, img.path, img.quality, img.isPrimary ? 1 : 0);
  }

  insertConsent(rec: {
    id: string;
    identityId: string;
    kind: string;
    statement: string;
    attestedAt: number;
    appVersion: string;
  }) {
    this.db
      .prepare(
        "INSERT INTO consent_record (id, identity_id, kind, statement, attested_at, app_version) VALUES (?,?,?,?,?,?)",
      )
      .run(rec.id, rec.identityId, rec.kind, rec.statement, rec.attestedAt, rec.appVersion);
  }

  /** Identity is usable only with a consent record (TS-01). */
  listIdentities(): Array<{
    id: string;
    name: string;
    thumbPath: string | null;
    tags: string[];
    quality: number;
    createdAt: number;
    consentAttestedAt: number | null;
  }> {
    return this.db
      .query(
        `SELECT i.id, i.name, i.thumb_path, i.tags, i.quality, i.created_at,
                (SELECT MAX(attested_at) FROM consent_record c WHERE c.identity_id = i.id) AS consent_attested_at
         FROM identity i ORDER BY i.created_at DESC`,
      )
      .all()
      .map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: row.id as string,
          name: row.name as string,
          thumbPath: row.thumb_path as string | null,
          tags: JSON.parse((row.tags as string) ?? "[]") as string[],
          quality: row.quality as number,
          createdAt: row.created_at as number,
          consentAttestedAt: row.consent_attested_at as number | null,
        };
      });
  }

  getIdentity(id: string): { id: string; name: string; consented: boolean } | null {
    const row = this.db
      .query(
        `SELECT i.id, i.name, EXISTS(SELECT 1 FROM consent_record c WHERE c.identity_id = i.id) AS consented
         FROM identity i WHERE i.id = ?`,
      )
      .get(id) as { id: string; name: string; consented: number } | null;
    if (!row) return null;
    return { id: row.id, name: row.name, consented: row.consented === 1 };
  }

  /** TS-11: delete an identity and all derived data. */
  deleteIdentity(id: string): { thumbPath: string | null; images: string[] } {
    const images = this.db
      .query("SELECT path FROM identity_image WHERE identity_id = ?")
      .all(id)
      .map((r) => (r as { path: string }).path);
    const thumbRow = this.db.query("SELECT thumb_path FROM identity WHERE id = ?").get(id) as
      | { thumb_path: string | null }
      | undefined;
    this.db.transaction(() => {
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.prepare("DELETE FROM identity WHERE id = ?").run(id);
    })();
    return { thumbPath: thumbRow?.thumb_path ?? null, images };
  }

  // ---- library ----

  insertSession(session: { id: string; mode: string; startedAt: number }) {
    this.db
      .prepare("INSERT OR IGNORE INTO session (id, mode, started_at) VALUES (?,?,?)")
      .run(session.id, session.mode, session.startedAt);
  }

  endSession(id: string, statsJson: string) {
    this.db
      .prepare("UPDATE session SET ended_at = ?, stats_json = ? WHERE id = ?")
      .run(Date.now(), statsJson, id);
  }

  insertRecording(rec: {
    id: string;
    sessionId: string | null;
    path: string;
    durationMs: number;
    bytes: number;
    codec: string;
    container: string;
    createdAt: number;
  }) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO recording (id, session_id, path, duration_ms, bytes, codec, container, created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        rec.id,
        rec.sessionId,
        rec.path,
        rec.durationMs,
        rec.bytes,
        rec.codec,
        rec.container,
        rec.createdAt,
      );
  }

  insertSnapshot(snap: {
    id: string;
    sessionId: string | null;
    path: string;
    w: number;
    h: number;
    format: string;
    createdAt: number;
  }) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO snapshot (id, session_id, path, w, h, format, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(snap.id, snap.sessionId, snap.path, snap.w, snap.h, snap.format, snap.createdAt);
  }

  insertProvenance(p: { id: string; assetId: string; manifestJson: string; signer: string; signedAt: number }) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO provenance (id, asset_id, manifest_json, signer, signed_at) VALUES (?,?,?,?,?)",
      )
      .run(p.id, p.assetId, p.manifestJson, p.signer, p.signedAt);
  }

  hasProvenance(assetId: string): boolean {
    return !!this.db.query("SELECT 1 FROM provenance WHERE asset_id = ?").get(assetId);
  }

  listLibrary(): Array<{
    id: string;
    kind: "recording" | "snapshot";
    path: string;
    bytes: number;
    durationMs?: number;
    createdAt: number;
    provenanceSigned: boolean;
  }> {
    const recs = this.db
      .query("SELECT * FROM recording ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    const snaps = this.db
      .query("SELECT * FROM snapshot ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    return [
      ...recs.map((r) => ({
        id: r.id as string,
        kind: "recording" as const,
        path: r.path as string,
        bytes: r.bytes as number,
        durationMs: r.duration_ms as number,
        createdAt: r.created_at as number,
        provenanceSigned: this.hasProvenance(r.id as string),
      })),
      ...snaps.map((s) => ({
        id: s.id as string,
        kind: "snapshot" as const,
        path: s.path as string,
        bytes: 0,
        createdAt: s.created_at as number,
        provenanceSigned: this.hasProvenance(s.id as string),
      })),
    ];
  }

  deleteLibraryItem(id: string): { kind: "recording" | "snapshot"; path: string } | null {
    const rec = this.db.query("SELECT path FROM recording WHERE id = ?").get(id) as
      | { path: string }
      | undefined;
    if (rec) {
      this.db.prepare("DELETE FROM recording WHERE id = ?").run(id);
      return { kind: "recording", path: rec.path };
    }
    const snap = this.db.query("SELECT path FROM snapshot WHERE id = ?").get(id) as
      | { path: string }
      | undefined;
    if (snap) {
      this.db.prepare("DELETE FROM snapshot WHERE id = ?").run(id);
      return { kind: "snapshot", path: snap.path };
    }
    return null;
  }

  // ---- models ----

  upsertModel(m: {
    id: string;
    kind: string;
    version: string;
    license: string;
    sha256: string;
    installed: boolean;
    byoPath?: string | null;
  }) {
    this.db
      .prepare(
        "INSERT INTO model (id, kind, version, license, sha256, installed, byo_path) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, version=excluded.version, license=excluded.license, sha256=excluded.sha256, installed=excluded.installed, byo_path=excluded.byo_path",
      )
      .run(m.id, m.kind, m.version, m.license, m.sha256, m.installed ? 1 : 0, m.byoPath ?? null);
  }

  listModels(): Array<{
    id: string;
    kind: string;
    version: string;
    license: string;
    sha256: string;
    installed: boolean;
    byoPath: string | null;
  }> {
    return (this.db.query("SELECT * FROM model").all() as Array<Record<string, unknown>>).map(
      (r) => ({
        id: r.id as string,
        kind: r.kind as string,
        version: r.version as string,
        license: r.license as string,
        sha256: r.sha256 as string,
        installed: r.installed === 1,
        byoPath: r.byo_path as string | null,
      }),
    );
  }

  // ---- jobs ----

  insertJob(j: { id: string; type: string; input: string; presetId?: string; createdAt: number }) {
    this.db
      .prepare("INSERT INTO job (id, type, input, state, preset_id, created_at) VALUES (?,?,?,?,?,?)")
      .run(j.id, j.type, j.input, "queued", j.presetId ?? null, j.createdAt);
  }

  updateJobState(id: string, state: string, progress: number, output?: string) {
    this.db
      .prepare("UPDATE job SET state = ?, progress = ?, output = COALESCE(?, output) WHERE id = ?")
      .run(state, progress, output ?? null, id);
  }

  listJobs(): Array<{ id: string; type: string; input: string; output: string | null; state: string; progress: number; createdAt: number }> {
    return (this.db.query("SELECT * FROM job ORDER BY created_at DESC").all() as Array<
      Record<string, unknown>
    >).map((r) => ({
      id: r.id as string,
      type: r.type as string,
      input: r.input as string,
      output: r.output as string | null,
      state: r.state as string,
      progress: r.progress as number,
      createdAt: r.created_at as number,
    }));
  }

  close() {
    this.db.close();
  }
}
