'use strict';

import {
  $, state, baseBadge,
  sourceColors, statusColors, kindColors, kindStatusColors,
  typeColors, conceptStatusColors, cloudStatusColors,
  esc, timeAgo, kindLabel, toast,
  KEBAB_SVG, EMPTY_PILL,
} from './state.js';

// ── Skeleton ──

export function showSkeleton() {
  const tbody = $('tbody');
  const skeleton = $('loading-skeleton');
  if (skeleton) skeleton.style.display = '';
  if (tbody) tbody.innerHTML = '';
}

function hideSkeleton() {
  const skeleton = $('loading-skeleton');
  if (skeleton) skeleton.style.display = 'none';
}

export function initSkeleton() {
  const tbody = $('skeleton-body');
  if (!tbody) return;
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push('<tr class="skeleton-row"><td class="skeleton-cell tiny"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell tiny"></td><td></td></tr>');
  }
  tbody.innerHTML = rows.join('');
}

// ── Row rendering ──

function buildRow(m, viewMode) {
  const src = m.source;
  const st = m.synapseStatus || 'unshared';
  const cs = m.cloud_status || '';
  var cloudLabel, cloudBadge;
  if (m.direction === 'unshared' && (cs === 'rejected' || cs === 'unshared')) {
    cloudLabel = 'Unshared';
    cloudBadge = cloudStatusColors['unshared_rejected'];
  } else if (st === 'shared' && cs && cloudStatusColors[cs]) {
    cloudLabel = { pending_approval: 'Pending', pending_unshare: 'Unshare pending', active: 'Active', rejected: 'Rejected' }[cs] || cs;
    cloudBadge = cloudStatusColors[cs];
  } else {
    cloudLabel = { unshared: 'Unshared', shared: 'Shared', pulled: 'Pulled' }[st] || st;
    cloudBadge = statusColors[st] || baseBadge + ' bg-muted text-muted-foreground';
  }
  const dirtyMark = m.isDirty ? ' *' : '';
  const cloudCell = '<td class="p-2"><span class="' + cloudBadge + '">' + cloudLabel + dirtyMark + '</span></td>';
  const menu = buildMenu(m);

  if (viewMode === 'memory') {
    const hk = (m.type || '').toLowerCase();
    const hkg = kindColors[hk] || baseBadge + ' bg-muted text-muted-foreground';
    const hksg = kindStatusColors[(m.status || '').toLowerCase()] || baseBadge + ' bg-muted text-muted-foreground';
    return '<tr class="border-b border-border last:border-b-0 transition-colors hover:bg-muted/50" data-id="' + m.id + '" data-source="' + src + '">'
      + '<td class="max-w-[400px] truncate p-2 align-middle text-sm">' + esc(m.content || m.preview || '') + '</td>'
      + '<td class="p-2 align-middle"><span class="' + hkg + '">' + esc(kindLabel(m.type)) + '</span></td>'
      + '<td class="text-xs p-2 align-middle truncate max-w-[120px]">' + esc(m.project || '') + '</td>'
      + '<td class="whitespace-nowrap max-w-[180px] overflow-x-auto text-center p-2 align-middle">' + (m.related_ids && m.related_ids.length ? m.related_ids.map(rid => '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">' + rid + '</span>').join(' ') : EMPTY_PILL) + '</td>'
      + '<td class="p-2 align-middle">' + (m.status ? '<span class="' + hksg + '">' + esc(m.status) + '</span>' : EMPTY_PILL) + '</td>'
      + cloudCell
      + '<td class="whitespace-nowrap text-sm text-muted-foreground p-2 align-middle" title="' + new Date((m.created_at || 0) * 1000).toISOString().slice(0, 19).replace('T', ' ') + '">' + timeAgo(m.created_at) + '</td>'
      + '<td class="text-xs p-2 align-middle">' + m.id + '</td>'
      + '<td class="p-2"><div class="dropdown-menu">'
      + '<button class="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-accent" aria-haspopup="menu" aria-expanded="false" aria-label="Actions">' + KEBAB_SVG + '</button>'
      + '<div data-popover aria-hidden="true" class="z-50 rounded-lg bg-popover p-1 shadow-md ring-1 ring-border/10 min-w-40"><div role="menu">' + menu + '</div></div></td></tr>';
  }

  if (viewMode === 'concept') {
    const ct = (m.type || '').toLowerCase();
    const ctg = typeColors[ct] || baseBadge + ' bg-muted text-muted-foreground';
    const csg = conceptStatusColors[(m.status || '').toLowerCase()] || baseBadge + ' bg-muted text-muted-foreground';
    const tagPills = (m.tags && m.tags.length ? m.tags : []).map(t => '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">' + esc(t) + '</span>').join(' ');
    return '<tr class="border-b border-border last:border-b-0 transition-colors hover:bg-muted/50" data-id="' + m.id + '" data-source="' + src + '">'
      + '<td class="p-2 font-medium max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">' + esc(m.title || m.slug || '') + '</td>'
      + '<td class="p-2"><span class="' + ctg + '">' + esc(m.type || '') + '</span></td>'
      + '<td class="text-xs p-2 align-middle truncate max-w-[120px]">' + (m.collection ? esc(m.collection) : EMPTY_PILL) + '</td>'
      + '<td class="max-w-[300px] truncate p-2 text-sm text-muted-foreground">' + esc(m.description || '') + '</td>'
      + '<td class="p-2">' + (tagPills || EMPTY_PILL) + '</td>'
      + '<td class="p-2 align-middle">' + (m.status ? '<span class="' + csg + '">' + esc(m.status) + '</span>' : EMPTY_PILL) + '</td>'
      + cloudCell
      + '<td class="whitespace-nowrap text-sm text-muted-foreground p-2 align-middle" title="' + new Date((m.updated_at || m.created_at || 0) * 1000).toISOString().slice(0, 19).replace('T', ' ') + '">' + timeAgo(m.updated_at || m.created_at) + '</td>'
      + '<td class="p-2"><div class="dropdown-menu">'
      + '<button class="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-accent" aria-haspopup="menu" aria-expanded="false" aria-label="Actions">' + KEBAB_SVG + '</button>'
      + '<div data-popover aria-hidden="true" class="z-50 rounded-lg bg-popover p-1 shadow-md ring-1 ring-border/10 min-w-40"><div role="menu">' + menu + '</div></div></td></tr>';
  }

  // aggregated ('all')
  const sourceLabel = m.source === 'memory' ? 'Memory' : 'Concept';
  let typeClass;
  if (src === 'memory') {
    const k = (m.type || '').toLowerCase();
    const kc = kindColors[k] || baseBadge + ' bg-muted text-muted-foreground';
    typeClass = kc;
  } else {
    const t = (m.type || '').toLowerCase();
    const tc = typeColors[t] || baseBadge + ' bg-muted text-muted-foreground';
    typeClass = tc;
  }
  let contentStatusCell = EMPTY_PILL;
  if (m.status) {
    if (src === 'memory') {
      const sg = kindStatusColors[(m.status || '').toLowerCase()] || baseBadge + ' bg-muted text-muted-foreground';
      contentStatusCell = '<span class="' + sg + '">' + esc(m.status) + '</span>';
    } else {
      const sg2 = conceptStatusColors[(m.status || '').toLowerCase()] || baseBadge + ' bg-muted text-muted-foreground';
      contentStatusCell = '<span class="' + sg2 + '">' + esc(m.status) + '</span>';
    }
  }

  return '<tr class="border-b border-border last:border-b-0 transition-colors hover:bg-muted/50" data-id="' + m.id + '" data-source="' + src + '">'
    + '<td class="p-2"><span class="' + (sourceColors[src] || baseBadge + ' bg-muted text-muted-foreground') + '">' + sourceLabel + '</span></td>'
    + '<td class="max-w-[300px] truncate p-2 text-sm">' + esc(m.preview || m.title || m.description || m.slug || '') + '</td>'
    + '<td class="p-2"><span class="' + typeClass + '">' + esc(src === 'memory' ? kindLabel(m.type) : (m.type || '')) + '</span></td>'
    + '<td class="p-2 align-middle">' + contentStatusCell + '</td>'
    + cloudCell
    + '<td class="whitespace-nowrap text-sm text-muted-foreground p-2" title="' + new Date((m.created_at || 0) * 1000).toISOString().slice(0, 19).replace('T', ' ') + '">' + timeAgo(m.created_at) + '</td>'
    + '<td class="p-2"><div class="dropdown-menu">'
    + '<button class="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-accent" aria-haspopup="menu" aria-expanded="false" aria-label="Actions">' + KEBAB_SVG + '</button>'
    + '<div data-popover aria-hidden="true" class="z-50 rounded-lg bg-popover p-1 shadow-md ring-1 ring-border/10 min-w-40"><div role="menu">' + menu + '</div></div></td></tr>';
}

function buildMenu(m) {
  const s = m.source;
  const id = m.id;
  const items = [];
  items.push('<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent preview-action" data-id="' + id + '" data-source="' + s + '">Preview</div>');

  if (m._scope === 'local') {
    if (m.synapseStatus === 'shared' && m.direction === 'push') {
      items.push('<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent unshare-action" data-id="' + id + '" data-source="' + s + '">Unshare</div>');
    } else {
      items.push('<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent share-action" data-id="' + id + '" data-source="' + s + '">Share</div>');
    }
    return items.join('');
  }

  switch (m.synapseStatus) {
    case 'unshared':
      items.push('<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent share-action" data-id="' + id + '" data-source="' + s + '">Share</div>');
      break;
    case 'shared':
      if (m.direction === 'push') {
        items.push('<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent unshare-action" data-id="' + id + '" data-source="' + s + '">Unshare</div>');
      } else {
        items.push('<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent pull-delete-action" data-id="' + id + '" data-source="' + s + '">Remove Local</div>');
      }
      break;
    case 'pulled':
      items.push('<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent pull-delete-action" data-id="' + id + '" data-source="' + s + '">Remove Local</div>');
      break;
    default:
      items.push('<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent dismiss-action" data-id="' + id + '" data-source="' + s + '">Dismiss</div>');
  }
  return items.join('');
}

export function tableRender(data) {
  state.lastData = data;
  hideSkeleton();
  $('error').style.display = 'none';

  state.total = data.total;
  const allRows = data.rows;
  for (let i = 0; i < allRows.length; i++) {
    allRows[i]._scope = allRows[i].origin || 'local';
  }

  const tbody = $('tbody');
  const stats = $('stats');
  const pagination = $('pagination');

  if (allRows.length === 0) {
    const colspan = state.source === 'memory' ? 9 : state.source === 'concept' ? 9 : 7;
    const msg = state.search ? 'No results for "' + esc(state.search) + '"' : 'No synapses yet';
    tbody.innerHTML = '<tr><td colspan="' + colspan + '"><div class="empty">' + msg + '</div></td></tr>';
    stats.textContent = msg;
    pagination.innerHTML = '';
    return;
  }

  const viewMode = state.source || 'all';
  $('thead-all').classList.toggle('hidden', viewMode !== 'all');
  $('thead-memory').classList.toggle('hidden', viewMode !== 'memory');
  $('thead-concept').classList.toggle('hidden', viewMode !== 'concept');

  stats.textContent = 'Showing ' + (data.offset + 1) + '\u2013' + Math.min(data.offset + data.rows.length, data.total) + ' of ' + data.total + ' synapses';
  tbody.innerHTML = allRows.map(m => buildRow(m, viewMode)).join('');

  const allMenus = tbody.querySelectorAll('.dropdown-menu');
  const n = allMenus.length;
  if (n > 0) {
    for (let i = 0; i < n; i++) {
      const popover = allMenus[i].querySelector('[data-popover]');
      if (popover) {
        popover.setAttribute('data-align', i >= n - 3 ? 'end' : 'start');
        popover.setAttribute('data-side', 'left');
        popover.style.margin = '0';
      }
    }
  }

  const tp = Math.ceil(data.total / state.limit);
  const cp = Math.floor(state.offset / state.limit) + 1;
  pagination.innerHTML = '<button id="page-prev" class="btn rounded-full cursor-pointer" data-variant="outline" data-size="sm"' + (cp <= 1 ? ' disabled' : '') + ' aria-label="Previous page">&larr; Prev</button>'
    + '<span class="text-[13px]">Page ' + cp + ' of ' + tp + '</span>'
    + '<button id="page-next" class="btn rounded-full cursor-pointer" data-variant="outline" data-size="sm"' + (cp >= tp ? ' disabled' : '') + ' aria-label="Next page">Next &rarr;</button>';

  if (window.basecoat && window.basecoat.initAll) {
    setTimeout(() => { window.basecoat.initAll({ force: true }); }, 0);
  }
}

// ── Preview modal ──

function renderPreviewNav() {
  $('preview-back').disabled = state.previewHistory.length <= 1;
  $('preview-forward').disabled = state.previewForward.length === 0;
}

function renderPreviewMeta(s) {
  const el = $('preview-meta');
  const parts = [];
  parts.push('<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">' + (s.source === 'memory' ? 'Memory' : 'Concept') + '</span>');
  if (s.source === 'memory') {
    const k = (s.type || '').toLowerCase();
    const kc = kindColors[k] || baseBadge + ' bg-muted text-muted-foreground';
    parts.push('<span class="' + kc + '">' + esc(kindLabel(s.type)) + '</span>');
    if (s.project) parts.push('<span class="text-muted-foreground">' + esc(s.project) + '</span>');
  } else {
    const t = (s.type || '').toLowerCase();
    const tc = typeColors[t] || baseBadge + ' bg-muted text-muted-foreground';
    parts.push('<span class="' + tc + '">' + esc(s.type || '') + '</span>');
    if (s.slug) {
      const crumbs = [s.collection, ...s.slug.split('/')].filter(Boolean);
      parts.push('<span class="text-muted-foreground font-mono text-xs">' + crumbs.map(c => esc(c)).join(' <span class="text-muted-foreground/40">›</span> ') + '</span>');
    }
  }
  parts.push('<span class="text-muted-foreground">#' + s.id + '</span>');
  if (s.created_at) parts.push('<span class="text-muted-foreground">' + new Date(s.created_at * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + '</span>');
  el.innerHTML = parts.join(' <span class="text-muted-foreground/40">&middot;</span> ');
}

function showPreviewLoading() {
  $('preview-body').innerHTML = '';
  $('preview-loading').classList.remove('hidden');
}

function hidePreviewLoading() {
  $('preview-loading').classList.add('hidden');
}

function renderPreviewBody(body) {
  $('preview-body').innerHTML = body || 'No content.';
}

function updatePreviewShareButton() {
  const h = state.previewHistory[state.previewHistory.length - 1];
  if (!h) return;
  const allRows = state.lastData?.rows || [];
  const row = allRows.find(r => r.id === h.id && r.source === h.source);
  const btn = $('preview-share');
  if (!btn || btn.hidden) return;
  const total = state.previewFamilyTotal || 0;
  const withCount = (verb) => (h.source === 'concept' && total >= 1)
    ? verb + ' ' + total + (total === 1 ? ' concept' : ' concepts')
    : verb;
  if (row && row.synapseStatus === 'shared' && row.direction === 'push') {
    const cs = row.cloud_status || '';
    if (cs === 'pending_unshare') { btn.textContent = 'Cancel unshare'; btn.disabled = false; return; }
    if (cs === 'rejected') { btn.textContent = withCount('Re-share'); btn.disabled = false; return; }
    btn.textContent = row.isDirty ? 'Re-push' : withCount('Unshare');
  } else {
    btn.textContent = withCount('Share');
  }
  btn.disabled = false;
}

function renderPreviewRelations(s) {
  const isMemory = s.source === 'memory';
  const relBy = s.referenced_by || [];
  const siblings = isMemory ? [] : (s.siblings || []);
  const related = isMemory ? (s.related_ids || []) : (s.references || []);
  const all = (typeof state.lastData !== 'undefined' && state.lastData) ? (state.lastData.rows || []) : [];

  state.previewFamilyTotal = isMemory ? 0 : (s.family_total || 0);

  const fill = (id, label, items) => {
    const sel = $(id);
    if (!sel) return;
    sel.disabled = items.length === 0;
    sel.innerHTML = '<option value="" disabled selected>' + esc(label + ' (' + items.length + ')') + '</option>' +
      items.map(it => '<option value="' + esc(String(it.id)) + '">' + esc(it.label) + '</option>').join('');
    sel.value = '';
  };

  const sibSelect = $('preview-siblings-select');
  if (isMemory) {
    fill('preview-relby-select', 'Referenced by', relBy.map(r => ({
      id: r.id, label: 'Memory #' + r.id + (r.status ? ' (' + r.status + ')' : ''),
    })));
    fill('preview-related-select', 'Related', related.map(id => {
      let label = 'Memory #' + id;
      const relRow = all.find(x => x.id === id && x.source === 'memory');
      if (relRow && relRow.status) label += ' (' + relRow.status + ')';
      return { id, label };
    }));
    if (sibSelect) {
      sibSelect.classList.add('!hidden');
      sibSelect.disabled = true;
      sibSelect.innerHTML = '<option value="" disabled selected>Siblings</option>';
    }
  } else {
    if (sibSelect) sibSelect.classList.remove('!hidden');
    const labelOf = (r) => r.title || String(r.slug || '').split('/').pop();
    fill('preview-relby-select', 'Ancestors', relBy.map(r => ({ id: r.id, label: labelOf(r) })));
    fill('preview-siblings-select', 'Siblings', siblings.map(r => ({ id: r.id, label: labelOf(r) })));
    fill('preview-related-select', 'Descendants', related.map(r => ({ id: r.id, label: labelOf(r) })));
  }

  // Show/hide team selector for multi-node
  const teamSelect = $('preview-team-select');
  if (teamSelect && state.nodes.length > 1) {
    teamSelect.classList.remove('!hidden');
    teamSelect.innerHTML = state.nodes.map(function (n) {
      return '<option value="' + esc(n.account_slug) + '">' + esc(n.account_name) + '</option>';
    }).join('');
    if (state.activeNodeSlug) teamSelect.value = state.activeNodeSlug;
  } else if (teamSelect) {
    teamSelect.classList.add('!hidden');
    teamSelect.innerHTML = '';
  }
}

export function navigatePreview(id, source) {
  const current = { id: id, source: source };
  const idx = state.previewHistory.findIndex(h => h.id === current.id && h.source === current.source);
  if (idx !== -1) {
    const removed = state.previewHistory.splice(idx + 1);
    state.previewForward = removed.reverse().concat(state.previewForward);
  } else {
    if (state.previewHistory.length >= 10) state.previewHistory.shift();
    state.previewHistory.push(current);
    state.previewForward = [];
  }

  const allRows = (typeof state.lastData !== 'undefined' && state.lastData) ? (state.lastData.rows || []) : [];
  const row = allRows.find(r => r.id === id && r.source === source);

  const version = ++state.previewNavVersion;
  renderPreviewNav();
  showPreviewLoading();

  let url;
  if (row && row._scope === 'local' && source === 'memory') {
    url = '/api/memories/' + id + '?project=' + encodeURIComponent(row.project || '');
  } else {
    url = '/api/synapses/' + id + '?source=' + encodeURIComponent(source);
  }
  fetch(url)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(s => {
      if (version !== state.previewNavVersion) return;
      hidePreviewLoading();
      renderPreviewMeta(s);
      renderPreviewBody(s.body_html || s.content_html || s.body || s.content || s.description || s.preview);
      renderPreviewRelations(s);
      renderPreviewNav();
      updatePreviewShareButton();
    })
    .catch(() => {
      if (version !== state.previewNavVersion) return;
      state.previewHistory = state.previewHistory.filter(h => h.id !== id || h.source !== source);
      hidePreviewLoading();
      $('preview-meta').innerHTML = '';
      $('preview-relby-select').innerHTML = '<option value="" disabled selected>Ancestors</option>';
      $('preview-relby-select').disabled = true;
      $('preview-siblings-select').innerHTML = '<option value="" disabled selected>Siblings</option>';
      $('preview-siblings-select').disabled = true;
      $('preview-related-select').innerHTML = '<option value="" disabled selected>Descendants</option>';
      $('preview-related-select').disabled = true;
      state.previewFamilyTotal = 0;
      const errTitle = typeof id === 'number' ? 'Synapse #' + id : 'Concept: ' + id.toString().split('/').pop();
      renderPreviewBody('Error loading synapse.');
      renderPreviewNav();
      toast('Failed to load: ' + errTitle, 'error');
    });
}

export function previewSynapse(id, source) {
  state.previewHistory.length = 0;
  state.previewForward.length = 0;
  state.previewNavVersion = 0;
  $('preview-dialog').showModal();
  navigatePreview(id, source);
}

// ── Row removal ──

export function removeRow(id) {
  const row = document.querySelector('tr[data-id="' + id + '"]');
  if (!row) return;
  row.style.transition = 'opacity .2s';
  row.style.opacity = '0';
  setTimeout(() => { row.remove(); }, 250);
}

// ── Project dropdown ──

export function renderMemDropdown(projects) {
  const dd = $('mem-project-dropdown');
  const input = $('mem-project');
  if (projects.length === 0) {
    dd.innerHTML = '<div class="project-picker-empty">No projects found</div>';
  } else {
    dd.innerHTML = projects.map(p =>
      '<div class="project-picker-option" role="option" data-value="' + esc(p) + '">' + esc(p) + '</div>'
    ).join('');
  }
  input.setAttribute('aria-expanded', dd.classList.contains('open') ? 'true' : 'false');
}

export function renderConDropdown(collections) {
  const dd = $('con-collection-dropdown');
  const input = $('con-collection');
  if (collections.length === 0) {
    dd.innerHTML = '<div class="project-picker-empty">No collections found</div>';
  } else {
    dd.innerHTML = collections.map(c =>
      '<div class="project-picker-option" role="option" data-value="' + esc(c) + '">' + esc(c) + '</div>'
    ).join('');
  }
  input.setAttribute('aria-expanded', dd.classList.contains('open') ? 'true' : 'false');
}

// ── Scope toggle ──

export function setScope(s) {
  state.scope = s;
  state.offset = 0;
  ['all', 'local', 'team'].forEach(v => {
    const btn = $('scope-' + v);
    if (v === s) {
      btn.classList.add('bg-accent', 'text-accent-foreground');
      btn.classList.remove('bg-transparent', 'text-muted-foreground');
    } else {
      btn.classList.remove('bg-accent', 'text-accent-foreground');
      btn.classList.add('bg-transparent', 'text-muted-foreground');
    }
  });
}

// ── Leaderboard display ──

export function openLeaderboard() {
  $('leaderboard-dialog').showModal();
}

export function renderLeaderboardBody(s, period) {
  const pills = document.querySelectorAll('#leaderboard-pills button');
  for (let p = 0; p < pills.length; p++) {
    if (pills[p].dataset.period === period) {
      pills[p].classList.add('bg-accent', 'text-accent-foreground');
      pills[p].classList.remove('bg-transparent', 'text-muted-foreground');
    } else {
      pills[p].classList.remove('bg-accent', 'text-accent-foreground');
      pills[p].classList.add('bg-transparent', 'text-muted-foreground');
    }
  }

  $('leaderboard-loading').style.display = 'none';

  if (!s.tools || s.tools.length === 0) {
    $('leaderboard-body').innerHTML = '<div class="text-sm text-muted-foreground py-8 text-center">No data for this period</div>';
    return;
  }

  let rows = '<div class="text-xs text-muted-foreground mb-2 pb-2 border-b border-border">' + s.tools.length + ' tools · ' + (s.total_in_period || 0) + ' total calls</div>' +
    '<div class="flex items-center gap-3 mb-2 text-xs text-muted-foreground">' +
    '<span class="w-5 text-right">#</span>' +
    '<span class="w-36 font-medium">Tool</span>' +
    '<span class="w-24 text-right">Calls</span>' +
    '<span class="flex-1">Share</span>' +
    '<span class="w-20 text-right">Success</span>' +
    '</div>';
  for (let i = 0; i < s.tools.length; i++) {
    const t = s.tools[i];
    let barColor;
    if (t.success_rate >= 95) barColor = 'bg-emerald-500';
    else if (t.success_rate >= 80) barColor = 'bg-amber-500';
    else barColor = 'bg-rose-500';
    const barWidth = Math.max(t.share_pct, 2);
    rows += '<div class="flex items-center gap-3 mb-2">' +
      '<span class="w-5 text-xs text-right text-muted-foreground font-mono">' + (i + 1) + '</span>' +
      '<span class="w-36 text-sm font-mono truncate">' + esc(t.tool) + '</span>' +
      '<span class="w-24 text-xs text-right text-muted-foreground">' + t.count + ' (' + t.share_pct + '%)</span>' +
      '<div class="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">' +
        '<div class="h-full rounded-full ' + barColor + '" style="width:' + barWidth + '%"></div>' +
      '</div>' +
      '<span class="w-20 text-xs text-right truncate ' + (t.success_rate >= 95 ? 'text-emerald-600 dark:text-emerald-400' : t.success_rate >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400') + '">' + (t.count - (t.error_count || 0)) + '/' + t.count + ' (' + t.success_rate + '%)</span>' +
    '</div>';
  }
  $('leaderboard-body').innerHTML = rows;
}
