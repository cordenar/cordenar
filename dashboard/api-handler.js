// Cordenar Dashboard — API handler
// Pattern mirrors Cordenar dashboard
import { existsSync, readdirSync } from 'node:fs';
import { listSynapses, shareSynapses, unshareSynapse, toEpoch } from '../sync.js';
import {
  getPushEntries,
  getPullEntries,
  getDirtyEntries,
  lookupLocalByDirection,
  removeMapping,
  searchLocalMemory,
  listLocalMemories,
  getMemoryById,
  initDb,
  searchLocalConcepts,
  listLocalConcepts,
  searchTeamMemoryHybrid,
  searchTeamConceptHybrid,
  getConceptFamily,
  getToolStats,
} from '../db.js';
import { isAuthenticated, getNodeId, getNodes, getActiveNode } from '../auth.js';
import { getConfig } from '../config.js';
import { marked } from 'marked';

marked.use({
  renderer: {
    link({ href, text }) {
      const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<span class="link-ref" title="${esc(href)}">${esc(text)}</span>`;
    },
    html({ text }) {
      return '';
    }
  }
});
function json(data, status = 200) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

export function err(msg, status = 500) {
  if (status >= 500) console.error('[dashboard]', msg);
  return json({ error: msg }, status);
}

function valInt(v, def, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return def;
  if (n > max) return max;
  return n;
}

function valEnum(v, allowed, def) {
  return allowed.includes(v) ? v : def;
}

export function createApiHandler(db) {
  return async function handleApi(path, method, params) {
    // ── Dashboard (unified paginated view) ─────────────────
    if (path === '/api/dashboard' && method === 'GET') {
      const scope = valEnum(params.get('scope') || 'all', ['all', 'local', 'team'], 'all');
      const source = valEnum(params.get('source') || '', ['', 'memory', 'concept'], '');
      const status = valEnum(params.get('status') || '', ['', 'shared', 'unshared', 'pulled'], '');
      const search = (params.get('search') || '').substring(0, 500);
      const limit = valInt(params.get('limit'), 20, 200);
      const offset = valInt(params.get('offset'), 0, 1e9);
      const project = params.get('project') || '';
      const kind = params.get('kind') || '';
      const memstatus = params.get('memstatus') || '';
      const memLifecycle = valEnum(params.get('lifecycle') || 'active', ['active', 'archived', 'trash'], 'active');
      const conType = params.get('conType') || '';
      const conStatus = params.get('conStatus') || '';
      const collection = params.get('collection') || '';

      const fetchLimit = Math.min(offset + limit, 500);

      // push-origin ids — drive the shared/unshared status views
      const sharedMemIds = [];
      const sharedConIds = [];
      for (const e of getPushEntries()) {
        if (e.source === 'memory') sharedMemIds.push(e.local_id);
        else if (e.source === 'concept') sharedConIds.push(e.local_id);
      }

      const isShared = status === 'shared';
      const isUnshared = status === 'unshared';
      const wantLocal = (scope === 'local' || scope === 'all') && (status === '' || isShared || isUnshared);
      const wantTeam = (scope === 'team' || scope === 'all') && (status === '' || status === 'pulled');
      const requireFtsMatch = isShared || isUnshared;
      const memInclude = isShared ? sharedMemIds : undefined;
      const memExclude = isUnshared ? sharedMemIds : undefined;
      const conInclude = isShared ? sharedConIds : undefined;
      const conExclude = isUnshared ? sharedConIds : undefined;

      const rows = [];
      let total = 0;

      // Local memories
      if (wantLocal && !collection && (!source || source === 'memory')) {
        const res = search
          ? searchLocalMemory({ query: search, includeIds: memInclude, excludeIds: memExclude, project: project || undefined, kind: kind || undefined, status: memstatus || undefined, archived: memLifecycle === 'archived', trash: memLifecycle === 'trash', limit: fetchLimit, offset: 0, alpha: 0.3, requireFtsMatch })
          : listLocalMemories({ project: project || undefined, kind: kind || undefined, status: memstatus || undefined, archived: memLifecycle === 'archived', trash: memLifecycle === 'trash', includeIds: memInclude, excludeIds: memExclude, limit: fetchLimit, offset: 0 });
        total += res.total || 0;
        for (const m of (res.rows || [])) {
          rows.push({
            source: 'memory', id: m.id, origin: 'local', type: m.kind || '',
            project: m.project, status: m.status || '',
            preview: m.content ? m.content.substring(0, 200) : '',
            content: m.content, related_ids: Array.isArray(m.related_ids) ? m.related_ids : [],
            created_at: toEpoch(m.updated_at || m.created_at), updated_at: toEpoch(m.updated_at || m.created_at),
            synapseStatus: 'unshared',
          });
        }
      }

      // Local concepts
      if (wantLocal && (!source || source === 'concept')) {
        const res = search
          ? searchLocalConcepts({ query: search, includeIds: conInclude, excludeIds: conExclude, type: conType || undefined, status: conStatus || undefined, collection: collection || undefined, tags: undefined, limit: fetchLimit, offset: 0, alpha: 0.3, requireFtsMatch })
          : listLocalConcepts({ collection: collection || undefined, type: conType || undefined, status: conStatus || undefined, includeIds: conInclude, excludeIds: conExclude, limit: fetchLimit, offset: 0 });
        total += res.total || 0;
        for (const c of (res.rows || [])) {
          rows.push({
            source: 'concept', id: c.id, origin: 'local', type: c.type || '',
            title: c.title, description: c.description, collection: c.collection, slug: c.slug,
            tags: Array.isArray(c.tags) ? c.tags : [], status: c.status || '',
            preview: c.title || c.slug,
            created_at: toEpoch(c.updated_at || c.created_at), updated_at: toEpoch(c.updated_at || c.created_at),
            synapseStatus: 'unshared',
          });
        }
      }

      // Team memories
      if (wantTeam && !collection && (!source || source === 'memory')) {
        const res = search
          ? searchTeamMemoryHybrid({ query: search, project: project || undefined, kind: kind || undefined, status: memstatus || undefined, cloud_status: 'active', limit: fetchLimit, offset: 0, alpha: 0.3 })
          : listSynapses({ source: 'memory', type: kind || undefined, project: project || undefined, limit: fetchLimit });
        total += res.total || 0;
        for (const m of (res.rows || [])) {
          rows.push({
            source: 'memory', id: (m.row_id ?? m.id), origin: 'team', type: m.kind || m.type || '',
            project: m.project, status: m.status || '',
            preview: m.preview || (m.content ? m.content.substring(0, 200) : ''),
            content: m.content, related_ids: [],
            created_at: toEpoch(m.created_at), updated_at: toEpoch(m.updated_at || m.created_at),
            synapseStatus: 'pulled',
          });
        }
      }

      // Team concepts
      if (wantTeam && (!source || source === 'concept')) {
        const res = search
          ? searchTeamConceptHybrid({ query: search, type: conType || undefined, collection: collection || undefined, cloud_status: 'active', status: conStatus || undefined, limit: fetchLimit, offset: 0, alpha: 0.3 })
          : listSynapses({ source: 'concept', type: conType || undefined, collection: collection || undefined, limit: fetchLimit });
        total += res.total || 0;
        for (const c of (res.rows || [])) {
          rows.push({
            source: 'concept', id: (c.row_id ?? c.id), origin: 'team', type: c.type,
            title: c.title, description: c.description, slug: c.slug, collection: c.collection,
            tags: Array.isArray(c.tags) ? c.tags : [], status: c.status || '',
            preview: c.title || c.slug, body: c.body,
            created_at: toEpoch(c.created_at), updated_at: toEpoch(c.updated_at || c.created_at),
            synapseStatus: 'pulled',
          });
        }
      }

      // Enrich with the sync map — direction-aware: local → push/unshared, team → pull
      for (const r of rows) {
        const mapped = r.origin === 'team'
          ? lookupLocalByDirection(r.source, r.id, ['pull'])
          : lookupLocalByDirection(r.source, r.id, ['push', 'unshared']);
        if (mapped) {
          if (mapped.direction === 'push') { r.direction = 'push'; r.synapseStatus = 'shared'; }
          else if (mapped.direction === 'unshared') { r.direction = 'unshared'; r.synapseStatus = 'unshared'; }
          else if (mapped.direction === 'pull') { r.direction = 'pull'; r.synapseStatus = 'pulled'; }
          r.cloud_status = mapped.cloud_status || '';
          r.isDirty = mapped.direction === 'push' && mapped.local_hash !== mapped.cloud_hash;
        }
      }

      rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      const paged = rows.slice(offset, offset + limit);
      return json({ rows: paged, total, limit, offset });
    }

    // ── Memory projects ───────────────────────────────────
    if (path === '/api/projects' && method === 'GET') {
      const d = initDb();
      const rows = d.prepare('SELECT DISTINCT project FROM memories ORDER BY project').all();
      return json(rows.map(r => r.project));
    }

    // ── Concept collections ───────────────────────────────
    if (path === '/api/collections' && method === 'GET') {
      const d = initDb();
      const rows = d.prepare('SELECT collection FROM concepts WHERE collection IS NOT NULL UNION SELECT collection FROM concept_synapses WHERE collection IS NOT NULL ORDER BY collection').all();
      return json(rows.map(r => r.collection));
    }

    // ── Single local memory ────────────────────────────────
    const memMatch = path.match(/^\/api\/memories\/(\d+)$/);
    if (memMatch && method === 'GET') {
      const id = parseInt(memMatch[1], 10);
      const project = params.get('project') || '';
      if (!id || !project) return err('Missing id or project', 400);
      const mem = getMemoryById(project, id);
      if (!mem) return err('Memory not found', 404);
      if (mem.content) mem.content_html = marked.parse(mem.content);
      const idStr = String(id);
      const d = initDb();
      mem.referenced_by = d.prepare(
        "SELECT id, kind, status, substr(content, 1, 100) as preview FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND id != ? AND related_ids != '' AND (related_ids = ? OR related_ids LIKE ? OR related_ids LIKE ? OR related_ids LIKE ?)"
      ).all(project, id, idStr, idStr + ',%', '%,' + idStr, '%,' + idStr + ',%');
      return json(mem);
    }

    // ── Single synapse ───────────────────────────────────────
    const getMatch = path.match(/^\/api\/synapses\/(\d+)$/);
    if (getMatch && method === 'GET') {
      const id = parseInt(getMatch[1], 10);
      const source = params.get('source') || '';
      if (!id || !source) return err('Missing id or source', 400);
      var s;
      const d = initDb();
      if (source === 'memory') {
        var row = d.prepare(
          'SELECT id, project, kind as type, kind, status, content, substr(content, 1, 200) as preview, related_ids, created_at FROM memories WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL'
        ).get(id);
        if (!row) return err('Synapse not found', 404);
        s = row;
        s.source = 'memory';
        s.related_ids = s.related_ids ? s.related_ids.split(',').map(Number).filter(Boolean) : [];
      } else {
        var crow = d.prepare(
          'SELECT id, collection, slug, type, title, status, description, body, substr(body, 1, 200) as preview, created_at FROM concepts WHERE id = ?'
        ).get(id);
        if (!crow) return err('Synapse not found', 404);
        s = crow;
        s.source = 'concept';
      }
      const mapped = lookupLocalByDirection(source, id, ['push', 'unshared']);
      if (mapped) {
        s.cloudId = mapped.cloud_id;
        s.direction = mapped.direction;
        s.isDirty = mapped.direction === 'push' && mapped.local_hash !== mapped.cloud_hash;
      }
      if (s.body) s.body_html = marked.parse(s.body);
      if (s.content) s.content_html = marked.parse(s.content);
      if (source === 'memory') {
        s.related_ids = s.related_ids || [];
        var idStr = String(id);
        s.referenced_by = d.prepare(
          "SELECT id, kind, status FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND id != ? AND related_ids != '' AND (related_ids = ? OR related_ids LIKE ? OR related_ids LIKE ? OR related_ids LIKE ?)"
        ).all(s.project, id, idStr, idStr + ',%', '%,' + idStr, '%,' + idStr + ',%');
      }
      if (source === 'concept' && s.slug) {
        const fam = getConceptFamily(s.collection, s.slug);
        const light = (r) => ({ id: r.id, slug: r.slug, title: r.title, type: r.type });
        s.references = fam.descendants.map(light);
        s.referenced_by = fam.ancestors.map(light);
        s.siblings = fam.siblings.map(light);
        s.family_total = fam.total;
      }
      return json(s);
    }

    // ── Status overview ───────────────────────────────────────
    if (path === '/api/status' && method === 'GET') {
      const authenticated = isAuthenticated();
      const nodeId = getNodeId();
      const pushes = getPushEntries();
      const pulls = getPullEntries();
      const dirty = getDirtyEntries();
      const nodes = authenticated ? getNodes() : [];
      const activeNode = authenticated ? getActiveNode() : null;

      return json({
        authenticated,
        nodeId,
        nodes: nodes.map(n => ({ account_name: n.account_name, account_slug: n.account_slug, name: n.name })),
        active_account_slug: activeNode?.account_slug || null,
        pushed: pushes.length,
        pulled: pulls.length,
        dirty: dirty.length,
      });
    }

    // ── Synapse statistics ────────────────────────────────────
    if (path === '/api/stats' && method === 'GET') {
      const all = listSynapses({ limit: 500 }).rows;
      var teamMemoryCount = 0, teamConceptCount = 0;
      var kinds = {}, types = {}, statuses = {};
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        if (s.source === 'memory') teamMemoryCount++;
        else teamConceptCount++;
        var t = (s.type || '').toLowerCase();
        if (t) {
          if (s.source === 'memory') {
            if (t === 'progressive_summary') t = 'summary';
            kinds[t] = (kinds[t] || 0) + 1;
          } else {
            types[t] = (types[t] || 0) + 1;
          }
        }
        if (s.status) statuses[s.status.toLowerCase()] = (statuses[s.status.toLowerCase()] || 0) + 1;
      }

      function topEntries(obj, n) {
        return Object.entries(obj).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n).map(function (e) { return { name: e[0], count: e[1] }; });
      }

      // Local data stats
      const d = initDb();
      const sharedCount = (d.prepare("SELECT COUNT(*) as c FROM synapse_map WHERE direction = 'push'").get() || {}).c || 0;
      const pulledCount = (d.prepare("SELECT COUNT(*) as c FROM synapse_map WHERE direction = 'pull'").get() || {}).c || 0;
      const localMemoryCount = (d.prepare('SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL AND archived_at IS NULL').get() || {}).c || 0;
      const localConceptCount = (d.prepare('SELECT COUNT(*) as c FROM concepts').get() || {}).c || 0;
      const localProjects = d.prepare('SELECT DISTINCT project FROM memories ORDER BY project').all().map(r => r.project);
      const memKinds = d.prepare('SELECT kind, COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND archived_at IS NULL GROUP BY kind').all();
      const conTypes = d.prepare('SELECT type, COUNT(*) as count FROM concepts GROUP BY type').all();

      // Backup stats
      const backupDir = getConfig().backup?.dir;
      var backupCount = 0, backupLastAt = null;
      if (backupDir && existsSync(backupDir)) {
        const backupFiles = readdirSync(backupDir)
          .filter(function (f) { return f.startsWith('cordenar-') && f.endsWith('.db'); })
          .sort();
        backupCount = backupFiles.length;
        if (backupCount > 0) {
          const m = backupFiles[backupCount - 1].match(/cordenar-([\d-]+)/);
          backupLastAt = m ? m[1] : null;
        }
      }

      // Merge: local only if no team data, or always include local
      const teamTotal = all.length;
      const total = teamTotal + localMemoryCount + localConceptCount;
      const memoryCount = teamMemoryCount + localMemoryCount;
      const conceptCount = teamConceptCount + localConceptCount;
      const mergedKinds = Object.keys(kinds).length === 0 && memKinds.length > 0
        ? Object.fromEntries(memKinds.map(function (r) { return [r.kind || '(empty)', r.count]; }))
        : kinds;
      const mergedTypes = Object.keys(types).length === 0 && conTypes.length > 0
        ? Object.fromEntries(conTypes.map(function (r) { return [r.type, r.count]; }))
        : types;

      var nodes = 1;
      var nodeId = getNodeId();
      const allNodes = getNodes();
      const teams = [...new Set(allNodes.map(n => n.account_name).filter(Boolean))];
      const teamSyncRows = d.prepare(
        "SELECT account_id, direction, COUNT(*) as c FROM synapse_map GROUP BY account_id, direction"
      ).all();
      const teamMap = {};
      for (var ti = 0; ti < teamSyncRows.length; ti++) {
        var tr = teamSyncRows[ti];
        if (!teamMap[tr.account_id]) teamMap[tr.account_id] = { shared: 0, pulled: 0 };
        if (tr.direction === 'push') teamMap[tr.account_id].shared = tr.c;
        if (tr.direction === 'pull') teamMap[tr.account_id].pulled = tr.c;
      }
      const nameMap = {};
      for (var ni = 0; ni < allNodes.length; ni++) nameMap[allNodes[ni].account_id] = allNodes[ni].account_name;
      const teamSync = Object.entries(teamMap).map(function (e) {
        return { name: nameMap[e[0]] || null, shared: e[1].shared, pulled: e[1].pulled };
      });
      return json({
        total,
        memoryCount,
        conceptCount,
        teamTotal,
        sharedCount,
        pulledCount,
        teamSync,
        nodes,
        nodeId,
        teams,
        kinds: topEntries(mergedKinds, 100),
        types: topEntries(mergedTypes, 100),
        statuses: topEntries(statuses, 100),
        localMemoryCount,
        localConceptCount,
        localProjects,
        memoryKinds: memKinds.map(function (r) { return { name: r.kind || '(empty)', count: r.count }; }),
        conceptTypes: conTypes.map(function (r) { return { name: r.type, count: r.count }; }),
        backupCount,
        backupLastAt,
      });
    }

    // ── Share synapse ─────────────────────────────────────────
    const shareMatch = path.match(/^\/api\/synapses\/(\d+)\/share$/);
    if (shareMatch && method === 'POST') {
      const id = parseInt(shareMatch[1], 10);
      const source = params.get('source') || '';
      const accountSlug = params.get('account_slug') || undefined;
      if (!id || !source) return err('Missing id or source', 400);

      if (!isAuthenticated()) {
        console.error('[dashboard] share failed: not authenticated');
        return err('Not authenticated. Run cordenar_auth first.', 401);
      }

      try {
        const result = await shareSynapses({ synapses: [{ source, id }], account_slug: accountSlug });
        const item = result.results && result.results[0];
        if (!item) {
          console.error('[dashboard] share returned no result');
          return err('Share returned no result', 500);
        }
        if (result.newly_shared > 0) return json({ shared: true, family_total: result.family_total, newly_shared: result.newly_shared, already_shared: result.already_shared });
        if (result.already_shared > 0) return json({ already_shared: true, family_total: result.family_total, already_shared: result.already_shared });
        if (item.status === 'not_found') return err('Item not found in local store', 404);
        if (item.status === 'duplicate') return json({ duplicate: true, detail: item.detail });
        if (item.status === 'error') {
          console.error('[dashboard] share error:', item.message || 'unknown');
          return err(item.message || 'Share failed', 500);
        }
        console.error('[dashboard] share unknown status:', item.status);
        return err('Unknown share status: ' + item.status, 500);
      } catch (e) {
        console.error('[dashboard] share exception:', e.message);
        return err(e.message, 500);
      }
    }

    // ── Unlink (keep local, remove mapping) ───────────────────
    const unlinkMatch = path.match(/^\/api\/synapses\/(\d+)\/unlink$/);
    if (unlinkMatch && method === 'POST') {
      const id = parseInt(unlinkMatch[1], 10);
      const source = params.get('source') || '';
      if (!id || !source) return err('Missing id or source', 400);
      const mapped = lookupLocalByDirection(source, id, ['push']);
      if (mapped) {
        removeMapping(mapped.cloud_id);
        return json({ unlinked: true });
      }
      return err('Not found in sync map', 404);
    }

    // ── Unshare (request admin review) ───────────────────────
    const unshareMatch = path.match(/^\/api\/synapses\/(\d+)\/unshare$/);
    if (unshareMatch && method === 'POST') {
      const id = parseInt(unshareMatch[1], 10);
      const source = params.get('source') || '';
      if (!id || !source) return err('Missing id or source', 400);
      try {
        const result = await unshareSynapse(source, id);
        return json({ unshared: true, total: result.total, requested: result.requested, errors: result.errors });
      } catch (e) {
        console.error('[dashboard] unshare failed:', e.message);
        return err(e.message, 500);
      }
    }

    // ── Remove pulled local copy ──────────────────────────────
    const pullDeleteMatch = path.match(/^\/api\/synapses\/(\d+)\/pull-delete$/);
    if (pullDeleteMatch && method === 'POST') {
      const id = parseInt(pullDeleteMatch[1], 10);
      const source = params.get('source') || '';
      if (!id || !source) return err('Missing id or source', 400);

      const d = initDb();
      const mapped = d.prepare(
        "SELECT * FROM synapse_map WHERE source = ? AND local_id = ? AND direction = 'pull'"
      ).get(source, id);
      if (!mapped) return err('Not a pulled synapse', 404);

      const table = source === 'memory' ? 'memory_synapses' : 'concept_synapses';
      const vecTable = source === 'memory' ? 'memory_synapses_vec' : 'concept_synapses_vec';
      const ftsTable = source === 'memory' ? 'memory_synapses_fts' : 'concept_synapses_fts';

      const synRow = d.prepare(`SELECT row_id FROM ${table} WHERE id = ?`).get(mapped.cloud_id);

      if (synRow) {
        d.prepare(`DELETE FROM ${vecTable} WHERE rowid = ?`).run(synRow.row_id);
        d.prepare(`DELETE FROM ${ftsTable} WHERE rowid = ?`).run(synRow.row_id);
      }

      d.prepare(`DELETE FROM ${table} WHERE id = ?`).run(mapped.cloud_id);

      d.prepare('DELETE FROM synapse_map WHERE cloud_id = ?').run(mapped.cloud_id);

      return json({ removed: true });
    }

    // ── Dismiss rejected ──────────────────────────────────────
    const dismissMatch = path.match(/^\/api\/synapses\/(\d+)\/dismiss$/);
    if (dismissMatch && method === 'POST') {
      const id = parseInt(dismissMatch[1], 10);
      const source = params.get('source') || '';
      if (!id || !source) return err('Missing id or source', 400);
      const mapped = lookupLocalByDirection(source, id, ['push']);
      if (mapped) {
        removeMapping(mapped.cloud_id);
        return json({ dismissed: true });
      }
      return err('Not found in sync map', 404);
    }

    if (path === '/api/tool-stats' && method === 'GET') {
      const period = params.get('period') || undefined;
      const stats = getToolStats({ period });
      return json(stats);
    }

    return null;
  };
}
