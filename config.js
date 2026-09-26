// Cordenar — Configuration loader
// Priority: code defaults → config file → environment variables
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DEFAULTS = {
  port: 3458,
  dbPath: join(homedir(), '.cordenar', 'synapses.db'),
  authFile: join(homedir(), '.cordenar', 'auth.json'),
  manifestPath: join(homedir(), '.cordenar', 'manifest.json'),
  supabaseUrl: '',
  supabasePublishableKey: '',
  cloudUrl: 'http://127.0.0.1:3459',

  // ── Personal memory / concept config ──────────────────
  backup: {
    dir: join(homedir(), '.cordenar', 'backups'),
    intervalWrites: 50,
    retention: {
      recentHours: 24,
      dailyDays: 30,
      weeklyWeeks: 12,
      monthlyMonths: 12,
    },
    freshnessHours: 1,
  },
  contentMaxSize: 100000,
  toolRetentionDays: 30,
  db: {
    busyTimeout: 5000,
  },
  retrieval: {
    maxResults: 5000,
    maxVectorCandidates: 4096,
  },
  summary: {
    turnThreshold: 10,
    contextThreshold: 20,
    recentLimit: 50,
  },
  search: {
    alpha: 0.3,
  },
  index: {
    paths: [],
  },
  schemas: {
    default: {
      kinds: {
        fact: { statuses: [], required: [], defaults: {} },
        decision: { statuses: ['proposed','approved','rejected','implemented','superseded'], required: [], defaults: { status: 'proposed', files: [], rationale: '' } },
        bug: { statuses: ['open','in_progress','fixed','wont_fix','cant_repro'], required: [], defaults: { status: 'open', severity: 'minor', files: [] } },
        plan: { statuses: ['pending','in_progress','completed','cancelled'], required: [], defaults: { status: 'pending', files: [], steps: [] } },
        note: { statuses: [], required: [], defaults: {} },
        progressive_summary: { statuses: [], required: [], defaults: {} },
      },
      types: {
        skill: { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        agent: { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        instruction: { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        prompt: { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        workflow: { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        reference: { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
        knowledge: { statuses: ['stable','draft','deprecated'], defaults: { status: 'stable' } },
      },
    },
  },
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(target, key)) {
      target[key] = JSON.parse(JSON.stringify(source[key]));
      continue;
    }
    const tv = target[key];
    const sv = source[key];
    if (isObject(tv) && isObject(sv)) {
      deepMerge(tv, sv);
    } else {
      target[key] = sv;
    }
  }
  return target;
}

function readConfigFile() {
  const path = join(homedir(), '.cordenar', 'config.json');
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveTilde(p) {
  if (typeof p !== 'string') return p;
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1));
  }
  return p;
}

function applyEnvOverrides(cfg) {
  if (process.env.SUPABASE_URL) cfg.supabaseUrl = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_PUBLISHABLE_KEY)
    cfg.supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (process.env.CORDENAR_CLOUD_URL) cfg.cloudUrl = process.env.CORDENAR_CLOUD_URL;
  if (process.env.CORDENAR_PORT)
    cfg.port = parseInt(process.env.CORDENAR_PORT, 10) || 3458;
  if (process.env.CORDENAR_DB_PATH)
    cfg.dbPath = resolveTilde(process.env.CORDENAR_DB_PATH);
  if (process.env.CORDENAR_AUTH_FILE)
    cfg.authFile = resolveTilde(process.env.CORDENAR_AUTH_FILE);
  if (process.env.CORDENAR_MANIFEST_PATH)
    cfg.manifestPath = resolveTilde(process.env.CORDENAR_MANIFEST_PATH);
  if (process.env.CORDENAR_INDEX_PATHS)
    cfg.index.paths = process.env.CORDENAR_INDEX_PATHS.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (process.env.BACKUP_DIR)
    cfg.backup.dir = resolveTilde(process.env.BACKUP_DIR);
  if (process.env.BACKUP_INTERVAL_WRITES)
    cfg.backup.intervalWrites = parseInt(process.env.BACKUP_INTERVAL_WRITES, 10) || 50;
  if (process.env.BACKUP_RETENTION_RECENT_HOURS)
    cfg.backup.retention.recentHours = parseInt(process.env.BACKUP_RETENTION_RECENT_HOURS, 10) || 24;
  if (process.env.BACKUP_RETENTION_DAILY_DAYS)
    cfg.backup.retention.dailyDays = parseInt(process.env.BACKUP_RETENTION_DAILY_DAYS, 10) || 30;
  if (process.env.BACKUP_RETENTION_WEEKLY_WEEKS)
    cfg.backup.retention.weeklyWeeks = parseInt(process.env.BACKUP_RETENTION_WEEKLY_WEEKS, 10) || 12;
  if (process.env.BACKUP_RETENTION_MONTHLY_MONTHS)
    cfg.backup.retention.monthlyMonths = parseInt(process.env.BACKUP_RETENTION_MONTHLY_MONTHS, 10) || 12;
  if (process.env.CORDENAR_CONTENT_MAX_SIZE)
    cfg.contentMaxSize = parseInt(process.env.CORDENAR_CONTENT_MAX_SIZE, 10) || 100000;
  if (process.env.CORDENAR_TOOL_RETENTION_DAYS)
    cfg.toolRetentionDays = parseInt(process.env.CORDENAR_TOOL_RETENTION_DAYS, 10) || 30;
  if (process.env.CORDENAR_SUMMARY_TURN_THRESHOLD) {
    cfg.summary.turnThreshold = parseInt(process.env.CORDENAR_SUMMARY_TURN_THRESHOLD, 10) || 10;
  }
  if (process.env.CORDENAR_SUMMARY_CONTEXT_THRESHOLD) {
    cfg.summary.contextThreshold = parseInt(process.env.CORDENAR_SUMMARY_CONTEXT_THRESHOLD, 10) || 20;
  }
  if (process.env.CORDENAR_DB_BUSY_TIMEOUT)
    cfg.db.busyTimeout = parseInt(process.env.CORDENAR_DB_BUSY_TIMEOUT, 10) || 5000;
  if (process.env.CORDENAR_BACKUP_FRESHNESS_HOURS)
    cfg.backup.freshnessHours = parseInt(process.env.CORDENAR_BACKUP_FRESHNESS_HOURS, 10) || 1;
  return cfg;
}

export function getIndexPaths() {
  const cfg = getConfig();
  return cfg.index?.paths || [];
}

export function resolveTypeSchema(type) {
  const cfg = getConfig();
  return cfg.schemas?.default?.types?.[type] || { statuses: ['stable', 'draft', 'deprecated'], defaults: { status: 'stable' } };
}

let _cfg = null;

export function getConfig() {
  if (_cfg) return _cfg;
  const defaults = JSON.parse(JSON.stringify(DEFAULTS));
  _cfg = deepMerge(defaults, readConfigFile());
  applyEnvOverrides(_cfg);
  return _cfg;
}

export function getDbPath() {
  const cfg = getConfig();
  return cfg.dbPath;
}

export function ensureDbDir() {
  const path = getDbPath();
  const dir = join(path, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return path;
}

export function reloadConfig() {
  _cfg = null;
}
