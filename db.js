// Cordenar — Synapse database (synapses.db)
// Stores synapse_map + local synapse content + FTS5 + vec0
import Database from 'better-sqlite3';
import { load } from 'sqlite-vec';
import { createEmbedding } from './embedding.js';
import { ensureDbDir, getConfig, getIndexPaths, resolveTypeSchema } from './config.js';
import { existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep, resolve as resolvePath, relative, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { load as yamlLoad, JSON_SCHEMA } from 'js-yaml';

let db;

export function initDb() {
  if (db) return db;
  const path = ensureDbDir();
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma(`busy_timeout = ${getConfig().db.busyTimeout}`);
  load(db);

  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');

  migrateDb();

  const volatileMounts = ['/tmp/', '/dev/shm/'];
  const resolvedPath = resolvePath(path);
  if (process.env.CORDENAR_ENV !== 'test' && volatileMounts.some(function (v) { return resolvedPath.startsWith(v); })) {
    throw new Error(
      'Refusing to start: dbPath is on a volatile mount that may be wiped on reboot.\n' +
      '  Current path: ' + path + '\n' +
      '  Override with CORDENAR_DB_PATH env var if this is intentional.'
    );
  }

  try {
    const integrityResult = db.pragma('integrity_check');
    if (integrityResult.length > 0) {
      const row = integrityResult[0];
      if (row.integrity_check !== 'ok') {
        console.error('[cordenar] WARNING: integrity_check failed:', JSON.stringify(integrityResult));
      }
    }
  } catch (err) {
    console.error('[cordenar] WARNING: integrity_check error:', err.message);
  }

  try {
    const memoriesCount = db.prepare('SELECT COUNT(*) as c FROM memories').get().c;
    const conceptsCount = db.prepare('SELECT COUNT(*) as c FROM concepts').get().c;
    const memSynCount = db.prepare('SELECT COUNT(*) as c FROM memory_synapses').get().c;
    const conSynCount = db.prepare('SELECT COUNT(*) as c FROM concept_synapses').get().c;
    console.log(
      '[cordenar] startup: memories=' + memoriesCount +
      ' concepts=' + conceptsCount +
      ' memory_synapses=' + memSynCount +
      ' concept_synapses=' + conSynCount
    );
  } catch (err) {
    console.error('[cordenar] WARNING: row count check error:', err.message);
  }

  const cfg = getConfig();
  const backupDir = cfg.backup?.dir;
  if (backupDir) {
    if (existsSync(backupDir)) {
      const backupFiles = readdirSync(backupDir)
        .filter(function (f) { return f.startsWith(BACKUP_PREFIX); })
        .sort();
      const latestFile = backupFiles[backupFiles.length - 1];
      if (latestFile) {
        const latestStat = statSync(resolvePath(backupDir, latestFile));
        const hoursSince = (Date.now() - latestStat.mtimeMs) / 3600000;
        if (hoursSince > getConfig().backup.freshnessHours) {
          doBackup();
        }
      } else {
        doBackup();
      }
    } else {
      doBackup();
    }
    enforceRetention();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS synapse_map (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      cloud_id      TEXT NOT NULL UNIQUE,
      source        TEXT NOT NULL,
      local_id      INTEGER NOT NULL,
      account_id    TEXT,
      local_hash    TEXT NOT NULL,
      cloud_hash    TEXT NOT NULL,
      direction     TEXT NOT NULL DEFAULT 'push',
      cloud_status  TEXT,
      synced_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_synapse_map_lookup
      ON synapse_map(source, local_id);
    CREATE INDEX IF NOT EXISTS idx_synapse_map_cloud
      ON synapse_map(cloud_id);

    -- memory_synapses (stable integer row_id, cloud UUID as UNIQUE)
    CREATE TABLE IF NOT EXISTS memory_synapses (
      row_id          INTEGER PRIMARY KEY AUTOINCREMENT,
      id              TEXT UNIQUE NOT NULL,
      account_id      TEXT NOT NULL,
      source_node_id  TEXT NOT NULL,
      project         TEXT NOT NULL DEFAULT '',
      kind            TEXT NOT NULL DEFAULT '',
      related_ids     TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT '',
      content         TEXT NOT NULL,
      metadata        TEXT NOT NULL DEFAULT '{}',
      content_hash    TEXT NOT NULL,
      cloud_status    TEXT NOT NULL DEFAULT 'active',
      approved_by     TEXT,
      approved_at     TEXT,
      source_node_name TEXT,
      source_user_email TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mem_syn_account ON memory_synapses(account_id);
    CREATE INDEX IF NOT EXISTS idx_mem_syn_cloud_status ON memory_synapses(cloud_status);
    CREATE INDEX IF NOT EXISTS idx_mem_syn_project ON memory_synapses(project);

    -- concept_synapses
    CREATE TABLE IF NOT EXISTS concept_synapses (
      row_id          INTEGER PRIMARY KEY AUTOINCREMENT,
      id              TEXT UNIQUE NOT NULL,
      account_id      TEXT NOT NULL,
      source_node_id  TEXT NOT NULL,
      slug            TEXT NOT NULL,
      collection      TEXT,
      type            TEXT NOT NULL,
      title           TEXT,
      description     TEXT,
      tags            TEXT,
      status          TEXT DEFAULT 'stable',
      frontmatter     TEXT NOT NULL DEFAULT '{}',
      body            TEXT NOT NULL,
      body_length     INTEGER DEFAULT 0,
      content_hash    TEXT NOT NULL,
      cloud_status    TEXT NOT NULL DEFAULT 'active',
      approved_by     TEXT,
      approved_at     TEXT,
      source_node_name TEXT,
      source_user_email TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_con_syn_account ON concept_synapses(account_id);
    CREATE INDEX IF NOT EXISTS idx_con_syn_cloud_status ON concept_synapses(cloud_status);
    CREATE INDEX IF NOT EXISTS idx_con_syn_slug ON concept_synapses(slug);

    -- FTS5: content-sync with stable row_id (not the TEXT UUID)
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_synapses_fts USING fts5(
      project, kind, status, content,
      content=memory_synapses,
      content_rowid=row_id,
      tokenize='unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS concept_synapses_fts USING fts5(
      title, description, tags, body,
      content=concept_synapses,
      content_rowid=row_id,
      tokenize='unicode61'
    );

    -- Vector search (sqlite-vec)
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_synapses_vec USING vec0(
      embedding float[256]
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS concept_synapses_vec USING vec0(
      embedding float[256]
    );

    -- Local memories (memory parity — local CRUD, not team-synced)
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      related_ids TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at INTEGER DEFAULT NULL,
      archived_at INTEGER DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_project_created ON memories(project, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_project_updated ON memories(project, updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      project, kind, status, content,
      content=memories,
      content_rowid=id,
      tokenize='unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
      embedding float[256]
    );

    -- Local concepts (concept parity — local index/CRUD, not team-synced)
    CREATE TABLE IF NOT EXISTS concepts (
      id INTEGER PRIMARY KEY,
      collection TEXT NOT NULL,
      slug TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      description TEXT,
      tags TEXT,
      status TEXT DEFAULT 'stable',
      frontmatter TEXT NOT NULL DEFAULT '{}',
      body TEXT NOT NULL,
      file_path TEXT,
      file_hash TEXT,
      body_length INTEGER DEFAULT 0,
      timestamp TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(collection, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_concepts_type ON concepts(type);
    CREATE INDEX IF NOT EXISTS idx_concepts_status ON concepts(status);

    CREATE VIRTUAL TABLE IF NOT EXISTS concepts_fts USING fts5(
      title, description, tags, body,
      content=concepts,
      content_rowid=id,
      tokenize='unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS concepts_vec USING vec0(
      embedding float[256]
    );

    -- Tool call tracking (OTel spans)
    CREATE TABLE IF NOT EXISTS tool_calls (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tool          TEXT NOT NULL,
      error_type    TEXT,
      called_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      deployment_env TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_called ON tool_calls(called_at);
  `);

  db.prepare('INSERT OR IGNORE INTO migrations (name) VALUES (?)').run('0001_baseline');

  try { db.exec("ALTER TABLE tool_calls ADD COLUMN deployment_env TEXT"); } catch {}

  db.prepare(
    'DELETE FROM tool_calls WHERE called_at < ?'
  ).run(Math.floor(Date.now() / 1000) - getConfig().toolRetentionDays * 86400);

  return db;
}

function migrateDb() {
  applyTrackedMigrations();
}

function applyTrackedMigrations() {
  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map(r => r.name)
  );

  const migrations = [
    ['0005_concept_collection', () => {
      const cols = db.pragma('table_info(concepts)').map(c => c.name);
      if (cols.length > 0 && !cols.includes('collection')) {
        db.exec('DROP TABLE IF EXISTS concepts_fts; DROP TABLE IF EXISTS concepts_vec; DROP TABLE IF EXISTS concepts;');
      }
    }],
    ['0006_concept_synapse_collection', () => {
      const cols = db.pragma('table_info(concept_synapses)').map(c => c.name);
      if (cols.length > 0 && !cols.includes('collection')) {
        db.exec('ALTER TABLE concept_synapses ADD COLUMN collection TEXT');
      }
    }],
    ['0007_drop_concept_resource', () => {
      const cols = db.pragma('table_info(concepts)').map(c => c.name);
      if (cols.includes('resource')) {
        db.exec('ALTER TABLE concepts DROP COLUMN resource');
      }
    }],
  ];

  for (const [name, fn] of migrations) {
    if (!applied.has(name)) {
      fn();
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
    }
  }
}

// ── synapse_map ────────────────────────────────────────────────

export function lookupLocalByDirection(source, localId, directions) {
  initDb();
  if (!directions || directions.length === 0) return undefined;
  const placeholders = directions.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM synapse_map WHERE source = ? AND local_id = ? AND direction IN (${placeholders})`)
    .get(source, localId, ...directions);
}

export function lookupCloud(cloudId) {
  initDb();
  return db
    .prepare('SELECT * FROM synapse_map WHERE cloud_id = ?')
    .get(cloudId);
}

export function lookupLocalByAccount(source, localId, accountId) {
  initDb();
  return db
    .prepare("SELECT * FROM synapse_map WHERE source = ? AND local_id = ? AND account_id = ?")
    .get(source, localId, accountId);
}

export function storeMapping({
  cloud_id, source, local_id, account_id, local_hash, cloud_hash, direction, cloud_status,
}) {
  initDb();
  db.prepare(
    `INSERT INTO synapse_map
       (cloud_id, source, local_id, account_id, local_hash, cloud_hash, direction, cloud_status, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(cloud_id) DO UPDATE SET
       local_hash = excluded.local_hash,
       cloud_hash = excluded.cloud_hash,
       cloud_status = COALESCE(excluded.cloud_status, synapse_map.cloud_status),
       synced_at = unixepoch()`
  ).run(cloud_id, source, local_id, account_id || null, local_hash, cloud_hash, direction, cloud_status || null);
}

export function removeMapping(cloudId) {
  initDb();
  db.prepare('DELETE FROM synapse_map WHERE cloud_id = ?').run(cloudId);
}

export function softUnshareMapping(cloudId) {
  initDb();
  db.prepare("UPDATE synapse_map SET direction = 'unshared' WHERE cloud_id = ?").run(cloudId);
}

export function updateSynapseMapCloudStatus(cloudId, status) {
  initDb();
  db.prepare('UPDATE synapse_map SET cloud_status = ? WHERE cloud_id = ?').run(status, cloudId);
}

export function getPushEntries() {
  initDb();
  return db.prepare("SELECT * FROM synapse_map WHERE direction = 'push'").all();
}

export function getPullEntries() {
  initDb();
  return db.prepare("SELECT * FROM synapse_map WHERE direction = 'pull'").all();
}

export function getDirtyEntries() {
  initDb();
  return db.prepare(
    "SELECT * FROM synapse_map WHERE direction = 'push' AND local_hash != cloud_hash"
  ).all();
}

// ── memory_synapses CRUD ───────────────────────────────────

export function insertMemorySynapse(row) {
  initDb();
  const result = db.prepare(
    `INSERT INTO memory_synapses
       (id, account_id, source_node_id, project, kind, related_ids, status, content, metadata,
        content_hash, cloud_status, approved_by, approved_at,
        source_node_name, source_user_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.account_id, row.source_node_id,
    row.project, row.kind, row.related_ids, row.status, row.content, row.metadata,
    row.content_hash, row.cloud_status, row.approved_by, row.approved_at,
    row.source_node_name, row.source_user_email, row.created_at, row.updated_at
  );
  return Number(result.lastInsertRowid);
}

function updateMemorySynapse(rowId, updates) {
  initDb();
  const clauses = [];
  const params = [];
  for (const [key, value] of Object.entries(updates)) {
    clauses.push(`${key} = ?`);
    params.push(value);
  }
  clauses.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(rowId);
  return db.prepare(
    `UPDATE memory_synapses SET ${clauses.join(', ')} WHERE row_id = ?`
  ).run(...params);
}

export function updateMemorySynapseByCloudId(cloudId, updates) {
  initDb();
  const row = getSynapseByCloudId(cloudId);
  if (!row || row.synapse_type !== 'team_memory') return { changes: 0 };
  return updateMemorySynapse(row.row_id, updates);
}

export function upsertMemoryFts(rowId, project, kind, status, content) {
  initDb();
  db.prepare(
    'INSERT OR REPLACE INTO memory_synapses_fts (rowid, project, kind, status, content) VALUES (?, ?, ?, ?, ?)'
  ).run(rowId, project, kind, status, content);
}

export function setMemoryVec(rowId, embeddingBuf) {
  initDb();
  db.prepare('DELETE FROM memory_synapses_vec WHERE rowid = CAST(? AS INTEGER)').run(rowId);
  db.prepare(
    'INSERT INTO memory_synapses_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)'
  ).run(rowId, embeddingBuf);
}

// ── concept_synapses CRUD ──────────────────────────────────────

export function insertConceptSynapse(row) {
  initDb();
  const result = db.prepare(
    `INSERT INTO concept_synapses
       (id, account_id, source_node_id, slug, collection, type, title, description, tags,
        status, frontmatter, body, body_length,
        content_hash, cloud_status, approved_by, approved_at,
        source_node_name, source_user_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.account_id, row.source_node_id,
    row.slug, row.collection ?? null, row.type, row.title, row.description, row.tags,
    row.status, row.frontmatter, row.body, row.body_length,
    row.content_hash, row.cloud_status, row.approved_by, row.approved_at,
    row.source_node_name, row.source_user_email, row.created_at, row.updated_at
  );
  return Number(result.lastInsertRowid);
}

function updateConceptSynapse(rowId, updates) {
  initDb();
  const clauses = [];
  const params = [];
  for (const [key, value] of Object.entries(updates)) {
    clauses.push(`${key} = ?`);
    params.push(value);
  }
  clauses.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(rowId);
  return db.prepare(
    `UPDATE concept_synapses SET ${clauses.join(', ')} WHERE row_id = ?`
  ).run(...params);
}

export function updateConceptSynapseByCloudId(cloudId, updates) {
  initDb();
  const row = getSynapseByCloudId(cloudId);
  if (!row || row.synapse_type !== 'team_concept') return { changes: 0 };
  return updateConceptSynapse(row.row_id, updates);
}

export function upsertConceptFts(rowId, title, description, tags, body) {
  initDb();
  db.prepare(
    'INSERT OR REPLACE INTO concept_synapses_fts (rowid, title, description, tags, body) VALUES (?, ?, ?, ?, ?)'
  ).run(rowId, title, description, tags, body);
}

export function setConceptVec(rowId, embeddingBuf) {
  initDb();
  db.prepare('DELETE FROM concept_synapses_vec WHERE rowid = CAST(? AS INTEGER)').run(rowId);
  db.prepare(
    'INSERT INTO concept_synapses_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)'
  ).run(rowId, embeddingBuf);
}

// ── Lookup ─────────────────────────────────────────────────────

export function getSynapseByCloudId(cloudId) {
  initDb();
  const mem = db.prepare('SELECT * FROM memory_synapses WHERE id = ?').get(cloudId);
  if (mem) return { ...mem, synapse_type: 'team_memory' };
  const con = db.prepare('SELECT * FROM concept_synapses WHERE id = ?').get(cloudId);
  if (con) return { ...con, synapse_type: 'team_concept' };
  return null;
}

export function getTeamMemorySynapsesByIds(ids) {
  initDb();
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM memory_synapses WHERE cloud_status = 'active' AND id IN (${placeholders})`
  ).all(...ids);
  return rows.map(r => ({ ...r, synapse_type: 'team_memory' }));
}

// ── List ───────────────────────────────────────────────────────

export function listTeamMemorySynapses({ project, kind, cloud_status, limit = 50 } = {}) {
  initDb();
  const clauses = ["1=1"];
  const params = [];
  if (project) { clauses.push('project = ?'); params.push(project); }
  if (kind) { clauses.push('kind = ?'); params.push(kind); }
  if (cloud_status) { clauses.push('cloud_status = ?'); params.push(cloud_status); }
  params.push(limit);
  const rows = db.prepare(
    `SELECT * FROM memory_synapses WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params);
  const mapped = rows.map(r => ({ ...r, synapse_type: 'team_memory' }));
  return { rows: mapped, total: mapped.length };
}

export function listTeamConceptSynapses({ type, tags, cloud_status, collection, limit = 50 } = {}) {
  initDb();
  const clauses = ["1=1"];
  const params = [];
  if (type) { clauses.push('type = ?'); params.push(type); }
  if (tags) {
    const tagArr = Array.isArray(tags) ? tags : [tags];
    const tagPlaceholders = tagArr.map(() => 'tags LIKE ?').join(' OR ');
    clauses.push('(' + tagPlaceholders + ')');
    for (const t of tagArr) { params.push('%"' + t + '"%'); }
  }
  if (cloud_status) { clauses.push('cloud_status = ?'); params.push(cloud_status); }
  if (collection) { clauses.push('collection = ?'); params.push(collection); }
  params.push(limit);
  const rows = db.prepare(
    `SELECT * FROM concept_synapses WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params);
  const mapped = rows.map(r => ({ ...r, synapse_type: 'team_concept' }));
  return { rows: mapped, total: mapped.length };
}

// ── Counts ─────────────────────────────────────────────────────

export function countSynapsesByAccount() {
  initDb();
  const mem = db.prepare(
    "SELECT account_id, COUNT(*) as c FROM memory_synapses GROUP BY account_id"
  ).all();
  const con = db.prepare(
    "SELECT account_id, COUNT(*) as c FROM concept_synapses GROUP BY account_id"
  ).all();
  const map = new Map();
  for (const r of mem) map.set(r.account_id, { mem: r.c, con: 0 });
  for (const r of con) {
    const existing = map.get(r.account_id) || { mem: 0, con: 0 };
    existing.con = r.c;
    map.set(r.account_id, existing);
  }
  return Object.fromEntries(map);
}

// ── Cleanup ────────────────────────────────────────────────────

export function getLocalActiveForAccount(accountId) {
  initDb();
  const mem = db.prepare(
    "SELECT id, content_hash FROM memory_synapses WHERE account_id = ? AND cloud_status = 'active'"
  ).all(accountId).map(r => ({ ...r, source: 'memory' }));
  const con = db.prepare(
    "SELECT id, content_hash FROM concept_synapses WHERE account_id = ? AND cloud_status = 'active'"
  ).all(accountId).map(r => ({ ...r, source: 'concept' }));
  return [...mem, ...con];
}

export function markSynapsesRemoved(ids, source) {
  initDb();
  if (!ids || ids.length === 0) return;
  const table = source === 'memory' ? 'memory_synapses' : 'concept_synapses';
  const placeholders = ids.map(() => '?').join(',');
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ${table} SET cloud_status = 'removed', updated_at = ? WHERE id IN (${placeholders})`
  ).run(now, ...ids);
}

// ── Hybrid Search ──────────────────────────────────────────────

function sanitizeMemoryQuery(query) {
  const cleaned = query
    .toLowerCase()
    .replace(/[*"()\-:^~[\]{}!&|<>+=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.split(/\s+/).filter(t => t.length >= 3).map(t => t + '*').join(' ');
}

function tokenizeQuery(query) {
  return query
    .toLowerCase()
    .replace(/[*"'()\-:^~[\]{}!&|<>+=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function sanitizeConceptQuery(query) {
  return tokenizeQuery(query).map((t) => `"${t}"`).join(' OR ');
}

export function searchTeamMemoryHybrid({ query, project, kind, status, cloud_status, includeIds, excludeIds, limit = 10, offset = 0, alpha = 0.3 }) {
  const d = initDb();
  if (includeIds && includeIds.length === 0) return { rows: [], total: 0 };
  if (alpha < 0) alpha = 0;
  if (alpha > 1) alpha = 1;
  limit = Math.min(limit, 5000);
  const K = Math.min((offset + limit) * 3, 4096);
  const useVector = alpha > 0;
  const ftsQuery = sanitizeMemoryQuery(query);

  if (!ftsQuery && !useVector) return { rows: [], total: 0 };

  let queryEmbedding, queryBuf;
  if (useVector) {
    queryEmbedding = createEmbedding(query);
    queryBuf = Buffer.from(queryEmbedding.buffer);
  }

  const ftsMap = new Map();

  if (ftsQuery) {
    const ftsParams = [ftsQuery];
    const extraClauses = [];
    if (project) { extraClauses.push('AND m.project = ?'); ftsParams.push(project); }
    if (kind) { extraClauses.push('AND m.kind = ?'); ftsParams.push(kind); }
    if (status) { extraClauses.push('AND m.status = ?'); ftsParams.push(status); }
    if (cloud_status) { extraClauses.push('AND m.cloud_status = ?'); ftsParams.push(cloud_status); }
    if (includeIds && includeIds.length > 0) {
      extraClauses.push('AND m.row_id IN (' + includeIds.map(() => '?').join(',') + ')');
      ftsParams.push(...includeIds);
    } else if (excludeIds && excludeIds.length > 0) {
      extraClauses.push('AND m.row_id NOT IN (' + excludeIds.map(() => '?').join(',') + ')');
      ftsParams.push(...excludeIds);
    }
    ftsParams.push(K);

    let ftsResults = [];
    try {
      ftsResults = d.prepare(`
        SELECT m.row_id, m.id, m.account_id, m.source_node_id, m.project, m.kind,
               m.related_ids, m.status, m.content, m.metadata, m.content_hash,
               m.cloud_status, m.approved_by, m.approved_at,
               m.source_node_name, m.source_user_email, m.created_at, m.updated_at,
               f.rank as raw_rank
        FROM (SELECT rowid, rank FROM memory_synapses_fts WHERE memory_synapses_fts MATCH ?) f
        JOIN memory_synapses m ON m.row_id = f.rowid
        WHERE 1=1 ${extraClauses.join(' ')}
        ORDER BY raw_rank
        LIMIT ?
      `).all(...ftsParams);
    } catch (e) { /* FTS query failed — fall back to vec-only */ }

    const ftsRawScores = ftsResults.map(r => -r.raw_rank);
    const maxFtsScore = ftsRawScores.length > 0 ? Math.max(...ftsRawScores) : 1;

    for (let i = 0; i < ftsResults.length; i++) {
      const r = ftsResults[i];
      const norm = maxFtsScore > 0 ? ftsRawScores[i] / maxFtsScore : 0;
      r.fts_score = Math.max(0, Math.min(1, norm));
      r.vec_score = 0;
      r.synapse_type = 'team_memory';
      ftsMap.set(r.row_id, r);
    }
  }

  if (useVector) {
    const vecResults = d.prepare(
      'SELECT rowid, distance FROM memory_synapses_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?'
    ).all(queryBuf, K);

    const vecMap = new Map();
    for (const r of vecResults) {
      const norm = 1 - Math.min(1, r.distance / 2);
      vecMap.set(r.rowid, norm);
    }

    for (const [rowId, norm] of vecMap) {
      if (ftsMap.has(rowId)) {
        ftsMap.get(rowId).vec_score = norm;
      } else {
        const extraClauses = [];
        const lookupParams = [rowId];
        if (project) { extraClauses.push('AND project = ?'); lookupParams.push(project); }
        if (kind) { extraClauses.push('AND kind = ?'); lookupParams.push(kind); }
        if (status) { extraClauses.push('AND m.status = ?'); lookupParams.push(status); }
        if (cloud_status) { extraClauses.push('AND cloud_status = ?'); lookupParams.push(cloud_status); }
        const m = d.prepare(
          `SELECT * FROM memory_synapses WHERE row_id = ? ${extraClauses.join(' ')}`
        ).get(...lookupParams);
        if (m) {
          if (includeIds && !includeIds.includes(m.row_id)) continue;
          if (excludeIds && excludeIds.includes(m.row_id)) continue;
          m.fts_score = 0;
          m.vec_score = norm;
          m.synapse_type = 'team_memory';
          ftsMap.set(m.row_id, m);
        }
      }
    }
  }

  const results = Array.from(ftsMap.values())
    .map(r => ({
      row_id: r.row_id,
      id: r.id,
      account_id: r.account_id,
      source_node_id: r.source_node_id,
      synapse_type: 'team_memory',
      project: r.project,
      kind: r.kind,
      related_ids: r.related_ids ? r.related_ids.split(',').filter(Boolean) : [],
      status: r.status || '',
      content: r.content,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      content_hash: r.content_hash,
      cloud_status: r.cloud_status,
      approved_by: r.approved_by,
      approved_at: r.approved_at,
      source_node_name: r.source_node_name,
      source_user_email: r.source_user_email,
      created_at: r.created_at,
      updated_at: r.updated_at,
      score: alpha * r.vec_score + (1 - alpha) * r.fts_score,
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const total = results.length;
  return { rows: results.slice(offset, offset + limit), total };
}

export function searchTeamConceptHybrid({ query, type, tags, cloud_status, collection, status, includeIds, excludeIds, limit = 10, offset = 0, alpha = 0.3 }) {
  const d = initDb();
  if (includeIds && includeIds.length === 0) return { rows: [], total: 0 };
  if (alpha < 0) alpha = 0;
  if (alpha > 1) alpha = 1;
  limit = Math.min(limit, 5000);
  const K = Math.min((offset + limit) * 3, 4096);
  const useVector = alpha > 0;
  const ftsQuery = sanitizeConceptQuery(query);

  if (!ftsQuery && !useVector) return { rows: [], total: 0 };

  let queryEmbedding, queryBuf;
  if (useVector) {
    queryEmbedding = createEmbedding(query);
    queryBuf = Buffer.from(queryEmbedding.buffer);
  }

  const ftsMap = new Map();

  if (ftsQuery) {
    const ftsParams = [ftsQuery];
    const extraClauses = [];
    if (type) { extraClauses.push('AND c.type = ?'); ftsParams.push(type); }
    if (tags) {
      const tagArr = Array.isArray(tags) ? tags : [tags];
      extraClauses.push('AND (' + tagArr.map(() => 'c.tags LIKE ?').join(' OR ') + ')');
      for (const t of tagArr) { ftsParams.push('%"' + t + '"%'); }
    }
    if (cloud_status) { extraClauses.push('AND c.cloud_status = ?'); ftsParams.push(cloud_status); }
    if (collection) { extraClauses.push('AND c.collection = ?'); ftsParams.push(collection); }
    if (status) { extraClauses.push('AND c.status = ?'); ftsParams.push(status); }
    if (includeIds && includeIds.length > 0) {
      extraClauses.push('AND c.row_id IN (' + includeIds.map(() => '?').join(',') + ')');
      ftsParams.push(...includeIds);
    } else if (excludeIds && excludeIds.length > 0) {
      extraClauses.push('AND c.row_id NOT IN (' + excludeIds.map(() => '?').join(',') + ')');
      ftsParams.push(...excludeIds);
    }
    ftsParams.push(K);

    let ftsResults = [];
    try {
      ftsResults = d.prepare(`
        SELECT c.row_id, c.id, c.account_id, c.source_node_id, c.slug, c.collection, c.type,
               c.title, c.description, c.tags, c.status, c.frontmatter, c.body,
               c.body_length, c.content_hash, c.cloud_status,
               c.approved_by, c.approved_at,
               c.source_node_name, c.source_user_email, c.created_at, c.updated_at,
               f.rank as raw_rank
        FROM (SELECT rowid, rank FROM concept_synapses_fts WHERE concept_synapses_fts MATCH ?) f
        JOIN concept_synapses c ON c.row_id = f.rowid
        WHERE 1=1 ${extraClauses.join(' ')}
        ORDER BY raw_rank
        LIMIT ?
      `).all(...ftsParams);
    } catch (e) { /* FTS query failed — fall back to vec-only */ }

    const ftsRawScores = ftsResults.map(r => -r.raw_rank);
    const maxFtsScore = ftsRawScores.length > 0 ? Math.max(...ftsRawScores) : 1;

    for (let i = 0; i < ftsResults.length; i++) {
      const r = ftsResults[i];
      const norm = maxFtsScore > 0 ? ftsRawScores[i] / maxFtsScore : 0;
      r.fts_score = Math.max(0, Math.min(1, norm));
      r.vec_score = 0;
      r.synapse_type = 'team_concept';
      ftsMap.set(r.row_id, r);
    }
  }

  if (useVector) {
    const vecResults = d.prepare(
      'SELECT rowid, distance FROM concept_synapses_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?'
    ).all(queryBuf, K);

    const vecMap = new Map();
    for (const r of vecResults) {
      const norm = 1 - Math.min(1, r.distance / 2);
      vecMap.set(r.rowid, norm);
    }

    for (const [rowId, norm] of vecMap) {
      if (ftsMap.has(rowId)) {
        ftsMap.get(rowId).vec_score = norm;
      } else {
        const extraClauses = [];
        const lookupParams = [rowId];
        if (type) { extraClauses.push('AND type = ?'); lookupParams.push(type); }
        if (tags) {
          const tagArr = Array.isArray(tags) ? tags : [tags];
          extraClauses.push('AND (' + tagArr.map(() => 'tags LIKE ?').join(' OR ') + ')');
          for (const t of tagArr) { lookupParams.push('%"' + t + '"%'); }
        }
        if (cloud_status) { extraClauses.push('AND cloud_status = ?'); lookupParams.push(cloud_status); }
        if (collection) { extraClauses.push('AND collection = ?'); lookupParams.push(collection); }
        if (status) { extraClauses.push('AND status = ?'); lookupParams.push(status); }
        const c = d.prepare(
          `SELECT * FROM concept_synapses WHERE row_id = ? ${extraClauses.join(' ')}`
        ).get(...lookupParams);
        if (c) {
          if (includeIds && !includeIds.includes(c.row_id)) continue;
          if (excludeIds && excludeIds.includes(c.row_id)) continue;
          c.fts_score = 0;
          c.vec_score = norm;
          c.synapse_type = 'team_concept';
          ftsMap.set(c.row_id, c);
        }
      }
    }
  }

  const results = Array.from(ftsMap.values())
    .map(r => ({
        row_id: r.row_id,
        id: r.id,
        account_id: r.account_id,
        source_node_id: r.source_node_id,
        synapse_type: 'team_concept',
        slug: r.slug,
        collection: r.collection,
        type: r.type,
        title: r.title,
        description: r.description,
        tags: typeof r.tags === 'string' ? r.tags : (r.tags || ''),
        status: r.status || 'stable',
        frontmatter: typeof r.frontmatter === 'string' ? JSON.parse(r.frontmatter || '{}') : r.frontmatter,
        body: r.body,
        body_length: r.body_length,
        content_hash: r.content_hash,
        cloud_status: r.cloud_status,
        approved_by: r.approved_by,
        approved_at: r.approved_at,
        source_node_name: r.source_node_name,
        source_user_email: r.source_user_email,
        created_at: r.created_at,
        updated_at: r.updated_at,
        score: alpha * r.vec_score + (1 - alpha) * r.fts_score,
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const total = results.length;
    return { rows: results.slice(offset, offset + limit), total };
  }

  // ══════════════════════════════════════════════════════════════
  // Local memories (memory parity — local CRUD on `memories`)
  // ══════════════════════════════════════════════════════════════

  const BACKUP_PREFIX = 'cordenar-';
  let writeCount = 0;
  let lastDataVersion = 0;

  function recordWrite() {
    const cfg = getConfig();
    writeCount++;
    if (writeCount >= (cfg.backup?.intervalWrites || 50)) {
      doBackup();
    }
  }

  function resolveSchema(project) {
    const cfg = getConfig();
    const schemas = cfg.schemas || {};
    return schemas[project] || schemas.default;
  }

  function normalizeMetadata(project, kind, rawMeta, now) {
    const schema = resolveSchema(project);
    const kindSchema = schema?.kinds?.[kind];
    let meta;
    if (kindSchema) {
      meta = { ...kindSchema.defaults };
      if (rawMeta && typeof rawMeta === 'object') {
        for (const key of Object.keys(rawMeta)) {
          if (rawMeta[key] !== undefined && rawMeta[key] !== null) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            meta[key] = rawMeta[key];
          }
        }
      }
      for (const key of (kindSchema.required || [])) {
        if (meta[key] === undefined || meta[key] === null) {
          meta[key] = kindSchema.defaults[key];
        }
      }
      const validStatuses = kindSchema.statuses || [];
      if (validStatuses.length > 0 && meta.status && !validStatuses.includes(meta.status)) {
        throw new Error(
          `Invalid status "${meta.status}" for kind "${kind}". Valid: ${validStatuses.join(", ")}`
        );
      }
    } else {
      meta = rawMeta && typeof rawMeta === 'object' ? { ...rawMeta } : {};
    }
    const ts = now || Math.floor(Date.now() / 1000);
    meta.created_at = meta.created_at || ts;
    meta.updated_at = ts;
    return meta;
  }

  export function storeMemory({ project, kind, content, metadata, related_ids, status }) {
    const d = initDb();
    if (content && content.length > getConfig().contentMaxSize) {
      throw new Error('Content exceeds maximum size (' + getConfig().contentMaxSize + ' characters)');
    }
    const finalKind = kind || 'note';
    const metaInput = { ...(metadata || {}) };
    if (status !== undefined && status !== null) {
      metaInput.status = status;
    }
    const meta = normalizeMetadata(project, finalKind, metaInput);
    const metaStr = JSON.stringify(meta);
    const rids = Array.isArray(related_ids) ? related_ids.join(',') : String(related_ids || '');
    const now = Math.floor(Date.now() / 1000);
    const result = d.prepare(
      'INSERT INTO memories (project, kind, related_ids, status, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(project, finalKind, rids, meta.status || '', content, metaStr, now, now);
    const id = Number(result.lastInsertRowid);
    d.prepare('INSERT INTO memories_fts (rowid, project, kind, status, content) VALUES (?, ?, ?, ?, ?)')
      .run(id, project, finalKind, meta.status || '', content);
    const embedding = createEmbedding(content);
    d.prepare('INSERT INTO memories_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
      .run(id, Buffer.from(embedding.buffer));
    recordWrite();
    return Number(id);
  }

  export function getMemoryById(project, id) {
    const d = initDb();
    const row = d.prepare('SELECT * FROM memories WHERE id = ? AND project = ?').get(id, project);
    if (!row) return null;
    return {
      ...row,
      type: row.kind,
      source: 'memory',
      metadata: JSON.parse(row.metadata || '{}'),
      related_ids: row.related_ids ? row.related_ids.split(',').map(Number).filter(Boolean) : [],
      status: row.status || '',
    };
  }

  export function searchLocalMemory({ project, query, limit = 10, offset = 0, alpha = 0.3, archived, trash, kind, status, includeIds, excludeIds, requireFtsMatch }) {
    const d = initDb();
    if (includeIds && includeIds.length === 0) return { rows: [], total: 0 };
    if (alpha < 0) alpha = 0;
    if (alpha > 1) alpha = 1;
    limit = Math.min(limit, 5000);
    const K = Math.min((offset + limit) * 3, 4096);
    const useVector = alpha > 0;
    const ftsQuery = sanitizeMemoryQuery(query);
    let queryEmbedding, queryBuf;
    if (useVector) {
      queryEmbedding = createEmbedding(query);
      queryBuf = Buffer.from(queryEmbedding.buffer);
    }
    if (!ftsQuery && !useVector) return { rows: [], total: 0 };

    let deletedClause, lookupClause;
    if (archived) {
      deletedClause = 'AND m.archived_at IS NOT NULL AND m.deleted_at IS NULL';
      lookupClause = 'archived_at IS NOT NULL AND deleted_at IS NULL';
    } else if (trash) {
      deletedClause = 'AND m.deleted_at IS NOT NULL';
      lookupClause = 'deleted_at IS NOT NULL';
    } else {
      deletedClause = 'AND m.deleted_at IS NULL AND m.archived_at IS NULL';
      lookupClause = 'deleted_at IS NULL AND archived_at IS NULL';
    }

    const ftsMap = new Map();

    if (ftsQuery) {
      const ftsParams = [ftsQuery];
      const ftsProjectClause = project ? 'AND m.project = ?' : '';
      if (project) ftsParams.push(project);
      const ftsKindClause = kind && kind.trim().length > 0 ? 'AND m.kind = ?' : '';
      if (kind && kind.trim().length > 0) ftsParams.push(kind);
      const ftsStatusClause = status ? 'AND m.status = ?' : '';
      if (status) ftsParams.push(status);
      let ftsIdClause = '';
      if (includeIds && includeIds.length > 0) {
        ftsIdClause = 'AND m.id IN (' + includeIds.map(() => '?').join(',') + ')';
        ftsParams.push(...includeIds);
      } else if (excludeIds && excludeIds.length > 0) {
        ftsIdClause = 'AND m.id NOT IN (' + excludeIds.map(() => '?').join(',') + ')';
        ftsParams.push(...excludeIds);
      }
      ftsParams.push(K);
      const ftsResults = d.prepare(`
        SELECT m.id, m.project, m.kind, m.related_ids, m.status, m.content, m.metadata, m.created_at, m.updated_at, m.deleted_at, m.archived_at,
               f.rank as raw_rank
        FROM (SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ?) f
        JOIN memories m ON m.id = f.rowid
        WHERE 1=1 ${deletedClause} ${ftsProjectClause} ${ftsKindClause} ${ftsStatusClause} ${ftsIdClause}
        ORDER BY raw_rank
        LIMIT ?
      `).all(...ftsParams);
      const ftsRawScores = ftsResults.map(r => -r.raw_rank);
      const maxFtsScore = ftsRawScores.length > 0 ? Math.max(...ftsRawScores) : 1;
      for (let i = 0; i < ftsResults.length; i++) {
        const r = ftsResults[i];
        const norm = maxFtsScore > 0 ? ftsRawScores[i] / maxFtsScore : 0;
        r.fts_score = Math.max(0, Math.min(1, norm));
        r.vec_score = 0;
        ftsMap.set(r.id, r);
      }
    }

    if (useVector) {
      const vecResults = d.prepare(`
        SELECT rowid, distance
        FROM memories_vec
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `).all(queryBuf, K);
      const vecMap = new Map();
      for (const r of vecResults) {
        const norm = 1 - Math.min(1, r.distance / 2);
        vecMap.set(r.rowid, norm);
      }
      for (const [id, norm] of vecMap) {
        if (ftsMap.has(id)) {
          ftsMap.get(id).vec_score = norm;
        } else {
          const lookupKindClause = kind && kind.trim().length > 0 ? ' AND kind = ?' : '';
          const lookupStatusClause = status ? ' AND status = ?' : '';
          const lookupSql = project
            ? `SELECT * FROM memories WHERE id = ? AND project = ?${lookupKindClause}${lookupStatusClause} AND ${lookupClause}`
            : `SELECT * FROM memories WHERE id = ?${lookupKindClause}${lookupStatusClause} AND ${lookupClause}`;
          const lookupParams = [id];
          if (project) lookupParams.push(project);
          if (kind && kind.trim().length > 0) lookupParams.push(kind);
          if (status) lookupParams.push(status);
          const m = d.prepare(lookupSql).get(...lookupParams);
          if (m) {
            if (includeIds && !includeIds.includes(m.id)) continue;
            if (excludeIds && excludeIds.includes(m.id)) continue;
            m.fts_score = 0;
            m.vec_score = norm;
            if (typeof m.metadata === 'string') m.metadata = JSON.parse(m.metadata);
            ftsMap.set(m.id, m);
          }
        }
      }
    }

    if (requireFtsMatch && ftsQuery) {
      for (const [id, r] of ftsMap) {
        if (r.fts_score === 0) ftsMap.delete(id);
      }
    }

    const results = Array.from(ftsMap.values())
      .map(r => ({
        id: r.id,
        project: r.project,
        kind: r.kind,
        related_ids: r.related_ids ? r.related_ids.split(',').map(Number).filter(Boolean) : [],
        status: r.status || '',
        content: r.content,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
        created_at: r.created_at,
        updated_at: r.updated_at,
        score: alpha * r.vec_score + (1 - alpha) * r.fts_score,
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const total = results.length;
    return { rows: results.slice(offset, offset + limit), total };
  }

  export function listLocalMemories({ project, kind, trash = false, archived = false, limit = 20, offset = 0, status, includeIds, excludeIds }) {
    const d = initDb();
    if (includeIds && includeIds.length === 0) return { rows: [], total: 0, limit, offset };
    const params = [];
    const conditions = [];
    if (project) { conditions.push('project = ?'); params.push(project); }
    if (kind && kind.trim().length > 0) { conditions.push('kind = ?'); params.push(kind); }
    if (status && status.trim().length > 0) { conditions.push('status = ?'); params.push(status); }
    if (includeIds && includeIds.length > 0) { conditions.push('id IN (' + includeIds.map(() => '?').join(',') + ')'); params.push(...includeIds); }
    else if (excludeIds && excludeIds.length > 0) { conditions.push('id NOT IN (' + excludeIds.map(() => '?').join(',') + ')'); params.push(...excludeIds); }
    if (archived) {
      conditions.push('archived_at IS NOT NULL AND deleted_at IS NULL');
    } else if (trash) {
      conditions.push('deleted_at IS NOT NULL');
    } else {
      conditions.push('deleted_at IS NULL AND archived_at IS NULL');
    }
    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    const total = d.prepare('SELECT COUNT(*) as c FROM memories' + whereClause).get(...params).c || 0;
    let sql = 'SELECT * FROM memories' + whereClause;
    sql += ' ORDER BY COALESCE(NULLIF(updated_at, 0), created_at) DESC LIMIT ? OFFSET ?';
    const rows = d.prepare(sql).all(...params, limit, offset).map(r => ({
      ...r,
      metadata: JSON.parse(r.metadata || '{}'),
      related_ids: r.related_ids ? r.related_ids.split(',').map(Number).filter(Boolean) : [],
      status: r.status || '',
    }));
    return { rows, total, limit, offset };
  }

  export function updateMemory({ id, project, kind, content, metadata, related_ids, status }) {
    const d = initDb();
    const existing = d.prepare('SELECT id, kind, metadata FROM memories WHERE id = ? AND project = ? AND deleted_at IS NULL')
      .get(id, project);
    if (!existing) return false;
    const sets = [];
    const params = [];
    const effectiveKind = kind !== undefined && kind !== null ? kind : existing.kind;
    if (kind !== undefined && kind !== null) {
      sets.push('kind = ?'); params.push(kind);
    }
    if (content !== undefined && content !== null) {
      sets.push('content = ?'); params.push(content);
    }
    if (related_ids !== undefined) {
      const rids = Array.isArray(related_ids) ? related_ids.join(',') : String(related_ids || '');
      sets.push('related_ids = ?'); params.push(rids);
    }
    sets.push('updated_at = unixepoch()');
    const existingMeta = JSON.parse(existing.metadata || '{}');
    let incomingMeta;
    if (typeof metadata === 'string') {
      try { incomingMeta = JSON.parse(metadata); } catch { incomingMeta = {}; }
    } else {
      incomingMeta = metadata !== undefined && metadata !== null ? { ...metadata } : {};
    }
    if (status !== undefined && status !== null) incomingMeta.status = status;
    const mergedMeta = normalizeMetadata(project, effectiveKind, { ...existingMeta, ...incomingMeta });
    sets.push('status = ?'); params.push(mergedMeta.status || '');
    sets.push('metadata = ?'); params.push(JSON.stringify(mergedMeta));
    params.push(id, project);
    let result;
    try {
      result = d.transaction(() => {
        d.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(id);
        const r = d.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ? AND project = ?`).run(...params);
        if (r.changes === 0) throw new Error('memory-update-no-match');
        const current = d.prepare('SELECT kind, status, content FROM memories WHERE id = ?').get(id);
        const ftsContent = content !== undefined && content !== null ? content : current.content;
        d.prepare('INSERT INTO memories_fts (rowid, project, kind, status, content) VALUES (?, ?, ?, ?, ?)')
          .run(id, project, current.kind, current.status || '', ftsContent);
        if (content !== undefined && content !== null) {
          const embedding = createEmbedding(content);
          d.prepare('DELETE FROM memories_vec WHERE rowid = CAST(? AS INTEGER)').run(id);
          d.prepare('INSERT INTO memories_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
            .run(id, Buffer.from(embedding.buffer));
        }
        return r;
      })();
    } catch (e) {
      if (e.message === 'memory-update-no-match') return false;
      throw e;
    }
    if (result.changes > 0) {
      recordWrite();
      return true;
    }
    return false;
  }

  export function trashMemory(project, id) {
    const d = initDb();
    const result = d.prepare(
      'UPDATE memories SET deleted_at = unixepoch() WHERE id = ? AND project = ? AND deleted_at IS NULL'
    ).run(id, project);
    if (result.changes > 0) recordWrite();
    return result.changes > 0;
  }

  export function restoreMemory(project, id) {
    const d = initDb();
    const result = d.prepare(
      'UPDATE memories SET deleted_at = NULL WHERE id = ? AND project = ? AND deleted_at IS NOT NULL'
    ).run(id, project);
    return result.changes > 0;
  }

  export function archiveMemory(project, id) {
    const d = initDb();
    const result = d.prepare(
      'UPDATE memories SET archived_at = unixepoch() WHERE id = ? AND project = ? AND deleted_at IS NULL AND archived_at IS NULL'
    ).run(id, project);
    if (result.changes > 0) recordWrite();
    return result.changes > 0;
  }

  export function unarchiveMemory(project, id) {
    const d = initDb();
    const result = d.prepare(
      'UPDATE memories SET archived_at = NULL WHERE id = ? AND project = ? AND archived_at IS NOT NULL'
    ).run(id, project);
    if (result.changes > 0) recordWrite();
    return result.changes > 0;
  }

  export function deleteMemoryPermanent(project, id, force) {
    const d = initDb();
    if (!force) {
      const existing = d.prepare(
        'SELECT id FROM memories WHERE id = ? AND project = ? AND deleted_at IS NOT NULL'
      ).get(id, project);
      if (!existing) {
        throw new Error(`Memory #${id} is not in trash. Trash it first or use force=true.`);
      }
    }
    const result = d.transaction(() => {
      d.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(id);
      d.prepare('DELETE FROM memories_vec WHERE rowid = CAST(? AS INTEGER)').run(id);
      return d.prepare('DELETE FROM memories WHERE id = ? AND project = ?').run(id, project);
    })();
    if (result.changes > 0) recordWrite();
    return result.changes > 0;
  }

  export function reassignMemories(fromProject, toProject, ids) {
    const d = initDb();
    let result;
    if (ids && Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      result = d.prepare(
        `UPDATE memories SET project = ?, updated_at = unixepoch() WHERE project = ? AND id IN (${placeholders})`
      ).run(toProject, fromProject, ...ids);
    } else {
      result = d.prepare(
        'UPDATE memories SET project = ?, updated_at = unixepoch() WHERE project = ?'
      ).run(toProject, fromProject);
    }
    if (result.changes > 0) recordWrite();
    return result.changes;
  }

  export function listProjects() {
    const d = initDb();
    return d.prepare('SELECT DISTINCT project FROM memories ORDER BY project').all().map(r => r.project);
  }

  export function countProject(project) {
    const d = initDb();
    const rows = d.prepare(
      'SELECT kind, COUNT(*) as count FROM memories WHERE project = ? AND deleted_at IS NULL GROUP BY kind'
    ).all(project);
    const counts = {};
    let total = 0;
    for (const r of rows) {
      counts[r.kind || '(empty)'] = r.count;
      total += r.count;
    }
    counts.total = total;
    return counts;
  }

  export function trashProject(project) {
    const d = initDb();
    const active = d.prepare(
      'SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL'
    ).get(project);
    if (active.c === 0) {
      throw new Error(`Project '${project}' has no non-trashed memories to trash.`);
    }
    const result = d.prepare(
      'UPDATE memories SET deleted_at = unixepoch() WHERE project = ? AND deleted_at IS NULL'
    ).run(project);
    recordWrite();
    return result.changes;
  }

  export function deleteProject(project, force) {
    const d = initDb();
    const total = d.prepare('SELECT COUNT(*) as c FROM memories WHERE project = ?').get(project);
    if (total.c === 0) {
      throw new Error(`Project '${project}' has no memories.`);
    }
    if (!force) {
      const active = d.prepare(
        'SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL'
      ).get(project);
      if (active.c > 0) {
        throw new Error(
          `Project '${project}' has ${active.c} non-trashed memories. Trash them first or use force=true.`
        );
      }
    }
    const result = d.transaction(() => {
      const ids = d.prepare('SELECT id FROM memories WHERE project = ?').all(project).map((r) => r.id);
      for (const id of ids) {
        d.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(id);
        d.prepare('DELETE FROM memories_vec WHERE rowid = CAST(? AS INTEGER)').run(id);
      }
      return d.prepare('DELETE FROM memories WHERE project = ?').run(project);
    })();
    recordWrite();
    return result.changes;
  }

  export function getBrief({ project } = {}) {
    const d = initDb();
    const projects = project
      ? [project]
      : d.prepare('SELECT DISTINCT project FROM memories ORDER BY project').all().map(r => r.project);
    const results = [];
    for (const proj of projects) {
      let lastSummary = null;
      const summaryRow = d.prepare(
        "SELECT id, updated_at FROM memories WHERE project = ? AND kind = 'progressive_summary' AND deleted_at IS NULL AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1"
      ).get(proj);
      if (summaryRow) {
        lastSummary = { id: summaryRow.id, stale: false };
        const newer = d.prepare(
          "SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND kind != 'progressive_summary' AND updated_at > ? LIMIT 1"
        ).get(proj, summaryRow.updated_at);
        lastSummary.stale = newer.c > 0;
      }
      const pendingCount = d.prepare(
        "SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND kind = 'plan' AND status IN ('pending','approved','in_progress')"
      ).get(proj).c;
      const openBugsCount = d.prepare(
        "SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND kind = 'bug' AND status IN ('open','in_progress')"
      ).get(proj).c;
      const activityCount = d.prepare(
        'SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL'
      ).get(proj).c;
      results.push({
        project: proj,
        last_summary: lastSummary,
        pending: pendingCount,
        open_bugs: openBugsCount,
        activity_count: activityCount,
      });
    }
    return results;
  }

  export function doBackup() {
    const cfg = getConfig();
    const d = initDb();
    const currentVersion = d.pragma('data_version');
    if (currentVersion === lastDataVersion) return;
    const dir = cfg.backup?.dir;
    if (!dir) throw new Error('backup.dir not configured');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace('T', '-').replace(/:/g, '-').replace(/\..+/, '');
    const filename = `${BACKUP_PREFIX}${ts}-${Date.now() % 100000}.db`;
    const filepath = join(dir, filename);
    const abs = resolvePath(filepath);
    if (!abs.startsWith(dir + sep)) throw new Error('Backup path outside backup directory');
  try {
    d.exec(`VACUUM INTO '${abs.replace(/'/g, "''")}'`);
    if (!verifyBackup(abs, d)) {
      writeCount = 0;
      return null;
    }
    writeCount = 0;
    lastDataVersion = currentVersion;
    enforceRetention();
    return { filename, filepath };
  } catch (e) {
    console.error('doBackup failed:', e.message);
    return null;
  }
  }

  function verifyBackup(abs, srcDb) {
    let buDb;
    try {
      buDb = new Database(abs, { readonly: true });
      buDb.pragma('quick_check');
      const buMem = buDb.prepare('SELECT COUNT(*) as c FROM memories').get().c;
      const buCon = buDb.prepare('SELECT COUNT(*) as c FROM concepts').get().c;
      const sMem = srcDb.prepare('SELECT COUNT(*) as c FROM memories').get().c;
      const sCon = srcDb.prepare('SELECT COUNT(*) as c FROM concepts').get().c;
      const srcTotal = sMem + sCon;
      const buTotal = buMem + buCon;
      if (srcTotal > 0 && buTotal === 0) {
        unlinkSync(abs);
        console.warn('[cordenar] backup rejected: empty copy (source ' + srcTotal + ' rows, backup 0)');
        return false;
      }
      return true;
    } catch (e) {
      try { if (abs) unlinkSync(abs); } catch (_) {}
      console.warn('[cordenar] backup rejected: verification failed (' + e.message + ')');
      return false;
    } finally {
      if (buDb) { try { buDb.close(); } catch (_) {} }
    }
  }

  function enforceRetention() {
    const cfg = getConfig();
    const dir = cfg.backup?.dir;
    if (!dir || !existsSync(dir)) return;
    const ret = cfg.backup?.retention || { recentHours: 24, dailyDays: 30, weeklyWeeks: 12, monthlyMonths: 12 };

    const files = readdirSync(dir)
      .filter(f => f.startsWith(BACKUP_PREFIX) && f.endsWith('.db'))
      .map(f => {
        const fp = join(dir, f);
        return { name: f, path: fp, mtime: statSync(fp).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    const now = Date.now();
    const keep = new Set();
    const days = new Set();
    const weeks = new Set();
    const months = new Set();

    for (const f of files) {
      const ageMs = now - f.mtime;
      const d = new Date(f.mtime);

      if (ageMs <= ret.recentHours * 3600000) {
        keep.add(f.path);
        continue;
      }
      if (ageMs <= ret.dailyDays * 86400000) {
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        if (!days.has(key)) { keep.add(f.path); days.add(key); }
        continue;
      }
      if (ageMs <= ret.weeklyWeeks * 7 * 86400000) {
        const weekStart = new Date(d.getFullYear(), 0, 1);
        const key = d.getFullYear() + '-W' + String(Math.floor((d - weekStart) / 604800000) + 1).padStart(2, '0');
        if (!weeks.has(key)) { keep.add(f.path); weeks.add(key); }
        continue;
      }
      if (ageMs <= ret.monthlyMonths * 30 * 86400000) {
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        if (!months.has(key)) { keep.add(f.path); months.add(key); }
        continue;
      }
    }

    let pruned = 0;
    for (const f of files) {
      if (!keep.has(f.path)) {
        unlinkSync(f.path);
        pruned++;
      }
    }
    if (pruned > 0) {
      console.warn('[cordenar] backup retention pruned ' + pruned + ' files');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Local concepts (concept parity — local index/CRUD on `concepts`)
  // ══════════════════════════════════════════════════════════════

  function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { frontmatter: {}, body: content };
    try {
      const frontmatter = yamlLoad(match[1], { schema: JSON_SCHEMA }) || {};
      return { frontmatter, body: content.slice(match[0].length) };
    } catch {
      return { frontmatter: {}, body: content };
    }
  }

  function normalizeTags(input) {
    if (input == null) return [];
    if (Array.isArray(input)) return input;
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) return [];
      return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  function inferType(relPath, frontmatter) {
    if (frontmatter.type) return frontmatter.type.toLowerCase();
    const lower = relPath.toLowerCase();
    if (lower.includes('/references/')) return 'reference';
    if (lower.includes('/example/')) return 'reference';
    if (lower.endsWith('skill.md')) return 'skill';
    if (lower.includes('/skills/')) return 'skill';
    if (lower.includes('instruction')) return 'instruction';
    if (lower.includes('agent')) return 'agent';
    if (lower.includes('prompt')) return 'prompt';
    if (lower.includes('workflow')) return 'workflow';
    return 'reference';
  }

  function deriveSlug(filePath, bundleRoot) {
    let rel = relative(bundleRoot, filePath);
    rel = rel.replace(/\.md$/i, '');
    rel = rel.replace(/\/SKILL$/i, '');
    if (!rel || rel === '.' || rel === 'SKILL') rel = basename(bundleRoot).replace(/\.md$/i, '');
    return rel;
  }

  function detectBundleRoot(filePath, scanPath, cache) {
    const dir = dirname(filePath);
    if (cache.has(dir)) return cache.get(dir);
    const home = homedir();
    const chain = [];
    let d = dir;
    while (d !== '/' && d !== home) {
      chain.push(d);
      d = dirname(d);
    }
    let bundle = scanPath;
    for (const marker of ['.git', 'package.json', 'SKILL.md']) {
      const found = chain.find(c => existsSync(join(c, marker)));
      if (found) { bundle = found; break; }
    }
    cache.set(dir, bundle);
    return bundle;
  }

  // ── Title derivation for frontmatter-less files ────────────────

  function stripMarkdownInline(s) {
    return String(s || '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#+\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function firstH1(body) {
    const m = String(body || '').match(/^#\s+(.+)$/m);
    return m ? stripMarkdownInline(m[1]) : '';
  }

  function firstSentence(body) {
    const text = String(body || '');
    const line = text.split('\n').find((l) => l.trim() && !/^#/.test(l.trim()));
    const base = (line || text).trim();
    const sentence = base.split('. ')[0] || base;
    return stripMarkdownInline(sentence).slice(0, 80);
  }

  function indexSingleFile(filePath, bundleRoot) {
    const d = initDb();
    const collection = basename(bundleRoot);
    const slug = deriveSlug(filePath, bundleRoot);
    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    const { frontmatter, body } = parseFrontmatter(content);
    const title = frontmatter.title || frontmatter.name || firstH1(body) || firstSentence(body) || '';
    const description = frontmatter.description || '';

    const existing = d.prepare('SELECT id, file_hash, title, description FROM concepts WHERE file_path = ?').get(filePath);
    if (existing && existing.file_hash === hash && existing.title === title && existing.description === description) {
      return { slug, collection, action: 'skipped' };
    }

    const type = inferType(relative(bundleRoot, filePath), frontmatter);
    const schema = resolveTypeSchema(type);
    let status = frontmatter.status || (schema ? schema.defaults.status : 'stable');
    if (schema && schema.statuses && schema.statuses.length > 0 && !schema.statuses.includes(status)) {
      status = schema.defaults.status;
    }
    const tags = JSON.stringify(normalizeTags(frontmatter.tags));
    const frontmatterJson = JSON.stringify(frontmatter);
    const timestamp = frontmatter.timestamp || null;
    const bodyLength = body.length;
    const now = Math.floor(Date.now() / 1000);
    const embedding = createEmbedding(body);

    if (existing) {
      d.transaction(() => {
        d.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(existing.id);
        d.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(existing.id);

        d.prepare(`
          UPDATE concepts SET collection=?, type=?, title=?, description=?, tags=?, status=?, frontmatter=?, body=?,
          body_length=?, file_hash=?, timestamp=?, updated_at=?
          WHERE id=?
        `).run(collection, type, title, description, tags, status, frontmatterJson, body, bodyLength, hash, timestamp, now, existing.id);

        d.prepare('INSERT INTO concepts_fts (rowid, title, description, tags, body) VALUES (?, ?, ?, ?, ?)')
          .run(existing.id, title, description, tags, body);
        d.prepare('INSERT INTO concepts_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
          .run(existing.id, Buffer.from(embedding.buffer));
      })();

      return { slug, collection, action: 'updated' };
    }

    // Check for slug collision within the collection
    const slugCollision = d.prepare('SELECT id FROM concepts WHERE collection = ? AND slug = ?').get(collection, slug);
    if (slugCollision) {
      return { slug, collection, action: 'collision' };
    }

    const result = d.prepare(`
      INSERT INTO concepts (collection, slug, type, title, description, tags, status, frontmatter, body, body_length, file_path, file_hash, timestamp, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(collection, slug, type, title, description, tags, status, frontmatterJson, body, bodyLength, filePath, hash, timestamp, now, now);

    const id = result.lastInsertRowid;
    d.prepare('INSERT INTO concepts_fts (rowid, title, description, tags, body) VALUES (?, ?, ?, ?, ?)')
      .run(id, title, description, tags, body);
    d.prepare('INSERT INTO concepts_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
      .run(id, Buffer.from(embedding.buffer));

    return { slug, collection, action: 'added' };
  }

  export function deindexConcepts({ collection, slug, path } = {}) {
    initDb();
    const removed = [];
    if (slug) {
      const concept = db.prepare("SELECT id, slug FROM concepts WHERE collection = ? AND slug = ?").get(collection, slug);
      if (concept) {
        db.transaction(() => {
          db.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(concept.id);
          db.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(concept.id);
          db.prepare('DELETE FROM concepts WHERE id = ?').run(concept.id);
        })();
        removed.push(concept.slug);
      }
    } else if (path) {
      const rows = db.prepare("SELECT id, slug FROM concepts WHERE file_path LIKE ?").all(path + '%');
      db.transaction(() => {
        for (const r of rows) {
          db.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(r.id);
          db.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(r.id);
          db.prepare('DELETE FROM concepts WHERE id = ?').run(r.id);
          removed.push(r.slug);
        }
      })();
    }
    return { removed, total: db.prepare('SELECT COUNT(*) as c FROM concepts').get().c };
  }

  const SKIP_CONCEPT_FILES = new Set(['readme.md', 'changelog.md', 'contributing.md', 'license.md']);

  function walkConceptDir(dir, files = []) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walkConceptDir(full, files);
      } else if (entry.isFile() && entry.name.endsWith('.md') && !SKIP_CONCEPT_FILES.has(entry.name.toLowerCase())) {
        files.push(full);
      }
    }
    return files;
  }

  export function indexConcepts(scanPaths) {
    initDb();
    const paths = scanPaths || getIndexPaths();
    const added = [], updated = [], collisions = [];
    const currentFiles = new Set();
    const bundleCache = new Map();
    const pending = [];
    for (const p of paths) {
      if (!existsSync(p)) continue;
      const st = statSync(p);
      if (st.isDirectory()) {
        for (const f of walkConceptDir(p)) pending.push({ filePath: f, scanPath: p });
      } else if (st.isFile() && p.endsWith('.md')) {
        pending.push({ filePath: p, scanPath: p });
      }
    }
    for (const { filePath, scanPath } of pending) {
      const bundleRoot = detectBundleRoot(filePath, scanPath, bundleCache);
      const result = indexSingleFile(filePath, bundleRoot);
      currentFiles.add(filePath);
      if (result.action === 'added') added.push(result.slug);
      else if (result.action === 'updated') updated.push(result.slug);
      else if (result.action === 'collision') collisions.push(result.slug);
    }
    const removed = [];
    if (scanPaths) {
      db.transaction(() => {
        for (const p of scanPaths) {
          const rows = db.prepare("SELECT id, slug, file_path FROM concepts WHERE file_path LIKE ?").all(p + '%');
          for (const c of rows) {
            if (!currentFiles.has(c.file_path)) {
              db.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(c.id);
              db.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(c.id);
              db.prepare('DELETE FROM concepts WHERE id = ?').run(c.id);
              removed.push(c.slug);
            }
          }
        }
      })();
    } else {
      const localConcepts = db.prepare("SELECT id, slug, file_path FROM concepts").all();
      db.transaction(() => {
        for (const c of localConcepts) {
          if (!currentFiles.has(c.file_path)) {
            db.prepare('DELETE FROM concepts_fts WHERE rowid = ?').run(c.id);
            db.prepare('DELETE FROM concepts_vec WHERE rowid = ?').run(c.id);
            db.prepare('DELETE FROM concepts WHERE id = ?').run(c.id);
            removed.push(c.slug);
          }
        }
      })();
    }
    return { added, updated, collisions, removed, total: db.prepare('SELECT COUNT(*) as c FROM concepts').get().c };
  }

  export function searchLocalConcepts({ query, collection, type, tags, status, match, weights, boost, limit = 10, offset = 0, alpha = 0.3, includeIds, excludeIds, requireFtsMatch } = {}) {
    initDb();
    if (includeIds && includeIds.length === 0) return { rows: [], total: 0 };
    const cfg = getConfig();
    const matchCols = match ? match.split(',').map(s => s.trim()).filter(Boolean) : null;
    const bodyExcluded = matchCols && !matchCols.includes('body');
    const alphaValue = bodyExcluded ? 1 : (alpha !== undefined ? alpha : (cfg.search?.alpha || 0.3));
    const wTitle = weights?.title ?? 10;
    const wDesc = weights?.description ?? 5;
    const wTags = weights?.tags ?? 3;
    const wBody = weights?.body ?? 1;
    const candidateLimit = Math.min((offset + limit) * 3, 4096);

    let vectorResults = [];
    if (alphaValue > 0 && !bodyExcluded) {
      const queryEmbedding = createEmbedding(query);
      const queryBuf = Buffer.from(queryEmbedding.buffer);
      const vecRows = db.prepare(
        'SELECT rowid, distance FROM concepts_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?'
      ).all(queryBuf, candidateLimit);
      const vecMap = new Map();
      for (const r of vecRows) {
        const norm = 1 - Math.min(1, r.distance / 2);
        vecMap.set(r.rowid, { distance: r.distance, norm });
      }
      for (const [rowId, info] of vecMap) {
        let lookupSql = 'SELECT c.id, c.collection, c.slug, c.type, c.title, c.description, c.tags, c.status, c.body_length FROM concepts c WHERE c.id = ?';
        const lookupParams = [rowId];
        if (collection) {
          lookupSql += ' AND c.collection = ?';
          lookupParams.push(collection);
        }
        if (type) {
          const types = Array.isArray(type) ? type : [type];
          if (types.length > 0) {
            lookupSql += ' AND c.type IN (' + types.map(() => '?').join(',') + ')';
            lookupParams.push(...types);
          }
        }
        if (status) {
          lookupSql += ' AND c.status = ?';
          lookupParams.push(status);
        }
        if (tags) {
          const tagArr = Array.isArray(tags) ? tags : [tags];
          lookupSql += ' AND (' + tagArr.map(() => 'c.tags LIKE ?').join(' OR ') + ')';
          for (const t of tagArr) { lookupParams.push('%"' + t + '"%'); }
        }
        const c = db.prepare(lookupSql).get(...lookupParams);
        if (c) {
          if (includeIds && !includeIds.includes(c.id)) continue;
          if (excludeIds && excludeIds.includes(c.id)) continue;
          c.distance = info.distance;
          c.vec_score = info.norm;
          c.fts_score = 0;
          vectorResults.push(c);
        }
      }
    }

    let ftsResults = [];
    const tokens = tokenizeQuery(query);
    if (tokens.length) {
      let ftsSql = `SELECT c.id, c.collection, c.slug, c.type, c.title, c.description, c.tags, c.status, c.body_length,
        c.created_at, c.updated_at,
        bm25(concepts_fts, ${wTitle}, ${wDesc}, ${wTags}, ${wBody}) AS rank
        FROM concepts c
        JOIN concepts_fts f ON f.rowid = c.id
        WHERE concepts_fts MATCH ?`;
      let ftsQuery;
      if (matchCols) {
        const ftsPrefix = matchCols.length === 1 ? matchCols[0] + ':' : '{' + matchCols.join(' ') + '}:';
        ftsQuery = tokens.map(t => `${ftsPrefix}"${t}"`).join(' OR ');
      } else {
        ftsQuery = tokens.map(t => `"${t}"`).join(' OR ');
      }
      const ftsParams = [ftsQuery];
      if (collection) {
        ftsSql += ' AND c.collection = ?';
        ftsParams.push(collection);
      }
      if (type) {
        const types = Array.isArray(type) ? type : [type];
        if (types.length > 0) {
          ftsSql += ' AND c.type IN (' + types.map(() => '?').join(',') + ')';
          ftsParams.push(...types);
        }
      }
      if (status) {
        ftsSql += ' AND c.status = ?';
        ftsParams.push(status);
      }
      if (tags) {
        const tagArr = Array.isArray(tags) ? tags : [tags];
        ftsSql += ' AND (' + tagArr.map(() => 'c.tags LIKE ?').join(' OR ') + ')';
        for (const t of tagArr) { ftsParams.push('%"' + t + '"%'); }
      }
      if (includeIds && includeIds.length > 0) {
        ftsSql += ' AND c.id IN (' + includeIds.map(() => '?').join(',') + ')';
        ftsParams.push(...includeIds);
      } else if (excludeIds && excludeIds.length > 0) {
        ftsSql += ' AND c.id NOT IN (' + excludeIds.map(() => '?').join(',') + ')';
        ftsParams.push(...excludeIds);
      }
      ftsSql += ' ORDER BY rank LIMIT ?';
      ftsParams.push(candidateLimit);
      ftsResults = db.prepare(ftsSql).all(...ftsParams);
    }

    if (ftsResults.length === 0 && vectorResults.length === 0) return { rows: [], total: 0 };

    const scores = new Map();
    if (ftsResults.length > 0) {
      const rawScores = ftsResults.map((r) => -r.rank);
      const maxRaw = Math.max(...rawScores);
      for (let i = 0; i < ftsResults.length; i++) {
        const r = ftsResults[i];
        const normalized = maxRaw > 0 ? rawScores[i] / maxRaw : 0;
        scores.set(r.id, { id: r.id, collection: r.collection, slug: r.slug, type: r.type, title: r.title,
          description: r.description, tags: r.tags, status: r.status, body_length: r.body_length, created_at: r.created_at, updated_at: r.updated_at, score: Math.max(0, Math.min(1, normalized)) });
      }
    }
    const ftsIds = new Set(scores.keys());
    if (vectorResults.length > 0) {
      for (const r of vectorResults) {
        const normalized = 1 - Math.min(1, r.distance / 2);
        if (scores.has(r.id)) {
          scores.get(r.id).score = (1 - alphaValue) * scores.get(r.id).score + alphaValue * normalized;
        } else {
          const concept = db.prepare('SELECT c.id, c.collection, c.slug, c.type, c.title, c.description, c.tags, c.status, c.body_length, c.created_at, c.updated_at FROM concepts c WHERE c.id = ?').get(r.id);
          if (concept) scores.set(r.id, { ...concept, score: alphaValue * normalized });
        }
      }
    }

    if (requireFtsMatch && tokens.length) {
      for (const id of scores.keys()) {
        if (!ftsIds.has(id)) scores.delete(id);
      }
    }

    if (tags && tags.length > 0) {
      for (const [id, entry] of scores) {
        const conceptTags = typeof entry.tags === 'string' ? JSON.parse(entry.tags || '[]') : (entry.tags || []);
        const hasAll = tags.every(t => conceptTags.includes(t));
        if (!hasAll) scores.delete(id);
      }
    }

    if (boost) {
      for (const [id, entry] of scores) {
        let factor = 1;
        if (boost.type && entry.type) factor *= (boost.type[entry.type] ?? 1);
        if (boost.status && entry.status) factor *= (boost.status[entry.status] ?? 1);
        entry.score *= factor;
      }
    }

    const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score);
    const total = sorted.length;
    return {
      rows: sorted.slice(offset, offset + limit).map(r => {
        let snippet = '';
        if (r.description) {
          snippet = r.description;
        } else {
          const raw = db.prepare('SELECT body FROM concepts WHERE id = ?').get(r.id);
          if (raw) snippet = raw.body.slice(0, 200).replace(/\n/g, ' ');
        }
        return {
          id: r.id,
          collection: r.collection,
          slug: r.slug,
          type: r.type,
          title: r.title,
          description: r.description,
          tags: typeof r.tags === 'string' ? JSON.parse(r.tags || '[]') : (r.tags || []),
          status: r.status,
          body_length: r.body_length || 0,
          created_at: r.created_at || 0,
          updated_at: r.updated_at || r.created_at || 0,
          approx_tokens: Math.round((r.body_length || 0) / 4),
          score: Math.round(r.score * 100) / 100,
          snippet,
        };
      }),
      total,
    };
  }

  export function getConceptBySlug(collection, slug, resolveDeps = false, visited = new Set()) {
    initDb();
    const concept = db.prepare('SELECT * FROM concepts WHERE collection = ? AND slug = ?').get(collection, slug);
    if (!concept) return null;
    let frontmatter = {};
    try { frontmatter = JSON.parse(concept.frontmatter || '{}'); } catch {}

    // ONE shared family helper for ancestors/descendants/siblings (decision #3).
    const family = computeConceptFamily({
      table: 'concepts',
      cols: 'id, collection, slug, type, title',
      collection,
      slug,
    });
    const light = (r) => ({ id: r.id, slug: r.slug, title: r.title, type: r.type });

    let dependencies = [];
    if (frontmatter.dependencies && Array.isArray(frontmatter.dependencies)) {
      for (const rawDep of frontmatter.dependencies) {
        const depSlug = typeof rawDep === 'string' ? rawDep : (rawDep && rawDep.slug);
        if (!depSlug) continue;
        const escapedDep = String(depSlug).replace(/_/g, '\\_').replace(/%/g, '\\%');
        const dep = db.prepare("SELECT id, slug, title FROM concepts WHERE collection = ? AND (slug = ? OR slug LIKE ? ESCAPE '\\') ORDER BY (slug = ?) DESC, length(slug) ASC LIMIT 1")
          .get(collection, depSlug, '%/' + escapedDep, depSlug);
        dependencies.push({ id: dep ? dep.id : null, slug: dep ? dep.slug : depSlug, title: dep ? dep.title : null });
      }
    }
    let resolved = [];
    if (resolveDeps) {
      visited.add(collection + '/' + slug);
      for (const dep of dependencies) {
        if (dep.id === null) continue;
        if (!visited.has(collection + '/' + dep.slug)) {
          const fullDep = getConceptBySlug(collection, dep.slug, true, visited);
          if (fullDep) resolved.push(fullDep);
        }
      }
    }
    const result = {
      id: concept.id,
      collection: concept.collection,
      slug: concept.slug,
      type: concept.type,
      title: concept.title,
      description: concept.description,
      tags: typeof concept.tags === 'string' ? JSON.parse(concept.tags || '[]') : (concept.tags || []),
      status: concept.status,
      timestamp: concept.timestamp,
      body_length: concept.body_length,
      approx_tokens: Math.round((concept.body_length || 0) / 4),
      frontmatter,
      body: concept.body,
      references: family.descendants.map(light),
      siblings: family.siblings.map(light),
      dependencies,
      referenced_by: family.ancestors.map(light),
    };
    if (resolveDeps) result.resolved = resolved;
    return result;
  }

  // ── concept family (path-family ∪ transitive deps) ────────────
  // ONE implementation parameterized over table (decision #3): shared by
  // local getConceptFamily (concepts) and team getRelated (concept_synapses).
  export function computeConceptFamily({ table, cols, collection, slug }) {
    initDb();
    const empty = { ancestors: [], descendants: [], siblings: [], family: [], total: 0 };
    if (!collection || !slug) return empty;

    const esc = (s) => String(s).replace(/_/g, '\\_').replace(/%/g, '\\%');
    const sel = `SELECT ${cols} FROM ${table}`;
    const getBySlug = (s) => db.prepare(`${sel} WHERE collection = ? AND slug = ?`).get(collection, s);
    const segments = slug.split('/');

    // ancestors — chain up the path
    const ancestors = [];
    for (let i = 1; i < segments.length; i++) {
      const a = getBySlug(segments.slice(0, i).join('/'));
      if (a) ancestors.push(a);
    }

    // descendants — recursive subtree
    const descendants = db.prepare(
      `${sel} WHERE collection = ? AND slug LIKE ? ESCAPE '\\' AND slug != ?`
    ).all(collection, esc(slug) + '/%', slug);

    // siblings — immediate (one level, same parent)
    const parent = segments.slice(0, -1).join('/');
    const siblings = segments.length > 1
      ? db.prepare(
          `${sel} WHERE collection = ? AND slug LIKE ? ESCAPE '\\' AND slug NOT LIKE ? ESCAPE '\\' AND slug != ?`
        ).all(collection, esc(parent) + '/%', esc(parent) + '/%/%', slug)
      : db.prepare(
          `${sel} WHERE collection = ? AND slug NOT LIKE ? ESCAPE '\\' AND slug != ?`
        ).all(collection, '%/%', slug);

    // dedupe by slug: self ∪ ancestors ∪ descendants ∪ siblings(+their subtrees)
    const map = new Map();
    const add = (r) => { if (r && !map.has(r.slug)) map.set(r.slug, r); };
    add(getBySlug(slug));
    ancestors.forEach(add);
    descendants.forEach(add);
    for (const s of siblings) {
      add(s);
      const subCols = db.prepare(
        `${sel} WHERE collection = ? AND slug LIKE ? ESCAPE '\\'`
      ).all(collection, esc(s.slug) + '/%');
      subCols.forEach(add);
    }

    // transitive dependencies (cycle-safe, dangling skipped)
    const visited = new Set(map.keys());
    const queue = [...map.values()];
    while (queue.length) {
      const cur = queue.shift();
      let fm = {};
      try { fm = JSON.parse(cur.frontmatter || '{}'); } catch {}
      const deps = Array.isArray(fm.dependencies) ? fm.dependencies : [];
      for (const rawDep of deps) {
        const depSlug = typeof rawDep === 'string' ? rawDep : (rawDep && rawDep.slug);
        if (!depSlug) continue;
        const resolved = db.prepare(
          `${sel} WHERE collection = ? AND (slug = ? OR slug LIKE ? ESCAPE '\\') ORDER BY (slug = ?) DESC, length(slug) ASC LIMIT 1`
        ).get(collection, depSlug, '%/' + esc(depSlug), depSlug);
        if (!resolved || visited.has(resolved.slug)) continue;
        visited.add(resolved.slug);
        map.set(resolved.slug, resolved);
        queue.push(resolved);
      }
    }

    const family = [...map.values()];
    return { ancestors, descendants, siblings, family, total: family.length };
  }

  export function getConceptFamily(collection, slug) {
    return computeConceptFamily({
      table: 'concepts',
      cols: 'id, collection, slug, type, title, description, tags, status, frontmatter, body_length',
      collection,
      slug,
    });
  }

  export function getConceptContext(collection, slug) {
    initDb();
    const concept = db.prepare('SELECT type, title, body FROM concepts WHERE collection = ? AND slug = ?').get(collection, slug);
    if (!concept) return null;
    return `[${collection}] (${concept.type}) ${slug}: ${concept.title || ''}\n\n${concept.body}`;
  }

  export function listLocalConcepts({ collection, type, tags, status: conStatus, limit = 50, offset = 0, includeIds, excludeIds } = {}) {
    initDb();
    if (includeIds && includeIds.length === 0) return { rows: [], total: 0, limit, offset };
    const conditions = [];
    const params = [];
    if (collection) { conditions.push('collection = ?'); params.push(collection); }
    if (type) { conditions.push('type = ?'); params.push(type); }
    if (conStatus) { conditions.push('status = ?'); params.push(conStatus); }
    if (includeIds && includeIds.length > 0) { conditions.push('id IN (' + includeIds.map(() => '?').join(',') + ')'); params.push(...includeIds); }
    else if (excludeIds && excludeIds.length > 0) { conditions.push('id NOT IN (' + excludeIds.map(() => '?').join(',') + ')'); params.push(...excludeIds); }
    let whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    if (tags && tags.length > 0) {
      const tagConditions = tags.map(() => 'tags LIKE ?').join(' AND ');
      whereClause += (conditions.length > 0 ? ' AND ' : 'WHERE ') + tagConditions;
      for (const t of tags) params.push('%"' + t + '"%');
    }
    const total = db.prepare('SELECT COUNT(*) as c FROM concepts ' + whereClause).get(...params).c;
    const rows = db.prepare(
      'SELECT id, collection, slug, type, title, description, tags, status, timestamp, body_length, created_at, updated_at FROM concepts ' + whereClause + ' ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ).all(...params, limit, offset).map(r => ({
      id: r.id,
      collection: r.collection,
      slug: r.slug,
      type: r.type,
      title: r.title,
      description: r.description,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags || '[]') : (r.tags || []),
      status: r.status,
      timestamp: r.timestamp,
      body_length: r.body_length,
      created_at: r.created_at,
      updated_at: r.updated_at,
      approx_tokens: Math.round((r.body_length || 0) / 4),
    }));
    return { rows, total, limit, offset };
  }

  export function insertToolCalls(rows) {
    const d = initDb();
    if (!rows || rows.length === 0) return;
    const insert = d.prepare(
      'INSERT INTO tool_calls (tool, error_type, called_at, deployment_env) VALUES (?, ?, ?, ?)'
    );
    const purge = d.prepare(
      'DELETE FROM tool_calls WHERE called_at < ?'
    );
    const retention = getConfig().toolRetentionDays * 86400;
    const cutoff = Math.floor(Date.now() / 1000) - retention;
    d.transaction(() => {
      for (const row of rows) {
        insert.run(row.tool, row.error_type, row.called_at, row.deployment_env);
      }
      purge.run(cutoff);
    })();
  }

  export function getToolStats({ exclude, period } = {}) {
    const d = initDb();
    const now = Math.floor(Date.now() / 1000);
    const last7d = now - 7 * 86400;
    const last30d = now - 30 * 86400;
    const last24h = now - 24 * 3600;

    let periodStart;
    if (period === '24h') periodStart = last24h;
    else if (period === '7d') periodStart = last7d;
    else if (period === '30d') periodStart = last30d;

    const totalLast7d = (d.prepare(
      'SELECT COUNT(*) as c FROM tool_calls WHERE called_at >= ? AND (? IS NULL OR tool != ?) AND tool NOT LIKE \'http:%\' AND (deployment_env = \'production\' OR deployment_env IS NULL)'
    ).get(last7d, exclude, exclude) || {}).c || 0;

    const last7dErrorCount = (d.prepare(
      'SELECT COUNT(*) as c FROM tool_calls WHERE called_at >= ? AND error_type IS NOT NULL AND (? IS NULL OR tool != ?) AND tool NOT LIKE \'http:%\' AND (deployment_env = \'production\' OR deployment_env IS NULL)'
    ).get(last7d, exclude, exclude) || {}).c || 0;

    const last7dErrorRate = totalLast7d > 0 ? Math.round((last7dErrorCount / totalLast7d) * 100) / 100 : 0;

    let tools, totalInPeriod;
    if (periodStart !== undefined || period === 'all') {
      const timeFilter = period === 'all' ? '' : 'AND called_at >= ?';
      const timeParams = period === 'all' ? [] : [periodStart];
      tools = d.prepare(
        `SELECT tool, COUNT(*) as count FROM tool_calls WHERE (? IS NULL OR tool != ?) AND tool NOT LIKE 'http:%' AND (deployment_env = 'production' OR deployment_env IS NULL) ${timeFilter} GROUP BY tool ORDER BY count DESC LIMIT 34`
      ).all(exclude, exclude, ...timeParams);
      totalInPeriod = d.prepare(
        `SELECT COUNT(*) as c FROM tool_calls WHERE (? IS NULL OR tool != ?) AND tool NOT LIKE 'http:%' AND (deployment_env = 'production' OR deployment_env IS NULL) ${timeFilter}`
      ).get(exclude, exclude, ...timeParams).c || 0;
      for (const t of tools) {
        t.share_pct = totalInPeriod > 0 ? Math.round(t.count * 1000 / totalInPeriod) / 10 : 0;
      }
      const errorCounts = d.prepare(
        `SELECT tool, COUNT(*) as c FROM tool_calls WHERE error_type IS NOT NULL AND tool IN (${tools.map(() => '?').join(',')}) AND tool NOT LIKE 'http:%' AND (deployment_env = 'production' OR deployment_env IS NULL) ${timeFilter} GROUP BY tool`
      ).all(...tools.map(t => t.tool), ...timeParams);
      const errMap = Object.fromEntries(errorCounts.map(e => [e.tool, e.c]));
      for (const t of tools) {
        const errCount = errMap[t.tool] || 0;
        t.error_count = errCount;
        t.success_rate = t.count > 0 ? Math.round((1 - errCount / t.count) * 100) : 0;
      }
    }

    const result = { total_last_7d: totalLast7d, last_7d_error_rate: last7dErrorRate };
    if (tools) { result.tools = tools; result.total_in_period = totalInPeriod; }
    return result;
  }
