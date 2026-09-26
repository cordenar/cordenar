// Cordenar — Supabase client wrapper (multi-node)
// Uses node JWT stored in ~/.cordenar/auth.json
// getNodeClient(node?) defaults to active node; pass a node to target a specific one.
// Expired node JWTs are refreshed via POST {cloudUrl}/api/auth/node/refresh (the cloud
// accepts expired-but-valid node tokens) — proactively before a request and once on 401.
import { createClient } from '@supabase/supabase-js';
import { getConfig } from './config.js';
import { getActiveNode, getAccessToken, saveAuthRaw, loadAuth } from './auth.js';

// Decode a JWT's `exp` claim. Malformed/undecodable tokens count as expired.
export function isTokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    if (!payload.exp) return false;
    return payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

// Refresh a node's JWT via the cloud and persist it to auth.json.
export async function refreshNodeToken(node) {
  const cfg = getConfig();
  const current = getAccessToken(node);
  if (!current) throw new Error('No token to refresh. Run cordenar_auth first.');

  const res = await fetch(`${cfg.cloudUrl}/api/auth/node/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: current }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || `Token refresh failed (${res.status})`);
  }

  const auth = loadAuth();
  if (auth) {
    const stored = auth.nodes.find(n => n.node_id === node.node_id);
    if (stored) {
      stored.access_token = data.access_token;
      saveAuthRaw(auth);
    }
  }
  node.access_token = data.access_token;
  return data.access_token;
}

// Deduplicate concurrent refreshes for the same node.
const inFlightRefreshes = new Map();
function refreshNodeTokenOnce(node) {
  const key = node.node_id;
  if (inFlightRefreshes.has(key)) return inFlightRefreshes.get(key);
  const p = refreshNodeToken(node).finally(() => inFlightRefreshes.delete(key));
  inFlightRefreshes.set(key, p);
  return p;
}

// fetch wrapper: refresh an expired token before the call, and retry once on 401.
function makeRefreshingFetch(node) {
  const withAuth = (token, base) => {
    const headers = new Headers(base || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  };

  return async (input, init = {}) => {
    let token = getAccessToken(node);
    if (isTokenExpired(token)) {
      try { token = await refreshNodeTokenOnce(node); } catch { /* retry below on 401 */ }
    }

    let res = await fetch(input, { ...init, headers: withAuth(token, init.headers) });
    if (res.status === 401) {
      try {
        token = await refreshNodeTokenOnce(node);
        res = await fetch(input, { ...init, headers: withAuth(token, init.headers) });
      } catch { /* return the original 401 */ }
    }
    return res;
  };
}

export function getNodeClient(node) {
  const cfg = getConfig();
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
    throw new Error(
      'Supabase not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY env vars.'
    );
  }

  const target = node || getActiveNode();
  if (!target) throw new Error('No active node. Run cordenar_auth first.');

  const token = getAccessToken(target);
  if (!token) throw new Error('Not authenticated. Run cordenar_auth first.');

  return createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      fetch: makeRefreshingFetch(target),
    },
  });
}
