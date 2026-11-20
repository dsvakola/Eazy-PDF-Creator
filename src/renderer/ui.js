'use strict';
// Eazy PDF Creator - toolbar wiring, keyboard, drag & drop, start-up. Copyright (C) 2026 Vidyasagar Academy - GPL

// ---------- toolbar icons ----------
const BTN_ICONS = {
  'btn-pane': 'pane', 'btn-open': 'open', 'btn-recent': 'recent', 'btn-prev': 'up', 'btn-next': 'down',
  'btn-zoomout': 'minus', 'btn-zoomin': 'plus', 'btn-rotate': 'rotate', 'btn-viewmode': 'continuous',
  'btn-search': 'search', 'btn-text': 'text', 'btn-draw': 'draw', 'btn-whiteout': 'whiteout',
  'btn-hl': 'hl', 'btn-ul': 'ul', 'btn-note': 'note', 'btn-theme': 'theme',
  'btn-present': 'present', 'btn-print': 'print', 'btn-save': 'save', 'btn-protect': 'protect', 'btn-settings': 'settings', 'btn-about': 'about',
  'search-prev': 'up', 'search-next': 'down', 'search-close': 'close',
};
for (const [id, name] of Object.entries(BTN_ICONS)) {
  const el = $('#' + id);
  if (el) el.innerHTML = icon(name);
}

function updateToolbar() {
  const t = state.active, has = !!t;
  ['btn-prev', 'btn-next', 'btn-zoomout', 'btn-zoomin', 'btn-rotate', 'btn-viewmode', 'btn-search', 'btn-text', 'btn-draw', 'btn-whiteout', 'btn-hl', 'btn-ul', 'btn-note', 'btn-present', 'btn-print', 'btn-save', 'btn-protect']
    .forEach(id => { const el = $('#' + id); if (el) el.disabled = !has; });
  $('#page-input').disabled = !has; $('#zoom-select').disabled = !has;
  if (!has) { $('#page-input').value = ''; $('#page-total').textContent = '/ 0'; return; }
  const inp = $('#page-input');
  if (document.activeElement !== inp) inp.value = t.page;
  $('#page-total').textContent = '/ ' + t.numPages;
  $('#btn-prev').disabled = t.page <= 1;
  $('#btn-next').disabled = t.page >= t.numPages;
  const vm = $('#btn-viewmode');
  vm.innerHTML = icon(t.viewMode === 'continuous' ? 'continuous' : 'single');
  vm.title = t.viewMode === 'continuous' ? 'Continuous view (click for single page)' : 'Single page view (click for continuous)';
}

// ---------- button actions ----------
const withTab = (fn) => () => { const t = state.active; if (t) fn(t); };
async function pickFiles() { const f = await vra.openDialog(); if (f.length) openFiles(f); }

$('#btn-open').onclick = pickFiles;
$('#btn-newtab').onclick = pickFiles;
$('#welcome-open').onclick = pickFiles;
if ($('#welcome-create')) $('#welcome-create').onclick = () => setAppMode('converter');
$('#btn-recent').onclick = (e) => showMenu(e.currentTarget, state.recent.map(p => ({ label: baseName(p), sub: p, action: () => openFile(p) })));
$('#btn-pane').onclick = () => togglePane();
$('#btn-prev').onclick = withTab(prevPage);
$('#btn-next').onclick = withTab(nextPage);
$('#btn-zoomin').onclick = withTab(t => zoomStep(t, 1));
$('#btn-zoomout').onclick = withTab(t => zoomStep(t, -1));
$('#btn-rotate').onclick = withTab(t => rotate(t, 90));
$('#btn-viewmode').onclick = withTab(t => setViewMode(t, t.viewMode === 'continuous' ? 'single' : 'continuous'));
$('#btn-search').onclick = () => { const t = state.active; if (!t) return; if (t.search && t.search.open) closeSearch(); else openSearch(); };
$('#btn-text').onclick = () => setTextMode(!state.textMode);
$('#btn-draw').onclick = () => setDrawMode(!state.drawMode);
$('#btn-whiteout').onclick = () => setWhiteoutMode(!state.whiteoutMode);
$('#btn-hl').onclick = () => addMarkup('highlight', '#ffe14d');
$('#btn-ul').onclick = () => addMarkup('underline', '#d62828');
$('#btn-note').onclick = () => setNoteMode(!state.noteMode);
$('#btn-theme').onclick = cycleTheme;
$('#btn-present').onclick = enterPresentation;
$('#btn-print').onclick = printDocument;
$('#btn-save').onclick = saveAnnotatedCopy;
$('#btn-protect').onclick = showProtect;
$('#btn-settings').onclick = showSettings;
$('#btn-about').onclick = showAbout;

// keep text selected when toolbar buttons are pressed
$('#toolbar').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });

// page number box
$('#page-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const t = state.active; const n = parseInt(e.target.value, 10); if (t && n) goToPage(t, n); e.target.blur(); }
});
$('#page-input').addEventListener('focus', (e) => e.target.select());
$('#page-input').addEventListener('blur', () => updateToolbar());

// zoom box
$('#zoom-select').addEventListener('change', (e) => {
  const t = state.active; if (!t) return;
  const v = e.target.value;
  if (v === 'fit-width' || v === 'fit-page') setZoomMode(t, v);
  else if (v !== 'custom') setZoom(t, parseFloat(v));
  e.target.blur();
});

// side tabs
$$('#side-tabs button').forEach(b => b.onclick = () => { state.settings.sideTab = b.dataset.side; saveSettings(); renderSidebar(); });

// selection popup
$$('#selpop .sw').forEach(b => b.onclick = () => addMarkup('highlight', b.dataset.color));
$('#selpop-ul').onclick = () => addMarkup('underline', '#d62828');
$('#selpop-note').onclick = addNoteFromSelection;
$('#selpop').addEventListener('mousedown', (e) => e.preventDefault());

// search bar
let searchTimer;
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { const t = state.active; if (t && t.search) runSearch(t, e.target.value); }, 250);
});
$('#search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const t = state.active; if (!t || !t.search) return;
    clearTimeout(searchTimer);
    if (t.search.query !== e.target.value) runSearch(t, e.target.value); else searchNext(e.shiftKey ? -1 : 1);
  }
});
$('#search-next').onclick = () => searchNext(1);
$('#search-prev').onclick = () => searchNext(-1);
$('#search-close').onclick = closeSearch;

// ---------- keyboard ----------
function scrollPage(tab, dir, amount) {
  const sc = tab.scroller;
  if (tab.viewMode === 'single') {
    const atTop = sc.scrollTop <= 0, atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
    if (dir > 0 && atBottom) { nextPage(tab); return; }
    if (dir < 0 && atTop) { if (tab.page > 1) goToPage(tab, tab.page - 1, { toEnd: true }); return; }
  }
  sc.scrollBy({ top: dir * amount });
}

function handleEscape(e) {
  e.preventDefault();
  if (modalOpen()) { closeModal(null); return; }
  if (!$('#menu').hidden) { hideMenu(); return; }
  if (!$('#selpop').hidden) { hideSelPop(); window.getSelection().removeAllRanges(); return; }
  if (state.presentation) { exitPresentation(); return; }
  const t = state.active;
  if (t && t.search && t.search.open) { closeSearch(); return; }
  if (state.noteMode || state.textMode || state.drawMode || state.whiteoutMode) { clearEditModes(); return; }
  const a = document.activeElement;
  if (a && a.matches && a.matches('input, textarea, select')) { a.blur(); return; }
  if (state.settings.escClose) vra.closeApp();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { handleEscape(e); return; }
  if (modalOpen()) return;
  const tab = state.active;
  const inField = e.target.matches && e.target.matches('input, textarea, select');
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl) {
    const k = e.key.toLowerCase();
    if (k === 'o') { e.preventDefault(); pickFiles(); }
    else if (k === 'w') { e.preventDefault(); if (tab) closeTab(tab); }
    else if (k === 'f') { e.preventDefault(); openSearch(); }
    else if (k === 'g') { e.preventDefault(); if (tab) $('#page-input').focus(); }
    else if (k === 'p') { e.preventDefault(); printDocument(); }
    else if (k === 's' && e.shiftKey) { e.preventDefault(); showProtect(); }
    else if (k === 's') { e.preventDefault(); saveAnnotatedCopy(); }
    else if (k === 'l') { e.preventDefault(); enterPresentation(); }
    else if (k === '=' || k === '+') { e.preventDefault(); if (tab) zoomStep(tab, 1); }
    else if (k === '-' || k === '_') { e.preventDefault(); if (tab) zoomStep(tab, -1); }
    else if (k === '0') { e.preventDefault(); if (tab) setZoomMode(tab, 'fit-page'); }
    else if (k === '9') { e.preventDefault(); if (tab) setZoomMode(tab, 'fit-width'); }
    else if (k === '1') { e.preventDefault(); if (tab) setZoom(tab, 1); }
    else if (k === 'tab') {
      e.preventDefault();
      if (state.tabs.length > 1) {
        const i = state.tabs.indexOf(tab), n = state.tabs.length;
        switchTab(state.tabs[(i + (e.shiftKey ? -1 : 1) + n) % n]);
      }
    }
    return;
  }

  if (e.key === 'F3') { e.preventDefault(); searchNext(e.shiftKey ? -1 : 1); return; }
  if (e.key === 'F5' || e.key === 'F11') { e.preventDefault(); state.presentation ? exitPresentation() : enterPresentation(); return; }
  if (e.key === 'F12') { e.preventDefault(); togglePane(); return; }
  if (inField || !tab) return;

  const H = tab.scroller.clientHeight;
  switch (e.key) {
    case 'ArrowRight': e.preventDefault(); nextPage(tab); break;
    case 'ArrowLeft': e.preventDefault(); prevPage(tab); break;
    case 'ArrowDown': e.preventDefault(); scrollPage(tab, 1, 70); break;
    case 'ArrowUp': e.preventDefault(); scrollPage(tab, -1, 70); break;
    case 'PageDown': e.preventDefault(); scrollPage(tab, 1, H * 0.9); break;
    case 'PageUp': e.preventDefault(); scrollPage(tab, -1, H * 0.9); break;
    case ' ': e.preventDefault(); scrollPage(tab, e.shiftKey ? -1 : 1, H * 0.9); break;
    case 'Home': e.preventDefault(); goToPage(tab, 1); break;
    case 'End': e.preventDefault(); goToPage(tab, tab.numPages); break;
    case 'r': rotate(tab, 90); break;
    case 'R': rotate(tab, -90); break;
    default: break;
  }
});

// ---------- drag & drop ----------
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; $('#dropzone').hidden = false; e.preventDefault(); } });
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropzone').hidden = true; });
document.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('#dropzone').hidden = true;
  const isConverter = $('#converter-view') && !$('#converter-view').hidden;
  const allPaths = Array.from(e.dataTransfer.files).map(f => vra.pathForFile(f)).filter(Boolean);
  if (!allPaths.length) return;

  if (isConverter) {
    addFilesToConverter(allPaths);
    return;
  }
  const pdfPaths = allPaths.filter(p => /\.pdf$/i.test(p));
  if (pdfPaths.length) {
    openFiles(pdfPaths);
  } else {
    // If user drops Word, Excel, PowerPoint, Text, Markdown or Images onto the Viewer:
    setAppMode('converter');
    addFilesToConverter(allPaths);
  }
});

// ---------- start-up ----------
(async function init() {
  const [settings, recent, lp, annots] = await Promise.all([
    vra.storeGet('settings'), vra.storeGet('recent'), vra.storeGet('lastpages'), vra.storeGet('annots'),
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.recent = (recent && recent.list) || [];
  state.lastPages = lp || {};
  state.annots = annots || {};
  applyTheme(); renderSidebar(); renderRecent(); updateToolbar();
  initConverter();
  initMenuBar();
  setupDrawingHandlers();
  vra.onOpenFiles((files) => openFiles(files));
  const files = await vra.initialFiles();
  if (files.length) openFiles(files);
})();
