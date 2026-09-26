'use strict';

import { syncThemeBtn } from './state.js';
import { initSkeleton } from './ui.js';
import { loadSynapses, loadStatus, loadStats, loadToolStats } from './api.js';
import { initEvents, setupSSE } from './events.js';

try {
  initSkeleton();
  initEvents();
  setupSSE();

  if (document.documentElement.classList.contains('dark')) {
    syncThemeBtn(true);
  }

  loadStatus().catch(function () {});
  loadStats().catch(function () {});
  loadSynapses().catch(function (e) { console.error('[dashboard] loadSynapses:', e); });
  setInterval(function () { loadToolStats().catch(function () {}); }, 30000);
  loadToolStats().catch(function () {});
} catch (e) {
  console.error('[dashboard] init failed:', e);
  document.getElementById('error').textContent = 'Init error: ' + e.message;
  document.getElementById('error').style.display = 'block';
}
