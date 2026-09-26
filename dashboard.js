#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { initDb } from './db.js';
import { getConfig, getDbPath } from './config.js';
import { createApiHandler, err } from './dashboard/api-handler.js';
import { fullSync } from './sync.js';
import { initTelemetry, getTracer, forceFlushTelemetry, SpanKind, SpanStatusCode } from './otel.js';

const arg = process.argv[2] || 'start';
const PORT = getConfig().port;

function killOnPort(port) {
  try {
    const pids = execSync('lsof -ti:' + port, { encoding: 'utf-8' }).trim();
    if (!pids) return;
    for (const pid of pids.split('\n')) {
      try {
        const cmd = execSync('ps -p ' + pid + ' -o comm=', { encoding: 'utf-8' }).trim();
        if (cmd === 'node') process.kill(parseInt(pid), 'SIGTERM');
      } catch {}
    }
  } catch {}
}

if (arg === 'stop') {
  killOnPort(PORT);
  console.log('Cordenar stopped');
  process.exit(0);
}
if (arg === 'restart') {
  killOnPort(PORT);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version;
const PUBLIC = path.join(__dirname, 'dashboard', 'public');

const DB = initDb();
initTelemetry(DB, VERSION);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const sseClients = new Set();
let syncRunning = false;

const rateLimit = new Map();
function checkRate(ip, limit, windowMs) {
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateLimit.set(ip, entry);
  return entry.count <= limit;
}

function broadcast(type, data) {
  const cleanType = String(type).replace(/[\r\n]/g, '');
  const payload = `event: ${cleanType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:' + PORT);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const params = url.searchParams;

  if (pathname === '/health' && req.method === 'GET') {
    const cfg = getConfig();
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    const dbSize = fs.statSync(getDbPath()).size;
    const backupDir = cfg.backup?.dir || path.join(getDbPath(), '..', 'backups');
    let backupCount = 0, lastBackup = null;
    try {
      const files = fs.readdirSync(backupDir).filter(f => f.startsWith('cordenar-') && f.endsWith('.db')).sort();
      backupCount = files.length;
      if (files.length > 0) lastBackup = files[files.length - 1];
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      version: pkg.version,
      uptime: Math.floor(process.uptime()),
      db_size: dbSize,
      backup_count: backupCount,
      last_backup: lastBackup,
    }));
    return;
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    if (sseClients.size >= 100) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too many connections');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => { sseClients.delete(res); });
    return;
  }

  if (pathname === '/api/notify' && req.method === 'POST') {
    const span = getTracer().startSpan('http:POST:/api/notify', { kind: SpanKind.SERVER });
    let body = '';
    let bodyBytes = 0;
    req.on('data', chunk => {
      bodyBytes += chunk.length;
      if (bodyBytes > 65536) {
        span.setAttribute('http.status_code', 413);
        span.end();
        res.writeHead(413); res.end('Payload too large'); req.destroy(); return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const { event, id, source, project } = JSON.parse(body);
        const mappedEvent = /^(memory_|concept_|project_)/.test(event)
          ? 'synapse_updated'
          : event;
        broadcast(mappedEvent, { id, source, project });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        span.setAttribute('http.status_code', 200);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        span.setAttribute('http.status_code', 400);
        span.setAttribute('error.type', e.name || 'Error');
        span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
      }
      span.end();
    });
    return;
  }

  if (pathname === '/api/sync' && req.method === 'POST') {
    const span = getTracer().startSpan('http:POST:/api/sync', { kind: SpanKind.SERVER });
    if (syncRunning) {
      span.setAttribute('http.status_code', 409);
      span.end();
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sync already in progress' }));
      return;
    }
    syncRunning = true;
    span.setAttribute('http.status_code', 200);
    span.end();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Sync started' }));
    fullSync()
      .then(function (result) { broadcast('sync_complete', result); })
      .catch(function (e) { console.error('Sync error:', e); })
      .finally(function () { syncRunning = false; });
    return;
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  if (pathname.startsWith('/api/') && !checkRate(ip, 50, 1000)) {
    res.writeHead(429, { 'Content-Type': 'text/plain' });
    res.end('Rate limited');
    return;
  }

  try {
    if (pathname.startsWith('/api/')) {
      const span = getTracer().startSpan('http:' + req.method + ':' + pathname, { kind: SpanKind.SERVER });
      try {
        const handleApi = createApiHandler(DB);
        const result = await handleApi(pathname, req.method, params) || err('Not found', 404);
        span.setAttribute('http.status_code', result.status);
        if (result.status >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'HTTP ' + result.status });
        }

        if (result.status === 200) {
          const shareMatch = pathname.match(/^\/api\/synapses\/(\d+)\/share$/);
          if (shareMatch && req.method === 'POST') {
            broadcast('synapse_shared', { id: parseInt(shareMatch[1], 10), source: params.get('source') || '' });
          }
          const unshareMatch = pathname.match(/^\/api\/synapses\/(\d+)\/unshare$/);
          if (unshareMatch && req.method === 'POST') {
            broadcast('synapse_updated', { id: parseInt(unshareMatch[1], 10), source: params.get('source') || '' });
          }
          const unlinkMatch = pathname.match(/^\/api\/synapses\/(\d+)\/unlink$/);
          if (unlinkMatch && req.method === 'POST') {
            broadcast('synapse_unlinked', { id: parseInt(unlinkMatch[1], 10) });
          }
          const pullDeleteMatch = pathname.match(/^\/api\/synapses\/(\d+)\/pull-delete$/);
          if (pullDeleteMatch && req.method === 'POST') {
            broadcast('synapse_unlinked', { id: parseInt(pullDeleteMatch[1], 10) });
          }
          const dismissMatch = pathname.match(/^\/api\/synapses\/(\d+)\/dismiss$/);
          if (dismissMatch && req.method === 'POST') {
            broadcast('synapse_unlinked', { id: parseInt(dismissMatch[1], 10) });
          }
        }

        res.writeHead(result.status, result.headers);
        res.end(result.body);
        return;
      } catch (handlerError) {
        span.setAttribute('http.status_code', 500);
        span.setAttribute('error.type', handlerError.name || 'Error');
        span.setStatus({ code: SpanStatusCode.ERROR, message: handlerError.message });
        throw handlerError;
      } finally {
        span.end();
      }
    }

    const filePath = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PUBLIC + path.sep)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved);

    fs.readFile(resolved, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      if (ext === '.html' || ext === '.js' || ext === '.css' || ext === '.mjs') {
        headers['Cache-Control'] = 'no-cache';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  } catch (e) {
    console.error('Server error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  try { fs.unlinkSync(getConfig().manifestPath); } catch {}
  for (const client of sseClients) { try { client.end(); } catch {} }
  server.close(async () => {
    try { await forceFlushTelemetry(); } catch {}
    try { DB.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, '127.0.0.1', () => {
  console.log('\nCordenar Dashboard \u2192 http://localhost:' + PORT + '\n');

  const manifestPath = getConfig().manifestPath;
  try {
    fs.writeFileSync(manifestPath, JSON.stringify({
      name: 'cordenar',
      notifyEndpoint: `http://127.0.0.1:${PORT}/api/notify`,
    }));
  } catch (e) { console.error('[cordenar] manifest write failed:', e.message); }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' is in use. Run "cordenar stop" first.');
    process.exit(1);
  }
  throw e;
});

export { server };
