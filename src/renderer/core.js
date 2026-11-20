'use strict';
// Eazy PDF Creator - core: state, helpers, tabs. Copyright (C) 2026 Vidyasagar Academy - GPL
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.js', location.href).href;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const baseName = (p) => p.split(/[\\/]/).pop();
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const DEFAULT_SETTINGS = { leftPane: true, sideTab: 'thumbs', escClose: true, rememberLast: true, theme: 'light', viewMode: 'continuous' };
const state = {
  tabs: [], active: null, nextId: 1,
  settings: { ...DEFAULT_SETTINGS },
  recent: [], lastPages: {}, annots: {},
  presentation: false, noteMode: false, presBackup: null,
};

// ---------- icons ----------
const ICONS = {
  pane: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  continuous: '<rect x="6" y="3" width="12" height="8" rx="1"/><rect x="6" y="13" width="12" height="8" rx="1"/>',
  single: '<rect x="6" y="3" width="12" height="18" rx="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  hl: '<path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 21h16"/>',
  ul: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>',
  note: '<path d="M4 4h16v12l-5 5H4z"/><path d="M15 21v-5h5"/>',
  theme: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  present: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  print: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3"/><path d="M8 21v-7h8v7"/>',
  protect: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24">${ICONS[n]}</svg>`;

// ---------- persistence ----------
const saveSettings = () => vra.storeSet('settings', state.settings);
const saveRecent = () => vra.storeSet('recent', { list: state.recent });
const saveLastPages = debounce(() => vra.storeSet('lastpages', state.lastPages), 500);
const saveAnnots = debounce(() => vra.storeSet('annots', state.annots), 400);

function addRecent(p) {
  state.recent = [p, ...state.recent.filter(x => x !== p)].slice(0, 15);
  saveRecent(); renderRecent();
}
function removeRecent(p) { state.recent = state.recent.filter(x => x !== p); saveRecent(); renderRecent(); }

// ---------- small UI helpers ----------
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

let modalResolve = null;
function modalOpen() { return !$('#modal-back').hidden; }
function closeModal(val) {
  $('#modal-back').hidden = true; $('#modal').innerHTML = '';
  const r = modalResolve; modalResolve = null; if (r) r(val);
}
function showModal(html) {
  $('#modal').innerHTML = html; $('#modal-back').hidden = false;
  return new Promise(res => { modalResolve = res; });
}
$('#modal-back').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-back') closeModal(null); });

function askPassword(reason) {
  const msg = reason === 2 ? 'Incorrect password. Please try again.' : 'This PDF is password protected.';
  const p = showModal(`<h2>Password needed</h2><p>${msg}</p>
    <input type="password" id="pw-input" autofocus>
    <div class="mbtns"><button id="pw-cancel">Cancel</button><button id="pw-ok" class="primary">Open</button></div>`);
  setTimeout(() => {
    const inp = $('#pw-input'); if (!inp) return; inp.focus();
    $('#pw-ok').onclick = () => closeModal(inp.value);
    $('#pw-cancel').onclick = () => closeModal(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') closeModal(inp.value); };
  }, 0);
  return p;
}

function hideMenu() { $('#menu').hidden = true; }
function showMenu(anchor, items) {
  const m = $('#menu');
  m.innerHTML = '';
  if (!items.length) m.innerHTML = '<div class="mempty">Nothing here yet</div>';
  items.forEach(it => {
    const d = document.createElement('div'); d.className = 'mi';
    d.innerHTML = esc(it.label) + (it.sub ? `<small>${esc(it.sub)}</small>` : '');
    d.onclick = () => { hideMenu(); it.action(); };
    m.appendChild(d);
  });
  const r = anchor.getBoundingClientRect();
  m.hidden = false;
  m.style.left = Math.min(r.left, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = (r.bottom + 4) + 'px';
}
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu') && !e.target.closest('#btn-recent')) hideMenu(); });

// ---------- opening files ----------
async function openFiles(paths) { for (const p of paths) await openFile(p); }

async function openFile(p) {
  const existing = state.tabs.find(t => t.path === p);
  if (existing) { switchTab(existing); return; }
  let bytes;
  try { bytes = await vra.readFile(p); }
  catch (e) { toast('Could not open "' + baseName(p) + '". The file may have been moved or deleted.'); removeRecent(p); return; }
  const info = await vra.fileInfo(p);
  const task = pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: new URL('lib/cmaps/', location.href).href, cMapPacked: true,
    standardFontDataUrl: new URL('lib/standard_fonts/', location.href).href,
  });
  task.onPassword = (update, reason) => {
    askPassword(reason).then(pw => { if (pw === null) task.destroy(); else update(pw); });
  };
  let pdf;
  try { pdf = await task.promise; }
  catch (e) {
    if (e && e.name !== 'PasswordException' && !/destroyed/i.test(e.message || '')) toast('Could not open "' + baseName(p) + '": ' + (e.message || e));
    return;
  }
  const tab = createTab(p, pdf, info);
  state.tabs.push(tab);
  addRecent(p);
  switchTab(tab);
}

function createTab(path, pdf, info) {
  const key = path + '|' + (info.size || 0);
  if (!state.annots[key]) state.annots[key] = {};
  const tab = {
    id: state.nextId++, path, name: baseName(path), key, pdf, numPages: pdf.numPages,
    page: 1, zoomMode: 'fit-width', scale: 1, rotation: 0, viewMode: state.settings.viewMode,
    recs: [], annots: state.annots[key], search: null, outline: undefined,
    scroller: null, pagesEl: null, thumbsEl: null, outlineEl: null, savedScroll: 0, tops: [], laidOut: false,
  };
  const last = state.settings.rememberLast ? state.lastPages[key] : null;
  if (last && last >= 1 && last <= tab.numPages) tab.page = last;
  buildTabView(tab);
  return tab;
}

function switchTab(tab) {
  const prev = state.active;
  if (prev && prev !== tab && prev.scroller) { prev.savedScroll = prev.scroller.scrollTop; prev.scroller.hidden = true; }
  state.active = tab;
  $('#welcome').hidden = true;
  tab.scroller.hidden = false;
  cancelSearchScan();
  renderTabs();
  updateTitle();
  hideSelPop();
  tab.laidOut = false;
  relayout(tab, { initial: true });
  renderSidebar();
  updateToolbar();
  syncSearchUI();
}

function closeTab(tab) {
  if (state.settings.rememberLast) { state.lastPages[tab.key] = tab.page; vra.storeSet('lastpages', state.lastPages); }
  const i = state.tabs.indexOf(tab);
  releaseAllPages(tab);
  tab.scroller.remove();
  try { tab.pdf.destroy(); } catch (e) { /* ignore */ }
  state.tabs.splice(i, 1);
  if (state.active === tab) {
    state.active = null;
    if (state.tabs.length) switchTab(state.tabs[Math.min(i, state.tabs.length - 1)]);
    else { $('#welcome').hidden = false; renderTabs(); updateTitle(); renderSidebar(); updateToolbar(); $('#searchbar').hidden = true; renderRecent(); }
  } else renderTabs();
}

function renderTabs() {
  const c = $('#tabs'); c.innerHTML = '';
  state.tabs.forEach(t => {
    const d = document.createElement('div');
    d.className = 'tab' + (t === state.active ? ' active' : '');
    d.title = t.path;
    d.innerHTML = `<span class="tname">${esc(t.name)}</span><button class="tclose" title="Close (Ctrl+W)">×</button>`;
    d.onclick = (e) => { if (e.target.closest('.tclose')) closeTab(t); else if (t !== state.active) switchTab(t); };
    d.onauxclick = (e) => { if (e.button === 1) closeTab(t); };
    c.appendChild(d);
  });
  const a = $('#tabs .tab.active'); if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateTitle() {
  const t = state.active;
  const title = t ? `${t.name} - Eazy PDF Creator` : 'Eazy PDF Creator';
  document.title = title; vra.setTitle(title);
}

function renderRecent() {
  const box = $('#recent-list');
  if (!state.recent.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<h3>Recent files</h3>';
  state.recent.slice(0, 8).forEach(p => {
    const d = document.createElement('div'); d.className = 'ritem';
    d.innerHTML = `<span class="rname">${esc(baseName(p))}</span><span class="rpath">${esc(p)}</span>`;
    d.onclick = () => openFile(p);
    box.appendChild(d);
  });
}
