'use strict';

import {
  $, state, allMemProjects, allConceptCollections,
  toast, showError,
  memProjectEl, memProjectDropdownEl, conCollectionEl, conCollectionDropdownEl,
  syncThemeBtn, CLOUD_URL,
} from './state.js';
import {
  renderMemDropdown, renderConDropdown, setScope, previewSynapse,
  navigatePreview, removeRow, openLeaderboard,
} from './ui.js';
import {
  loadSynapses, loadStatus, loadStats,
  loadMemoryProjects, loadConceptCollections, loadLeaderboard,
} from './api.js';

export function initEvents() {

  $('source').addEventListener('change', function () {
    state.source = this.value;
    state.offset = 0;
    $('filters-memory').classList.toggle('hidden', this.value !== 'memory');
    $('filters-concept').classList.toggle('hidden', this.value !== 'concept');
    if (this.value === 'memory') loadMemoryProjects().catch(function () {});
    if (this.value === 'concept') loadConceptCollections().catch(function () {});
    loadSynapses().catch(showError);
  });

  $('status').addEventListener('change', function () {
    state.status = this.value;
    state.offset = 0;
    loadSynapses().catch(showError);
  });

  $('scope-all').addEventListener('click', function () {
    setScope('all');
    loadSynapses().catch(showError);
  });
  $('scope-local').addEventListener('click', function () {
    setScope('local');
    loadSynapses().catch(showError);
  });
  $('scope-team').addEventListener('click', function () {
    setScope('team');
    loadSynapses().catch(showError);
  });

  $('mem-kind').addEventListener('change', function () {
    state.memKind = this.value;
    state.offset = 0;
    loadSynapses().catch(showError);
  });

  $('mem-status-ctx').addEventListener('change', function () {
    state.memStatus = this.value;
    state.offset = 0;
    loadSynapses().catch(showError);
  });

  $('con-type').addEventListener('change', function () {
    state.conType = this.value;
    state.offset = 0;
    loadSynapses().catch(showError);
  });

  $('con-status-ctx').addEventListener('change', function () {
    state.conStatus = this.value;
    state.offset = 0;
    loadSynapses().catch(showError);
  });

  $('mem-lifecycle').addEventListener('change', function () {
    state.memLifecycle = this.value;
    state.offset = 0;
    loadSynapses().catch(showError);
  });

  // Project combobox
  $('mem-project').addEventListener('focus', function () {
    renderMemDropdown(allMemProjects);
    memProjectDropdownEl().classList.add('open');
    this.setAttribute('aria-expanded', 'true');
  });

  $('mem-project').addEventListener('input', function () {
    const val = this.value.toLowerCase();
    const filtered = allMemProjects.filter(p => p.toLowerCase().includes(val));
    renderMemDropdown(filtered);
    memProjectDropdownEl().classList.add('open');
    this.setAttribute('aria-expanded', 'true');
  });

  memProjectDropdownEl().addEventListener('mousedown', function (e) {
    e.preventDefault();
    const opt = e.target.closest('.project-picker-option');
    if (opt) {
      memProjectEl().value = opt.dataset.value;
      $('mem-project-clear').classList.remove('hidden');
      memProjectDropdownEl().classList.remove('open');
      memProjectEl().setAttribute('aria-expanded', 'false');
      memProjectEl().dispatchEvent(new Event('change'));
    }
  });

  memProjectEl().addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && memProjectEl().value) {
      $('mem-project-clear').click();
      return;
    }
    const dd = memProjectDropdownEl();
    if (!dd.classList.contains('open')) return;
    const items = dd.querySelectorAll('.project-picker-option');
    if (items.length === 0) return;
    const cur = dd.querySelector('.project-picker-option.highlight');
    let idx = cur ? Array.from(items).indexOf(cur) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cur) cur.classList.remove('highlight');
      idx = (idx + 1) % items.length;
      items[idx].classList.add('highlight');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cur) cur.classList.remove('highlight');
      idx = (idx - 1 + items.length) % items.length;
      items[idx].classList.add('highlight');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur) {
        memProjectEl().value = cur.dataset.value;
        dd.classList.remove('open');
        memProjectEl().setAttribute('aria-expanded', 'false');
        memProjectEl().dispatchEvent(new Event('change'));
      }
    } else if (e.key === 'Escape') {
      dd.classList.remove('open');
      memProjectEl().setAttribute('aria-expanded', 'false');
    }
  });

  memProjectEl().addEventListener('blur', function () {
    setTimeout(function () {
      memProjectDropdownEl().classList.remove('open');
      memProjectEl().setAttribute('aria-expanded', 'false');
    }, 200);
  });

  $('mem-project-clear').addEventListener('click', function () {
    memProjectEl().value = '';
    this.classList.add('hidden');
    memProjectEl().dispatchEvent(new Event('change'));
    memProjectEl().focus();
  });

  $('mem-project').addEventListener('change', function () {
    state.memProject = this.value;
    $('mem-project-clear').classList.toggle('hidden', !this.value);
    state.offset = 0;
    loadSynapses().catch(showError);
  });

  // Collection combobox
  $('con-collection').addEventListener('focus', function () {
    renderConDropdown(allConceptCollections);
    conCollectionDropdownEl().classList.add('open');
    this.setAttribute('aria-expanded', 'true');
  });

  $('con-collection').addEventListener('input', function () {
    const val = this.value.toLowerCase();
    const filtered = allConceptCollections.filter(c => c.toLowerCase().includes(val));
    renderConDropdown(filtered);
    conCollectionDropdownEl().classList.add('open');
    this.setAttribute('aria-expanded', 'true');
  });

  conCollectionDropdownEl().addEventListener('mousedown', function (e) {
    e.preventDefault();
    const opt = e.target.closest('.project-picker-option');
    if (opt) {
      conCollectionEl().value = opt.dataset.value;
      $('con-collection-clear').classList.remove('hidden');
      conCollectionDropdownEl().classList.remove('open');
      conCollectionEl().setAttribute('aria-expanded', 'false');
      conCollectionEl().dispatchEvent(new Event('change'));
    }
  });

  conCollectionEl().addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && conCollectionEl().value) {
      $('con-collection-clear').click();
      return;
    }
    const dd = conCollectionDropdownEl();
    if (!dd.classList.contains('open')) return;
    const items = dd.querySelectorAll('.project-picker-option');
    if (items.length === 0) return;
    const cur = dd.querySelector('.project-picker-option.highlight');
    let idx = cur ? Array.from(items).indexOf(cur) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cur) cur.classList.remove('highlight');
      idx = (idx + 1) % items.length;
      items[idx].classList.add('highlight');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cur) cur.classList.remove('highlight');
      idx = (idx - 1 + items.length) % items.length;
      items[idx].classList.add('highlight');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur) {
        conCollectionEl().value = cur.dataset.value;
        dd.classList.remove('open');
        conCollectionEl().setAttribute('aria-expanded', 'false');
        conCollectionEl().dispatchEvent(new Event('change'));
      }
    } else if (e.key === 'Escape') {
      dd.classList.remove('open');
      conCollectionEl().setAttribute('aria-expanded', 'false');
    }
  });

  conCollectionEl().addEventListener('blur', function () {
    setTimeout(function () {
      conCollectionDropdownEl().classList.remove('open');
      conCollectionEl().setAttribute('aria-expanded', 'false');
    }, 200);
  });

  $('con-collection-clear').addEventListener('click', function () {
    conCollectionEl().value = '';
    this.classList.add('hidden');
    conCollectionEl().dispatchEvent(new Event('change'));
    conCollectionEl().focus();
  });

  $('con-collection').addEventListener('change', function () {
    state.conCollection = this.value;
    $('con-collection-clear').classList.toggle('hidden', !this.value);
    state.offset = 0;
    loadSynapses().catch(showError);
  });

  // Search
  $('search').addEventListener('input', function () {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.search = this.value.trim();
      state.offset = 0;
      loadSynapses().catch(showError);
    }, 200);
  });

  // Sync button
  const syncNowBtn = $('sync-now');
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', function () {
      fetch('/api/sync', { method: 'POST' })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); toast('Sync started', 'info'); })
        .catch(() => { toast('Sync failed', 'error'); });
    });
  }

  // Tbody actions (preview, share, unlink, etc.)
  $('tbody').addEventListener('click', function (e) {
    const previewItem = e.target.closest('.preview-action');
    if (previewItem) {
      previewSynapse(parseInt(previewItem.dataset.id, 10), previewItem.dataset.source);
      return;
    }

    const shareItem = e.target.closest('.share-action');
    if (shareItem) {
      e.stopPropagation();
      fetch('/api/synapses/' + shareItem.dataset.id + '/share?source=' + encodeURIComponent(shareItem.dataset.source), { method: 'POST' })
        .then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) throw new Error(body.error || 'Share failed');
          if (body.already_shared) { toast('Already shared', 'warning'); }
          else if (body.duplicate) { toast(body.detail || 'Duplicate', 'warning'); }
          else { toast('Synapse shared', 'success'); }
          loadSynapses().catch(showError);
        })
        .catch(err => toast('Share failed: ' + err.message, 'error'));
      return;
    }

    const unshareItem = e.target.closest('.unshare-action');
    if (unshareItem) {
      e.stopPropagation();
      fetch('/api/synapses/' + unshareItem.dataset.id + '/unshare?source=' + encodeURIComponent(unshareItem.dataset.source), { method: 'POST' })
        .then(r => { if (!r.ok) throw new Error('Unshare failed'); return r.json(); })
        .then(() => { toast('Unshare requested', 'success'); loadSynapses().catch(showError); })
        .catch(err => toast('Unshare failed: ' + err.message, 'error'));
      return;
    }

    const pullDeleteItem = e.target.closest('.pull-delete-action');
    if (pullDeleteItem) {
      e.stopPropagation();
      const id = pullDeleteItem.dataset.id;
      const source = pullDeleteItem.dataset.source;
      const dialog = $('confirm-dialog');
      $('confirm-message').textContent = 'Remove pulled synapse from local storage? This only deletes your local copy.';
      dialog.showModal();
      $('confirm-ok').onclick = function () {
        dialog.close();
        fetch('/api/synapses/' + id + '/pull-delete?source=' + encodeURIComponent(source), { method: 'POST' })
          .then(r => { if (!r.ok) throw new Error('Remove failed'); return r.json(); })
          .then(() => { toast('Local copy removed', 'success'); loadSynapses().catch(showError); })
          .catch(err => toast('Remove failed: ' + err.message, 'error'));
      };
      $('confirm-cancel').onclick = function () { dialog.close(); };
      return;
    }

    const dismissItem = e.target.closest('.dismiss-action');
    if (dismissItem) {
      e.stopPropagation();
      fetch('/api/synapses/' + dismissItem.dataset.id + '/dismiss?source=' + encodeURIComponent(dismissItem.dataset.source), { method: 'POST' })
        .then(r => { if (!r.ok) throw new Error('Dismiss failed'); return r.json(); })
        .then(() => { toast('Dismissed', 'success'); loadSynapses().catch(showError); })
        .catch(err => toast('Dismiss failed: ' + err.message, 'error'));
      return;
    }
  });

  // Preview navigation
  $('preview-back').addEventListener('click', function () {
    if (state.previewHistory.length <= 1) return;
    const current = state.previewHistory.pop();
    state.previewForward.unshift(current);
    const prev = state.previewHistory[state.previewHistory.length - 1];
    navigatePreview(prev.id, prev.source);
  });

  $('preview-forward').addEventListener('click', function () {
    if (state.previewForward.length === 0) return;
    const next = state.previewForward.shift();
    state.previewHistory.push(next);
    navigatePreview(next.id, next.source);
  });

  // One shared change handler for all relation dropdowns (Ancestors / Siblings / Descendants).
  document.querySelectorAll('.preview-rel-select').forEach(function (sel) {
    sel.addEventListener('change', function () {
      if (!this.value) return;
      const h = state.previewHistory[state.previewHistory.length - 1];
      const source = h ? h.source : state.source;
      navigatePreview(parseInt(this.value, 10), source);
    });
  });

  $('preview-dialog').addEventListener('close', function () {
    state.previewHistory.length = 0;
    state.previewForward.length = 0;
    $('preview-meta').innerHTML = '';
    $('preview-body').innerHTML = '';
    $('preview-loading').classList.add('hidden');
    $('preview-back').disabled = true;
    $('preview-forward').disabled = true;
    $('preview-relby-select').innerHTML = '<option value="" disabled selected>Ancestors</option>';
    $('preview-relby-select').disabled = true;
    $('preview-siblings-select').innerHTML = '<option value="" disabled selected>Siblings</option>';
    $('preview-siblings-select').disabled = true;
    $('preview-related-select').innerHTML = '<option value="" disabled selected>Descendants</option>';
    $('preview-related-select').disabled = true;
    state.previewFamilyTotal = 0;
    const teamSelect = $('preview-team-select');
    if (teamSelect) { teamSelect.classList.add('!hidden'); teamSelect.innerHTML = ''; }
    const shareBtn = $('preview-share');
    if (shareBtn && shareBtn.dataset.unsharePending !== 'true') { shareBtn.textContent = 'Share'; shareBtn.disabled = false; }
  });

  // Preview share button
  $('preview-share').addEventListener('click', function () {
    const h = state.previewHistory[state.previewHistory.length - 1];
    if (!h) return;
    const allRows = state.lastData?.rows || [];
    const row = allRows.find(r => r.id === h.id && r.source === h.source);
    if (!row || row._scope !== 'local') { toast('Already shared', 'warning'); return; }

    if (row.synapseStatus === 'shared' && row.direction === 'push') {
      // Re-share: cancel unshare and set back to pending_approval
      const shareBtn = $('preview-share');
      if (shareBtn && shareBtn.dataset.unsharePending === 'true') {
        fetch('/api/synapses/' + row.id + '/share?source=' + encodeURIComponent(h.source), { method: 'POST' })
          .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
          .then(function (result) {
            if (result.ok) {
              shareBtn.dataset.unsharePending = '';
              shareBtn.textContent = 'Unshare';
              shareBtn.disabled = false;
              // Inline notification
              var rFooter = document.querySelector('#preview-dialog footer');
              if (rFooter) {
                var rNote = document.createElement('span');
                rNote.className = 'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700';
                rNote.textContent = 'Unshare cancelled';
                rFooter.insertBefore(rNote, rFooter.firstChild);
                setTimeout(function () { if (rNote.parentNode) rNote.remove(); }, 3000);
              }
              loadSynapses().catch(showError);
            } else {
              toast('Re-share failed: ' + (result.body.error || 'Unknown error'), 'error');
            }
          })
          .catch(function (err) { toast('Re-share failed: ' + err.message, 'error'); });
        return;
      }

      // Unshare expands the full family server-side.
      const unshareBtn = $('preview-share');
      unshareBtn.disabled = true;
      fetch('/api/synapses/' + row.id + '/unshare?source=' + encodeURIComponent(h.source), { method: 'POST' })
        .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
        .then(function (result) {
          unshareBtn.disabled = false;
          if (!result.ok) { toast('Unshare failed: ' + (result.body.error || 'Unknown error'), 'error'); return; }
          var b = result.body;
          var text = (b.requested || 0) + ' unshared' + (b.errors ? ', ' + b.errors + ' failed' : '');
          toast(text, b.errors ? 'warning' : 'success');
          unshareBtn.dataset.unsharePending = 'true';
          unshareBtn.textContent = 'Unshare pending';
          unshareBtn.disabled = true;
          var uFooter = document.querySelector('#preview-dialog footer');
          if (uFooter) {
            var uNote = document.createElement('span');
            uNote.className = 'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700';
            uNote.textContent = text + ' · Pull to refresh';
            uFooter.insertBefore(uNote, uFooter.firstChild);
            setTimeout(function () { if (uNote.parentNode) uNote.remove(); }, 3000);
          }
          loadSynapses().catch(showError);
        })
        .catch(function (err) { unshareBtn.disabled = false; toast('Unshare failed: ' + err.message, 'error'); });
      return;
    }

    // Share expands the full family server-side (single POST).
    const teamSelect = $('preview-team-select');
    const accountSlug = (teamSelect && !teamSelect.classList.contains('!hidden') && teamSelect.value) || undefined;

    const shareBtn = $('preview-share');
    shareBtn.disabled = true;
    var url = '/api/synapses/' + row.id + '/share?source=' + encodeURIComponent(h.source);
    if (accountSlug) url += '&account_slug=' + encodeURIComponent(accountSlug);
    fetch(url, { method: 'POST' })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (result) {
        shareBtn.disabled = false;
        if (!result.ok) { toast('Share failed: ' + (result.body.error || 'Unknown error'), 'error'); return; }
        var b = result.body;
        var msg = [];
        if (b.newly_shared) msg.push(b.newly_shared + ' shared');
        if (b.already_shared) msg.push(b.already_shared + ' already shared');
        if (b.family_total) msg.push('of ' + b.family_total + ' in family');
        var text = msg.join(', ') || 'Nothing to share';
        toast(text, 'success');
        shareBtn.textContent = 'Unshare';
        var footer = document.querySelector('#preview-dialog footer');
        if (footer) {
          var note = document.createElement('span');
          note.className = 'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700';
          note.textContent = text + ' · Pull to refresh';
          footer.insertBefore(note, footer.firstChild);
          setTimeout(function () { if (note.parentNode) note.remove(); }, 3000);
        }
        loadSynapses().catch(showError);
      })
      .catch(function (err) { shareBtn.disabled = false; toast('Share failed: ' + err.message, 'error'); });
  });

  // Pagination
  $('pagination').addEventListener('click', function (e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'page-prev' && state.offset > 0) {
      state.offset = Math.max(0, state.offset - state.limit);
      loadSynapses().catch(showError);
    } else if (btn.id === 'page-next') {
      state.offset += state.limit;
      loadSynapses().catch(showError);
    }
  });

  // Theme toggle
  $('theme-btn').addEventListener('click', function () {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('cordenar-theme', isDark ? 'dark' : 'light');
    syncThemeBtn(isDark);
  });

  // Leaderboard
  $('view-leaderboard').addEventListener('click', function () {
    openLeaderboard();
    loadLeaderboard('7d');
  });
  $('leaderboard-pills').addEventListener('click', function (e) {
    e.stopPropagation();
    const btn = e.target.closest('button');
    if (!btn) return;
    loadLeaderboard(btn.dataset.period);
  });

  // Confirm dialog
  $('confirm-dialog').addEventListener('click', function (e) {
    if (e.target === this) this.close();
  });

  // Select placeholder: muted when empty, foreground when a value is chosen.
  [
    'source', 'status', 'mem-kind', 'mem-status-ctx', 'mem-lifecycle',
    'con-type', 'con-status-ctx'
  ].forEach(function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.classList.toggle('text-muted-foreground', sel.value === '');
    sel.addEventListener('change', function () {
      sel.classList.toggle('text-muted-foreground', sel.value === '');
    });
  });

}

// ── SSE + polling ──

export function setupSSE() {
  const es = new EventSource('/api/events');
  es.onerror = function () { console.error('SSE connection error — dashboard may be stale'); };

  es.addEventListener('synapse_shared', function () { loadSynapses().catch(showError); });
  es.addEventListener('synapse_unlinked', function (e) { try { removeRow(JSON.parse(e.data).id); } catch {} });
  es.addEventListener('sync_complete', function (e) {
    try {
      const data = JSON.parse(e.data);
      toast('Sync complete: pushed ' + (typeof data.pushed === 'number' ? data.pushed : 0) + ', pulled ' + (typeof data.pulled === 'number' ? data.pulled : 0) + ', unlinked ' + (typeof data.unlinked === 'number' ? data.unlinked : 0), 'success');
      loadStats().catch(function () {});
      loadSynapses().catch(showError);
    } catch (_) {}
  });
  es.addEventListener('auth_changed', function () { loadStatus().catch(() => {}); loadSynapses().catch(showError); });
  es.addEventListener('synapse_updated', function () { loadStats().catch(function () {}); loadSynapses().catch(showError); });
  es.addEventListener('index_complete', function () { loadStats().catch(function () {}); loadSynapses().catch(showError); });

  setInterval(function () {
    if (es.readyState === EventSource.CLOSED) {
      loadStats().catch(function () {});
      loadSynapses().catch(function () {});
    }
  }, 30000);
}
