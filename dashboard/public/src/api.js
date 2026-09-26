'use strict';

import { $, state, allMemProjects, allConceptCollections, esc } from './state.js';
import {
  showSkeleton, tableRender,
  renderMemDropdown, renderConDropdown, renderLeaderboardBody,
} from './ui.js';

// ── Load synapses ──

let loadVersion = 0;

export async function loadSynapses() {
  const version = ++loadVersion;
  showSkeleton();

  const params = new URLSearchParams();
  params.set('scope', state.scope);
  params.set('limit', state.limit);
  params.set('offset', state.offset);
  if (state.source) params.set('source', state.source);
  if (state.status) params.set('status', state.status);
  if (state.search) params.set('search', state.search);
  if (state.memProject) params.set('project', state.memProject);
  if (state.memKind) params.set('kind', state.memKind);
  if (state.memLifecycle) params.set('lifecycle', state.memLifecycle);
  if (state.memStatus) params.set('memstatus', state.memStatus);
  if (state.conType) params.set('conType', state.conType);
  if (state.conStatus) params.set('conStatus', state.conStatus);
  if (state.conCollection) params.set('collection', state.conCollection);

  const r = await fetch('/api/dashboard?' + params.toString());
  if (!r.ok) throw new Error('Failed to load data');
  const data = await r.json();

  if (version !== loadVersion) return;
  tableRender(data);
}

// ── Status ──

export async function loadStatus() {
  try {
    const r = await fetch('/api/status');
    if (!r.ok) return;
    const data = await r.json();
    state.nodes = data.nodes || [];
    state.activeNodeSlug = data.active_account_slug || '';
    if (data.authenticated) {
      $('preview-share').hidden = false;
      $('stat-env-local').classList.add('hidden');
      $('stat-env-cloud').classList.remove('hidden');
      const syncNowBtn = $('sync-now');
      if (syncNowBtn) { syncNowBtn.title = 'Authenticated — Node: ' + (data.nodeId || '?'); }
      const syncDotCard = $('sync-dot-card');
      if (syncDotCard) syncDotCard.style.background = '#4caf50';
    } else {
      $('preview-share').hidden = true;
      $('stat-env-local').classList.remove('hidden');
      $('stat-env-cloud').classList.add('hidden');
    }
  } catch {}
}

export async function loadStats() {
  try {
    const r = await fetch('/api/stats');
    if (!r.ok) return;
    const s = await r.json();
    $('stats-cards').classList.remove('hidden');
    $('stat-total').textContent = s.total.toLocaleString();
    const srcText = [];
    if (s.memoryCount) srcText.push(s.memoryCount.toLocaleString() + ' Memories');
    if (s.conceptCount) srcText.push(s.conceptCount.toLocaleString() + ' Concepts');
    $('stat-sources').textContent = srcText.join(' \u00b7 ') || '\u2014';
    const teamSync = s.teamSync || [];
    if (teamSync.length > 0) {
      $('stat-sync-detail').innerHTML = teamSync.map(function (t) {
        return (t.name ? esc(t.name) + ' \u00b7 ' : '') + t.shared + ' Shared \u00b7 ' + t.pulled + ' Pulled';
      }).join('<br>');
    } else {
      const syncSub = [];
      if (s.sharedCount) syncSub.push(s.sharedCount + ' Shared');
      if (s.pulledCount) syncSub.push(s.pulledCount + ' Pulled');
      $('stat-sync-detail').textContent = syncSub.join(' \u00b7 ') || 'No data synced yet.';
    }
  } catch {}
}

export async function loadMemoryProjects() {
  const r = await fetch('/api/projects');
  if (!r.ok) return;
  const projects = await r.json();
  allMemProjects.length = 0;
  Array.prototype.push.apply(allMemProjects, projects);
  renderMemDropdown(allMemProjects);
}

export async function loadConceptCollections() {
  const r = await fetch('/api/collections');
  if (!r.ok) return;
  const collections = await r.json();
  allConceptCollections.length = 0;
  Array.prototype.push.apply(allConceptCollections, collections);
  renderConDropdown(allConceptCollections);
}

export async function loadToolStats() {
  try {
    const r = await fetch('/api/tool-stats');
    if (!r.ok) return;
    const s = await r.json();
    const success = Math.round((1 - (s.last_7d_error_rate || 0)) * 100);
    const calls = (s.total_last_7d || 0).toLocaleString();
    $('stat-tool-detail').textContent = calls + ' calls \u00b7 ' + success + '% success \u00b7 Last 7 days';
  } catch {}
}

export async function loadLeaderboard(period) {
  $('leaderboard-loading').style.display = '';
  try {
    const r = await fetch('/api/tool-stats?period=' + encodeURIComponent(period));
    if (!r.ok) { $('leaderboard-loading').style.display = 'none'; return; }
    const s = await r.json();
    renderLeaderboardBody(s, period);
  } catch (e) {
    $('leaderboard-loading').style.display = 'none';
  }
}
