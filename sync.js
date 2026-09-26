// Cordenar — Sync logic
// Pull → synapses.db, Share → cloud from local tables,
// Sync → 3-phase across nodes, Retrieval → read from synapses.db
import { computeHash } from './hash.js';
import { createEmbedding, embeddingToString } from './embedding.js';
import { getNodeClient } from './supabase.js';
import { getNodes, getActiveNode, findNode } from './auth.js';
import {
  lookupLocalByDirection, lookupLocalByAccount, lookupCloud, storeMapping, getPushEntries, getDirtyEntries, removeMapping, softUnshareMapping, updateSynapseMapCloudStatus,
  insertMemorySynapse, updateMemorySynapseByCloudId, upsertMemoryFts, setMemoryVec,
  insertConceptSynapse, updateConceptSynapseByCloudId, upsertConceptFts, setConceptVec,
  getSynapseByCloudId, getTeamMemorySynapsesByIds,
  getConceptFamily, computeConceptFamily,
  listTeamMemorySynapses as listMemSyn, listTeamConceptSynapses as listConSyn,
  countSynapsesByAccount,
  getLocalActiveForAccount, markSynapsesRemoved,
  searchTeamMemoryHybrid, searchTeamConceptHybrid,
  searchLocalMemory, listLocalMemories,
  searchLocalConcepts, listLocalConcepts,
  initDb,
} from './db.js';

// ── Helpers ────────────────────────────────────────────────────

function normalizeSynapseRows(raw) {
  if (raw && typeof raw === 'object' && Array.isArray(raw.rows)) return raw.rows;
  return [];
}

function nowISO() {
  return new Date().toISOString();
}

export function toEpoch(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : Math.floor(new Date(v).getTime() / 1000);
  return Number.isFinite(n) ? n : 0;
}

// ── cordenar_list_accounts ─────────────────────────────────────

export async function listAccounts() {
  const supabase = getNodeClient();
  const { data, error } = await supabase.rpc('get_accounts');
  if (error) throw new Error(error.message);
  return (data || []).map(a => ({
    account_id: a.account_id,
    name: a.name,
    slug: a.slug,
    role: a.account_role,
    is_primary_owner: a.is_primary_owner,
  }));
}

// ── cordenar_pull ──────────────────────────────────────────────

export async function pullSynapses() {
  const nodes = getNodes();
  if (!nodes.length) throw new Error('No nodes registered. Run cordenar_auth first.');

  const results = [];

  for (const node of nodes) {
    if (node.status === 'needs_reauth') {
      results.push({ account_slug: node.account_slug, account_name: node.account_name, status: 'skipped', reason: 'needs_reauth' });
      continue;
    }

    let supabase;
    try {
      supabase = getNodeClient(node);
    } catch (e) {
      results.push({ account_slug: node.account_slug, account_name: node.account_name, status: 'error', message: e.message });
      continue;
    }

    try {
      let offset = 0;
      const batchSize = 500;
      let total = Infinity;
      const receivedIds = new Set();
      let batchError = null;

      while (offset < total) {
        const { data: raw, error: rpcErr } = await supabase.rpc('get_synapses', {
          p_account_id: node.account_id,
          p_cloud_status: null,
          p_limit: batchSize,
          p_offset: offset,
        });

        if (rpcErr) {
          batchError = rpcErr;
          break;
        }

        total = raw.total;
        const synapses = normalizeSynapseRows(raw);

        for (const syn of synapses) {
          receivedIds.add(syn.id);
          const existing = lookupCloud(syn.id);

          if (existing && existing.cloud_hash === syn.content_hash) {
            results.push({ cloud_id: syn.id, source: syn.synapse_type, account_id: syn.account_id, status: 'current' });
            updateSynapseMapCloudStatus(syn.id, syn.cloud_status);
            if ((syn.cloud_status === 'rejected' || syn.cloud_status === 'unshared') && existing.cloud_status !== 'pending_approval' && existing.direction === 'push') {
              softUnshareMapping(syn.id);
            }
            continue;
          }

          if (syn.cloud_status !== 'active') {
            if (existing) {
              if (existing.direction === 'push' && (syn.cloud_status === 'rejected' || syn.cloud_status === 'unshared')) {
                if (existing.cloud_status !== 'pending_approval') {
                  softUnshareMapping(existing.cloud_id);
                }
                results.push({ cloud_id: syn.id, source: syn.synapse_type, account_id: syn.account_id, status: 'unshared' });
              } else {
                if (syn.synapse_type === 'team_memory') {
                  updateMemorySynapseByCloudId(syn.id, { cloud_status: syn.cloud_status });
                } else {
                  updateConceptSynapseByCloudId(syn.id, { cloud_status: syn.cloud_status });
                }
                updateSynapseMapCloudStatus(syn.id, syn.cloud_status);
                results.push({ cloud_id: syn.id, source: syn.synapse_type, account_id: syn.account_id, status: 'updated_status', cloud_status: syn.cloud_status });
              }
            } else {
              results.push({ cloud_id: syn.id, source: syn.synapse_type, account_id: syn.account_id, status: 'skipped_not_active' });
            }
            continue;
          }

          if (syn.synapse_type === 'team_memory') {
            upsertMemoryLocally(syn, existing);
          } else if (syn.synapse_type === 'team_concept') {
            upsertConceptLocally(syn, existing);
          }
          updateSynapseMapCloudStatus(syn.id, syn.cloud_status);

          results.push({
            cloud_id: syn.id, source: syn.synapse_type, account_id: syn.account_id,
            status: existing ? 'updated' : 'pulled',
          });
        }

        offset += batchSize;
      }

      if (batchError) {
        results.push({ account_slug: node.account_slug, account_name: node.account_name, status: 'error', message: batchError.message });
        continue;
      }

      // Cleanup sweep: local active entries absent from cloud
      const localActives = getLocalActiveForAccount(node.account_id);
      const removedMem = [];
      const removedCon = [];
      for (const la of localActives) {
        if (!receivedIds.has(la.id)) {
          (la.source === 'memory' ? removedMem : removedCon).push(la.id);
        }
      }
      if (removedMem.length) markSynapsesRemoved(removedMem, 'memory');
      if (removedCon.length) markSynapsesRemoved(removedCon, 'concept');
      if (removedMem.length || removedCon.length) {
        results.push({
          account_slug: node.account_slug,
          account_name: node.account_name,
          status: 'cleanup',
          removed: removedMem.length + removedCon.length,
        });
      }
    } catch (e) {
      results.push({ account_slug: node.account_slug, account_name: node.account_name, status: 'error', message: e.message });
    }
  }

  const changed = results.filter(r => r.status !== 'current' && r.status !== 'error' && r.status !== 'skipped_not_active');
  return { pulled: changed.length, synapses: results };
}

function upsertMemoryLocally(syn, existing) {
  const content = syn.content || '';
  const metadataStr = typeof syn.metadata === 'string' ? syn.metadata : JSON.stringify(syn.metadata || {});
  const relatedIds = syn.related_ids || '';
  const now = nowISO();

  if (existing) {
    // UPDATE — keep row_id stable for synapse_map
    let localId = existing.local_id;
    if (existing.direction === 'push') {
      // This was a push entry repurposed — create a new pull row
      const rowId = insertMemorySynapse({
        id: syn.id,
        account_id: syn.account_id,
        source_node_id: syn.source_node_id,
        project: syn.project || '',
        kind: syn.kind || '',
        related_ids: relatedIds,
        status: syn.status || '',
        content,
        metadata: metadataStr,
        content_hash: syn.content_hash,
        cloud_status: syn.cloud_status || 'active',
        approved_by: syn.approved_by || null,
        approved_at: syn.approved_at || null,
        source_node_name: syn.source_node_name || null,
        source_user_email: syn.source_user_email || null,
        created_at: syn.created_at || now,
        updated_at: syn.updated_at || now,
      });
      localId = rowId;
      storeMapping({
        cloud_id: syn.id, source: 'memory', local_id: rowId,
        account_id: syn.account_id, local_hash: syn.content_hash,
        cloud_hash: syn.content_hash, direction: 'pull',
      });
    } else {
      updateMemorySynapseByCloudId(syn.id, {
        project: syn.project || '',
        kind: syn.kind || '',
        related_ids: relatedIds,
        status: syn.status || '',
        content,
        metadata: metadataStr,
        content_hash: syn.content_hash,
        cloud_status: syn.cloud_status || 'active',
        approved_by: syn.approved_by || null,
        approved_at: syn.approved_at || null,
        source_node_name: syn.source_node_name || null,
        source_user_email: syn.source_user_email || null,
        created_at: syn.created_at || now,
      });
    }
    upsertMemoryFts(localId, syn.project || '', syn.kind || '', syn.status || '', content);
  } else {
    const rowId = insertMemorySynapse({
      id: syn.id,
      account_id: syn.account_id,
      source_node_id: syn.source_node_id,
      project: syn.project || '',
      kind: syn.kind || '',
      related_ids: relatedIds,
      status: syn.status || '',
      content,
      metadata: metadataStr,
      content_hash: syn.content_hash,
      cloud_status: syn.cloud_status || 'active',
      approved_by: syn.approved_by || null,
      approved_at: syn.approved_at || null,
      source_node_name: syn.source_node_name || null,
      source_user_email: syn.source_user_email || null,
      created_at: syn.created_at || now,
      updated_at: syn.updated_at || now,
    });
    upsertMemoryFts(rowId, syn.project || '', syn.kind || '', syn.status || '', content);
    storeMapping({
      cloud_id: syn.id, source: 'memory', local_id: rowId,
      account_id: syn.account_id, local_hash: syn.content_hash,
      cloud_hash: syn.content_hash, direction: 'pull',
    });
  }

  const embedding = createEmbedding(content);
  const embBuf = Buffer.from(embedding.buffer);
  const synRow = getSynapseByCloudId(syn.id);
  if (synRow) setMemoryVec(synRow.row_id, embBuf);
}

function upsertConceptLocally(syn, existing) {
  const body = syn.body || syn.content || '';
  const frontmatterStr = typeof syn.frontmatter === 'string' ? syn.frontmatter : JSON.stringify(syn.frontmatter || {});
  const tagsStr = typeof syn.tags === 'string' ? syn.tags : JSON.stringify(Array.isArray(syn.tags) ? syn.tags : []);
  const now = nowISO();

  if (existing) {
    let localId = existing.local_id;
    if (existing.direction === 'push') {
      const rowId = insertConceptSynapse({
        id: syn.id,
        account_id: syn.account_id,
        source_node_id: syn.source_node_id,
        slug: syn.slug || '',
        collection: syn.collection || null,
        type: syn.type || 'reference',
        title: syn.title || '',
        description: syn.description || '',
        tags: tagsStr,
        status: syn.status || 'stable',
        frontmatter: frontmatterStr,
        body,
        body_length: body.length,
        content_hash: syn.content_hash,
        cloud_status: syn.cloud_status || 'active',
        approved_by: syn.approved_by || null,
        approved_at: syn.approved_at || null,
        source_node_name: syn.source_node_name || null,
        source_user_email: syn.source_user_email || null,
        created_at: syn.created_at || now,
        updated_at: syn.updated_at || now,
      });
      localId = rowId;
      storeMapping({
        cloud_id: syn.id, source: 'concept', local_id: rowId,
        account_id: syn.account_id, local_hash: syn.content_hash,
        cloud_hash: syn.content_hash, direction: 'pull',
      });
    } else {
      updateConceptSynapseByCloudId(syn.id, {
        slug: syn.slug || '',
        collection: syn.collection || null,
        type: syn.type || 'reference',
        title: syn.title || '',
        description: syn.description || '',
        tags: tagsStr,
        status: syn.status || 'stable',
        frontmatter: frontmatterStr,
        body,
        body_length: body.length,
        content_hash: syn.content_hash,
        cloud_status: syn.cloud_status || 'active',
        approved_by: syn.approved_by || null,
        approved_at: syn.approved_at || null,
        source_node_name: syn.source_node_name || null,
        source_user_email: syn.source_user_email || null,
        created_at: syn.created_at || now,
      });
    }
    upsertConceptFts(localId, syn.title || '', syn.description || '', tagsStr, body);
  } else {
    const rowId = insertConceptSynapse({
      id: syn.id,
      account_id: syn.account_id,
      source_node_id: syn.source_node_id,
      slug: syn.slug || '',
      collection: syn.collection || null,
      type: syn.type || 'reference',
      title: syn.title || '',
      description: syn.description || '',
      tags: tagsStr,
      status: syn.status || 'stable',
      frontmatter: frontmatterStr,
      body,
      body_length: body.length,
      content_hash: syn.content_hash,
      cloud_status: syn.cloud_status || 'active',
      approved_by: syn.approved_by || null,
      approved_at: syn.approved_at || null,
      source_node_name: syn.source_node_name || null,
      source_user_email: syn.source_user_email || null,
      created_at: syn.created_at || now,
      updated_at: syn.updated_at || now,
    });
    upsertConceptFts(rowId, syn.title || '', syn.description || '', tagsStr, body);
    storeMapping({
      cloud_id: syn.id, source: 'concept', local_id: rowId,
      account_id: syn.account_id, local_hash: syn.content_hash,
      cloud_hash: syn.content_hash, direction: 'pull',
    });
  }

  const embedding = createEmbedding(body);
  const embBuf = Buffer.from(embedding.buffer);
  const synRow = getSynapseByCloudId(syn.id);
  if (synRow) setConceptVec(synRow.row_id, embBuf);
}

// ── cordenar_share ─────────────────────────────────────────────

export async function shareSynapses({ synapses, account_slug } = {}) {
  const results = [];

  const node = account_slug ? findNode(account_slug) : getActiveNode();
  if (!node) {
    return { results: [{ status: 'error', message: account_slug ? `No node for: ${account_slug}` : 'No active node' }], family_total: 0, newly_shared: 0, already_shared: 0, errors: 1 };
  }
  const effectiveAccountId = node.account_id;
  const nodeId = node.node_id;

  let supabase;
  try {
    supabase = getNodeClient(node);
  } catch (e) {
    return { results: [{ status: 'error', message: e.message }], family_total: 0, newly_shared: 0, already_shared: 0, errors: 1 };
  }

  // c1: expand every requested concept to its FULL family (entire tree, always).
  // Memories do not expand (concepts vs memories separation). Dedupe within the request.
  const d0 = initDb();
  const work = [];
  const workSeen = new Set();
  const topSeen = new Set();
  let family_total = 0;

  for (const item of synapses) {
    const { source, id } = item;
    if (topSeen.has(`${source}:${id}`)) continue;
    topSeen.add(`${source}:${id}`);

    if (source === 'concept') {
      const concept = d0.prepare('SELECT collection, slug FROM concepts WHERE id = ?').get(id);
      if (!concept) { results.push({ source, id, status: 'not_found' }); continue; }
      const fam = getConceptFamily(concept.collection, concept.slug);
      family_total += fam.total;
      for (const m of fam.family) {
        const key = `concept:${m.id}`;
        if (workSeen.has(key)) continue;
        workSeen.add(key);
        work.push({ source: 'concept', id: m.id });
      }
    } else if (source === 'memory') {
      family_total += 1;
      const key = `memory:${id}`;
      if (workSeen.has(key)) continue;
      workSeen.add(key);
      work.push({ source: 'memory', id });
    } else {
      results.push({ source, id, status: 'error', message: `Unknown source: ${source}` });
    }
  }

  for (const { source, id } of work) {
    const existing = lookupLocalByAccount(source, id, effectiveAccountId);
    if (existing) {
      const tableName = source === 'memory' ? 'memory_synapses' : 'concept_synapses';
      const { data: checkRow } = await supabase.from(tableName)
        .select('id,cloud_status').eq('id', existing.cloud_id).maybeSingle();
      if (!checkRow) {
        removeMapping(existing.cloud_id);
      } else {
        if (checkRow.cloud_status === 'pending_unshare') {
          const { error: updErr } = await supabase.from(tableName)
            .update({ cloud_status: 'pending_approval' })
            .eq('id', existing.cloud_id);
          if (!updErr) {
            updateSynapseMapCloudStatus(existing.cloud_id, 'pending_approval');
            results.push({ source, id, status: 'shared', cloud_id: existing.cloud_id, detail: 'Unshare cancelled' });
          } else {
            results.push({ source, id, status: 'error', message: updErr.message });
          }
          continue;
        }
        results.push({ source, id, status: 'already_shared', cloud_id: existing.cloud_id });
        continue;
      }
    }

    let content, hash, tableName, row;

    if (source === 'memory') {
      const d = initDb();
      row = d.prepare(
        'SELECT project, kind, related_ids, status, content, metadata FROM memories WHERE id = ?'
      ).get(id);
      if (!row) { results.push({ source, id, status: 'not_found' }); continue; }
      content = row.content || '';
      hash = computeHash(content);
      tableName = 'memory_synapses';

      // Translate local IDs in related_ids to cloud UUIDs via synapse_map
      const localRelatedIds = (row.related_ids || '').split(',').map(Number).filter(Boolean);
      const translatedIds = [];
      if (localRelatedIds.length > 0) {
        const d3 = initDb();
        for (const localId of localRelatedIds) {
          const mapping = d3.prepare(
            "SELECT cloud_id FROM synapse_map WHERE source = 'memory' AND local_id = ? AND direction = 'push'"
          ).get(localId);
          if (mapping && mapping.cloud_id) translatedIds.push(mapping.cloud_id);
        }
      }
      const cloudRelatedIds = translatedIds.join(',');

      const { data: synapse, error: sErr } = await supabase.from(tableName).insert({
        account_id: effectiveAccountId,
        source_node_id: nodeId,
        project: row.project,
        kind: row.kind,
        related_ids: cloudRelatedIds,
        status: row.status,
        content: row.content,
        metadata: row.metadata,
        content_hash: hash,
        embedding: embeddingToString(createEmbedding(content)),
        cloud_status: 'pending_approval',
      }).select('id').single();

      if (sErr) {
        if (sErr.code === '23505') {
          results.push({ source, id, status: 'duplicate', detail: 'Content already shared to this account' });
          continue;
        }
        results.push({ source, id, status: 'error', message: sErr.message });
        continue;
      }

      storeMapping({ cloud_id: synapse.id, source, local_id: id, account_id: effectiveAccountId, local_hash: hash, cloud_hash: hash, direction: 'push', cloud_status: 'pending_approval' });
      results.push({ source, id, status: 'shared', cloud_id: synapse.id });

    } else if (source === 'concept') {
      const d = initDb();
      row = d.prepare(
        'SELECT slug, collection, type, title, description, tags, status, frontmatter, body, body_length FROM concepts WHERE id = ?'
      ).get(id);
      if (!row) { results.push({ source, id, status: 'not_found' }); continue; }
      content = row.body || '';
      hash = computeHash(content);
      tableName = 'concept_synapses';

      const { data: synapse, error: sErr } = await supabase.from(tableName).insert({
        account_id: effectiveAccountId,
        source_node_id: nodeId,
        slug: row.slug,
        collection: row.collection,
        type: row.type,
        title: row.title,
        description: row.description,
        tags: row.tags,
        status: row.status,
        frontmatter: row.frontmatter,
        body: row.body,
        body_length: row.body_length,
        content_hash: hash,
        embedding: embeddingToString(createEmbedding(content)),
        cloud_status: 'pending_approval',
      }).select('id').single();

      if (sErr) {
        if (sErr.code === '23505') {
          results.push({ source, id, status: 'duplicate', detail: 'Content already shared to this account' });
          continue;
        }
        results.push({ source, id, status: 'error', message: sErr.message });
        continue;
      }

      storeMapping({ cloud_id: synapse.id, source, local_id: id, account_id: effectiveAccountId, local_hash: hash, cloud_hash: hash, direction: 'push', cloud_status: 'pending_approval' });
      results.push({ source, id, status: 'shared', cloud_id: synapse.id });

    }
  }

  const newly_shared = results.filter(r => r.status === 'shared').length;
  const already_shared = results.filter(r => r.status === 'already_shared').length;
  const errors = results.filter(r => r.status === 'error' || r.status === 'not_found').length;
  return { results, family_total, newly_shared, already_shared, errors };
}

// ── cordenar_sync ──────────────────────────────────────────────

export async function unshareSynapse(source, localId) {
  const node = getActiveNode();
  if (!node) throw new Error('No active node. Run cordenar_auth first.');
  const supabase = getNodeClient(node);

  // c1: unshare = entire tree. Concepts expand to their full family; memories stay single.
  // Single-account by design (a full tree is inherently one account) — no per-item routing.
  const targets = [];
  if (source === 'concept') {
    const d = initDb();
    const concept = d.prepare('SELECT collection, slug FROM concepts WHERE id = ?').get(localId);
    if (!concept) throw new Error(`Concept not found: ${localId}`);
    const fam = getConceptFamily(concept.collection, concept.slug);
    for (const m of fam.family) targets.push({ source: 'concept', localId: m.id, slug: m.slug });
  } else {
    targets.push({ source, localId, slug: null });
  }

  const results = [];
  let errors = 0;
  for (const t of targets) {
    const mapped = lookupLocalByDirection(t.source, t.localId, ['push']);
    if (!mapped) {
      results.push({ source: t.source, id: t.localId, slug: t.slug, status: 'skipped' });
      continue;
    }
    const { data, error } = await supabase.rpc('request_unshare', { p_synapse_id: mapped.cloud_id });
    if (error) { results.push({ source: t.source, id: t.localId, slug: t.slug, status: 'error', message: error.message }); errors++; continue; }
    if (data && data.ok === false) { results.push({ source: t.source, id: t.localId, slug: t.slug, status: 'error', message: data.message || 'Unshare request denied' }); errors++; continue; }
    updateSynapseMapCloudStatus(mapped.cloud_id, 'pending_unshare');
    results.push({ source: t.source, id: t.localId, slug: t.slug, status: 'pending_unshare', cloud_id: mapped.cloud_id });
  }
  const requested = results.filter(r => r.status === 'pending_unshare').length;
  return { results, total: targets.length, requested, errors };
}

export async function fullSync() {
  const result = { pushed: 0, unlinked: 0, pulled: 0, nodes: [] };
  const nodes = getNodes();

  for (const node of nodes) {
    const nodeResult = { account_slug: node.account_slug, pushed: 0, unlinked: 0, error: null };

    if (node.status === 'needs_reauth') {
      nodeResult.error = 'needs_reauth';
      result.nodes.push(nodeResult);
      continue;
    }

    let supabase;
    try {
      supabase = getNodeClient(node);
    } catch (e) {
      nodeResult.error = e.message;
      result.nodes.push(nodeResult);
      continue;
    }

    // Phase A: Push dirty entries for this node's account
    try {
      const dirty = getDirtyEntries();
      for (const entry of dirty) {
        if (entry.account_id !== node.account_id) continue;

        let content, tableName, insertPayload;
        if (entry.source === 'memory') {
          const d = initDb();
          const mem = d.prepare(
            'SELECT project, kind, related_ids, status, content, metadata FROM memories WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL'
          ).get(entry.local_id);
          if (!mem) { result.unlinked++; nodeResult.unlinked++; continue; }
          content = mem.content;
          tableName = 'memory_synapses';
          const localRelIds = (mem.related_ids || '').split(',').map(Number).filter(Boolean);
          const transRelIds = [];
          if (localRelIds.length > 0) {
            const dRel = initDb();
            for (const lid of localRelIds) {
              const map = dRel.prepare("SELECT cloud_id FROM synapse_map WHERE source = 'memory' AND local_id = ? AND direction = 'push'").get(lid);
              if (map && map.cloud_id) transRelIds.push(map.cloud_id);
            }
          }
          insertPayload = {
            account_id: entry.account_id, source_node_id: node.node_id,
            project: mem.project, kind: mem.kind, related_ids: transRelIds.join(','),
            status: mem.status, content: mem.content, metadata: mem.metadata,
            content_hash: computeHash(content || ''),
            cloud_status: 'pending_approval',
          };
        } else if (entry.source === 'concept') {
          const d = initDb();
          const concept = d.prepare(
            'SELECT slug, collection, type, title, description, tags, status, frontmatter, body, body_length FROM concepts WHERE id = ?'
          ).get(entry.local_id);
          if (!concept) { result.unlinked++; nodeResult.unlinked++; continue; }
          content = concept.body;
          tableName = 'concept_synapses';
          insertPayload = {
            account_id: entry.account_id, source_node_id: node.node_id,
            slug: concept.slug, collection: concept.collection, type: concept.type, title: concept.title,
            description: concept.description, tags: concept.tags,
            status: concept.status, frontmatter: concept.frontmatter,
            body: concept.body, body_length: concept.body_length,
            content_hash: computeHash(content || ''),
            cloud_status: 'pending_approval',
          };
        } else continue;

        const newHash = computeHash(content || '');
        if (newHash === entry.cloud_hash) continue;

        const { data: synapse, error: sErr } = await supabase.from(tableName)
          .insert(insertPayload)
          .select('id').single();

        if (sErr) {
          if (sErr.code === '23505') continue;
          console.error('[cordenar] push insert failed:', sErr.message || sErr.code, 'source:', entry.source, 'id:', entry.local_id);
          continue;
        }

        storeMapping({
          cloud_id: synapse.id, source: entry.source, local_id: entry.local_id,
          account_id: entry.account_id, local_hash: newHash, cloud_hash: newHash,
          direction: 'push', cloud_status: 'pending_approval',
        });

        result.pushed++;
        nodeResult.pushed++;
      }

      // Phase B: Detect and unlink locally-deleted shared synapses
      const allPush = getPushEntries();
      for (const entry of allPush) {
        if (entry.account_id !== node.account_id) continue;
        let exists = true;
        const d = initDb();
        if (entry.source === 'memory') {
          const mem = d.prepare('SELECT 1 FROM memories WHERE id = ? AND deleted_at IS NULL').get(entry.local_id);
          exists = !!mem;
        } else if (entry.source === 'concept') {
          const concept = d.prepare('SELECT 1 FROM concepts WHERE id = ?').get(entry.local_id);
          exists = !!concept;
        }
        if (!exists) {
          removeMapping(entry.cloud_id);
          result.unlinked++;
          nodeResult.unlinked++;
        }
      }

      // Phase C: Detect and re-push orphaned entries (cloud rows cascade-deleted)
      if (allPush.length > 0) {
        const memIds = allPush.filter(e => e.source === 'memory' && e.account_id === node.account_id).map(e => e.cloud_id);
        const conIds = allPush.filter(e => e.source === 'concept' && e.account_id === node.account_id).map(e => e.cloud_id);

        const staleIds = new Set();
        if (memIds.length > 0) {
          const { data: memRows } = await supabase.from('memory_synapses').select('id').in('id', memIds);
          const found = new Set((memRows || []).map(r => r.id));
          memIds.forEach(id => { if (!found.has(id)) staleIds.add(id); });
        }
        if (conIds.length > 0) {
          const { data: conRows } = await supabase.from('concept_synapses').select('id').in('id', conIds);
          const found = new Set((conRows || []).map(r => r.id));
          conIds.forEach(id => { if (!found.has(id)) staleIds.add(id); });
        }

        for (const entry of allPush) {
          if (!staleIds.has(entry.cloud_id) || entry.account_id !== node.account_id) continue;
          removeMapping(entry.cloud_id);

          let content, tableName, insertPayload;
          const d2 = initDb();
          if (entry.source === 'memory') {
            const mem = d2.prepare(
        'SELECT project, kind, related_ids, status, content, metadata FROM memories WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL'
            ).get(entry.local_id);
            if (!mem) continue;
            content = mem.content;
            tableName = 'memory_synapses';
            const localRIds = (mem.related_ids || '').split(',').map(Number).filter(Boolean);
            const transRIds = [];
            if (localRIds.length > 0) {
              const dRel2 = initDb();
              for (const lid of localRIds) {
                const map = dRel2.prepare("SELECT cloud_id FROM synapse_map WHERE source = 'memory' AND local_id = ? AND direction = 'push'").get(lid);
                if (map && map.cloud_id) transRIds.push(map.cloud_id);
              }
            }
            insertPayload = {
              account_id: entry.account_id, source_node_id: node.node_id,
              project: mem.project, kind: mem.kind, related_ids: transRIds.join(','),
              status: mem.status, content: mem.content, metadata: mem.metadata,
              content_hash: computeHash(content || ''),
              embedding: embeddingToString(createEmbedding(content)),
              cloud_status: 'pending_approval',
            };
          } else {
            const concept = d2.prepare(
              'SELECT slug, collection, type, title, description, tags, status, frontmatter, body, body_length FROM concepts WHERE id = ?'
            ).get(entry.local_id);
            if (!concept) continue;
            content = concept.body;
            tableName = 'concept_synapses';
            insertPayload = {
              account_id: entry.account_id, source_node_id: node.node_id,
              slug: concept.slug, collection: concept.collection, type: concept.type, title: concept.title,
              description: concept.description, tags: concept.tags,
              status: concept.status, frontmatter: concept.frontmatter,
              body: concept.body, body_length: concept.body_length,
              content_hash: computeHash(content || ''),
              embedding: embeddingToString(createEmbedding(content)),
              cloud_status: 'pending_approval',
            };
          }

          const { data: row, error } = await supabase.from(tableName)
            .insert(insertPayload).select('id').single();
          if (error) continue;
          storeMapping({
            cloud_id: row.id, source: entry.source, local_id: entry.local_id,
            account_id: entry.account_id, local_hash: insertPayload.content_hash,
            cloud_hash: insertPayload.content_hash, direction: 'push',
          });
          result.pushed++;
          nodeResult.pushed++;
        }
      }
    } catch (e) {
      nodeResult.error = e.message;
    }

    result.nodes.push(nodeResult);
  }

  // Phase C: Pull (delegates to pullSynapses — iterates all nodes internally)
  try {
    const pullResult = await pullSynapses();
    result.pulled = pullResult.pulled;
  } catch (e) {
    console.error('[cordenar] pull failed during fullSync:', e.message);
  }

  return result;
}

// ── cordenar_memory_search ─────────────────────────────────────

export function memorySearch(args) {
  const { cloud_status, scope = 'all', limit = 10, offset = 0 } = args;
  const localParams = (({ cloud_status, ...rest }) => rest)(args);
  if (scope === 'local') {
    const r = searchLocalMemory(localParams);
    return { params: args, ...r };
  }
  if (scope === 'team') {
    const result = searchTeamMemoryHybrid(args);
    return { params: args, rows: result.rows || [], total: result.total };
  }
  const bigLimit = (offset + limit) * 2;
  const local = searchLocalMemory({ ...localParams, limit: bigLimit, offset: 0 });
  const team = searchTeamMemoryHybrid({ ...args, limit: bigLimit, offset: 0 });
  return { params: args, ...mergeMemory(local, team, offset, limit) };
}

// ── cordenar_concept_search ────────────────────────────────────

export function conceptSearch(args) {
  const { cloud_status, scope = 'all', limit = 10, offset = 0, collection } = args;
  const localParams = (({ cloud_status, ...rest }) => rest)(args);
  if (collection || scope === 'local') {
    const r = searchLocalConcepts(localParams);
    return { params: args, rows: r.rows, total: r.total };
  }
  if (scope === 'team') {
    const result = searchTeamConceptHybrid({ query: args.query, type: args.type, tags: args.tags, cloud_status, collection, limit, offset, alpha: args.alpha });
    return { params: args, rows: result.rows || [], total: result.total };
  }
  const bigLimit = (offset + limit) * 2;
  const local = searchLocalConcepts({ ...localParams, limit: bigLimit, offset: 0 });
  const team = searchTeamConceptHybrid({ query: args.query, type: args.type, tags: args.tags, cloud_status, collection, limit: bigLimit, offset: 0, alpha: args.alpha });
  return { params: args, ...mergeConcepts(local, team, offset, limit) };
}

// ── cordenar_memory_list ───────────────────────────────────────

export function memoryList({ project, kind, cloud_status, scope = 'all', limit = 50 } = {}) {
  if (scope === 'local') return listLocalMemories({ project, kind, limit });
  if (scope === 'team') {
    const t = listMemSyn({ project, kind, cloud_status, limit });
    return { rows: t.rows.map(m => ({ ...m, created_at: toEpoch(m.created_at), updated_at: toEpoch(m.updated_at) })), total: t.total };
  }
  const local = listLocalMemories({ project: project || undefined, kind, limit: limit * 2 });
  const team = project ? listMemSyn({ project, kind, cloud_status, limit: limit * 2 }) : { rows: [] };
  const rows = [
    ...local.rows.map(m => ({ ...m, scope: 'local' })),
    ...team.rows.map(m => ({ ...m, scope: 'team', created_at: toEpoch(m.created_at), updated_at: toEpoch(m.updated_at) })),
  ].sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0));
  return { rows: rows.slice(0, limit), total: rows.length };
}

// ── cordenar_concept_list ──────────────────────────────────────

export function conceptList({ collection, type, tags, cloud_status, scope = 'all', limit = 50 } = {}) {
  if (scope === 'local') return listLocalConcepts({ collection, type, tags, limit });
  if (scope === 'team') {
    const t = listConSyn({ collection, type, tags, cloud_status, limit });
    return { rows: t.rows.map(c => ({ ...c, created_at: toEpoch(c.created_at), updated_at: toEpoch(c.updated_at) })), total: t.total };
  }
  const local = listLocalConcepts({ collection, type, tags, limit: limit * 2 });
  const team = listConSyn({ collection, type, tags, cloud_status, limit: limit * 2 });
  const rows = [
    ...local.rows.map(c => ({ ...c, scope: 'local' })),
    ...team.rows.map(c => ({ ...c, scope: 'team', created_at: toEpoch(c.created_at), updated_at: toEpoch(c.updated_at) })),
  ].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  return { rows: rows.slice(0, limit), total: rows.length };
}

// ── cordenar_memory_context ────────────────────────────────────

export function memoryContext({ query, project, scope = 'all', limit = 10 } = {}) {
  if (scope === 'local') {
    const results = searchLocalMemory({ query, project, limit, alpha: 0.3 });
    if (!results.rows.length) return 'No matching local memories.';
    return results.rows.map((r, i) =>
      `[${i + 1}] [local] (${r.kind}) ${(r.content || '').substring(0, 500)}${(r.content || '').length > 500 ? '...' : ''}`
    ).join('\n\n');
  }
  if (scope === 'team') {
    const results = searchTeamMemoryHybrid({ query, project, cloud_status: 'active', limit, alpha: 0.3 });
    if (!results.rows.length) return 'No matching team memories.';
    return results.rows.map((r, i) =>
      `[${i + 1}] [team] (${r.kind}) ${(r.content || '').substring(0, 500)}${(r.content || '').length > 500 ? '...' : ''}`
    ).join('\n\n');
  }
  const local = searchLocalMemory({ query, project, limit, alpha: 0.3 });
  const team = searchTeamMemoryHybrid({ query, project, cloud_status: 'active', limit, alpha: 0.3 });
  const merged = [];
  local.rows.forEach(r => merged.push({ kind: r.kind, content: r.content, score: r.score, scope: 'local' }));
  team.rows.forEach(r => merged.push({ kind: r.kind, content: r.content, score: r.score, scope: 'team' }));
  merged.sort((a, b) => b.score - a.score);
  if (!merged.length) return 'No matching memories.';
  return merged.slice(0, limit).map((r, i) =>
    `[${i + 1}] [${r.scope}] (${r.kind}) ${r.content.substring(0, 500)}${r.content.length > 500 ? '...' : ''}`
  ).join('\n\n');
}

// ── cordenar_concept_search_context ────────────────────────────

export function conceptSearchContext({ query, collection, scope = 'all', limit = 10 } = {}) {
  if (collection || scope === 'local') {
    const results = searchLocalConcepts({ query, collection, limit, alpha: 0.3 });
    if (!results.rows.length) return 'No matching local concepts.';
    return results.rows.map((r, i) =>
      `[${i + 1}] [local] (${r.type}: ${r.collection}/${r.slug}) ${r.title || ''}\n${r.snippet || ''}`
    ).join('\n\n');
  }
  if (scope === 'team') {
    const results = searchTeamConceptHybrid({ query, collection, cloud_status: 'active', limit, alpha: 0.3 });
    if (!results.rows.length) return 'No matching team concepts.';
    return results.rows.map((r, i) =>
      `[${i + 1}] [team] (${r.type}: ${r.collection ? r.collection + '/' + r.slug : r.slug}) ${r.title || ''}\n${r.body ? r.body.substring(0, 500) : ''}${(r.body || '').length > 500 ? '...' : ''}`
    ).join('\n\n');
  }
  const local = searchLocalConcepts({ query, limit, alpha: 0.3 });
  const team = searchTeamConceptHybrid({ query, collection, cloud_status: 'active', limit, alpha: 0.3 });
  const merged = [];
  local.rows.forEach(r => merged.push({ collection: r.collection, type: r.type, slug: r.slug, title: r.title, snippet: r.snippet || '', score: r.score, scope: 'local' }));
  team.rows.forEach(r => merged.push({ collection: r.collection || null, type: r.type, slug: r.slug, title: r.title, snippet: r.body ? r.body.substring(0, 200) : '', score: r.score, scope: 'team' }));
  merged.sort((a, b) => b.score - a.score);
  if (!merged.length) return 'No matching concepts.';
  return merged.slice(0, limit).map((r, i) =>
    `[${i + 1}] [${r.scope}] (${r.type}: ${r.collection ? r.collection + '/' + r.slug : r.slug}) ${r.title || ''}\n${r.snippet || ''}`
  ).join('\n\n');
}

// ── merge helpers ──────────────────────────────────────────────

function mergeMemory(local, team, offset, limit) {
  const merged = [];
  local.rows.forEach(r => {
    merged.push({
      _local_id: r.id, id: String(r.id), scope: 'local',
      project: r.project, kind: r.kind, content: r.content,
      status: r.status, metadata: r.metadata, score: r.score,
      related_ids: r.related_ids, created_at: r.created_at, updated_at: r.updated_at,
      account_id: null, source_node_id: null, cloud_status: null,
    });
  });
  team.rows.forEach(r => {
    merged.push({
      _local_id: r.row_id, id: r.id, scope: 'team',
      project: r.project, kind: r.kind, content: r.content,
      status: r.status, metadata: r.metadata, score: r.score,
      account_id: r.account_id, source_node_id: r.source_node_id,
      cloud_status: r.cloud_status, created_at: r.created_at, updated_at: r.updated_at,
    });
  });
  merged.sort((a, b) => b.score - a.score);
  const total = merged.length;
  return { rows: merged.slice(offset, offset + limit), total };
}

function mergeConcepts(local, team, offset, limit) {
  const merged = [];
  local.rows.forEach(r => {
    merged.push({
      id: `local:${r.id}`, local_id: r.id, scope: 'local',
      collection: r.collection || null,
      slug: r.slug, type: r.type, title: r.title, description: r.description,
      tags: r.tags, status: r.status, body_length: r.body_length, score: r.score,
      snippet: r.snippet || '', account_id: null, cloud_status: null,
      created_at: r.created_at || null, updated_at: r.updated_at || null,
    });
  });
  team.rows.forEach(r => {
    merged.push({
      id: r.id, local_id: r.row_id, scope: 'team',
      collection: r.collection || null,
      slug: r.slug, type: r.type, title: r.title, description: r.description,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags || '[]') : (r.tags || []),
      status: r.status, body_length: r.body_length, score: r.score,
      snippet: r.body ? r.body.substring(0, 200) : '',
      account_id: r.account_id, cloud_status: r.cloud_status,
      created_at: r.created_at, updated_at: r.updated_at,
    });
  });
  merged.sort((a, b) => b.score - a.score);
  const total = merged.length;
  return { rows: merged.slice(offset, offset + limit), total };
}

// ── cordenar_get ───────────────────────────────────────────────

export function getSynapse(synapseId) {
  const syn = getSynapseByCloudId(synapseId);
  if (!syn) throw new Error(`Synapse not found: ${synapseId}`);
  return syn;
}

// ── cordenar_related ───────────────────────────────────────────

export function getRelated(synapseId) {
  const syn = getSynapseByCloudId(synapseId);
  if (!syn) throw new Error(`Synapse not found: ${synapseId}`);

  const related = [];

  if (syn.synapse_type === 'team_memory') {
    const ids = (syn.related_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length) {
      const rows = getTeamMemorySynapsesByIds(ids);
      for (const r of rows) {
        if (r.id !== synapseId) related.push(r);
      }
    }
  }

  if (syn.synapse_type === 'team_concept' && syn.slug) {
    const fam = computeConceptFamily({
      table: 'concept_synapses',
      cols: '*',
      collection: syn.collection,
      slug: syn.slug,
    });
    for (const r of fam.family) {
      if (r.id !== synapseId) related.push({ ...r, synapse_type: 'team_concept' });
    }
  }

  return { synapse: syn, related };
}

// ── cordenar_status helpers ────────────────────────────────────

export function getSynapseCounts() {
  const d = initDb();
  const localMem = d.prepare('SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL AND archived_at IS NULL').get().c;
  const localCon = d.prepare('SELECT COUNT(*) as c FROM concepts').get().c;
  const teamCounts = countSynapsesByAccount();
  teamCounts._local = { mem: localMem, con: localCon };
  return teamCounts;
}

// ── cordenar_list (dashboard: list shareable local content) ──

export function listSynapses({ source, type, project, collection, limit = 50 } = {}) {
  const results = [];
  let total = 0;
  const d = initDb();

  if (!collection && (!source || source === 'memory')) {
    const memWhere = project ? 'WHERE project = ?' : '';
    const memAnd = type && project ? 'AND kind = ?' : (type ? 'WHERE kind = ?' : '');
    const memCountParams = [project, type].filter((v) => v !== undefined && v !== null && v !== '');
    total += (d.prepare(
      `SELECT COUNT(*) as c FROM memory_synapses ${memWhere} ${memAnd}`
    ).get(...memCountParams) || {}).c || 0;

    const memories = d
      .prepare(
        `SELECT row_id as id, project, kind, status, content, substr(content, 1, 200) as preview, related_ids, created_at
         FROM memory_synapses
         ${memWhere} ${memAnd}
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(
        ...[project, type, limit].filter((v) => v !== undefined && v !== null && v !== '')
      );
    for (const m of memories) {
      results.push({
        source: 'memory',
        id: m.id,
        type: m.kind,
        project: m.project,
        status: m.status,
        preview: m.preview,
        content: m.content,
        related_ids: m.related_ids ? m.related_ids.split(',').map(Number).filter(Boolean) : [],
        created_at: m.created_at,
      });
    }
  }

  if (!source || source === 'concept') {
    const conClauses = [];
    const conParams = [];
    if (type) { conClauses.push('type = ?'); conParams.push(type); }
    if (collection) { conClauses.push('collection = ?'); conParams.push(collection); }
    const conWhere = conClauses.length ? 'WHERE ' + conClauses.join(' AND ') : '';
    total += (d.prepare(
      `SELECT COUNT(*) as c FROM concept_synapses ${conWhere}`
    ).get(...conParams) || {}).c || 0;

    const concepts = d
      .prepare(
        `SELECT row_id as id, slug, collection, type, title, status, description,
                substr(body, 1, 200) as preview, body, created_at
         FROM concept_synapses
         ${conWhere}
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(...conParams, limit);
    for (const c of concepts) {
      results.push({
        source: 'concept',
        id: c.id,
        type: c.type,
        slug: c.slug,
        collection: c.collection,
        title: c.title,
        description: c.description,
        preview: c.preview,
        body: c.body,
        status: c.status,
        created_at: c.created_at,
      });
    }
  }

  return { rows: results.sort((a, b) => toEpoch(b.created_at) - toEpoch(a.created_at)), total };
}

// ── cordenar_get ───────────────────────────────────────────────
