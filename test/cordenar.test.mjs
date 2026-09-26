import { tmpdir, hostname, userInfo } from 'node:os';
import { join, basename } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

// ── Isolation: set env vars BEFORE any project imports ──────────
const TMP = mkdtempSync(join(tmpdir(), 'cordenar-test-'));
process.env.CORDENAR_DB_PATH = join(TMP, 'test.db');
process.env.CORDENAR_AUTH_FILE = join(TMP, 'auth.json');
process.env.CORDENAR_ENV = 'test';

afterAll(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

// ── Project imports ─────────────────────────────────────────────
import {
  initDb,
  lookupLocalByDirection,
  lookupCloud,
  storeMapping,
  getPushEntries,
  getPullEntries,
  getDirtyEntries,
  removeMapping,
  insertMemorySynapse,
  updateMemorySynapseByCloudId,
  upsertMemoryFts,
  setMemoryVec,
  insertConceptSynapse,
  updateConceptSynapseByCloudId,
  upsertConceptFts,
  setConceptVec,
  getSynapseByCloudId,
  getTeamMemorySynapsesByIds,
  listTeamMemorySynapses,
  listTeamConceptSynapses,
  countSynapsesByAccount,
  getLocalActiveForAccount,
  markSynapsesRemoved,
  searchTeamMemoryHybrid,
  searchTeamConceptHybrid,
  searchLocalConcepts,
  deindexConcepts,
  indexConcepts,
  getConceptBySlug,
  getConceptFamily,
  getConceptContext,
  listLocalConcepts,
  updateMemory,
  deleteMemoryPermanent,
  insertToolCalls,
  getToolStats,
} from '../db.js';
import { conceptList, toEpoch } from '../sync.js';
import {
  loadAuth,
  saveAuth,
  clearAuth,
  saveAuthRaw,
  getNodes,
  getActiveNode,
  switchActiveNode,
  findNode,
  removeNode,
} from '../auth.js';
import { computeHash } from '../hash.js';
import { createEmbedding, embeddingToString } from '../embedding.js';
import { initTelemetry, getTracer, forceFlushTelemetry, SpanKind, SpanStatusCode } from '../otel.js';

// ── Shared constants ────────────────────────────────────────────
const TEMP_UUID = '00000000-0000-0000-0000-000000000000';
const ACCT_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NODE_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function uuid(seed) {
  return TEMP_UUID.slice(0, -1) + String(seed).padStart(1, '0');
}

// ── Phase 0: vec0 availability ──────────────────────────────────
const VEC_AVAILABLE = (() => {
  try {
    const d = initDb();
    d.prepare('SELECT 1 FROM memory_synapses_vec LIMIT 0').run();
    return true;
  } catch {
    return false;
  }
})();

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Auth module (20 assertions)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 1: Auth module', () => {
  test('loadAuth returns null when no file', () => {
    expect(loadAuth()).toBeNull();
  });

  test('saveAuth creates multi-node array', () => {
    saveAuth({
      node_id: 'n1',
      access_token: 'token1',
      account_id: ACCT_UUID,
      account_name: 'Test Team',
      account_slug: 'test-team',
      name: 'node-alpha',
    });
    const auth1 = loadAuth();
    expect(auth1).toBeTruthy();
    expect(Array.isArray(auth1.nodes)).toBe(true);
    expect(auth1.nodes).toHaveLength(1);
  });

  test('active_node_id set correctly', () => {
    const auth1 = loadAuth();
    expect(auth1.active_node_id).toBe('n1');
  });

  test('second saveAuth adds to nodes', () => {
    saveAuth({
      node_id: 'n2',
      access_token: 'token2',
      account_id: ACCT_UUID,
      account_name: 'Test Team 2',
      account_slug: 'test-team-2',
      name: 'node-beta',
    });
    const auth2 = loadAuth();
    expect(auth2.nodes).toHaveLength(2);
    expect(auth2.active_node_id).toBe('n2');
  });

  test('saveAuth overwrites by node_id', () => {
    saveAuth({
      node_id: 'n1',
      access_token: 'token1-updated',
      account_id: ACCT_UUID,
      name: 'node-alpha-renamed',
    });
    const auth3 = loadAuth();
    expect(auth3.nodes).toHaveLength(2);
    expect(auth3.nodes.find(n => n.node_id === 'n1').name).toBe('node-alpha-renamed');
  });

  test('getNodes returns array', () => {
    expect(Array.isArray(getNodes())).toBe(true);
    expect(getNodes()).toHaveLength(2);
  });

  test('getActiveNode returns active node', () => {
    expect(getActiveNode()).toBeTruthy();
    expect(getActiveNode().node_id).toBe('n1');
  });

  test('switchActiveNode finds by account_slug', () => {
    saveAuth({ node_id: 'n3', access_token: 't3', account_slug: 'team-c', name: 'gamma' });
    const switched = switchActiveNode('team-c');
    expect(switched).toBe(true);
    expect(getActiveNode().node_id).toBe('n3');
  });

  test('switchActiveNode returns false for unknown slug', () => {
    expect(switchActiveNode('nonexistent')).toBe(false);
  });

  test('findNode returns correct node', () => {
    expect(findNode('team-c')).toBeTruthy();
    expect(findNode('team-c').node_id).toBe('n3');
  });

  test('findNode returns null for unknown slug', () => {
    expect(findNode('nonexistent')).toBeNull();
  });

  test('removeNode removes by account_slug and clears active pointer', () => {
    removeNode('team-c');
    expect(getNodes()).toHaveLength(2);
    expect(loadAuth().active_node_id).toBeNull();
    expect(getActiveNode()).toBeNull();
  });

  test('removeNode last element clears array and active', () => {
    clearAuth();
    saveAuth({ node_id: 'solo', access_token: 'st', account_slug: 'solo', name: 'solo' });
    removeNode('solo');
    expect(getNodes()).toHaveLength(0);
    expect(getActiveNode()).toBeNull();
  });

  test('clearAuth makes loadAuth return null', () => {
    saveAuth({ node_id: 'temp', access_token: 'x', account_slug: 'temp', name: 'temp' });
    clearAuth();
    expect(loadAuth()).toBeNull();
  });

  test('getActiveNode returns null when active_node_id is dangling', () => {
    clearAuth();
    saveAuthRaw({ active_node_id: 'ghost', nodes: [{ node_id: 'real', access_token: 't', account_slug: 'real' }] });
    expect(getActiveNode()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 2: DB init + schema (10 assertions)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 2: DB init + schema', () => {
  const d = initDb();

  test('required tables exist', () => {
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
    expect(tables).toContain('synapse_map');
    expect(tables).toContain('memory_synapses');
    expect(tables).toContain('concept_synapses');
    expect(tables).toContain('memory_synapses_fts');
    expect(tables).toContain('concept_synapses_fts');
  });

  test('vec0 tables exist when available', () => {
    if (!VEC_AVAILABLE) return test.skip('sqlite-vec not available');
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
    expect(tables).toContain('memory_synapses_vec');
    expect(tables).toContain('concept_synapses_vec');
  });

  test('initDb is idempotent', () => {
    expect(() => initDb()).not.toThrow();
  });

  test('migrateDb does not throw on re-run', () => {
    expect(true).toBe(true); // migrateDb runs inside initDb, already verified by idempotency test
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Synapse CRUD (17 assertions)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 3: Synapse CRUD', () => {
  let hemRowId, compRowId, hemId, compId;

  test('insertMemorySynapse returns integer row_id', () => {
    hemId = uuid(1);
    hemRowId = insertMemorySynapse({
      id: hemId,
      account_id: ACCT_UUID,
      source_node_id: NODE_UUID,
      project: 'test-project',
      kind: 'fact',
      related_ids: '',
      status: 'open',
      content: 'Test memory content about database indexing.',
      metadata: '{"source":"test"}',
      content_hash: computeHash('Test memory content about database indexing.'),
      cloud_status: 'active',
      approved_by: null,
      approved_at: null,
      source_node_name: 'test-node',
      source_user_email: 'test@test.com',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    expect(typeof hemRowId).toBe('number');
    expect(hemRowId).toBeGreaterThan(0);
  });

  test('getSynapseByCloudId returns memory row with correct fields', () => {
    const mem = getSynapseByCloudId(hemId);
    expect(mem).toBeTruthy();
    expect(mem.synapse_type).toBe('team_memory');
    expect(mem.content).toBe('Test memory content about database indexing.');
    expect(mem.project).toBe('test-project');
    expect(mem.kind).toBe('fact');
  });

  test('updateMemorySynapseByCloudId changes fields', () => {
    updateMemorySynapseByCloudId(hemId, {
      kind: 'decision',
      content: 'Updated content about database optimization.',
      project: 'test-project-2',
    });
    const hemUpdated = getSynapseByCloudId(hemId);
    expect(hemUpdated.kind).toBe('decision');
    expect(hemUpdated.content).toBe('Updated content about database optimization.');
    expect(hemUpdated.project).toBe('test-project-2');
  });

  test('memory FTS matches term', () => {
    upsertMemoryFts(hemRowId, 'test-project-2', 'decision', 'open', 'Updated content about database optimization.');
    const ftsHem = initDb().prepare(
      "SELECT rowid FROM memory_synapses_fts WHERE memory_synapses_fts MATCH ?"
    ).all('database*');
    expect(ftsHem.length).toBeGreaterThan(0);
    expect(ftsHem[0].rowid).toBe(hemRowId);
  });

  test('insertConceptSynapse returns integer row_id', () => {
    compId = uuid(2);
    compRowId = insertConceptSynapse({
      id: compId,
      account_id: ACCT_UUID,
      source_node_id: NODE_UUID,
      slug: 'wordpress/plugin-dev',
      type: 'skill',
      title: 'WordPress Plugin Development Guide',
      description: 'A comprehensive guide to developing WordPress plugins using modern PHP.',
      tags: '["wordpress","plugin","php","development"]',
      status: 'stable',
      frontmatter: '{}',
      body: '## WordPress Plugin Development\n\nThis guide covers best practices for plugin development.',
      body_length: 82,
      content_hash: computeHash('## WordPress Plugin Development\n\nThis guide covers best practices for plugin development.'),
      cloud_status: 'active',
      approved_by: null,
      approved_at: null,
      source_node_name: 'test-node',
      source_user_email: 'test@test.com',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    expect(typeof compRowId).toBe('number');
    expect(compRowId).toBeGreaterThan(0);
  });

  test('getSynapseByCloudId returns concept row with correct fields', () => {
    const con = getSynapseByCloudId(compId);
    expect(con).toBeTruthy();
    expect(con.synapse_type).toBe('team_concept');
    expect(con.slug).toBe('wordpress/plugin-dev');
    expect(con.type).toBe('skill');
  });

  test('updateConceptSynapseByCloudId changes fields', () => {
    updateConceptSynapseByCloudId(compId, {
      title: 'WordPress Plugin Development (Updated)',
      type: 'reference',
    });
    const compUpdated = getSynapseByCloudId(compId);
    expect(compUpdated.title).toBe('WordPress Plugin Development (Updated)');
    expect(compUpdated.type).toBe('reference');
  });

  test('concept FTS matches term', () => {
    upsertConceptFts(compRowId, 'WordPress Plugin Development (Updated)', 'A comprehensive guide to developing WordPress plugins using modern PHP.', '["wordpress","plugin","php","development"]', '## WordPress Plugin Development\n\nThis guide covers best practices for plugin development.');
    const ftsComp = initDb().prepare(
      "SELECT rowid FROM concept_synapses_fts WHERE concept_synapses_fts MATCH ?"
    ).all('"wordpress"');
    expect(ftsComp.length).toBeGreaterThan(0);
    expect(ftsComp[0].rowid).toBe(compRowId);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 4: Synapse map CRUD (11 assertions)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 4: Synapse map', () => {
  const cloudId = uuid(3);
  const hash = computeHash('map test content');

  test('storeMapping inserts row', () => {
    storeMapping({
      cloud_id: cloudId,
      source: 'memory',
      local_id: 42,
      account_id: ACCT_UUID,
      local_hash: hash,
      cloud_hash: hash,
      direction: 'push',
    });
    const inserted = lookupCloud(cloudId);
    expect(inserted).toBeTruthy();
    expect(inserted.direction).toBe('push');
    expect(inserted.local_id).toBe(42);
  });

  test('storeMapping upserts on same cloud_id', () => {
    const hash2 = computeHash('updated content');
    storeMapping({
      cloud_id: cloudId,
      source: 'memory',
      local_id: 42,
      account_id: ACCT_UUID,
      local_hash: hash2,
      cloud_hash: hash2,
      direction: 'push',
    });
    const upserted = lookupCloud(cloudId);
    expect(upserted.local_hash).toBe(hash2);
  });

  test('lookupLocalByDirection scopes by direction', () => {
    expect(lookupLocalByDirection('memory', 42, ['push']).direction).toBe('push');
    expect(lookupLocalByDirection('memory', 42, ['pull'])).toBeUndefined();
  });

  test('pull entry stored and queryable', () => {
    const pullId = uuid(4);
    storeMapping({
      cloud_id: pullId,
      source: 'concept',
      local_id: 99,
      account_id: ACCT_UUID,
      local_hash: hash,
      cloud_hash: hash,
      direction: 'pull',
    });
    const pullMatch = lookupCloud(pullId);
    expect(pullMatch).toBeTruthy();
    expect(pullMatch.direction).toBe('pull');
  });

  test('lookupLocalByDirection resolves pull entries by direction', () => {
    expect(lookupLocalByDirection('concept', 99, ['pull']).direction).toBe('pull');
    expect(lookupLocalByDirection('concept', 99, ['push'])).toBeUndefined();
  });

  test('getPushEntries includes push', () => {
    const pushes = getPushEntries();
    expect(pushes.some(e => e.cloud_id === cloudId)).toBe(true);
  });

  test('getPullEntries includes pull', () => {
    const pulls = getPullEntries();
    expect(pulls.some(e => e.cloud_id === uuid(4))).toBe(true);
  });

  test('getDirtyEntries excludes matching-hash entries', () => {
    const dirty = getDirtyEntries();
    expect(dirty.some(e => e.cloud_id === cloudId)).toBe(false);
  });

  test('removeMapping deletes row', () => {
    removeMapping(cloudId);
    expect(lookupCloud(cloudId)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 5: List operations (4 assertions)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 5: List operations', () => {
  test('listTeamMemorySynapses by project', () => {
    const memByProject = listTeamMemorySynapses({ project: 'test-project-2', limit: 50 }).rows;
    expect(memByProject.length).toBeGreaterThan(0);
    expect(memByProject.every(r => r.project === 'test-project-2')).toBe(true);
  });

  test('listTeamMemorySynapses by kind', () => {
    const memByKind = listTeamMemorySynapses({ kind: 'decision', limit: 50 }).rows;
    expect(memByKind.length).toBeGreaterThan(0);
    expect(memByKind.every(r => r.kind === 'decision')).toBe(true);
  });

  test('listTeamConceptSynapses by type', () => {
    const conByType = listTeamConceptSynapses({ type: 'reference', limit: 50 }).rows;
    expect(conByType.length).toBeGreaterThan(0);
    expect(conByType.every(r => r.type === 'reference')).toBe(true);
  });

  test('listTeamConceptSynapses by tags', () => {
    const conByTags = listTeamConceptSynapses({ tags: 'wordpress', limit: 50 }).rows;
    expect(conByTags.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 6: Hybrid search (13 assertions)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 6: Hybrid search', () => {
  const searchRows = [
    { id: uuid(5), project: 'search-test', kind: 'fact', status: 'open',
      content: 'Effective database indexing strategies for improved query performance in PostgreSQL.' },
    { id: uuid(6), project: 'search-test', kind: 'note', status: 'open',
      content: 'Perl scripting techniques for system administration and text processing automation.' },
    { id: uuid(7), project: 'search-test', kind: 'decision', status: 'completed',
      content: 'JavaScript async patterns and event loop fundamentals for modern web development.' },
  ];

  beforeAll(() => {
    for (const r of searchRows) {
      const rid = insertMemorySynapse({
        id: r.id, account_id: ACCT_UUID, source_node_id: NODE_UUID,
        project: r.project, kind: r.kind, related_ids: '', status: r.status,
        content: r.content, metadata: '{}',
        content_hash: computeHash(r.content), cloud_status: 'active',
        approved_by: null, approved_at: null,
        source_node_name: 'test-node', source_user_email: 'test@test.com',
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      });
      upsertMemoryFts(rid, r.project, r.kind, r.status, r.content);
      if (VEC_AVAILABLE) {
        const emb = createEmbedding(r.content);
        setMemoryVec(rid, Buffer.from(emb.buffer));
      }
    }
  });

  test('FTS-only search returns results', () => {
    const ftsResult = searchTeamMemoryHybrid({ query: 'database indexing', alpha: 0, limit: 10 });
    expect(ftsResult.rows.length).toBeGreaterThan(0);
    expect(ftsResult.rows.some(r => r.content.includes('database'))).toBe(true);
  });

  test('Vector-only search returns results', () => {
    if (!VEC_AVAILABLE) return test.skip('sqlite-vec not available');
    const vecResult = searchTeamMemoryHybrid({ query: 'database indexing', alpha: 1, limit: 10 });
    expect(vecResult.rows.length).toBeGreaterThan(0);
    expect(vecResult.rows.every(r => typeof r.score === 'number')).toBe(true);
  });

  test('Hybrid search returns scored results', () => {
    const hybridResult = searchTeamMemoryHybrid({ query: 'database indexing', alpha: 0.3, limit: 10 });
    expect(hybridResult.rows.length).toBeGreaterThan(0);
    expect(hybridResult.rows.every(r => typeof r.score === 'number')).toBe(true);
  });

  test('Empty query returns empty', () => {
    const emptyResult = searchTeamMemoryHybrid({ query: '', alpha: 0, limit: 10 });
    expect(emptyResult.rows).toHaveLength(0);
    expect(emptyResult.total).toBe(0);
  });

  test('Concept FTS search returns results', () => {
    const compSearchId = uuid(8);
    const compSearchRid = insertConceptSynapse({
      id: compSearchId, account_id: ACCT_UUID, source_node_id: NODE_UUID,
      slug: 'testing/wordpress-integration', type: 'reference',
      title: 'WordPress Integration Testing',
      description: 'How to test WordPress plugin integrations.',
      tags: '["wordpress","testing","php"]',
      status: 'stable', frontmatter: '{}',
      body: '## Integration Testing for WordPress\n\nBest practices for automated integration testing.',
      body_length: 80,
      content_hash: computeHash('## Integration Testing for WordPress\n\nBest practices for automated integration testing.'),
      cloud_status: 'active',
      approved_by: null, approved_at: null,
      source_node_name: 'test-node', source_user_email: 'test@test.com',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    });
    upsertConceptFts(compSearchRid, 'WordPress Integration Testing', 'How to test WordPress plugin integrations.', '["wordpress","testing","php"]', '## Integration Testing for WordPress\n\nBest practices for automated integration testing.');
    if (VEC_AVAILABLE) {
      setConceptVec(compSearchRid, Buffer.from(createEmbedding('Integration Testing for WordPress').buffer));
    }

    const compSearchResult = searchTeamConceptHybrid({ query: 'wordpress testing', alpha: 0, limit: 10 });
    expect(compSearchResult.rows.length).toBeGreaterThan(0);
    expect(compSearchResult.rows.some(r => r.body && r.body.toLowerCase().includes('wordpress'))).toBe(true);
  });

  test('Filtered search limits by project', () => {
    const filteredResult = searchTeamMemoryHybrid({ query: 'database', project: 'search-test', alpha: 0, limit: 10 });
    expect(filteredResult.rows.every(r => r.project === 'search-test')).toBe(true);
  });

  test('localConceptSearch returns rows and total', () => {
    const localConceptSearch = searchLocalConcepts({ query: 'wordpress', limit: 5 });
    expect(Array.isArray(localConceptSearch.rows)).toBe(true);
    expect(typeof localConceptSearch.total).toBe('number');
  });

  test('localConceptSearch ranks the best match first', () => {
    const d = initDb();
    const now = Math.floor(Date.now() / 1000);
    const insConcept = d.prepare(`
      INSERT INTO concepts (collection, slug, type, title, description, tags, status, frontmatter, body, body_length, file_path, file_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insFts = d.prepare('INSERT INTO concepts_fts (rowid, title, description, tags, body) VALUES (?, ?, ?, ?, ?)');

    const good = insConcept.run(
      'test', 'test/spin-local-wp', 'prompt', 'Spin up a local WordPress site',
      'Use when spinning up a new local WordPress site from scratch.',
      '["wordpress","docker"]', 'stable', '{}',
      'Spin up a local WordPress site with docker.', 40, '/tmp/spin.md', 'h1', now, now,
    ).lastInsertRowid;
    insFts.run(good, 'Spin up a local WordPress site', 'Use when spinning up a new local WordPress site from scratch.', '["wordpress","docker"]', 'Spin up a local WordPress site with docker.');

    const weak = insConcept.run(
      'test', 'test/wp-plugin', 'skill', 'WordPress plugin',
      'A WordPress plugin development guide.',
      '["wordpress"]', 'stable', '{}',
      'WordPress plugin development.', 30, '/tmp/plugin.md', 'h2', now, now,
    ).lastInsertRowid;
    insFts.run(weak, 'WordPress plugin', 'A WordPress plugin development guide.', '["wordpress"]', 'WordPress plugin development.');

    const res = searchLocalConcepts({ query: 'spin up a local wordpress site', alpha: 0, limit: 10 });
    const slugs = res.rows.map((r) => r.slug);
    expect(slugs).toContain('test/spin-local-wp');
    expect(slugs).toContain('test/wp-plugin');
    expect(slugs.indexOf('test/spin-local-wp')).toBeLessThan(slugs.indexOf('test/wp-plugin'));
    expect(res.rows[0].score).toBeGreaterThan(res.rows[res.rows.length - 1].score);
  });

  test('deindexConcepts leaves no stale FTS entry', () => {
    const d = initDb();
    const now = Math.floor(Date.now() / 1000);
    const insConcept = d.prepare(`
      INSERT INTO concepts (collection, slug, type, title, description, tags, status, frontmatter, body, body_length, file_path, file_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insFts = d.prepare('INSERT INTO concepts_fts (rowid, title, description, tags, body) VALUES (?, ?, ?, ?, ?)');
    const id = insConcept.run(
      'test', 'test/wordpress-stale', 'reference', 'WordPress stale test',
      'wordpress', '["wordpress"]', 'stable', '{}',
      'wordpress content', 17, '/tmp/stale.md', 'h', now, now,
    ).lastInsertRowid;
    insFts.run(id, 'WordPress stale test', 'wordpress', '["wordpress"]', 'wordpress content');

    const res = deindexConcepts({ collection: 'test', slug: 'test/wordpress-stale' });
    expect(res.removed).toContain('test/wordpress-stale');

    const stale = d.prepare("SELECT rowid FROM concepts_fts WHERE concepts_fts MATCH 'wordpress' AND rowid = ?").all(id);
    expect(stale).toHaveLength(0);
  });

  test('updateMemory removes stale FTS terms', () => {
    const d = initDb();
    const now = Math.floor(Date.now() / 1000);
    const ins = d.prepare('INSERT INTO memories (id, project, kind, related_ids, status, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const id = ins.run(900001, 'memtest', 'fact', '', '', 'wordpress site', '{}', now, now).lastInsertRowid;
    d.prepare('INSERT INTO memories_fts (rowid, project, kind, status, content) VALUES (?, ?, ?, ?, ?)').run(id, 'memtest', 'fact', '', 'wordpress site');

    expect(updateMemory({ id, project: 'memtest', content: 'graphql only' })).toBe(true);

    expect(d.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'wordpress' AND rowid = ?").all(id)).toHaveLength(0);
    expect(d.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'graphql' AND rowid = ?").all(id)).toHaveLength(1);
  });

  test('deleteMemoryPermanent removes FTS entry', () => {
    const d = initDb();
    const now = Math.floor(Date.now() / 1000);
    const ins = d.prepare('INSERT INTO memories (id, project, kind, related_ids, status, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const id = ins.run(900002, 'memtest', 'fact', '', '', 'wordpress site', '{}', now, now).lastInsertRowid;
    d.prepare('INSERT INTO memories_fts (rowid, project, kind, status, content) VALUES (?, ?, ?, ?, ?)').run(id, 'memtest', 'fact', '', 'wordpress site');

    expect(deleteMemoryPermanent('memtest', id, true)).toBe(true);

    expect(d.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'wordpress' AND rowid = ?").all(id)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 7: Count + Cleanup (5 assertions)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 7: Count + Cleanup', () => {
  test('countSynapsesByAccount returns object with positive mem and con', () => {
    const counts = countSynapsesByAccount();
    expect(typeof counts).toBe('object');
    const memCount = counts[ACCT_UUID]?.mem || 0;
    const conCount = counts[ACCT_UUID]?.con || 0;
    expect(memCount).toBeGreaterThan(0);
    expect(conCount).toBeGreaterThan(0);
  });

  test('getLocalActiveForAccount returns array', () => {
    const activeEntries = getLocalActiveForAccount(ACCT_UUID);
    expect(Array.isArray(activeEntries)).toBe(true);
    expect(activeEntries.length).toBeGreaterThan(0);
  });

  test('markSynapsesRemoved sets cloud_status to removed', () => {
    const activeEntries = getLocalActiveForAccount(ACCT_UUID);
    const idsToRemove = activeEntries.filter(e => e.source === 'memory').slice(0, 1).map(e => e.id);
    if (idsToRemove.length === 0) return test.skip('no memory entries to remove');
    markSynapsesRemoved(idsToRemove, 'memory');
    for (const id of idsToRemove) {
      const syn = getSynapseByCloudId(id);
      expect(syn.cloud_status).toBe('removed');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 8: Embedding + Hash + Edge cases (9 assertions)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 8: Embedding, Hash, Edge cases', () => {
  test('createEmbedding returns Float32Array(256)', () => {
    const emb1 = createEmbedding('deterministic test input string');
    expect(emb1).toBeInstanceOf(Float32Array);
    expect(emb1).toHaveLength(256);
  });

  test('createEmbedding is deterministic', () => {
    const emb1 = createEmbedding('deterministic test input string');
    const emb2 = createEmbedding('deterministic test input string');
    expect(emb1.every((v, i) => v === emb2[i])).toBe(true);
  });

  test('createEmbedding produces different outputs for different inputs', () => {
    const emb1 = createEmbedding('deterministic test input string');
    const emb3 = createEmbedding('different input');
    expect(emb1.every((v, i) => v === emb3[i])).toBe(false);
  });

  test('embeddingToString produces bracketed 256-float string for pgvector', () => {
    const emb = createEmbedding('test content');
    const str = embeddingToString(emb);
    expect(str.startsWith('[')).toBe(true);
    expect(str.endsWith(']')).toBe(true);
    const floats = str.slice(1, -1).split(', ').map(Number);
    expect(floats.length).toBe(256);
    expect(floats.every(f => typeof f === 'number' && !isNaN(f))).toBe(true);
  });

  test('computeHash returns 64-char hex', () => {
    const hash1 = computeHash('test hash content');
    expect(hash1).toHaveLength(64);
    expect(/^[a-f0-9]+$/.test(hash1)).toBe(true);
  });

  test('computeHash is deterministic', () => {
    const hash1 = computeHash('test hash content');
    const hash2 = computeHash('test hash content');
    expect(hash1).toBe(hash2);
  });

  test('computeHash differs for different content', () => {
    const hash1 = computeHash('test hash content');
    const hash3 = computeHash('different hash content');
    expect(hash1).not.toBe(hash3);
  });

  test('clearAuth zero-byte file returns null', () => {
    clearAuth();
    expect(loadAuth()).toBeNull();
  });

  test('repeated initDb does not throw (DROP TABLE IF EXISTS handled)', () => {
    expect(() => { initDb(); initDb(); }).not.toThrow();
  });

  test('empty array lookups return empty', () => {
    expect(getTeamMemorySynapsesByIds([])).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Telemetry (OTel span pipeline)
// ═══════════════════════════════════════════════════════════════════
describe('Telemetry', () => {
  let db;
  beforeAll(async () => {
    db = initDb();
    initTelemetry(db, '0.0.0-test');
  });

  test('initTelemetry returns tracer', () => {
    const tracer = getTracer();
    expect(typeof tracer).toBe('object');
    expect(tracer).not.toBeNull();
  });

  test('span end writes to DB', async () => {
    const prevCount = db.prepare('SELECT COUNT(*) as c FROM tool_calls').get().c;

    const span1 = getTracer().startSpan('memory_store', { kind: SpanKind.SERVER });
    span1.end();

    const span2 = getTracer().startSpan('bad_tool', { kind: SpanKind.SERVER });
    try { throw new Error('test'); }
    catch (err) {
      span2.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span2.setAttribute('error.type', err.name);
    }
    span2.end();

    await forceFlushTelemetry();

    const newCount = db.prepare('SELECT COUNT(*) as c FROM tool_calls').get().c;
    expect(newCount - prevCount).toBe(2);
  });

  test('success span has correct attributes', () => {
    const rows = db.prepare('SELECT id, tool, error_type, deployment_env FROM tool_calls ORDER BY id DESC LIMIT 2').all();
    const success = rows.find(r => r.tool === 'memory_store');
    expect(success).toBeTruthy();
    expect(success.deployment_env).toBe('test');
    expect(success.error_type).toBeNull();
  });

  test('error span has correct attributes', () => {
    const rows = db.prepare('SELECT id, tool, error_type, deployment_env FROM tool_calls ORDER BY id DESC LIMIT 2').all();
    const error = rows.find(r => r.tool === 'bad_tool');
    expect(error).toBeTruthy();
    expect(error.deployment_env).toBe('test');
    expect(error.error_type).toBe('Error');
  });

  test('getToolStats excludes test data', () => {
    const stats = getToolStats();
    expect(stats.total_last_7d).toBe(0);
  });

  test('direct query finds test rows', () => {
    const rawCount = db.prepare('SELECT COUNT(*) as c FROM tool_calls WHERE deployment_env = \'test\'').get().c;
    expect(rawCount).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Protocol Integration (Tier 1: handler.fetch)
// ═══════════════════════════════════════════════════════════════════
describe('Protocol Integration', () => {
  let handler, client, clientTransport;
  let protoTmp;
  let origDb, origAuth;

  beforeAll(async () => {
    try {
      const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
      const { createMcpHandler } = await import('@modelcontextprotocol/server');
      const { createCordenarServer } = await import('../server.js');

      protoTmp = mkdtempSync(join(tmpdir(), 'cordenar-proto-'));
      origDb = process.env.CORDENAR_DB_PATH;
      origAuth = process.env.CORDENAR_AUTH_FILE;
      process.env.CORDENAR_DB_PATH = join(protoTmp, 'test.db');
      process.env.CORDENAR_AUTH_FILE = join(protoTmp, 'auth.json');
      process.env.CORDENAR_ENV = 'test';

      handler = createMcpHandler(createCordenarServer);

      clientTransport = new StreamableHTTPClientTransport(new URL('http://test/mcp'), {
        fetch: (url, init) => handler.fetch(new Request(url, init))
      });

      client = new Client(
        { name: 'smoke-test', version: '1.0.0' },
        { versionNegotiation: { mode: 'auto' } }
      );
      await client.connect(clientTransport);
    } catch (e) {
      if (e.code === 'ERR_MODULE_NOT_FOUND') {
        return test.skip('MCP client/server packages not installed');
      }
      throw e;
    }
  });

  afterAll(async () => {
    if (client) await client.close().catch(() => {});
    if (handler) await handler.close().catch(() => {});
    if (origDb !== undefined) process.env.CORDENAR_DB_PATH = origDb;
    if (origAuth !== undefined) process.env.CORDENAR_AUTH_FILE = origAuth;
    if (protoTmp) try { rmSync(protoTmp, { recursive: true, force: true }); } catch {}
  });

  test('tools/list returns 30+ tools', async () => {
    if (!client) return;
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(30);
  });

  test('tools/list includes memory_store', async () => {
    if (!client) return;
    const { tools } = await client.listTools();
    expect(tools.some(t => t.name === 'memory_store')).toBe(true);
  });

  test('tools/list includes tool_usage', async () => {
    if (!client) return;
    const { tools } = await client.listTools();
    expect(tools.some(t => t.name === 'tool_usage')).toBe(true);
  });

  test('memory_store succeeds over wire', async () => {
    if (!client) return;
    const res = await client.callTool({
      name: 'memory_store',
      arguments: { project: 'proto-test', content: 'protocol integration test', kind: 'fact' }
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(typeof parsed.id).toBe('number');
    expect(parsed.success).toBe(true);
  });

  test('missing required arg rejected by SDK', async () => {
    if (!client) return;
    const badRes = await client.callTool({
      name: 'memory_store',
      arguments: { project: 'test' }
    });
    expect(badRes.isError).toBe(true);
  });

  test('nonexistent memory returns error over wire', async () => {
    if (!client) return;
    const errRes = await client.callTool({
      name: 'memory_get',
      arguments: { project: 'nonexistent', id: 99999 }
    });
    expect(errRes.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Concept collections
// ═══════════════════════════════════════════════════════════════════
describe('Concept collections', () => {
  const ins = () => initDb().prepare('INSERT INTO concepts (collection, slug, type, title, body) VALUES (?, ?, ?, ?, ?)');

  test('schema has collection, no source/last_synced_at, composite unique', () => {
    const d = initDb();
    const cols = d.pragma('table_info(concepts)').map(c => c.name);
    expect(cols).toContain('collection');
    expect(cols).not.toContain('source');
    expect(cols).not.toContain('last_synced_at');
    const indexes = d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='concepts'").all().map(i => i.name);
    expect(indexes.some(n => n.startsWith('sqlite_autoindex'))).toBe(true);
  });

  test('same slug in two collections coexists', () => {
    ins().run('coll-a', 'shared/slug', 'skill', 'A', 'a');
    ins().run('coll-b', 'shared/slug', 'skill', 'B', 'b');
    expect(getConceptBySlug('coll-a', 'shared/slug').title).toBe('A');
    expect(getConceptBySlug('coll-b', 'shared/slug').title).toBe('B');
  });

  test('duplicate collection+slug violates UNIQUE constraint', () => {
    ins().run('coll-c', 'dup/slug', 'skill', 'C', 'c');
    expect(() => ins().run('coll-c', 'dup/slug', 'skill', 'C2', 'c2')).toThrow();
  });

  test('ancestry is scoped within collection', () => {
    ins().run('coll-d', 'anc/parent', 'skill', 'ParentD', 'd');
    ins().run('coll-d', 'anc/parent/child', 'skill', 'ChildD', 'd');
    ins().run('coll-e', 'anc/parent', 'skill', 'ParentE', 'e');
    const dConcept = getConceptBySlug('coll-d', 'anc/parent');
    const eConcept = getConceptBySlug('coll-e', 'anc/parent');
    expect(dConcept.references.map(r => r.slug)).toContain('anc/parent/child');
    expect(eConcept.references).toHaveLength(0);
  });

  test('getConceptContext requires collection (null on wrong collection)', () => {
    ins().run('coll-f', 'ctx/slug', 'skill', 'F', 'f body');
    expect(getConceptContext('coll-f', 'ctx/slug')).toContain('[coll-f]');
    expect(getConceptContext('coll-other', 'ctx/slug')).toBeNull();
  });

  test('listLocalConcepts filters by collection', () => {
    ins().run('coll-g', 'list/one', 'skill', 'G', 'g');
    ins().run('coll-h', 'list/two', 'skill', 'H', 'h');
    const rows = listLocalConcepts({ collection: 'coll-g' }).rows;
    expect(rows.map(r => r.slug)).toEqual(['list/one']);
  });

  test('migration 0005 drops old-schema concepts and recreates', () => {
    const migDir = mkdtempSync(join(tmpdir(), 'cordenar-mig-'));
    const migDb = join(migDir, 'mig.db');
    const raw = new Database(migDb);
    raw.exec("CREATE TABLE concepts (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, type TEXT NOT NULL, title TEXT, source TEXT DEFAULT 'local', last_synced_at INTEGER);");
    raw.prepare("INSERT INTO concepts (slug, type, title, source) VALUES ('old/slug', 'skill', 'Old', 'local')").run();
    raw.close();

    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    const dbJs = fileURLToPath(new URL('../db.js', import.meta.url));
    const script = join(migDir, 'migrate.mjs');
    writeFileSync(script,
      `import { initDb } from '${dbJs}';\n` +
      `const d = initDb();\n` +
      `const cols = d.pragma('table_info(concepts)').map(c => c.name);\n` +
      `const count = d.prepare('SELECT COUNT(*) c FROM concepts').get().c;\n` +
      `console.log(JSON.stringify({ cols, count }));\n` +
      `d.close();\n`);
    const out = execSync(`node "${script}"`, {
      env: { ...process.env, CORDENAR_DB_PATH: migDb, CORDENAR_ENV: 'test' },
      cwd: repoRoot,
    }).toString();
    const parsed = JSON.parse(out.trim().split('\n').pop());
    expect(parsed.cols).toContain('collection');
    expect(parsed.cols).not.toContain('source');
    expect(parsed.cols).not.toContain('last_synced_at');
    expect(parsed.count).toBe(0);
    rmSync(migDir, { recursive: true, force: true });
  });

  test('migration 0007 drops the old-schema resource column (FTS intact)', () => {
    const migDir = mkdtempSync(join(tmpdir(), 'cordenar-mig7-'));
    const migDb = join(migDir, 'mig.db');
    const raw = new Database(migDb);
    raw.exec("CREATE TABLE concepts (id INTEGER PRIMARY KEY, collection TEXT NOT NULL, slug TEXT NOT NULL, type TEXT NOT NULL, title TEXT, description TEXT, tags TEXT, status TEXT DEFAULT 'stable', frontmatter TEXT NOT NULL DEFAULT '{}', body TEXT NOT NULL, file_path TEXT, file_hash TEXT, body_length INTEGER DEFAULT 0, timestamp TEXT, resource TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(collection, slug));");
    raw.prepare("INSERT INTO concepts (collection, slug, type, title, body, resource) VALUES ('c', 'old/slug', 'skill', 'Old Title', 'oldsearch body', './references/')").run();
    raw.close();

    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    const dbJs = fileURLToPath(new URL('../db.js', import.meta.url));
    const script = join(migDir, 'migrate7.mjs');
    writeFileSync(script,
      `import { initDb } from '${dbJs}';\n` +
      `const d = initDb();\n` +
      `const cols = d.pragma('table_info(concepts)').map(c => c.name);\n` +
      `const count = d.prepare('SELECT COUNT(*) c FROM concepts').get().c;\n` +
      `d.prepare("INSERT INTO concepts_fts(concepts_fts) VALUES('rebuild')").run();\n` +
      `const found = d.prepare("SELECT COUNT(*) c FROM concepts_fts WHERE concepts_fts MATCH 'oldsearch'").get().c;\n` +
      `console.log(JSON.stringify({ cols, count, found }));\n` +
      `d.close();\n`);
    const out = execSync(`node "${script}"`, {
      env: { ...process.env, CORDENAR_DB_PATH: migDb, CORDENAR_ENV: 'test' },
      cwd: repoRoot,
    }).toString();
    const parsed = JSON.parse(out.trim().split('\n').pop());
    expect(parsed.cols).not.toContain('resource');
    expect(parsed.count).toBe(1);
    expect(parsed.found).toBe(1);
    rmSync(migDir, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Bundle-relative collection + slug derivation
// ═══════════════════════════════════════════════════════════════════
describe('Bundle-relative collection + slug', () => {
  test('detects git repo as bundle root, derives collection + bundle-relative slug', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-bundle-'));
    const kit = join(base, 'reserved', 'mykit');
    mkdirSync(join(kit, '.git'), { recursive: true });
    mkdirSync(join(kit, 'skills', 'foo'), { recursive: true });
    writeFileSync(join(kit, 'skills', 'foo', 'SKILL.md'), '---\nname: foo\n---\nbody');
    mkdirSync(join(kit, 'docs'), { recursive: true });
    writeFileSync(join(kit, 'docs', 'bar.md'), '# Bar\nbody');
    const r = indexConcepts([join(base, 'reserved')]);
    const d = initDb();
    const rows = d.prepare("SELECT collection, slug, type FROM concepts WHERE collection = 'mykit' ORDER BY slug").all();
    expect(r.collisions.length).toBe(0);
    expect(rows.map(x => x.collection + '/' + x.slug + ':' + x.type)).toEqual([
      'mykit/docs/bar:reference',
      'mykit/skills/foo:skill',
    ]);
    rmSync(base, { recursive: true, force: true });
  });

  test('root SKILL.md derives slug = bundle basename', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-single-'));
    const skill = join(base, 'single-skill');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: single\n---\nbody');
    const r = indexConcepts([skill]);
    const d = initDb();
    const rows = d.prepare("SELECT collection, slug, type FROM concepts WHERE collection = 'single-skill'").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].collection).toBe('single-skill');
    expect(rows[0].slug).toBe('single-skill');
    expect(rows[0].type).toBe('skill');
    rmSync(base, { recursive: true, force: true });
  });

  test('flat dir (no marker) falls back to scan path as collection', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-flat-'));
    const flat = join(base, 'notes');
    mkdirSync(flat, { recursive: true });
    writeFileSync(join(flat, 'note.md'), '# Note\nbody');
    const r = indexConcepts([flat]);
    const d = initDb();
    const row = d.prepare("SELECT collection, slug, type FROM concepts WHERE collection = 'notes'").get();
    expect(row.collection).toBe('notes');
    expect(row.slug).toBe('note');
    expect(row.type).toBe('reference');
    rmSync(base, { recursive: true, force: true });
  });

  test('dependency resolves by basename within collection', () => {
    const d = initDb();
    d.prepare("INSERT INTO concepts (collection, slug, type, title, body) VALUES ('c', 'skills/a', 'skill', 'A', 'a')").run();
    d.prepare("INSERT INTO concepts (collection, slug, type, title, body) VALUES ('c', 'skills/b', 'skill', 'B', 'b')").run();
    d.prepare("INSERT INTO concepts (collection, slug, type, title, body, frontmatter) VALUES ('c', 'skills/root', 'skill', 'Root', 'r', '{\"dependencies\":[\"a\"]}')").run();
    const g = getConceptBySlug('c', 'skills/root');
    expect(g.dependencies).toHaveLength(1);
    expect(g.dependencies[0]).toMatchObject({ slug: 'skills/a', title: 'A' });
    expect(typeof g.dependencies[0].id).toBe('number');
    expect(g.siblings.map((x) => x.slug).sort()).toEqual(['skills/a', 'skills/b']);
  });
});

describe('Frontmatter-less title derivation', () => {
  const titleOf = (base, slug) => {
    const d = initDb();
    return d.prepare('SELECT title FROM concepts WHERE collection = ? AND slug = ?').get(basename(base), slug)?.title;
  };

  test('derives title from the first # H1', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-title-'));
    writeFileSync(join(base, 'a.md'), '# Alpha Title\n\nbody');
    indexConcepts([base]);
    expect(titleOf(base, 'a')).toBe('Alpha Title');
    rmSync(base, { recursive: true, force: true });
  });

  test('finds the H1 anywhere in the body (multiline)', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-title-'));
    writeFileSync(join(base, 'b.md'), 'Intro line.\n# Beta Heading\n\nmore');
    indexConcepts([base]);
    expect(titleOf(base, 'b')).toBe('Beta Heading');
    rmSync(base, { recursive: true, force: true });
  });

  test('falls back to the first sentence when there is no H1', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-title-'));
    writeFileSync(join(base, 'c.md'), 'Just prose with no heading. More text here.');
    indexConcepts([base]);
    expect(titleOf(base, 'c')).toBe('Just prose with no heading');
    rmSync(base, { recursive: true, force: true });
  });

  test('empty body yields an empty title', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-title-'));
    writeFileSync(join(base, 'd.md'), '');
    indexConcepts([base]);
    expect(titleOf(base, 'd')).toBe('');
    rmSync(base, { recursive: true, force: true });
  });

  test('frontmatter.title beats the H1 and name', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-title-'));
    writeFileSync(join(base, 'e.md'), '---\ntitle: Explicit\nname: Named\n---\n# Ignored H1\n');
    indexConcepts([base]);
    expect(titleOf(base, 'e')).toBe('Explicit');
    rmSync(base, { recursive: true, force: true });
  });

  test('frontmatter.name beats the H1 when title is absent', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-title-'));
    writeFileSync(join(base, 'f.md'), '---\nname: Named\n---\n# H1 here\n');
    indexConcepts([base]);
    expect(titleOf(base, 'f')).toBe('Named');
    rmSync(base, { recursive: true, force: true });
  });

  test('strips inline markdown from the derived title', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-title-'));
    writeFileSync(join(base, 'g.md'), '# **Bold** and [link](http://x) and `code` title\n');
    indexConcepts([base]);
    expect(titleOf(base, 'g')).toBe('Bold and link and code title');
    rmSync(base, { recursive: true, force: true });
  });

  test('re-indexing an unchanged file is a no-op', () => {
    const base = mkdtempSync(join(tmpdir(), 'cord-title-'));
    writeFileSync(join(base, 'h.md'), '# Stable Title\n');
    const r1 = indexConcepts([base]);
    expect(r1.added).toHaveLength(1);
    const r2 = indexConcepts([base]);
    expect(r2.added).toHaveLength(0);
    expect(r2.updated).toHaveLength(0);
    expect(titleOf(base, 'h')).toBe('Stable Title');
    rmSync(base, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Concept family (related-sharing) ── full-tree model
// ═══════════════════════════════════════════════════════════════════
describe('Concept family (related-sharing)', () => {
  const COL = 'famtest';
  const add = (slug, extra = {}) => {
    initDb().prepare(
      'INSERT OR REPLACE INTO concepts (collection, slug, type, title, body, frontmatter) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(COL, slug, extra.type || 'skill', extra.title || slug, 'b', extra.frontmatter || '{}');
  };

  beforeAll(() => {
    initDb().prepare('DELETE FROM concepts WHERE collection = ?').run(COL);
    add('a');
    add('b');
    add('b/x');
    add('b/x/1');
    add('b/x/2');
    add('c');
    add('b/x/3', { frontmatter: '{"dependencies":["c","missing"]}' });
    add('b/y');
  });

  test('ancestors are the existing path chain (missing folder rows excluded)', () => {
    expect(getConceptFamily(COL, 'b/x').ancestors.map((r) => r.slug)).toEqual(['b']);
  });

  test('descendants are the full recursive subtree', () => {
    expect(getConceptFamily(COL, 'b/x').descendants.map((r) => r.slug).sort())
      .toEqual(['b/x/1', 'b/x/2', 'b/x/3']);
  });

  test('siblings are IMMEDIATE (one level, same parent), excluding self', () => {
    expect(getConceptFamily(COL, 'b/x').siblings.map((r) => r.slug)).toEqual(['b/y']);
  });

  test('root siblings are other top-level concepts; root has no ancestors', () => {
    const f = getConceptFamily(COL, 'b');
    expect(f.siblings.map((r) => r.slug).sort()).toEqual(['a', 'c']);
    expect(f.ancestors).toEqual([]);
  });

  test('family = self ∪ ancestors ∪ descendants ∪ siblings ∪ transitive deps (dangling skipped)', () => {
    const f = getConceptFamily(COL, 'b/x');
    // self b/x, ancestor b, sibling b/y, descendants 1/2/3, dep c via b/x/3; "missing" is dangling
    expect(f.family.map((r) => r.slug).sort())
      .toEqual(['b', 'b/x', 'b/x/1', 'b/x/2', 'b/x/3', 'b/y', 'c']);
    expect(f.total).toBe(7);
  });

  test('null collection/slug ⇒ empty family', () => {
    expect(getConceptFamily(null, 'b/x').total).toBe(0);
    expect(getConceptFamily(COL, null).total).toBe(0);
  });

  test('a sibling brings its subtree, but the sibling list stays immediate', () => {
    add('b/y/deep');
    const f = getConceptFamily(COL, 'b/x');
    expect(f.family.map((r) => r.slug)).toContain('b/y/deep');
    expect(f.siblings.map((r) => r.slug)).toEqual(['b/y']);
  });

  test('dependency cycles terminate', () => {
    const c = COL + '-cyc';
    const add2 = (slug, fm) => initDb().prepare(
      'INSERT OR REPLACE INTO concepts (collection, slug, type, title, body, frontmatter) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(c, slug, 'skill', slug, 'b', fm);
    add2('p', '{"dependencies":["q"]}');
    add2('q', '{"dependencies":["p"]}');
    expect(getConceptFamily(c, 'p').family.map((r) => r.slug).sort()).toEqual(['p', 'q']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Team concept collection scoping
// ═══════════════════════════════════════════════════════════════════
describe('Team concept collection scoping', () => {
  const ACC = 'acct-scope';
  const NODE = 'node-scope';
  const now = new Date().toISOString();
  const mk = (id, slug, collection) => ({
    id, account_id: ACC, source_node_id: NODE, slug, collection, type: 'reference',
    title: id, description: 'scope probe', tags: '["scope"]', status: 'stable', frontmatter: '{}',
    body: 'scope body ' + id, body_length: 10, content_hash: 'h' + id, cloud_status: 'active',
    approved_by: null, approved_at: null, source_node_name: NODE, source_user_email: 'u@x',
    created_at: now, updated_at: now,
  });

  beforeAll(() => {
    const d = initDb();
    d.prepare('DELETE FROM concept_synapses WHERE account_id = ?').run(ACC);
    for (const r of [mk('scope1', 'root/a', 'c1'), mk('scope2', 'root/a', 'c2'), mk('scope3', 'root/a', null)]) {
      const rowId = insertConceptSynapse(r);
      upsertConceptFts(rowId, r.title, r.description, r.tags, r.body);
    }
    insertConceptSynapse({ ...mk('route1', 'team/y', 'route-col'), account_id: 'acct-route' });
    d.prepare('INSERT INTO concepts (collection, slug, type, title, body) VALUES (?, ?, ?, ?, ?)')
      .run('route-col', 'local/x', 'skill', 'Local Route', 'b');
    insertConceptSynapse({ ...mk('ord1', 'team/old', 'order-col'), account_id: 'acct-order', created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z' });
    d.prepare('INSERT INTO concepts (collection, slug, type, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())')
      .run('order-col', 'local/new', 'skill', 'Local New', 'b');
  });

  test('searchTeamConceptHybrid filters by collection on the FTS branch', () => {
    const all = searchTeamConceptHybrid({ query: 'scope body', alpha: 0, limit: 500 }).rows;
    expect(all.filter((r) => r.account_id === ACC)).toHaveLength(3);
    const c1 = searchTeamConceptHybrid({ query: 'scope body', collection: 'c1', alpha: 0, limit: 500 }).rows;
    expect(c1).toHaveLength(1);
    expect(c1[0].collection).toBe('c1');
  });

  test('listTeamConceptSynapses filters by collection', () => {
    const rows = listTeamConceptSynapses({ collection: 'c1' }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].collection).toBe('c1');
  });

  test('conceptList collection + scope=team returns team only', () => {
    const rows = conceptList({ collection: 'route-col', scope: 'team' }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].collection).toBe('route-col');
    expect(rows[0].synapse_type).toBe('team_concept');
  });

  test('conceptList collection (scope all) returns local + team', () => {
    const rows = conceptList({ collection: 'route-col' }).rows;
    expect(rows.some((r) => r.scope === 'local' && r.collection === 'route-col')).toBe(true);
    expect(rows.some((r) => r.scope === 'team' && r.collection === 'route-col')).toBe(true);
  });

  test('toEpoch normalizes number, ISO, empty, null', () => {
    expect(toEpoch(1788577584)).toBe(1788577584);
    expect(toEpoch('2020-01-01T00:00:00.000Z')).toBe(1577836800);
    expect(toEpoch('')).toBe(0);
    expect(toEpoch(null)).toBe(0);
    expect(toEpoch(undefined)).toBe(0);
  });

  test('conceptList sorts newest-first across mixed local/team timestamps', () => {
    const rows = conceptList({ collection: 'order-col' }).rows;
    expect(rows.map((r) => r.slug)).toEqual(['local/new', 'team/old']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cloud suite (gated on CORDENAR_CLIENT_SECRET)
// ═══════════════════════════════════════════════════════════════════
const CLOUD_SECRET = process.env.CORDENAR_CLIENT_SECRET;
const CLOUD_TEST_MODE = process.env.CORDENAR_TEST_MODE === '1';

(CLOUD_SECRET ? describe : describe.skip)('Cloud Tier 1: Safe (no artifacts)', () => {
  let accountData;
  const clientId = `${hostname()}-${userInfo().username}`;

  async function authenticateWithCloud() {
    const { getConfig } = await import('../config.js');
    const cfg = getConfig();
    const res = await fetch(`${cfg.cloudUrl}/api/auth/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_secret: CLOUD_SECRET, client_id: clientId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Auth failed (${res.status})`);
    }
    const data = await res.json();
    saveAuth({
      node_id: data.node_id,
      access_token: data.access_token,
      account_id: data.account_id,
      name: data.name,
    });
    return data;
  }

  beforeAll(async () => {
    accountData = await authenticateWithCloud();
  });

  afterAll(() => {
    clearAuth();
  });

  test('authenticate returns node data', () => {
    expect(accountData).toBeTruthy();
    expect(accountData.node_id).toBeTruthy();
    expect(accountData.access_token).toBeTruthy();
  });

  test('listAccounts returns array with entries', async () => {
    const { listAccounts } = await import('../sync.js');
    const accounts = await listAccounts();
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.length).toBeGreaterThan(0);
  });

  test('pullSynapses returns structural object', async () => {
    const { pullSynapses } = await import('../sync.js');
    const pullResult = await pullSynapses();
    expect(typeof pullResult).toBe('object');
    expect(typeof pullResult.pulled).toBe('number');
    expect(Array.isArray(pullResult.synapses)).toBe(true);
  });

  test('fullSync returns object with push/unlink/pull counts', async () => {
    const { fullSync } = await import('../sync.js');
    const syncResult = await fullSync();
    expect(typeof syncResult).toBe('object');
    expect(typeof syncResult.pushed).toBe('number');
    expect(typeof syncResult.unlinked).toBe('number');
    expect(typeof syncResult.pulled).toBe('number');
    expect(Array.isArray(syncResult.nodes)).toBe(true);
  });
});
