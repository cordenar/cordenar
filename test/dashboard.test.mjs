import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_PORT = 34590;
let base, testDir, server;

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'dash-test-'));
  process.env.CORDENAR_DB_PATH = join(testDir, 'test.db');
  process.env.CORDENAR_MANIFEST_PATH = join(testDir, 'manifest.json');
  process.env.CORDENAR_AUTH_FILE = join(testDir, 'auth.json');
  process.env.CORDENAR_PORT = String(TEST_PORT);
  process.env.CORDENAR_ENV = 'test';

  const mod = await import('../dashboard.js');
  server = mod.server;

  base = `http://127.0.0.1:${TEST_PORT}`;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${base}/health`); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }

  const { storeMemory, initDb, storeMapping } = await import('../db.js');
  storeMemory({ project: 'test-proj', kind: 'note', content: 'note body text', status: 'pending' });
  storeMemory({ project: 'test-proj', kind: 'bug', content: 'bug description here', status: 'open' });
  storeMemory({ project: 'other-proj', kind: 'fact', content: 'factual statement' });
  const d = initDb();
  const localConcept = d.prepare('INSERT INTO concepts (collection, slug, type, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())')
    .run('test', 'test/concept', 'skill', 'Test Concept', 'concept body content');
  const now = new Date().toISOString();
  d.prepare("INSERT INTO memory_synapses (id, account_id, source_node_id, project, kind, content, content_hash, cloud_status, created_at, updated_at) VALUES ('team-mem-1', 'acct-team', 'node-team', 'team-proj', 'note', 'team memory content', 'hash-mem-1', 'active', ?, ?)")
    .run(now, now);
  d.prepare("INSERT INTO concept_synapses (id, account_id, source_node_id, slug, collection, type, title, body, content_hash, cloud_status, created_at, updated_at) VALUES ('team-con-1', 'acct-team', 'node-team', 'team/slug', 'team-col', 'reference', 'Team Concept', 'team concept body', 'hash-con-1', 'active', ?, ?)")
    .run(now, now);
  // push-origin mapping for the local concept (drives the `shared` status)
  storeMapping({ cloud_id: 'local-con-shared', source: 'concept', local_id: Number(localConcept.lastInsertRowid), account_id: 'acct-team', local_hash: 'h', cloud_hash: 'h', direction: 'push', cloud_status: 'active' });
  // id-collision: a local concept and a pulled concept sharing the same numeric id (9900)
  d.prepare("INSERT INTO concepts (id, collection, slug, type, title, body, created_at, updated_at) VALUES (9900, 'collide', 'local-9900', 'reference', 'Local 9900', 'b', unixepoch(), unixepoch())").run();
  d.prepare("INSERT INTO concept_synapses (row_id, id, account_id, source_node_id, slug, collection, type, title, body, content_hash, cloud_status, created_at, updated_at) VALUES (9900, 'team-9900', 'acct-team', 'node-team', 'team-9900', 'tcol-9900', 'reference', 'Team 9900', 'b', 'h', 'active', ?, ?)").run(now, now);
  storeMapping({ cloud_id: 'collide-push', source: 'concept', local_id: 9900, account_id: 'acct-team', local_hash: 'h', cloud_hash: 'h', direction: 'push', cloud_status: 'active' });
  storeMapping({ cloud_id: 'collide-pull', source: 'concept', local_id: 9900, account_id: 'acct-team', local_hash: 'h', cloud_hash: 'h', direction: 'pull', cloud_status: 'active' });
  // dirty push mapping (local_hash !== cloud_hash) for the isDirty list-enrichment assertion
  const dirtyConcept = d.prepare("INSERT INTO concepts (collection, slug, type, title, body, created_at, updated_at) VALUES ('dirty', 'dirty/slug', 'skill', 'Dirty Concept', 'b', unixepoch(), unixepoch())").run();
  storeMapping({ cloud_id: 'dirty-push', source: 'concept', local_id: Number(dirtyConcept.lastInsertRowid), account_id: 'acct-team', local_hash: 'local-v1', cloud_hash: 'cloud-v2', direction: 'push', cloud_status: 'active' });
});

afterAll(() => {
  if (server) server.close();
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
});

describe('GET /health', () => {
  test('returns 200 with version, uptime, db_size, backup_count', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.status).toBe('ok');
    expect(typeof b.version).toBe('string');
    expect(b.version.length).toBeGreaterThan(0);
    expect(typeof b.uptime).toBe('number');
    expect(b.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof b.db_size).toBe('number');
    expect(b.db_size).toBeGreaterThan(0);
    expect(typeof b.backup_count).toBe('number');
    expect(b.backup_count).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/dashboard', () => {
  test('returns rows and total with no params', async () => {
    const r = await fetch(`${base}/api/dashboard`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.rows)).toBe(true);
    expect(typeof b.total).toBe('number');
    expect(b.total).toBeGreaterThanOrEqual(3);
  });

  test('filters by scope=local', async () => {
    const r = await fetch(`${base}/api/dashboard?scope=local`);
    const b = await r.json();
    for (const row of b.rows) {
      expect(row.origin).toBe('local');
    }
  });

  test('filters by source=memory', async () => {
    const r = await fetch(`${base}/api/dashboard?source=memory`);
    const b = await r.json();
    for (const row of b.rows) {
      expect(row.source).toBe('memory');
    }
  });

  test('filters by source=concept', async () => {
    const r = await fetch(`${base}/api/dashboard?source=concept`);
    const b = await r.json();
    for (const row of b.rows) {
      expect(row.source).toBe('concept');
    }
  });

  test('filters concepts by collection', async () => {
    const r = await fetch(`${base}/api/dashboard?source=concept&collection=test`);
    const b = await r.json();
    expect(b.rows.length).toBeGreaterThan(0);
    for (const row of b.rows) {
      expect(row.collection).toBe('test');
    }
  });

  test('returns empty for unknown collection', async () => {
    const r = await fetch(`${base}/api/dashboard?source=concept&collection=nonexistent`);
    const b = await r.json();
    expect(b.rows.length).toBe(0);
  });

  test('paginates with limit and offset', async () => {
    const r = await fetch(`${base}/api/dashboard?limit=1&offset=0`);
    const b = await r.json();
    expect(b.rows.length).toBeLessThanOrEqual(1);
    expect(b.limit).toBe(1);
    expect(b.offset).toBe(0);
  });

  test('handles search query', async () => {
    const r = await fetch(`${base}/api/dashboard?search=bug`);
    const b = await r.json();
    for (const row of b.rows) {
      if (row.source === 'memory') {
        expect(row.preview).toBeDefined();
      }
    }
  });

  test('caps limit at 200', async () => {
    const r = await fetch(`${base}/api/dashboard?limit=5000`);
    expect(r.status).toBe(200);
  });

  test('handles non-numeric limit gracefully', async () => {
    const r = await fetch(`${base}/api/dashboard?limit=abc`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.limit).toBe(20);
  });

  test('handles invalid scope by defaulting to all', async () => {
    const r = await fetch(`${base}/api/dashboard?scope=bogus`);
    expect(r.status).toBe(200);
  });

  test('handles invalid source by defaulting to all', async () => {
    const r = await fetch(`${base}/api/dashboard?source=bogus`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.total).toBeGreaterThanOrEqual(3);
  });
});

describe('GET /api/dashboard — team rendering', () => {
  test('scope=team returns pulled team rows (memory + concept)', async () => {
    const r = await fetch(`${base}/api/dashboard?scope=team`);
    expect(r.status).toBe(200);
    const b = await r.json();
    const team = b.rows.filter((x) => x.origin === 'team');
    expect(team.length).toBeGreaterThanOrEqual(2);

    const mem = team.find((x) => x.source === 'memory');
    expect(mem).toBeDefined();
    expect(mem.type).toBe('note');
    expect(mem.project).toBe('team-proj');
    expect(mem.synapseStatus).toBe('pulled');

    const con = team.find((x) => x.source === 'concept');
    expect(con).toBeDefined();
    expect(con.title).toBe('Team Concept');
    expect(con.slug).toBe('team/slug');
    expect(con.type).toBe('reference');
  });

  test('scope=all includes both team and local rows', async () => {
    const r = await fetch(`${base}/api/dashboard?scope=all`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.rows.some((x) => x.origin === 'team')).toBe(true);
    expect(b.rows.some((x) => x.origin === 'local')).toBe(true);
  });

  test('scope=team&source=concept filters to concept team rows', async () => {
    const r = await fetch(`${base}/api/dashboard?scope=team&source=concept`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.rows.length).toBeGreaterThan(0);
    for (const row of b.rows) {
      expect(row.source).toBe('concept');
      expect(row.origin).toBe('team');
    }
  });
});

describe('GET /api/dashboard — collection + status + id-collision', () => {
  test('team concept rows carry collection', async () => {
    const b = await (await fetch(`${base}/api/dashboard?scope=team&source=concept`)).json();
    const row = b.rows.find((r) => r.slug === 'team/slug');
    expect(row).toBeDefined();
    expect(row.collection).toBe('team-col');
  });

  test('scope=team&collection= filters team concepts', async () => {
    const hit = await (await fetch(`${base}/api/dashboard?scope=team&collection=team-col`)).json();
    expect(hit.rows.some((r) => r.slug === 'team/slug')).toBe(true);
    const miss = await (await fetch(`${base}/api/dashboard?scope=team&collection=nope`)).json();
    expect(miss.rows.length).toBe(0);
  });

  test('status filter maps to synapseStatus', async () => {
    const shared = await (await fetch(`${base}/api/dashboard?scope=local&source=concept&status=shared`)).json();
    const sRow = shared.rows.find((r) => r.slug === 'test/concept');
    expect(sRow).toBeDefined();
    expect(sRow.synapseStatus).toBe('shared');
    expect(sRow.cloud_status).toBe('active');

    const unshared = await (await fetch(`${base}/api/dashboard?scope=local&source=concept&status=unshared`)).json();
    expect(unshared.rows.some((r) => r.slug === 'test/concept')).toBe(false);

    const pulled = await (await fetch(`${base}/api/dashboard?scope=team&status=pulled`)).json();
    expect(pulled.rows.length).toBeGreaterThan(0);
    expect(pulled.rows.every((r) => r.synapseStatus === 'pulled')).toBe(true);
  });

  test('id-collision: local and pulled rows enrich independently', async () => {
    const b = await (await fetch(`${base}/api/dashboard?scope=all&source=concept`)).json();
    const local = b.rows.find((r) => r.origin === 'local' && r.slug === 'local-9900');
    const team = b.rows.find((r) => r.origin === 'team' && r.slug === 'team-9900');
    expect(local).toBeDefined();
    expect(team).toBeDefined();
    expect(local.synapseStatus).toBe('shared');
    expect(team.synapseStatus).toBe('pulled');
  });

  test('list enrichment sets isDirty for a locally-modified push', async () => {
    const b = await (await fetch(`${base}/api/dashboard?scope=local&source=concept`)).json();
    const dirty = b.rows.find((r) => r.slug === 'dirty/slug');
    expect(dirty).toBeDefined();
    expect(dirty.isDirty).toBe(true);
    const clean = b.rows.find((r) => r.slug === 'test/concept');
    expect(clean).toBeDefined();
    expect(clean.isDirty).toBe(false);
  });
});

describe('GET /api/projects', () => {
  test('returns project names', async () => {
    const r = await fetch(`${base}/api/projects`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b)).toBe(true);
    expect(b).toContain('test-proj');
    expect(b).toContain('other-proj');
  });
});

describe('GET /api/collections', () => {
  test('returns collection names', async () => {
    const r = await fetch(`${base}/api/collections`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b)).toBe(true);
    expect(b).toContain('test');
  });
});

describe('GET /api/memories/:id', () => {
  test('returns memory with body_html', async () => {
    const r = await fetch(`${base}/api/memories/1?project=test-proj`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.id).toBe(1);
    expect(b.project).toBe('test-proj');
    expect(b.kind).toBe('note');
    expect(typeof b.content_html).toBe('string');
  });

  test('returns 404 for missing memory', async () => {
    const r = await fetch(`${base}/api/memories/99999?project=test-proj`);
    expect(r.status).toBe(404);
  });

  test('returns 400 for missing project', async () => {
    const r = await fetch(`${base}/api/memories/1`);
    expect(r.status).toBe(400);
  });
});

describe('GET /api/synapses/:id', () => {
  test('returns memory when source=memory', async () => {
    const r = await fetch(`${base}/api/synapses/1?source=memory`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.source).toBe('memory');
    expect(b.id).toBe(1);
  });

  test('returns concept when source=concept', async () => {
    const r = await fetch(`${base}/api/synapses/1?source=concept`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.source).toBe('concept');
    expect(b.id).toBe(1);
  });

  test('returns 400 when source missing', async () => {
    const r = await fetch(`${base}/api/synapses/1`);
    expect(r.status).toBe(400);
  });
});

describe('GET /api/status', () => {
  test('returns status with push/pull counts', async () => {
    const r = await fetch(`${base}/api/status`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(typeof b.pushed).toBe('number');
    expect(typeof b.pulled).toBe('number');
    expect(typeof b.dirty).toBe('number');
    expect(typeof b.authenticated).toBe('boolean');
  });
});

describe('GET /api/stats', () => {
  test('returns per-source and total counts', async () => {
    const r = await fetch(`${base}/api/stats`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(typeof b.total).toBe('number');
    expect(typeof b.memoryCount).toBe('number');
    expect(typeof b.conceptCount).toBe('number');
    expect(b.total).toBeGreaterThanOrEqual(3);
  });
});

describe('GET /api/tool-stats', () => {
  test('returns stats with period filtering', async () => {
    const r = await fetch(`${base}/api/tool-stats?period=all`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(typeof b.total_last_7d).toBe('number');
    expect(typeof b.last_7d_error_rate).toBe('number');
    expect(Array.isArray(b.tools)).toBe(true);
  });
});

describe('POST /api/notify', () => {
  test('returns ok with valid JSON', async () => {
    const r = await fetch(`${base}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test_event', id: 1, source: 'memory', project: 'test' }),
    });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
  });

  test('returns 400 for invalid JSON', async () => {
    const r = await fetch(`${base}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(r.status).toBe(400);
  });
});

describe('POST /api/sync', () => {
  test('returns 200 and triggers sync', async () => {
    const r = await fetch(`${base}/api/sync`, { method: 'POST' });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.message).toBe('Sync started');
  });
});
