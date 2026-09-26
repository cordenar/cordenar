#!/usr/bin/env node
// backfill-embeddings.js — set embedding for all cloud synapses owned by the active node
// Uses the verified set_synapse_embedding RPC. Idempotent (deterministic murmur3 embedder).

import { getNodeClient } from '../supabase.js';
import { getActiveNode } from '../auth.js';
import { createEmbedding, embeddingToString } from '../embedding.js';

async function backfill() {
  const node = getActiveNode();
  if (!node) {
    console.error('No active node. Run cordenar_auth first.');
    process.exit(1);
  }

  const supabase = getNodeClient(node);
  console.log(`Backfilling embeddings for account: ${node.account_id} (${node.account_name || node.node_id})`);

  let offset = 0;
  const batchSize = 500;
  let total = Infinity;
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let totalNodeRows = 0;

  while (offset < total) {
    const { data: raw, error: rpcErr } = await supabase.rpc('get_synapses', {
      p_account_id: node.account_id,
      p_cloud_status: null,
      p_limit: batchSize,
      p_offset: offset,
    });

    if (rpcErr) {
      console.error(`get_synapses RPC error: ${rpcErr.message}`);
      process.exit(1);
    }

    total = raw.total;
    const rows = (raw && typeof raw === 'object' && Array.isArray(raw.rows)) ? raw.rows : [];
    const nodeRows = rows.filter(r => r.source_node_id === node.node_id);
    totalNodeRows += nodeRows.length;

    for (const syn of nodeRows) {
      const content = (syn.content || syn.body || '');
      if (!content) {
        console.log(`  SKIP ${syn.id} — no content (type: ${syn.synapse_type})`);
        skipped++;
        continue;
      }

      const emb = embeddingToString(createEmbedding(content));
      const { data: result, error: embErr } = await supabase.rpc('set_synapse_embedding', {
        p_synapse_id: syn.id,
        p_embedding: emb,
      });

      if (embErr) {
        console.log(`  FAIL ${syn.id} — ${embErr.message}`);
        failed++;
        continue;
      }

      const resultObj = (result && typeof result === 'object') ? result : {};
      if (resultObj.ok === false) {
        console.log(`  SKIP ${syn.id} — ${resultObj.message || 'not owned by this node'}`);
        skipped++;
      } else {
        ok++;
      }
    }

    offset += batchSize;
  }

  console.log(`\nDone. ok=${ok} skipped=${skipped} failed=${failed} (${totalNodeRows} node-owned of ${total} total)`);
}

backfill().catch((e) => {
  console.error(e);
  process.exit(1);
});
