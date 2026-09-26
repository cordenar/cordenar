'use strict';

// ── Color/style constants ──

export const sourceColors = {
  memory: 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-foreground',
  concept: 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-foreground',
};
export const statusColors = {
  shared: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  pulled: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  unshared: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
};
export const cloudStatusColors = {
  pending_approval: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  pending_unshare: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  active: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  unshared_rejected: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};
export const baseBadge = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
export const kindColors = {
  fact:                baseBadge + ' bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
  decision:            baseBadge + ' bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  bug:                 baseBadge + ' bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  plan:                baseBadge + ' bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  note:                baseBadge + ' bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  progressive_summary: baseBadge + ' bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  insight:             baseBadge + ' bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};
export const kindStatusColors = {
  proposed:     baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  open:         baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  in_progress:  baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  pending:      baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved:     baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  implemented:  baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  fixed:        baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  completed:    baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected:     baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  superseded:   baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  wont_fix:     baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  cant_repro:   baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  cancelled:    baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
};
export const typeColors = {
  skill:       baseBadge + ' bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  agent:       baseBadge + ' bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  instruction: baseBadge + ' bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  prompt:      baseBadge + ' bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  workflow:    baseBadge + ' bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  reference:   baseBadge + ' bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  knowledge:   baseBadge + ' bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
};
export const conceptStatusColors = {
  stable:     baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  draft:      baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  deprecated: baseBadge + ' bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};
// ── Global state ──

export const state = { source: '', status: '', search: '', scope: 'all', limit: 20, offset: 0, total: 0, memProject: '', memKind: '', memStatus: '', memLifecycle: 'active', conType: '', conStatus: '', conCollection: '', lastData: null, previewHistory: [], previewForward: [], previewNavVersion: 0, searchTimer: null, nodes: [], activeNodeSlug: '' };
export let allMemProjects = [];
export let allConceptCollections = [];

// ── Cached DOM refs ──

export const $ = (id) => document.getElementById(id);
export const memProjectEl = () => $('mem-project');
export const memProjectDropdownEl = () => $('mem-project-dropdown');
export const conCollectionEl = () => $('con-collection');
export const conCollectionDropdownEl = () => $('con-collection-dropdown');

// ── Utilities ──

export function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

export function timeAgo(ts) {
  const sec = Math.floor(Date.now() / 1000 - ts);
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  return Math.floor(sec / 86400) + 'd ago';
}

export function kindLabel(k) {
  return k === 'progressive_summary' ? 'summary' : (k || '');
}

export function toast(msg, type, duration) {
  type = type || 'info';
  duration = duration || 4000;
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  container.appendChild(el);
  const timer = setTimeout(function () { removeToast(el); }, duration);
  el._timer = timer;
}

function removeToast(el) {
  if (el._removing) return;
  el._removing = true;
  clearTimeout(el._timer);
  el.classList.add('removing');
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
}

export function showError(msg) {
  const el = $('error');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
  console.error(msg);
}

// ── Shared markup constants ──

export const KEBAB_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
export const EMPTY_PILL = '<span class="text-muted-foreground/60 text-xs">—</span>';
export const CLOUD_URL = 'https://cordenar.cloud';

export function syncThemeBtn(isDark) {
  const btn = $('theme-btn');
  const moon = $('theme-icon-moon');
  const sun = $('theme-icon-sun');
  if (btn) btn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  if (moon) moon.classList.toggle('hidden', isDark);
  if (sun) sun.classList.toggle('hidden', !isDark);
}
