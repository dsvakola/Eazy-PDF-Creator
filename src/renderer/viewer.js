'use strict';
// Eazy PDF Creator - page rendering, layout, zoom, navigation. Copyright (C) 2026 Vidyasagar Academy - GPL

const PAGE_GAP = 12;      // must match .page margin-bottom in style.css
const PAD_V = 12, PAD_H = 24;
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

// ---------- building a tab's view ----------
function buildTabView(tab) {
  const sc = document.createElement('div');
  sc.className = 'scroller'; sc.hidden = true; sc.tabIndex = -1;
  const pg = document.createElement('div'); pg.className = 'pages';
  sc.appendChild(pg);
  $('#viewer-wrap').appendChild(sc);
  tab.scroller = sc; tab.pagesEl = pg;

  for (let i = 1; i <= tab.numPages; i++) {
    const div = document.createElement('div');
    div.className = 'page'; div.dataset.page = i;
    div.innerHTML = '<div class="loading"></div>';
    tab.recs.push({ num: i, div, w: 612, h: 792, known: false, key: null, rendering: false, canvas: null, textDiv: null, annotDiv: null, noteDiv: null, viewport: null, token: 0, textReady: null });
  }

  sc.addEventListener('scroll', () => {
    if (tab !== state.active) return;
    if (!tab._raf) tab._raf = requestAnimationFrame(() => { tab._raf = 0; onScroll(tab); });
  });
  sc.addEventListener('wheel', (e) => onWheel(tab, e), { passive: false });
  sc.addEventListener('mouseup', (e) => onViewerMouseUp(tab, e));
  sc.addEventListener('click', (e) => onViewerClick(tab, e));
  sc.addEventListener('mousedown', (e) => { if (!e.target.closest('#selpop')) hideSelPop(); });

  // Real page sizes: first page now, the rest in the background
  tab.pdf.getPage(1).then(p => { applyPageSize(tab, tab.recs[0], p); if (tab === state.active) relayout(tab, { keepAnchor: true }); });
  loadAllPageSizes(tab);
}

function applyPageSize(tab, rec, page) {
  const vp = page.getViewport({ scale: 1 }); // includes the page's own rotation
  rec.w = vp.width; rec.h = vp.height; rec.known = true;
}

async function loadAllPageSizes(tab) {
  if (tab.numPages > 600) return;               // very long documents: sizes are learned while scrolling
  for (let i = 2; i <= tab.numPages; i++) {
    if (!tab.scroller.isConnected) return;
    try { const p = await tab.pdf.getPage(i); applyPageSize(tab, tab.recs[i - 1], p); } catch (e) { return; }
    if (i % 40 === 0) await sleep(0);
  }
  if (tab === state.active) relayout(tab, { keepAnchor: true });
}

// ---------- geometry ----------
const rotated = (tab) => tab.rotation % 180 !== 0;
function pageDims(tab, rec) { return rotated(tab) ? { w: rec.h, h: rec.w } : { w: rec.w, h: rec.h }; }
function refRec(tab) { return tab.viewMode === 'single' ? tab.recs[tab.page - 1] : tab.recs[0]; }

function computeScale(tab) {
  if (tab.zoomMode === 'custom') return tab.scale;
  const sc = tab.scroller;
  const pad = state.presentation ? 0 : PAD_H * 2;
  const padV = state.presentation ? 0 : PAD_V * 2 + 4;
  const availW = Math.max(100, sc.clientWidth - pad - 2);
  const availH = Math.max(100, sc.clientHeight - padV - 2);
  if (tab.zoomMode === 'fit-width') {
    // continuous view: fit the widest page so nothing is cut off sideways
    const list = tab.viewMode === 'single' ? [tab.recs[tab.page - 1]] : tab.recs;
    let maxW = 1; for (const r of list) maxW = Math.max(maxW, pageDims(tab, r).w);
    return availW / maxW;
  }
  const d = pageDims(tab, tab.recs[tab.page - 1]);
  return Math.min(availW / d.w, availH / d.h); // fit-page
}

// (Re)compute sizes of all page boxes and schedule rendering
function relayout(tab, opts = {}) {
  if (!tab || tab !== state.active) return;
  const sc = tab.scroller;
  let anchor = null;
  if (!opts.initial && tab.laidOut && tab.tops.length && tab.viewMode === 'continuous') {
    const mid = sc.scrollTop + sc.clientHeight / 2;
    const i = findPageAt(tab, mid);
    const r = tab.recs[i];
    anchor = { i, frac: (mid - tab.tops[i]) / Math.max(1, r.hpx || 1) };
  }
  const prevPageForSingle = tab.page;
  tab.scale = computeScale(tab);
  const s = tab.scale;
  for (const rec of tab.recs) {
    const d = pageDims(tab, rec);
    rec.wpx = d.w * s; rec.hpx = d.h * s;
    rec.div.style.width = rec.wpx + 'px'; rec.div.style.height = rec.hpx + 'px';
  }
  // which pages are in the DOM
  if (tab.viewMode === 'single') {
    const rec = tab.recs[tab.page - 1];
    tab.pagesEl.replaceChildren(rec.div);
  } else if (tab.pagesEl.childElementCount !== tab.numPages) {
    tab.pagesEl.replaceChildren(...tab.recs.map(r => r.div));
  }
  // invalidate renders whose scale/rotation changed
  const key = s.toFixed(4) + '|' + tab.rotation;
  for (const rec of tab.recs) if (rec.key && rec.key !== key) releasePage(tab, rec);
  // tops
  tab.tops = tab.recs.map(r => r.div.isConnected ? r.div.offsetTop : 0);
  tab.laidOut = true;

  if (opts.initial) {
    if (tab.viewMode === 'continuous') sc.scrollTop = tab.savedScroll || (tab.recs[tab.page - 1] ? tab.tops[tab.page - 1] - PAD_V : 0);
    else sc.scrollTop = 0;
  } else if (anchor && tab.viewMode === 'continuous') {
    const r = tab.recs[anchor.i];
    sc.scrollTop = tab.tops[anchor.i] + anchor.frac * r.hpx - sc.clientHeight / 2;
  }
  tab.page = prevPageForSingle;
  updateZoomUI(tab);
  scheduleRender(tab);
  if (tab.viewMode === 'continuous') updateCurrentPage(tab);
  updateToolbar();
}

function findPageAt(tab, y) {
  const t = tab.tops; let lo = 0, hi = t.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}

function visiblePages(tab) {
  if (tab.viewMode === 'single') return [tab.page - 1];
  const sc = tab.scroller, H = sc.clientHeight;
  const from = findPageAt(tab, Math.max(0, sc.scrollTop - H * 0.6));
  const out = [];
  for (let i = from; i < tab.numPages; i++) {
    if (tab.tops[i] > sc.scrollTop + H * 1.6) break;
    out.push(i);
  }
  return out;
}

// ---------- rendering ----------
let renderQueue = [], activeRenders = 0;
function scheduleRender(tab) {
  if (tab !== state.active) return;
  const vis = visiblePages(tab);
  const visSet = new Set(vis);
  // free pages that are far away
  if (tab.viewMode === 'continuous') {
    const cur = tab.page - 1;
    for (const rec of tab.recs) if (rec.key && !visSet.has(rec.num - 1) && Math.abs(rec.num - 1 - cur) > 6) releasePage(tab, rec);
  }
  // current page first
  vis.sort((a, b) => Math.abs(a - (tab.page - 1)) - Math.abs(b - (tab.page - 1)));
  for (const i of vis) queueRender(tab, tab.recs[i]);
}

function queueRender(tab, rec) {
  const key = tab.scale.toFixed(4) + '|' + tab.rotation;
  if (rec.key === key || rec.rendering) return;
  if (!renderQueue.some(q => q.rec === rec)) renderQueue.push({ tab, rec });
  pumpRenderQueue();
}

function pumpRenderQueue() {
  while (activeRenders < 2 && renderQueue.length) {
    const { tab, rec } = renderQueue.shift();
    if (!tab.scroller.isConnected || tab !== state.active) continue;
    activeRenders++;
    renderPage(tab, rec).catch(() => {}).finally(() => { activeRenders--; pumpRenderQueue(); });
  }
}

async function renderPage(tab, rec) {
  const key = tab.scale.toFixed(4) + '|' + tab.rotation;
  if (rec.key === key) return;
  rec.rendering = true;
  const myToken = ++rec.token;
  try {
    const page = await tab.pdf.getPage(rec.num);
    if (!rec.known) { applyPageSize(tab, rec, page); relayout(tab, { keepAnchor: true }); rec.rendering = false; return; }
    const scale = tab.scale;
    const viewport = page.getViewport({ scale, rotation: (page.rotate + tab.rotation) % 360 });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = Math.floor(viewport.width) + 'px'; canvas.style.height = Math.floor(viewport.height) + 'px';
    const ctx = canvas.getContext('2d', { alpha: false });
    const task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
    rec.task = task;
    await task.promise;
    if (myToken !== rec.token) return;               // superseded (zoomed / released meanwhile)

    // text layer
    const textDiv = document.createElement('div');
    textDiv.className = 'textLayer';
    textDiv.style.setProperty('--scale-factor', viewport.scale);
    const textContent = await page.getTextContent();
    if (myToken !== rec.token) return;
    const annotDiv = document.createElement('div'); annotDiv.className = 'annotLayer';
    const noteDiv = document.createElement('div'); noteDiv.className = 'noteLayer';
    rec.div.replaceChildren(canvas, annotDiv, textDiv, noteDiv);
    const tl = pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textDiv, viewport, textDivs: [] });
    await tl.promise;
    if (myToken !== rec.token) return;

    rec.canvas = canvas; rec.textDiv = textDiv; rec.annotDiv = annotDiv; rec.noteDiv = noteDiv; rec.viewport = viewport;
    rec.key = key;
    drawAnnotations(tab, rec);
    applySearchMarks(tab, rec);
    if (rec.onRendered) { const f = rec.onRendered; rec.onRendered = null; f(); }
  } catch (e) {
    if (!(e && e.name === 'RenderingCancelledException')) console.error('render error page', rec.num, e);
  } finally {
    if (myToken === rec.token) rec.rendering = false;
    else rec.rendering = false;
  }
}

function releasePage(tab, rec) {
  rec.token++;
  if (rec.task) { try { rec.task.cancel(); } catch (e) { /* ignore */ } rec.task = null; }
  if (rec.canvas) { rec.canvas.width = 0; rec.canvas.height = 0; }
  rec.canvas = rec.textDiv = rec.annotDiv = rec.noteDiv = rec.viewport = null;
  rec.key = null; rec.rendering = false;
  rec.div.replaceChildren(Object.assign(document.createElement('div'), { className: 'loading' }));
}
function releaseAllPages(tab) { tab.recs.forEach(r => releasePage(tab, r)); renderQueue = renderQueue.filter(q => q.tab !== tab); }

// Wait until a page is drawn (used by search / annotations)
function ensureRendered(tab, rec) {
  const key = () => tab.scale.toFixed(4) + '|' + tab.rotation;
  if (rec.key === key()) return Promise.resolve();
  return new Promise(res => {
    const prev = rec.onRendered;
    rec.onRendered = () => { if (prev) prev(); res(); };
    queueRender(tab, rec);
    setTimeout(res, 4000);
  });
}

// ---------- scrolling / current page ----------
function onScroll(tab) {
  if (tab.viewMode === 'continuous') updateCurrentPage(tab);
  scheduleRender(tab);
  hideSelPop();
}

function updateCurrentPage(tab) {
  const sc = tab.scroller;
  const probe = sc.scrollTop + sc.clientHeight * 0.35;
  const i = findPageAt(tab, probe);
  const p = i + 1;
  if (p !== tab.page) { tab.page = p; onPageChanged(tab); }
}

function onPageChanged(tab) {
  if (tab !== state.active) return;
  $('#page-input').value = tab.page;
  if (state.settings.rememberLast) { state.lastPages[tab.key] = tab.page; saveLastPages(); }
  highlightThumb(tab);
  updateToolbar();
}

function goToPage(tab, n, opts = {}) {
  n = clamp(Math.round(n), 1, tab.numPages);
  if (tab.viewMode === 'single') {
    const changed = n !== tab.page;
    tab.page = n;
    tab.pagesEl.replaceChildren(tab.recs[n - 1].div);
    if (state.zoomModeNeedsRefit || tab.zoomMode !== 'custom') relayout(tab);
    else { tab.tops = tab.recs.map(r => r.div.isConnected ? r.div.offsetTop : 0); scheduleRender(tab); }
    tab.scroller.scrollTop = opts.toEnd ? tab.scroller.scrollHeight : 0;
    if (changed) onPageChanged(tab); else updateToolbar();
  } else {
    tab.scroller.scrollTop = tab.tops[n - 1] - PAD_V;
    if (n !== tab.page) { tab.page = n; onPageChanged(tab); }
    scheduleRender(tab);
  }
}
const nextPage = (tab) => { if (tab.page < tab.numPages) goToPage(tab, tab.page + 1); };
const prevPage = (tab) => { if (tab.page > 1) goToPage(tab, tab.page - 1); };

function onWheel(tab, e) {
  if (e.ctrlKey) {            // Ctrl + wheel / pinch = zoom
    e.preventDefault();
    const factor = Math.pow(1.0018, -e.deltaY);
    setZoom(tab, tab.scale * factor);
    return;
  }
  if (tab.viewMode === 'single' && Math.abs(e.deltaY) > 2) {
    const sc = tab.scroller;
    const atTop = sc.scrollTop <= 0, atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
    const now = Date.now();
    if (e.deltaY > 0 && atBottom && tab.page < tab.numPages && now - (tab._flip || 0) > 350) { tab._flip = now; e.preventDefault(); goToPage(tab, tab.page + 1); }
    else if (e.deltaY < 0 && atTop && tab.page > 1 && now - (tab._flip || 0) > 350) { tab._flip = now; e.preventDefault(); goToPage(tab, tab.page - 1, { toEnd: true }); }
  }
}

// ---------- zoom ----------
function setZoom(tab, scale) {
  scale = clamp(scale, 0.1, 6);
  tab.zoomMode = 'custom'; tab.scale = scale;
  relayout(tab);
}
function setZoomMode(tab, mode) { tab.zoomMode = mode; relayout(tab); }
function zoomStep(tab, dir) {
  const s = tab.scale;
  let n;
  if (dir > 0) n = ZOOMS.find(z => z > s + 0.005) || 6;
  else n = [...ZOOMS].reverse().find(z => z < s - 0.005) || 0.25;
  setZoom(tab, n);
}
function updateZoomUI(tab) {
  const sel = $('#zoom-select'), cust = $('#zoom-custom');
  if (tab.zoomMode === 'fit-width' || tab.zoomMode === 'fit-page') { sel.value = tab.zoomMode; return; }
  const pct = Math.round(tab.scale * 100);
  const match = $$('option', sel).find(o => /^[\d.]+$/.test(o.value) && Math.round(parseFloat(o.value) * 100) === pct);
  if (match) { sel.value = match.value; return; }
  cust.hidden = false; cust.textContent = pct + '%'; sel.value = 'custom';
}

function rotate(tab, deg) {
  tab.rotation = (tab.rotation + deg + 360) % 360;
  tab.thumbsEl = null;
  relayout(tab);
  renderSidebar();
}

function setViewMode(tab, mode, persist = true) {
  if (tab.viewMode === mode) return;
  const cur = tab.page;
  tab.viewMode = mode;
  releaseAllPages(tab);
  tab.pagesEl.replaceChildren();
  if (persist) { state.settings.viewMode = mode; saveSettings(); }
  tab.page = cur;
  relayout(tab, { initial: true });
  if (mode === 'continuous') tab.scroller.scrollTop = tab.tops[cur - 1] - PAD_V;
  updateToolbar();
}

// ---------- resize handling ----------
const onResize = debounce(() => {
  const t = state.active;
  if (t && t.zoomMode !== 'custom') relayout(t, { keepAnchor: true });
  else if (t) { t.tops = t.recs.map(r => r.div.isConnected ? r.div.offsetTop : 0); scheduleRender(t); }
}, 120);
new ResizeObserver(onResize).observe($('#viewer-wrap'));
