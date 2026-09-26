import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import http from 'node:http';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveAuth, clearAuth, getNodes, getActiveNode, removeNode, switchActiveNode } from './auth.js';
import { initDb, doBackup, storeMemory, getMemoryById, updateMemory, trashMemory, restoreMemory, deleteMemoryPermanent, archiveMemory, unarchiveMemory, reassignMemories, listProjects, countProject, trashProject, deleteProject, getBrief, indexConcepts, deindexConcepts, getConceptBySlug, getConceptFamily, getConceptContext, getToolStats } from './db.js';
import { getConfig, getDbPath } from './config.js';
import {
  initTelemetry,
  getTracer,
  forceFlushTelemetry,
  SpanKind,
  SpanStatusCode,
} from './otel.js';
import {
  pullSynapses, shareSynapses, unshareSynapse, fullSync, listAccounts,
  memorySearch, conceptSearch, memoryList, conceptList,
  memoryContext, conceptSearchContext, getSynapse, getRelated,
  getSynapseCounts,
} from './sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
const VERSION = pkg.version;

const CORDENAR_INSTRUCTIONS = readFileSync(join(__dirname, 'CORDENAR.md'), 'utf-8');

const DASH_PORT = getConfig().port;

const db = initDb();
initTelemetry(db, VERSION);

const backupTimer = setInterval(function () { try { doBackup(); } catch {} }, 3600000);

function notifyDash(event, data) {
  const body = JSON.stringify({ event, ...data });
  const req = http.request(
    `http://127.0.0.1:${DASH_PORT}/api/notify`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }
  );
  req.on('error', (e) => { console.error('notifyDash failed:', e.message); });
  req.write(body);
  req.end();
}

function deriveCapabilities(role) {
  const base = ['list', 'status', 'pull'];
  switch (role) {
    case 'owner':
    case 'admin':
      return [...base, 'share', 'approve', 'reject', 'manage_members', 'manage_nodes'];
    case 'member':
      return [...base, 'share'];
    default:
      return base;
  }
}

process.on('uncaughtException', async (err) => {
  console.error(`[cordenar] Uncaught: ${err.message}`);
  await forceFlushTelemetry();
  try { db.close(); } catch {}
  process.exit(1);
});
process.on('unhandledRejection', async (reason) => {
  console.error(`[cordenar] Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  await forceFlushTelemetry();
  try { db.close(); } catch {}
  process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error('[cordenar] shutting down (' + signal + ')');
  clearInterval(backupTimer);
  try { await forceFlushTelemetry(); } catch {}
  try { db.close(); } catch {}
  console.error('[cordenar] shutdown complete');
  const forceTimer = setTimeout(() => { console.error('[cordenar] forced exit'); process.exit(1); }, 10000);
  forceTimer.unref();
  process.exit(0);
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

export function createCordenarServer() {
  const server = new McpServer({ name: 'Cordenar', version: VERSION });

  function withTelemetry(toolName, handler) {
    return async (args, ctx) => {
      if (shuttingDown) return { content: [{ type: 'text', text: 'Server shutting down' }], isError: true };
      const span = getTracer().startSpan(toolName, { kind: SpanKind.SERVER });
      try {
        return await handler(args, ctx);
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.setAttribute('error.type', err.name || 'Error');
        const msg = err.message || 'Internal error';
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      } finally {
        span.end();
      }
    };
  }

  // ── Auth ───────────────────────────────────────────────────────────

server.registerTool('auth', {
  description: 'Authenticate this node with Cordenar cloud using a client secret, switch active account with account_slug, or list node status when called with no params.',
  inputSchema: z.object({
    client_secret: z.string().optional(),
    account_slug: z.string().optional(),
  }),
}, withTelemetry('auth', async ({ client_secret, account_slug }) => {
  if (!client_secret && !account_slug) {
    const nodes = getNodes();
    const active = getActiveNode();
    return {
      content: [{ type: 'text', text: JSON.stringify({
        nodes: nodes.map(n => ({
          node_id: n.node_id, name: n.name, account_name: n.account_name,
          account_slug: n.account_slug, account_role: n.account_role,
          active: active && n.node_id === active.node_id, status: n.status || null,
        })),
        active_account_slug: active?.account_slug || null,
      }, null, 2) }],
    };
  }

  if (account_slug && !client_secret) {
    const ok = switchActiveNode(account_slug);
    if (!ok) throw new Error(`No node found for account_slug: ${account_slug}`);
    const node = getActiveNode();
    return {
      content: [{ type: 'text', text: JSON.stringify({
        switched: true, node: node.name, node_id: node.node_id,
        account_name: node.account_name, account_slug: node.account_slug,
      }, null, 2) }],
    };
  }

  if (!client_secret) throw new Error('client_secret is required');

  const cloudUrl = getConfig().cloudUrl;
  const clientId = `${os.hostname()}-${os.userInfo().username}`;

  const authRes = await fetch(`${cloudUrl}/api/auth/node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_secret, client_id: clientId }),
  });

  if (!authRes.ok) {
    const body = await authRes.json().catch(() => ({}));
    throw new Error(body.error || `Auth failed with status ${authRes.status}`);
  }

  const data = await authRes.json();
  let userId = null;
  try {
    const parts = data.access_token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    userId = payload.sub || null;
  } catch {}

  saveAuth({
    node_id: data.node_id, access_token: data.access_token,
    account_id: data.account_id, name: data.name,
    account_name: null, account_slug: null,
    user_id: userId, account_role: null,
    is_primary_owner: false, accounts: [], capabilities: ['list', 'status'],
  });

  let accountName = null, accountSlug = null, accountRole = null;
  let isPrimaryOwner = false;
  let allAccounts = [];
  let capabilities = ['list', 'status'];

  try {
    allAccounts = await listAccounts();
    const acct = allAccounts.find(a => a.account_id === data.account_id);
    if (acct) {
      accountName = acct.name;
      accountSlug = acct.slug;
      accountRole = acct.role;
      isPrimaryOwner = acct.is_primary_owner;
      capabilities = deriveCapabilities(acct.role);
    }
  } catch (e) {
    console.error(`[cordenar] Account enrichment failed: ${e.message}`);
  }

  saveAuth({
    node_id: data.node_id, access_token: data.access_token,
    account_id: data.account_id, name: data.name,
    account_name: accountName, account_slug: accountSlug,
    user_id: userId, account_role: accountRole,
    is_primary_owner: isPrimaryOwner, accounts: allAccounts, capabilities,
  });

  const roleLabel = accountRole ? ` (${accountRole})` : '';
  const teamLabel = accountName ? ` in ${accountName}` : '';
  console.error(`[cordenar] Node ${data.name} authenticated as ${userId}${roleLabel}${teamLabel}`);

  return {
    content: [{ type: 'text', text: JSON.stringify({
      authenticated: true, node: data.name, node_id: data.node_id,
      account_id: data.account_id, account_name: accountName,
      account_slug: accountSlug, user_id: userId,
      account_role: accountRole, capabilities,
      message: `Node ${data.name} authenticated.`,
    }, null, 2) }],
  };
}));

server.registerTool('deauth', {
  description: 'Remove local authentication credentials. Clears the stored node JWT and identity. The node remains registered in the cloud dashboard but this machine can no longer access team data until re-authenticated.',
  inputSchema: z.object({
    account_slug: z.string().optional(),
  }),
}, withTelemetry('deauth', async ({ account_slug }) => {
  let result;
  if (account_slug) {
    const ok = removeNode(account_slug);
    result = ok
      ? { removed: account_slug, message: `Node for ${account_slug} removed.` }
      : { removed: false, message: `No node found for account_slug: ${account_slug}` };
  } else {
    clearAuth();
    result = { authenticated: false, message: 'All nodes deauthenticated.' };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

// ── Status ────────────────────────────────────────────────────────

server.registerTool('status', {
  description: 'Show current auth state, node info, pending push count, un-pulled synapse count, and last sync time.',
  inputSchema: z.object({}),
}, withTelemetry('status', async () => {
  const nodes = getNodes();
  const active = getActiveNode();
  const synapseCounts = getSynapseCounts();
  const pushCount = db.prepare("SELECT COUNT(*) AS c FROM synapse_map WHERE direction = 'push'").get();
  const pullCount = db.prepare("SELECT COUNT(*) AS c FROM synapse_map WHERE direction = 'pull'").get();
  const lastSync = db.prepare('SELECT MAX(synced_at) AS last FROM synapse_map').get();

  const nodeStatuses = nodes.map(n => {
    const memCount = synapseCounts[n.account_id]?.mem || 0;
    const conCount = synapseCounts[n.account_id]?.con || 0;
    return {
      name: n.name, node_id: n.node_id, account_name: n.account_name,
      account_slug: n.account_slug, account_role: n.account_role,
      active: active && n.node_id === active.node_id,
      status: n.status || 'active', mem_synapses: memCount, con_synapses: conCount,
    };
  });

  return {
    content: [{ type: 'text', text: JSON.stringify({
      authenticated: !!active, active_account_slug: active?.account_slug || null,
      nodes: nodeStatuses,
      pending_push: pushCount?.c || 0, pulled: pullCount?.c || 0,
      last_sync: lastSync?.last ? new Date(lastSync.last * 1000).toISOString() : null,
      effective_db_path: getDbPath(),
    }, null, 2) }],
  };
}));

// ── Memory ────────────────────────────────────────────────────────

server.registerTool('memory_search', {
  description: 'COGNITIVE RECALL: Search past architectural decisions, root causes, and project rules. Execute autonomously BEFORE writing code, changing architecture, or making design choices.',
  inputSchema: z.object({
    query: z.string(),
    project: z.string().optional(),
    kind: z.string().optional(),
    status: z.string().optional(),
    scope: z.string().optional(),
    cloud_status: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    alpha: z.number().optional(),
  }),
}, withTelemetry('memory_search', async (args) => ({
  content: [{ type: 'text', text: JSON.stringify(memorySearch(args), null, 2) }],
})));

server.registerTool('concept_search', {
  description: 'DISCOVER SKILLS & RULES: Search indexed skills, agents, workflows, and reference documents. Execute autonomously when encountering multi-step or unfamiliar workflows.',
  inputSchema: z.object({
    query: z.string(),
    collection: z.string().optional(),
    type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    scope: z.string().optional(),
    cloud_status: z.string().optional(),
    status: z.string().optional(),
    match: z.string().optional(),
    weights: z.object({
      title: z.number().optional(),
      description: z.number().optional(),
      tags: z.number().optional(),
      body: z.number().optional(),
    }).optional(),
    boost: z.record(z.record(z.number())).optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    alpha: z.number().optional(),
  }),
}, withTelemetry('concept_search', async (args) => ({
  content: [{ type: 'text', text: JSON.stringify(conceptSearch(args), null, 2) }],
})));

server.registerTool('memory_list', {
  description: 'List local and team memories with optional filters.',
  inputSchema: z.object({
    project: z.string().optional(),
    kind: z.string().optional(),
    scope: z.string().optional(),
    cloud_status: z.string().optional(),
    limit: z.number().optional(),
  }),
}, withTelemetry('memory_list', async (args) => ({
  content: [{ type: 'text', text: JSON.stringify(memoryList(args), null, 2) }],
})));

server.registerTool('concept_list', {
  description: 'List local and team concepts with optional filters.',
  inputSchema: z.object({
    collection: z.string().optional(),
    type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    scope: z.string().optional(),
    cloud_status: z.string().optional(),
    limit: z.number().optional(),
  }),
}, withTelemetry('concept_list', async (args) => ({
  content: [{ type: 'text', text: JSON.stringify(conceptList(args), null, 2) }],
})));

server.registerTool('memory_context', {
  description: 'Formatted context string for prompt injection from local and team memories.',
  inputSchema: z.object({
    query: z.string(),
    project: z.string().optional(),
    scope: z.string().optional(),
    limit: z.number().optional(),
  }),
}, withTelemetry('memory_context', async (args) => ({
  content: [{ type: 'text', text: memoryContext(args) }],
})));

server.registerTool('concept_search_context', {
  description: 'Formatted context string for prompt injection from local and team concepts.',
  inputSchema: z.object({
    query: z.string(),
    collection: z.string().optional(),
    scope: z.string().optional(),
    limit: z.number().optional(),
  }),
}, withTelemetry('concept_search_context', async (args) => ({
  content: [{ type: 'text', text: conceptSearchContext(args) }],
})));

// ── Detail ────────────────────────────────────────────────────────

server.registerTool('get', {
  description: 'Get full content and metadata of a specific local synapse by cloud UUID.',
  inputSchema: z.object({ synapse_id: z.string() }),
}, withTelemetry('get', async ({ synapse_id }) => ({
  content: [{ type: 'text', text: JSON.stringify(getSynapse(synapse_id), null, 2) }],
})));

server.registerTool('related', {
  description: 'Resolve related synapses for a given synapse. For memories, resolves explicit related_ids. For concepts, resolves the full family (ancestors + immediate siblings + descendants + declared dependencies) among your team-shared concepts.',
  inputSchema: z.object({ synapse_id: z.string() }),
}, withTelemetry('related', async ({ synapse_id }) => ({
  content: [{ type: 'text', text: JSON.stringify(getRelated(synapse_id), null, 2) }],
})));

// ── Cloud ─────────────────────────────────────────────────────────

server.registerTool('share', {
  description: 'Push local synapses to the cloud (pending admin approval). A shared concept expands to its ENTIRE family — ancestors, immediate siblings (with their subtrees), descendants, and declared dependencies — so shared skills arrive complete. Memories are shared as-is (no expansion). Returns { results, family_total, newly_shared, already_shared, errors }.',
  inputSchema: z.object({
    account_slug: z.string().optional(),
    synapses: z.array(z.object({
      source: z.string(),
      id: z.number(),
    })),
  }),
}, withTelemetry('share', async (args) => {
  const result = await shareSynapses(args);
  const hasError = result.errors > 0 || (result.results || []).some(s => s.status === 'error' || s.status === 'not_found');
  notifyDash('synapse_shared', { count: result.newly_shared || 0, family_total: result.family_total || 0 });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !!hasError };
}));

server.registerTool('unshare', {
  description: 'Request admin review to unshare a previously shared synapse (enters pending_unshare; removed on the next pull once approved). A concept unshare expands to its ENTIRE family, matching share. Unshare is single-account (the active node). Returns { results, total, requested, errors }.',
  inputSchema: z.object({
    source: z.string(),
    id: z.number(),
  }),
}, withTelemetry('unshare', async ({ source, id }) => {
  const result = await unshareSynapse(source, id);
  notifyDash('synapse_updated', { id, source });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: (result.errors || 0) > 0 };
}));

server.registerTool('pull', {
  description: 'Fetch approved active synapses from all your team accounts and store them locally in the Cordenar synapse store.',
  inputSchema: z.object({}),
}, withTelemetry('pull', async () => {
  const result = await pullSynapses();
  notifyDash('synapse_pulled', {});
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

server.registerTool('list_accounts', {
  description: 'List all Basejump accounts the authenticated user belongs to. Returns account_id, name, slug, and role.',
  inputSchema: z.object({}),
}, withTelemetry('list_accounts', async () => ({
  content: [{ type: 'text', text: JSON.stringify(await listAccounts(), null, 2) }],
})));

server.registerTool('sync', {
  description: 'Full bidirectional sync: push locally-edited shared synapses, detect and unlink locally-deleted shared synapses, pull new approved synapses from cloud.',
  inputSchema: z.object({}),
}, withTelemetry('sync', async () => {
  const result = await fullSync();
  const hasError = result.nodes && result.nodes.some(n => n.error);
  if (result.pushed || result.unlinked || result.pulled) {
    notifyDash('sync_complete', {});
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !!hasError };
}));

// ── Memory CRUD ───────────────────────────────────────────────────

server.registerTool('memory_store', {
  description: 'AUTONOMOUS PERSISTENCE: Save SUBSTANTIVE facts, architectural decisions, bug root causes, or milestone completions. Execute autonomously upon completing a task or resolving an issue. DO NOT store trivial file edits or routine queries.',
  inputSchema: z.object({
    project: z.string(),
    content: z.string(),
    kind: z.string().optional(),
    related_ids: z.array(z.number()).optional(),
    status: z.string().optional(),
    metadata: z.object({}).passthrough().optional(),
  }),
}, withTelemetry('memory_store', async (args) => {
  const result = { id: storeMemory(args), success: true };
  notifyDash('memory_new', { id: result.id, project: args.project });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

server.registerTool('memory_get', {
  description: 'Get a single local memory by project and ID. Returns full memory row with parsed metadata and related_ids.',
  inputSchema: z.object({
    project: z.string(),
    id: z.number(),
  }),
}, withTelemetry('memory_get', async ({ project, id }) => {
  const result = getMemoryById(project, id);
  if (!result) throw new Error(`Memory #${id} not found in project '${project}'`);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

server.registerTool('memory_update', {
  description: 'Update an existing local memory. Re-indexes FTS and vector if content changes.',
  inputSchema: z.object({
    id: z.number(),
    project: z.string(),
    kind: z.string().optional(),
    content: z.string().optional(),
    metadata: z.object({}).passthrough().optional(),
    related_ids: z.array(z.number()).optional(),
    status: z.string().optional(),
  }),
}, withTelemetry('memory_update', async (args) => {
  const updated = updateMemory(args);
  notifyDash('memory_update', { id: args.id, project: args.project });
  return { content: [{ type: 'text', text: JSON.stringify({ updated }, null, 2) }], isError: !updated };
}));

server.registerTool('memory_trash', {
  description: 'Soft-delete a local memory by ID (scoped to project). Recoverable via memory_restore.',
  inputSchema: z.object({ project: z.string(), id: z.number() }),
}, withTelemetry('memory_trash', async ({ project, id }) => {
  const deleted = trashMemory(project, id);
  notifyDash('memory_trash', { id, project });
  return { content: [{ type: 'text', text: JSON.stringify({ deleted }, null, 2) }], isError: !deleted };
}));

server.registerTool('memory_restore', {
  description: 'Restore a soft-deleted local memory from trash.',
  inputSchema: z.object({ project: z.string(), id: z.number() }),
}, withTelemetry('memory_restore', async ({ project, id }) => {
  const restored = restoreMemory(project, id);
  notifyDash('memory_restore', { id, project });
  return { content: [{ type: 'text', text: JSON.stringify({ restored }, null, 2) }], isError: !restored };
}));

server.registerTool('memory_purge', {
  description: 'Permanently delete a local memory. By default requires the memory to be in trash first (use force=true to bypass).',
  inputSchema: z.object({ project: z.string(), id: z.number(), force: z.boolean().optional() }),
}, withTelemetry('memory_purge', async ({ project, id, force }) => {
  const purged = deleteMemoryPermanent(project, id, force);
  notifyDash('memory_purge', { id, project });
  return { content: [{ type: 'text', text: JSON.stringify({ purged }, null, 2) }], isError: !purged };
}));

server.registerTool('memory_archive', {
  description: 'Archive a local memory by ID. Archived memories are excluded from default list/search/context.',
  inputSchema: z.object({ project: z.string(), id: z.number() }),
}, withTelemetry('memory_archive', async ({ project, id }) => {
  const archived = archiveMemory(project, id);
  notifyDash('memory_archive', { id, project });
  return { content: [{ type: 'text', text: JSON.stringify({ archived }, null, 2) }], isError: !archived };
}));

server.registerTool('memory_unarchive', {
  description: 'Restore an archived local memory back to active.',
  inputSchema: z.object({ project: z.string(), id: z.number() }),
}, withTelemetry('memory_unarchive', async ({ project, id }) => {
  const unarchived = unarchiveMemory(project, id);
  notifyDash('memory_unarchive', { id, project });
  return { content: [{ type: 'text', text: JSON.stringify({ unarchived }, null, 2) }], isError: !unarchived };
}));

server.registerTool('memory_reassign', {
  description: 'Move local memories from one project to another. If ids is provided, only moves those specific memories. If omitted, moves all memories from from_project.',
  inputSchema: z.object({
    from_project: z.string(),
    to_project: z.string(),
    ids: z.array(z.number()).optional(),
  }),
}, withTelemetry('memory_reassign', async ({ from_project, to_project, ids }) => {
  const result = { moved: reassignMemories(from_project, to_project, ids) };
  notifyDash('memory_reassign', { from: from_project, to: to_project });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

// ── Projects ──────────────────────────────────────────────────────

server.registerTool('project_list', {
  description: 'List all project namespaces with stored local memories.',
  inputSchema: z.object({}),
}, withTelemetry('project_list', async () => ({
  content: [{ type: 'text', text: JSON.stringify(listProjects(), null, 2) }],
})));

server.registerTool('project_count', {
  description: 'Count non-trashed local memories in a project, grouped by kind.',
  inputSchema: z.object({ project: z.string() }),
}, withTelemetry('project_count', async ({ project }) => ({
  content: [{ type: 'text', text: JSON.stringify(countProject(project), null, 2) }],
})));

server.registerTool('project_trash', {
  description: 'Soft-delete all non-trashed local memories in a project (recoverable).',
  inputSchema: z.object({ project: z.string() }),
}, withTelemetry('project_trash', async ({ project }) => {
  const result = { trashed: trashProject(project) };
  notifyDash('project_trash', { project });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

server.registerTool('project_purge', {
  description: 'Permanently delete a project and all its local memories. By default requires all memories to be in trash first (use force=true to bypass).',
  inputSchema: z.object({ project: z.string(), force: z.boolean().optional() }),
}, withTelemetry('project_purge', async ({ project, force }) => {
  const result = { purged: deleteProject(project, force) };
  notifyDash('project_purge', { project });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

// ── Brief & Summary ───────────────────────────────────────────────

server.registerTool('memory_brief', {
  description: 'AUTONOMOUS SESSION START: Execute at the absolute start of any conversation or task to brief yourself on active project context, unresolved bugs, and pending plans. MANDATORY before making assumptions.',
  inputSchema: z.object({
    project: z.string().optional(),
  }),
}, withTelemetry('memory_brief', async (args) => {
  const brief = getBrief(args);
  const payload = {
    _autonomy_rules: 'You are operating with Cordenar persistent memory. Autonomously execute `memory_search` before major decisions, and call `memory_store` after fixing bugs or achieving milestones without asking user permission.',
    brief,
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}));

server.registerTool('memory_progressive_summary', {
  description: 'Generate structured memory data for progressive summarization. Returns fresh data when the dual threshold is met (context pressure <=20% OR >=10 turns since last summary), or the last summary when still current. The agent must synthesize a 200-500 word summary and call memory_store with kind: progressive_summary.',
  inputSchema: z.object({
    project: z.string(),
    turns_since_last: z.number().optional(),
    context_remaining_pct: z.number().optional(),
  }),
}, withTelemetry('memory_progressive_summary', async ({ project, turns_since_last = 0, context_remaining_pct = 100 }) => {
  const cfg = getConfig();
  const turnThreshold = cfg.summary.turnThreshold;
  const contextThreshold = cfg.summary.contextThreshold;
  const recentLimit = cfg.summary.recentLimit;

  const lastSummary = db.prepare(
    "SELECT id, content, updated_at FROM memories WHERE project = ? AND kind = 'progressive_summary' AND deleted_at IS NULL AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).get(project);

  const shouldFire = context_remaining_pct <= contextThreshold || turns_since_last >= turnThreshold;

  if (lastSummary && !shouldFire) {
    return { content: [{ type: 'text', text: JSON.stringify({ up_to_date: true, content: lastSummary.content, summary_id: lastSummary.id }, null, 2) }] };
  }

  const recentMemories = db.prepare(
    'SELECT id, kind, content, status, created_at, updated_at, related_ids FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND kind != ? ORDER BY created_at DESC LIMIT ?'
  ).all(project, 'progressive_summary', recentLimit);

  const counts = {};
  for (const m of recentMemories) {
    counts[m.kind] = (counts[m.kind] || 0) + 1;
  }

  const newSinceLast = lastSummary
    ? db.prepare(
        "SELECT COUNT(*) as c FROM memories WHERE project = ? AND deleted_at IS NULL AND archived_at IS NULL AND kind != 'progressive_summary' AND updated_at > ?"
      ).get(project, lastSummary.updated_at).c
    : recentMemories.length;

  return { content: [{ type: 'text', text: JSON.stringify({
    needs_store: true,
    memories: recentMemories.map(m => ({
      id: m.id, kind: m.kind,
      content: m.content.substring(0, 500),
      status: m.status,
    })),
    synthesis_template: 'State / Recent Decisions / Pending / Next',
    summary_kind: 'progressive_summary',
    last_summary_id: lastSummary?.id || null,
    last_summary_stale: lastSummary ? newSinceLast > 0 : null,
    new_memory_count: newSinceLast,
    kind_counts: counts,
    total_memories: recentMemories.length,
  }, null, 2) }] };
}));

// ── Concepts ──────────────────────────────────────────────────────

server.registerTool('concept_index', {
  description: 'Index .md files as local concepts. Scans configured index.paths from config, or a specific path if provided. Extracts frontmatter (YAML), derives slug and type, indexes FTS5+vec0.',
  inputSchema: z.object({
    path: z.string().optional(),
  }),
}, withTelemetry('concept_index', async ({ path }) => {
  const result = indexConcepts(path ? [path] : undefined);
  if (result.added?.length || result.updated?.length || result.removed?.length) {
    notifyDash('index_complete', { count: result.total });
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

server.registerTool('concept_deindex', {
  description: 'Remove local concepts from the index. Pass collection + slug to remove one concept, or path to remove all concepts under a directory. Files on disk are never touched.',
  inputSchema: z.object({
    collection: z.string().optional(),
    slug: z.string().optional(),
    path: z.string().optional(),
  }),
}, withTelemetry('concept_deindex', async (args) => {
  const result = deindexConcepts(args);
  if (result.removed?.length) notifyDash('concept_deindex', { count: result.removed.length });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

server.registerTool('concept_get', {
  description: 'Retrieve a full local concept by collection and slug. Set resolve_dependencies: true to recursively fetch dependency bodies.',
  inputSchema: z.object({
    collection: z.string(),
    slug: z.string(),
    resolve_dependencies: z.boolean().optional(),
  }),
}, withTelemetry('concept_get', async ({ collection, slug, resolve_dependencies }) => {
  const result = getConceptBySlug(collection, slug, !!resolve_dependencies);
  if (!result) throw new Error(`Concept not found: ${collection}/${slug}`);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

server.registerTool('concept_family', {
  description: 'Preview the full relational family of a local concept BEFORE sharing. family = self ∪ ancestors ∪ descendants ∪ immediate siblings (with their subtrees) ∪ transitively declared dependencies (cycle-safe; dangling deps skipped). Returns { ancestors, descendants, siblings, family, total }; total is the recursive share size. A NULL/absent collection yields an empty family.',
  inputSchema: z.object({ collection: z.string(), slug: z.string() }),
}, withTelemetry('concept_family', async ({ collection, slug }) => {
  const result = getConceptFamily(collection, slug);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));

server.registerTool('concept_context', {
  description: 'Retrieve a local concept body as formatted text for prompt injection. Returns [collection] (type) slug: title followed by the full markdown body.',
  inputSchema: z.object({
    collection: z.string(),
    slug: z.string(),
  }),
}, withTelemetry('concept_context', async ({ collection, slug }) => {
  const result = getConceptContext(collection, slug);
  if (!result) throw new Error(`Concept not found: ${collection}/${slug}`);
  return { content: [{ type: 'text', text: result }] };
}));

// ── Telemetry ────────────────────────────────────────────────────

server.registerTool('tool_usage', {
  description: [
    'Show tool call usage statistics for this node. Returns per-tool call counts,',
    'success rates, and share percentages for the selected period.',
    '',
    'When the user asks about system usage, offer them a time period first. Accept:',
    '24hr, 7d (default), 30d, or all time.',
    '',
    'Present the data as a clean text summary. List the period header with total calls',
    'and overall success rate, then list each tool with its count, share percentage, and',
    'success rate. Flag any tool below 80% success.',
  ].join('\n'),
  inputSchema: z.object({
    period: z.string().optional().default('7d'),
  }),
}, withTelemetry('tool_usage', async ({ period }) => {
  await forceFlushTelemetry();
  const normalized = normalizePeriod(period);
  const stats = getToolStats({ exclude: 'tool_usage', period: normalized });
  const periodLabels = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', 'all': 'All time' };
  const successRate = Math.round((1 - (stats.last_7d_error_rate || 0)) * 1000) / 10;
  const prefix = normalized === 'all' ? '' : 'Last ';
  const tools = stats.tools || [];

  const lines = [
    `${stats.total_in_period} calls across ${tools.length} tools — ${prefix}${periodLabels[normalized]} — ${successRate}% success`,
    '',
  ];
  for (const t of tools) {
    const flag = t.success_rate < 80 ? ' (!)' : '';
    lines.push(`${t.tool}: ${t.count} calls (${t.share_pct}%), ${t.success_rate}% success${flag}`);
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}));

// ── Prompts ──────────────────────────────────────────────────────

server.registerPrompt('brain', {
  description: 'Initialize Cordenar persistent memory instructions and agent autonomy rules.',
}, async () => ({
  messages: [{ role: 'user', content: { type: 'text', text: CORDENAR_INSTRUCTIONS } }],
}));

  return server;
}

function normalizePeriod(input) {
  if (!input) return '7d';
  const raw = input.toLowerCase().replace(/[\s-]+/g, '');
  if (/^(24[hhrs]|1d)$/.test(raw) || /^24/.test(raw)) return '24h';
  if (/^7[dday]/.test(raw) || raw === 'week') return '7d';
  if (/^30[dday]/.test(raw) || raw === 'month') return '30d';
  if (/^(all|ever|forever|alltime)$/.test(raw)) return 'all';
  return '7d';
}


// ── Helpers ────────────────────────────────────────────────────
// (withTelemetry is defined above and used within createCordenarServer)
