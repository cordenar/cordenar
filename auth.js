// Cordenar — Multi-node authentication store
// Stores node credentials in ~/.cordenar/auth.json
// Format: { active_node_id: "...", nodes: [{...}, ...] }
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { getConfig } from './config.js';

export function loadAuth() {
  const cfg = getConfig();
  try {
    if (!existsSync(cfg.authFile)) return null;
    const raw = readFileSync(cfg.authFile, 'utf-8');
    const data = JSON.parse(raw);
    if (data.nodes) return data;
    return null;
  } catch {
    return null;
  }
}

export function saveAuthRaw(data) {
  const cfg = getConfig();
  writeFileSync(cfg.authFile, JSON.stringify(data, null, 2));
}

export function saveAuth(nodeData) {
  const current = loadAuth();
  const nodes = current ? [...current.nodes] : [];
  const existingIdx = nodes.findIndex(n => n.node_id === nodeData.node_id);
  if (existingIdx >= 0) {
    nodes[existingIdx] = { ...nodes[existingIdx], ...nodeData };
  } else {
    nodes.push(nodeData);
  }
  saveAuthRaw({
    active_node_id: nodeData.node_id,
    nodes,
  });
}

export function clearAuth() {
  const cfg = getConfig();
  try {
    if (existsSync(cfg.authFile)) {
      writeFileSync(cfg.authFile, '');
    }
  } catch (e) { console.error('[cordenar] clearAuth write failed:', e.message); }
}

export function removeNode(accountSlug) {
  const current = loadAuth();
  if (!current) return false;
  const idx = current.nodes.findIndex(n => n.account_slug === accountSlug);
  if (idx < 0) return false;
  current.nodes.splice(idx, 1);
  if (!current.nodes.some(n => n.node_id === current.active_node_id)) {
    current.active_node_id = null;
  }
  saveAuthRaw(current);
  return true;
}

export function getNodes() {
  const auth = loadAuth();
  return auth?.nodes || [];
}

export function getActiveNode() {
  const auth = loadAuth();
  if (!auth || !auth.nodes?.length) return null;
  return auth.nodes.find(n => n.node_id === auth.active_node_id) || null;
}

export function switchActiveNode(accountSlug) {
  const auth = loadAuth();
  if (!auth) return false;
  const node = auth.nodes.find(n => n.account_slug === accountSlug);
  if (!node) return false;
  auth.active_node_id = node.node_id;
  saveAuthRaw(auth);
  return true;
}

export function findNode(accountSlug) {
  const auth = loadAuth();
  if (!auth) return null;
  return auth.nodes.find(n => n.account_slug === accountSlug) || null;
}

export function isAuthenticated() {
  const node = getActiveNode();
  return !!(node && node.access_token);
}

export function getAccessToken(node) {
  if (!node) {
    node = getActiveNode();
  }
  if (!node) return null;
  return node.access_token;
}

export function getNodeId() {
  const node = getActiveNode();
  return node ? node.node_id : null;
}


