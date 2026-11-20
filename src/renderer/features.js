'use strict';
// Eazy PDF Creator - search, annotations, sidebar, print, save, settings. Copyright (C) 2026 Vidyasagar Academy - GPL

// =====================================================================
//  SEARCH
// =====================================================================
let searchToken = 0;
function cancelSearchScan() { searchToken++; }

function searchRegex(q) { return new RegExp(escRe(q.trim()).replace(/\s+/g, '\\s+'), 'gi'); }

function openSearch() {
  const t = state.active; if (!t) return;
  if (!t.search) t.search = { open: true, query: '', counts: [], total: 0, cur: -1, curPage: 0, curK: 0, scanning: false, done: false };
  t.search.open = true;
  syncSearchUI();
  const inp = $('#search-input'); inp.focus(); inp.select();
}
function closeSearch() {
  const t = state.active; if (!t || !t.search) { $('#searchbar').hidden = true; return; }
  cancelSearchScan();
  t.search.open = false; t.search.query = ''; t.search.total = 0; t.search.cur = -1; t.search.scanning = false;
  refreshMarks(t);
  syncSearchUI();
}
function syncSearchUI() {
  const t = state.active, bar = $('#searchbar');
  if (t && t.search && t.search.open) { bar.hidden = false; $('#search-input').value = t.search.query || ''; }
  else bar.hidden = true;
  updateSearchCount(t);
  $('#btn-search').classList.toggle('on', !bar.hidden);
}
function updateSearchCount(t) {
  const el = $('#search-count'); const s = t && t.search;
  if (!s || !s.query) { el.textContent = ''; return; }
  if (s.total === 0) el.textContent = s.scanning ? 'Searching...' : 'No matches';
  else el.textContent = `${s.cur >= 0 ? s.cur + 1 : '-'} of ${s.total}${s.scanning ? '+' : ''}`;
}

async function runSearch(tab, query) {
  const s = tab.search; if (!s) return;
  const myTok = ++searchToken;
  s.query = query; s.counts = new Array(tab.numPages).fill(0); s.total = 0; s.cur = -1; s.curPage = 0; s.done = false;
  refreshMarks(tab);
  if (!query.trim()) { s.scanning = false; updateSearchCount(tab); return; }
  s.scanning = true; updateSearchCount(tab);
  const re = searchRegex(query);
  let jumped = false;
  for (let i = 1; i <= tab.numPages; i++) {
    if (myTok !== searchToken) return;
    let n = 0;
    try {
      const page = await tab.pdf.getPage(i);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (typeof it.str !== 'string' || !it.str) continue;
        const m = it.str.match(re); if (m) n += m.length;
      }
    } catch (e) { /* skip page */ }
    if (myTok !== searchToken) return;
    s.counts[i - 1] = n; s.total += n;
    if (n && !jumped) { jumped = true; await gotoMatch(tab, 0); }
    if (i % 8 === 0) { updateSearchCount(tab); await sleep(0); }
  }
  s.scanning = false; s.done = true;
  refreshMarks(tab);
  updateSearchCount(tab);
}

function refreshMarks(tab) {
  for (const rec of tab.recs) if (rec.textDiv) { clearMarks(rec); applySearchMarks(tab, rec); }
}
function clearMarks(rec) {
  if (!rec.textDiv) return;
  rec.textDiv.querySelectorAll('mark.vra-hit').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  rec.textDiv.normalize();
}
function applySearchMarks(tab, rec) {
  const s = tab.search;
  if (!s || !s.query || !s.query.trim() || !rec.textDiv) return;
  const re = searchRegex(s.query);
  let k = 0;
  rec.textDiv.querySelectorAll(':scope > span').forEach(span => {
    const txt = span.textContent;
    re.lastIndex = 0;
    if (!re.test(txt)) return;
    re.lastIndex = 0;
    let html = '', last = 0, m;
    while ((m = re.exec(txt)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      html += esc(txt.slice(last, m.index)) + `<mark class="vra-hit" data-k="${k++}">${esc(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
    html += esc(txt.slice(last));
    span.innerHTML = html;
  });
  if (s.curPage === rec.num) {
    const mk = rec.textDiv.querySelector(`mark[data-k="${s.curK}"]`);
    if (mk) mk.classList.add('cur');
  }
}

async function gotoMatch(tab, idx) {
  const s = tab.search; if (!s || !s.total) return;
  idx = ((idx % s.total) + s.total) % s.total;
  let acc = 0, pi = -1, k = 0;
  for (let i = 0; i < tab.numPages; i++) {
    if (idx < acc + s.counts[i]) { pi = i; k = idx - acc; break; }
    acc += s.counts[i];
  }
  if (pi < 0) return;
  s.cur = idx; s.curPage = pi + 1; s.curK = k;
  tab.scroller.querySelectorAll('mark.cur').forEach(m => m.classList.remove('cur'));
  const rec = tab.recs[pi];
  goToPage(tab, pi + 1);
  await ensureRendered(tab, rec);
  if (rec.textDiv) {
    const mk = rec.textDiv.querySelector(`mark[data-k="${k}"]`);
    if (mk) { mk.classList.add('cur'); mk.scrollIntoView({ block: 'center', inline: 'center' }); }
  }
  updateSearchCount(tab);
}
function searchNext(dir) {
  const t = state.active; if (!t || !t.search || !t.search.total) return;
  gotoMatch(t, (t.search.cur < 0 ? (dir > 0 ? 0 : -1) : t.search.cur + dir));
}

// =====================================================================
//  ANNOTATIONS  (highlight, underline, sticky notes) - saved automatically
// =====================================================================
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function normRect(r) { return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.abs(r[2] - r[0]), Math.abs(r[3] - r[1])]; }

let activeDrawing = null;

function drawAnnotations(tab, rec) {
  if (!rec.annotDiv || !rec.viewport) return;
  rec.annotDiv.innerHTML = ''; rec.noteDiv.innerHTML = '';
  const list = tab.annots[rec.num] || [];
  const vp = rec.viewport;

  const allItems = [...list];
  if (activeDrawing && activeDrawing.tab === tab && activeDrawing.pageNum === rec.num) {
    allItems.push(activeDrawing);
  }

  let svgEl = null;

  for (const a of allItems) {
    if (a.type === 'note') {
      const [vx, vy] = vp.convertToViewportPoint(a.pt[0], a.pt[1]);
      const d = document.createElement('div'); d.className = 'note';
      d.style.left = clamp(vx, 0, vp.width - 22) + 'px'; d.style.top = clamp(vy, 0, vp.height - 22) + 'px';
      d.textContent = '✎'; d.title = a.text;
      d.dataset.id = a.id;
      d.onclick = (e) => { e.stopPropagation(); editNote(tab, rec.num, a); };
      rec.noteDiv.appendChild(d);
    } else if (a.type === 'text') {
      const [vx, vy] = vp.convertToViewportPoint(a.pt[0], a.pt[1]);
      const d = document.createElement('div');
      d.className = 'pdf-added-text';
      d.style.left = clamp(vx, 0, vp.width - 40) + 'px';
      d.style.top = clamp(vy, 0, vp.height - 30) + 'px';
      d.style.color = a.color || '#000000';
      d.style.fontSize = Math.round((a.fontSize || 14) * (vp.scale || 1)) + 'px';
      d.textContent = a.text;
      d.title = 'Click to edit or delete text';
      d.onclick = async (e) => {
        e.stopPropagation();
        const r = await textEditModal(a.text, a.fontSize, a.color, true);
        if (r === null) return;
        if (r === '\u0000DELETE') { deleteAnnot(tab, a.id); return; }
        a.text = r.text;
        a.fontSize = r.fontSize;
        a.color = r.color;
        redrawAnnotPage(tab, rec.num);
        saveAnnots();
      };
      rec.noteDiv.appendChild(d);
    } else if (a.type === 'whiteout') {
      const [x, y, w, h] = normRect(vp.convertToViewportRectangle(a.rect));
      const d = document.createElement('div');
      d.className = 'pdf-whiteout-block';
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      d.style.width = w + 'px';
      d.style.height = h + 'px';
      d.title = 'Whiteout block (Click to remove)';
      d.onclick = (e) => {
        e.stopPropagation();
        if (confirm('Delete this whiteout block?')) deleteAnnot(tab, a.id);
      };
      rec.noteDiv.appendChild(d);
    } else if (a.type === 'draw') {
      if (!svgEl) {
        svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.setAttribute('class', 'draw-svg');
        rec.annotDiv.appendChild(svgEl);
      }
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dStr = a.points.map((p, idx) => {
        const [vx, vy] = vp.convertToViewportPoint(p[0], p[1]);
        return (idx === 0 ? 'M' : 'L') + `${vx.toFixed(1)} ${vy.toFixed(1)}`;
      }).join(' ');
      path.setAttribute('d', dStr);
      path.setAttribute('stroke', a.color || '#d62828');
      path.setAttribute('stroke-width', String(Math.max(1.5, (a.strokeWidth || 2.5) * (vp.scale || 1))));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svgEl.appendChild(path);
    } else {
      for (const r of a.rects) {
        const [x, y, w, h] = normRect(vp.convertToViewportRectangle(r));
        const d = document.createElement('div');
        d.className = a.type === 'underline' ? 'ul' : 'hl';
        if (a.type === 'underline') { d.style.left = x + 'px'; d.style.top = (y + h - 2) + 'px'; d.style.width = w + 'px'; d.style.background = a.color; }
        else { d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.width = w + 'px'; d.style.height = h + 'px'; d.style.background = a.color; }
        rec.annotDiv.appendChild(d);
      }
    }
  }
}
function redrawAnnotPage(tab, pageNum) { const rec = tab.recs[pageNum - 1]; drawAnnotations(tab, rec); }

// collect selected rectangles, grouped by page, in PDF coordinates
function selectionByPage(tab) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const rootNode = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
  const rects = [];
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!range.intersectsNode(n) || !n.parentElement || !n.parentElement.closest('.textLayer')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    if (n === range.startContainer) r.setStart(n, range.startOffset);
    if (n === range.endContainer) r.setEnd(n, range.endOffset);
    for (const cr of r.getClientRects()) if (cr.width > 1 && cr.height > 1) rects.push(cr);
  }
  if (!rects.length) return null;
  const byPage = new Map();
  const live = tab.recs.filter(r => r.viewport && r.div.isConnected);
  const boxes = live.map(r => ({ r, b: r.div.getBoundingClientRect() }));
  for (const cr of rects) {
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    const hit = boxes.find(({ b }) => cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom);
    if (!hit) continue;
    const { r: rec, b } = hit;
    const lx = cr.left - b.left, ly = cr.top - b.top;
    const [x1, y1] = rec.viewport.convertToPdfPoint(lx, ly);
    const [x2, y2] = rec.viewport.convertToPdfPoint(lx + cr.width, ly + cr.height);
    const entry = byPage.get(rec.num) || { rects: [], last: null };
    entry.rects.push([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]);
    entry.last = { rec, lx: lx + cr.width, ly };
    byPage.set(rec.num, entry);
  }
  return { byPage, text: sel.toString().replace(/\s+/g, ' ').trim() };
}

function addMarkup(type, color) {
  const tab = state.active; if (!tab) return;
  const info = selectionByPage(tab);
  if (!info) { toast('First select some text in the PDF, then choose Highlight or Underline.'); return; }
  for (const [pageNum, entry] of info.byPage) {
    (tab.annots[pageNum] = tab.annots[pageNum] || []).push({ id: uid(), type, color, rects: entry.rects, text: info.text.slice(0, 140) });
    redrawAnnotPage(tab, pageNum);
  }
  saveAnnots(); renderNotesPanel();
  window.getSelection().removeAllRanges(); hideSelPop();
}

async function addNoteFromSelection() {
  const tab = state.active; if (!tab) return;
  const info = selectionByPage(tab);
  if (!info) { toast('Select some text first, or click the Note button and then click on the page.'); return; }
  const [pageNum, entry] = [...info.byPage.entries()].pop();
  const { rec, lx, ly } = entry.last;
  window.getSelection().removeAllRanges(); hideSelPop();
  await addNoteAtViewport(tab, rec, lx + 4, ly);
}

async function addNoteAtViewport(tab, rec, vx, vy) {
  const [px, py] = rec.viewport.convertToPdfPoint(vx, vy);
  const text = await noteDialog('');
  if (text === null || !text.trim()) return;
  (tab.annots[rec.num] = tab.annots[rec.num] || []).push({ id: uid(), type: 'note', pt: [px, py], text: text.trim() });
  redrawAnnotPage(tab, rec.num); saveAnnots(); renderNotesPanel();
}

function noteDialog(initial, canDelete) {
  const p = showModal(`<h2>${canDelete ? 'Edit note' : 'New note'}</h2>
    <textarea id="note-text" placeholder="Type your note here..."></textarea>
    <div class="mbtns">${canDelete ? '<button id="note-del" class="danger">Delete</button>' : ''}
    <button id="note-cancel">Cancel</button><button id="note-ok" class="primary">Save</button></div>`);
  setTimeout(() => {
    const ta = $('#note-text'); if (!ta) return;
    ta.value = initial; ta.focus();
    $('#note-ok').onclick = () => closeModal(ta.value);
    $('#note-cancel').onclick = () => closeModal(null);
    if (canDelete) $('#note-del').onclick = () => closeModal('\u0000DELETE');
  }, 0);
  return p;
}

async function editNote(tab, pageNum, ann) {
  const r = await noteDialog(ann.text, true);
  if (r === null) return;
  if (r === '\u0000DELETE') { deleteAnnot(tab, ann.id); return; }
  if (!r.trim()) return;
  ann.text = r.trim(); redrawAnnotPage(tab, pageNum); saveAnnots(); renderNotesPanel();
}

function deleteAnnot(tab, id) {
  for (const pn of Object.keys(tab.annots)) {
    const list = tab.annots[pn];
    const i = list.findIndex(a => a.id === id);
    if (i >= 0) { list.splice(i, 1); if (!list.length) delete tab.annots[pn]; redrawAnnotPage(tab, +pn); break; }
  }
  saveAnnots(); renderNotesPanel();
}

function clearEditModes() {
  state.noteMode = false;
  state.textMode = false;
  state.drawMode = false;
  state.whiteoutMode = false;
  document.body.classList.remove('notemode', 'textmode', 'drawmode', 'whiteoutmode');
  const btnNote = $('#btn-note'); if (btnNote) btnNote.classList.remove('on');
  const btnText = $('#btn-text'); if (btnText) btnText.classList.remove('on');
  const btnDraw = $('#btn-draw'); if (btnDraw) btnDraw.classList.remove('on');
  const btnWhite = $('#btn-whiteout'); if (btnWhite) btnWhite.classList.remove('on');
}

function setNoteMode(on) {
  clearEditModes();
  if (on) {
    state.noteMode = true;
    document.body.classList.add('notemode');
    $('#btn-note')?.classList.add('on');
    toast('Click on the page where you want the sticky note.', 2500);
  }
}

function setTextMode(on) {
  clearEditModes();
  if (on) {
    state.textMode = true;
    document.body.classList.add('textmode');
    $('#btn-text')?.classList.add('on');
    toast('Click anywhere on the page to type text onto the PDF.', 2500);
  }
}

function setDrawMode(on) {
  clearEditModes();
  if (on) {
    state.drawMode = true;
    document.body.classList.add('drawmode');
    $('#btn-draw')?.classList.add('on');
    toast('Click and drag on any page to draw or sign with the pen.', 2500);
  }
}

function setWhiteoutMode(on) {
  clearEditModes();
  if (on) {
    state.whiteoutMode = true;
    document.body.classList.add('whiteoutmode');
    $('#btn-whiteout')?.classList.add('on');
    toast('Click anywhere on the page to place a whiteout redaction box.', 2500);
  }
}

async function addTextAtViewport(tab, rec, vx, vy) {
  const [px, py] = rec.viewport.convertToPdfPoint(vx, vy);
  const res = await textEditModal('', 14, '#000000');
  if (!res || !res.text || !res.text.trim()) return;
  (tab.annots[rec.num] = tab.annots[rec.num] || []).push({
    id: uid(),
    type: 'text',
    pt: [px, py],
    text: res.text.trim(),
    fontSize: res.fontSize || 14,
    color: res.color || '#000000',
  });
  redrawAnnotPage(tab, rec.num);
  saveAnnots();
  renderNotesPanel();
}

function textEditModal(initialText, initialSize = 14, initialColor = '#000000', canDelete = false) {
  const p = showModal(`<h2>${canDelete ? 'Edit Text' : 'Add Text to PDF'}</h2>
    <div style="margin-bottom:12px; display:flex; gap:10px; align-items:center;">
      <label>Font Size:</label>
      <select id="text-edit-size" style="padding:4px 8px; border-radius:4px; border:1px solid var(--border);">
        <option value="10">10 pt</option>
        <option value="12">12 pt</option>
        <option value="14" selected>14 pt</option>
        <option value="18">18 pt</option>
        <option value="24">24 pt</option>
        <option value="32">32 pt</option>
        <option value="48">48 pt</option>
      </select>
      <label style="margin-left:8px;">Color:</label>
      <select id="text-edit-color" style="padding:4px 8px; border-radius:4px; border:1px solid var(--border);">
        <option value="#000000" selected>Black</option>
        <option value="#d62828">Red</option>
        <option value="#0066cc">Blue</option>
        <option value="#15803d">Green</option>
        <option value="#ffffff">White</option>
      </select>
    </div>
    <textarea id="text-edit-body" placeholder="Type text here..." style="width:100%; height:90px; padding:8px; border-radius:6px; border:1px solid var(--border); font-size:14px;"></textarea>
    <div class="mbtns">
      ${canDelete ? '<button id="text-edit-del" class="danger">Delete</button>' : ''}
      <button id="text-edit-cancel">Cancel</button>
      <button id="text-edit-ok" class="primary">Apply</button>
    </div>`);

  setTimeout(() => {
    const ta = $('#text-edit-body');
    const sz = $('#text-edit-size');
    const clr = $('#text-edit-color');
    if (ta) {
      ta.value = initialText || '';
      ta.focus();
    }
    if (sz && initialSize) sz.value = String(initialSize);
    if (clr && initialColor) clr.value = initialColor;

    $('#text-edit-ok').onclick = () => closeModal({
      text: ta.value,
      fontSize: parseInt(sz.value, 10) || 14,
      color: clr.value || '#000000',
    });
    $('#text-edit-cancel').onclick = () => closeModal(null);
    if (canDelete) $('#text-edit-del').onclick = () => closeModal('\u0000DELETE');
  }, 0);

  return p;
}

async function addWhiteoutAtViewport(tab, rec, vx, vy) {
  const [px, py] = rec.viewport.convertToPdfPoint(vx, vy);
  (tab.annots[rec.num] = tab.annots[rec.num] || []).push({
    id: uid(),
    type: 'whiteout',
    rect: [px, py - 20, px + 150, py + 8],
    color: '#ffffff',
  });
  redrawAnnotPage(tab, rec.num);
  saveAnnots();
  toast('Whiteout block added. Click on it to remove.', 2500);
}

// ----- selection popup -----
function hideSelPop() { $('#selpop').hidden = true; }
function onViewerMouseUp(tab, e) {
  if (state.noteMode || state.textMode || state.drawMode || state.whiteoutMode || state.presentation) return;
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { hideSelPop(); return; }
    const n = sel.getRangeAt(0).commonAncestorContainer;
    const el = n.nodeType === 1 ? n : n.parentElement;
    if (!el || !el.closest('.textLayer') && !(el.querySelector && el.querySelector('.textLayer'))) { hideSelPop(); return; }
    const rects = sel.getRangeAt(0).getClientRects();
    if (!rects.length) { hideSelPop(); return; }
    const last = rects[rects.length - 1], first = rects[0];
    const pop = $('#selpop'); pop.hidden = false;
    let top = first.top - pop.offsetHeight - 8; if (top < 80) top = last.bottom + 8;
    let left = clamp(first.left, 8, window.innerWidth - pop.offsetWidth - 8);
    pop.style.top = top + 'px'; pop.style.left = left + 'px';
  }, 0);
}
function onViewerClick(tab, e) {
  if (state.presentation) {
    const x = e.clientX / window.innerWidth;
    if (x < 0.3) prevPage(tab); else nextPage(tab);
    return;
  }
  if (state.textMode) {
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    const rec = tab.recs[+pageEl.dataset.page - 1];
    if (!rec || !rec.viewport) return;
    const b = pageEl.getBoundingClientRect();
    setTextMode(false);
    addTextAtViewport(tab, rec, e.clientX - b.left, e.clientY - b.top);
    return;
  }
  if (state.whiteoutMode) {
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    const rec = tab.recs[+pageEl.dataset.page - 1];
    if (!rec || !rec.viewport) return;
    const b = pageEl.getBoundingClientRect();
    setWhiteoutMode(false);
    addWhiteoutAtViewport(tab, rec, e.clientX - b.left, e.clientY - b.top);
    return;
  }
  if (!state.noteMode) return;
  const pageEl = e.target.closest('.page'); if (!pageEl || e.target.closest('.note')) return;
  const rec = tab.recs[+pageEl.dataset.page - 1];
  if (!rec || !rec.viewport) return;
  const b = pageEl.getBoundingClientRect();
  setNoteMode(false);
  addNoteAtViewport(tab, rec, e.clientX - b.left, e.clientY - b.top);
}

function setupDrawingHandlers() {
  const viewerWrap = $('#viewer-wrap');
  if (!viewerWrap) return;

  viewerWrap.addEventListener('pointerdown', (e) => {
    if (!state.drawMode || !state.active) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    const tab = state.active;
    const rec = tab.recs[+pageEl.dataset.page - 1];
    if (!rec || !rec.viewport) return;

    const b = pageEl.getBoundingClientRect();
    const vx = e.clientX - b.left;
    const vy = e.clientY - b.top;
    const [px, py] = rec.viewport.convertToPdfPoint(vx, vy);

    activeDrawing = {
      id: uid(),
      type: 'draw',
      tab,
      pageNum: rec.num,
      points: [[px, py]],
      color: '#d62828',
      strokeWidth: 2.5,
    };
    pageEl.setPointerCapture(e.pointerId);
  });

  viewerWrap.addEventListener('pointermove', (e) => {
    if (!activeDrawing) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl || +pageEl.dataset.page !== activeDrawing.pageNum) return;
    const rec = activeDrawing.tab.recs[activeDrawing.pageNum - 1];
    if (!rec || !rec.viewport) return;

    const b = pageEl.getBoundingClientRect();
    const vx = e.clientX - b.left;
    const vy = e.clientY - b.top;
    const [px, py] = rec.viewport.convertToPdfPoint(vx, vy);
    activeDrawing.points.push([px, py]);

    redrawAnnotPage(activeDrawing.tab, activeDrawing.pageNum);
  });

  const finishDrawing = () => {
    if (!activeDrawing) return;
    if (activeDrawing.points.length > 1) {
      (activeDrawing.tab.annots[activeDrawing.pageNum] = activeDrawing.tab.annots[activeDrawing.pageNum] || []).push({
        id: activeDrawing.id,
        type: 'draw',
        points: activeDrawing.points,
        color: activeDrawing.color,
        strokeWidth: activeDrawing.strokeWidth,
      });
      saveAnnots();
    }
    const cur = activeDrawing;
    activeDrawing = null;
    redrawAnnotPage(cur.tab, cur.pageNum);
  };

  viewerWrap.addEventListener('pointerup', finishDrawing);
  viewerWrap.addEventListener('pointercancel', finishDrawing);
}

// =====================================================================
//  SIDEBAR  (Pages / Contents / Notes)
// =====================================================================
const THUMB_W = 130;

function renderSidebar() {
  document.body.classList.toggle('nopane', !state.settings.leftPane);
  const tab = state.active, side = state.settings.sideTab;
  $$('#side-tabs button').forEach(b => b.classList.toggle('active', b.dataset.side === side));
  ['thumbs', 'outline', 'notes'].forEach(n => { $('#panel-' + n).hidden = n !== side; });
  $('#btn-pane').classList.toggle('on', state.settings.leftPane);
  if (!state.settings.leftPane) return;
  if (!tab) {
    ['thumbs', 'outline', 'notes'].forEach(n => { $('#panel-' + n).innerHTML = '<div class="empty-msg">Open a PDF to see its pages here.</div>'; });
    return;
  }
  if (side === 'thumbs') {
    const panel = $('#panel-thumbs');
    if (!tab.thumbsEl) tab.thumbsEl = buildThumbs(tab);
    if (panel.firstChild !== tab.thumbsEl) panel.replaceChildren(tab.thumbsEl);
    highlightThumb(tab);
  } else if (side === 'outline') {
    const panel = $('#panel-outline');
    if (tab.outlineEl) panel.replaceChildren(tab.outlineEl);
    else { panel.innerHTML = '<div class="empty-msg">Loading...</div>'; buildOutline(tab).then(() => { if (state.active === tab && state.settings.sideTab === 'outline') panel.replaceChildren(tab.outlineEl); }); }
  } else renderNotesPanel();
}

function buildThumbs(tab) {
  const wrap = document.createElement('div');

  const toolsBar = document.createElement('div');
  toolsBar.className = 'thumbs-tools-bar';
  toolsBar.innerHTML = `
    <button id="thumb-btn-add" class="tb-btn small" title="Insert blank page after current page">➕ Add</button>
    <button id="thumb-btn-rot" class="tb-btn small" title="Rotate current page 90°">↻ Rotate</button>
    <button id="thumb-btn-del" class="tb-btn small danger" title="Delete current page">🗑️ Delete</button>
  `;
  wrap.appendChild(toolsBar);

  toolsBar.querySelector('#thumb-btn-add').onclick = () => insertBlankPage(tab);
  toolsBar.querySelector('#thumb-btn-rot').onclick = () => rotateActivePage(tab, 90);
  toolsBar.querySelector('#thumb-btn-del').onclick = () => deleteActivePage(tab);

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { const el = en.target; io.unobserve(el); renderThumb(tab, el); }
  }, { root: $('#panel-thumbs'), rootMargin: '300px' });
  tab.recs.forEach(rec => {
    const d = document.createElement('div'); d.className = 'thumb'; d.dataset.page = rec.num;
    const dims = pageDims(tab, rec);
    d.innerHTML = `<canvas width="${THUMB_W}" height="${Math.round(THUMB_W * dims.h / dims.w)}" style="width:${THUMB_W}px;height:${Math.round(THUMB_W * dims.h / dims.w)}px"></canvas><span class="tnum">${rec.num}</span>`;
    d.onclick = () => goToPage(tab, rec.num);
    wrap.appendChild(d); io.observe(d);
  });
  return wrap;
}

async function renderThumb(tab, el) {
  const num = +el.dataset.page;
  try {
    const page = await tab.pdf.getPage(num);
    const rot = (page.rotate + tab.rotation) % 360;
    const v1 = page.getViewport({ scale: 1, rotation: rot });
    const ratio = 1.5, s = THUMB_W / v1.width;
    const vp = page.getViewport({ scale: s * ratio, rotation: rot });
    const canvas = el.querySelector('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    canvas.style.width = THUMB_W + 'px'; canvas.style.height = Math.floor(vp.height / ratio) + 'px';
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp }).promise;
  } catch (e) { /* ignore */ }
}

function highlightThumb(tab) {
  if (!tab || !tab.thumbsEl) return;
  const prev = tab.thumbsEl.querySelector('.thumb.current'); if (prev) prev.classList.remove('current');
  const cur = tab.thumbsEl.children[tab.page - 1];
  if (cur) { cur.classList.add('current'); if (state.settings.leftPane && state.settings.sideTab === 'thumbs') cur.scrollIntoView({ block: 'nearest' }); }
}

async function buildOutline(tab) {
  const root = document.createElement('div');
  let out = null;
  try { out = await tab.pdf.getOutline(); } catch (e) { /* none */ }
  if (!out || !out.length) root.innerHTML = '<div class="empty-msg">This PDF has no bookmarks (table of contents).</div>';
  else root.appendChild(outlineList(tab, out, 0));
  tab.outlineEl = root;
}
function outlineList(tab, items, depth) {
  const ul = document.createElement('ul'); ul.className = 'otree';
  for (const it of items) {
    const li = document.createElement('li');
    const row = document.createElement('div'); row.className = 'oitem';
    const has = it.items && it.items.length;
    row.innerHTML = `<span class="tog">${has ? (depth < 1 ? '▾' : '▸') : ''}</span><span class="otxt">${esc(it.title || '(untitled)')}</span>`;
    row.onclick = () => navigateOutline(tab, it);
    li.appendChild(row);
    if (has) {
      const child = outlineList(tab, it.items, depth + 1);
      child.hidden = depth >= 1;
      li.appendChild(child);
      row.querySelector('.tog').onclick = (e) => { e.stopPropagation(); child.hidden = !child.hidden; e.target.textContent = child.hidden ? '▸' : '▾'; };
    }
    ul.appendChild(li);
  }
  return ul;
}
async function navigateOutline(tab, it) {
  try {
    if (it.url) { vra.openExternal(it.url); return; }
    let dest = it.dest;
    if (typeof dest === 'string') dest = await tab.pdf.getDestination(dest);
    if (!Array.isArray(dest)) return;
    const ref = dest[0];
    const idx = (typeof ref === 'object' && ref !== null) ? await tab.pdf.getPageIndex(ref) : ref;
    goToPage(tab, idx + 1);
  } catch (e) { /* ignore */ }
}

function renderNotesPanel() {
  const panel = $('#panel-notes');
  const tab = state.active;
  if (!tab || state.settings.sideTab !== 'notes') return;
  const items = [];
  Object.keys(tab.annots).map(Number).sort((a, b) => a - b).forEach(pn => tab.annots[pn].forEach(a => items.push({ pn, a })));
  if (!items.length) { panel.innerHTML = '<div class="empty-msg">No highlights or notes yet.<br><br>Select text in the PDF to highlight or underline it, or use the Note button to add a sticky note.</div>'; return; }
  panel.innerHTML = '';
  for (const { pn, a } of items) {
    const d = document.createElement('div'); d.className = 'nitem';
    const label = a.type === 'note' ? 'Note' : a.type === 'underline' ? 'Underline' : 'Highlight';
    const color = a.type === 'note' ? '#ffd23f' : a.color;
    d.innerHTML = `<div class="nhead"><span class="ndot" style="background:${color}"></span>${label} · page ${pn}<button class="nx" title="Delete">×</button></div>
      <div class="ntext">${esc(a.text || '')}</div>`;
    d.onclick = (e) => {
      if (e.target.closest('.nx')) { deleteAnnot(tab, a.id); return; }
      goToPage(tab, pn);
      ensureRendered(tab, tab.recs[pn - 1]).then(() => { const pd = tab.recs[pn - 1].div; pd.classList.remove('flash'); void pd.offsetWidth; pd.classList.add('flash'); });
    };
    panel.appendChild(d);
  }
}

// =====================================================================
//  PRINT
// =====================================================================
async function printDocument() {
  const tab = state.active; if (!tab) return;
  const box = $('#printContainer'); box.innerHTML = '';
  const urls = [];
  try {
    for (let i = 1; i <= tab.numPages; i++) {
      toast(`Preparing page ${i} of ${tab.numPages} for printing...`, 60000);
      const page = await tab.pdf.getPage(i);
      const rot = (page.rotate + tab.rotation) % 360;
      const v1 = page.getViewport({ scale: 1, rotation: rot });
      const s = Math.min(2, 2400 / v1.width);
      const vp = page.getViewport({ scale: s, rotation: rot });
      const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const ctx = c.getContext('2d', { alpha: false });
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      for (const a of (tab.annots[i] || [])) {
        if (a.type === 'note') continue;
        ctx.save(); ctx.globalCompositeOperation = a.type === 'highlight' ? 'multiply' : 'source-over'; ctx.globalAlpha = a.type === 'highlight' ? 0.55 : 1;
        ctx.fillStyle = a.color;
        for (const r of a.rects) {
          const [x, y, w, h] = normRect(vp.convertToViewportRectangle(r));
          if (a.type === 'highlight') ctx.fillRect(x, y, w, h); else ctx.fillRect(x, y + h - 2 * s, w, 2 * s);
        }
        ctx.restore();
      }
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const url = URL.createObjectURL(blob); urls.push(url);
      const img = new Image(); img.src = url; box.appendChild(img);
      await img.decode().catch(() => {});
      c.width = c.height = 0;
    }
    $('#toast').hidden = true;
    await sleep(150);
    await vra.print();
  } catch (e) { toast('Printing failed: ' + (e.message || e)); }
  finally { urls.forEach(u => URL.revokeObjectURL(u)); box.innerHTML = ''; }
}

// =====================================================================
//  SAVE A COPY WITH ANNOTATIONS
// =====================================================================
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

async function buildAnnotatedPdf(tab) {
  const bytes = tab.pdfBytes || await vra.readFile(tab.path);
  const { PDFDocument, rgb, BlendMode, PDFHexString, StandardFonts } = PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  for (const pn of Object.keys(tab.annots)) {
    const page = doc.getPage(+pn - 1);
    for (const a of tab.annots[pn]) {
      if (a.type === 'highlight') {
        const [r, g, b] = hexRgb(a.color);
        for (const q of a.rects) page.drawRectangle({ x: q[0], y: q[1], width: q[2] - q[0], height: q[3] - q[1], color: rgb(r, g, b), opacity: 0.5, blendMode: BlendMode.Multiply, borderWidth: 0 });
      } else if (a.type === 'underline') {
        for (const q of a.rects) page.drawLine({ start: { x: q[0], y: q[1] }, end: { x: q[2], y: q[1] }, thickness: 1.2, color: rgb(0.84, 0.16, 0.16) });
      } else if (a.type === 'text') {
        const [r, g, b] = hexRgb(a.color || '#000000');
        page.drawText(a.text, {
          x: a.pt[0],
          y: a.pt[1],
          size: a.fontSize || 14,
          font: helvetica,
          color: rgb(r, g, b),
        });
      } else if (a.type === 'whiteout') {
        const minX = Math.min(a.rect[0], a.rect[2]);
        const minY = Math.min(a.rect[1], a.rect[3]);
        const w = Math.abs(a.rect[2] - a.rect[0]);
        const h = Math.abs(a.rect[3] - a.rect[1]);
        page.drawRectangle({
          x: minX,
          y: minY,
          width: w,
          height: h,
          color: rgb(1, 1, 1),
          borderWidth: 0,
        });
      } else if (a.type === 'draw') {
        const [r, g, b] = hexRgb(a.color || '#d62828');
        for (let i = 0; i < a.points.length - 1; i++) {
          page.drawLine({
            start: { x: a.points[i][0], y: a.points[i][1] },
            end: { x: a.points[i+1][0], y: a.points[i+1][1] },
            thickness: a.strokeWidth || 2.5,
            color: rgb(r, g, b),
          });
        }
      } else {
        const [x, y] = a.pt;
        const dict = doc.context.obj({
          Type: 'Annot', Subtype: 'Text', Rect: [x, y - 20, x + 20, y], Name: 'Note', F: 4,
          C: [1, 0.82, 0.25], Contents: PDFHexString.fromText(a.text), T: PDFHexString.fromText('Eazy PDF Creator'),
        });
        page.node.addAnnot(doc.context.register(dict));
      }
    }
  }
  return doc.save();
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Organizing & Editing Operations
// ─────────────────────────────────────────────────────────────────────────────

async function reloadTabBytes(tab, bytes) {
  const task = pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: new URL('lib/cmaps/', location.href).href, cMapPacked: true,
    standardFontDataUrl: new URL('lib/standard_fonts/', location.href).href,
  });
  const pdf = await task.promise;
  tab.pdf = pdf;
  tab.numPages = pdf.numPages;
  tab.page = Math.min(tab.page, tab.numPages);
  tab.recs = [];
  tab.scroller = null;
  tab.pagesEl = null;
  tab.thumbsEl = null;
  tab.laidOut = false;
  renderTabContent(tab);
  updateToolbar();
  renderSidebar();
}

async function deleteActivePage(tab) {
  if (tab.numPages <= 1) {
    toast('Cannot delete the only page in the document.');
    return;
  }
  if (!confirm(`Are you sure you want to delete Page ${tab.page} of ${tab.numPages}?`)) return;
  toast('Deleting page…', 5000);
  try {
    const { PDFDocument } = PDFLib;
    const baseBytes = tab.pdfBytes || await vra.readFile(tab.path);
    const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
    doc.removePage(tab.page - 1);
    const newBytes = await doc.save({ useObjectStreams: false });
    tab.pdfBytes = newBytes;
    await reloadTabBytes(tab, newBytes);
    toast(`Page deleted. Document now has ${tab.numPages} pages.`, 2500);
  } catch (err) {
    toast('Error deleting page: ' + (err.message || err));
  }
}

async function rotateActivePage(tab, deg = 90) {
  toast('Rotating page…', 5000);
  try {
    const { PDFDocument, degrees } = PDFLib;
    const baseBytes = tab.pdfBytes || await vra.readFile(tab.path);
    const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
    const p = doc.getPage(tab.page - 1);
    const cur = p.getRotation().angle;
    p.setRotation(degrees((cur + deg) % 360));
    const newBytes = await doc.save({ useObjectStreams: false });
    tab.pdfBytes = newBytes;
    await reloadTabBytes(tab, newBytes);
    toast(`Page ${tab.page} rotated.`, 2500);
  } catch (err) {
    toast('Error rotating page: ' + (err.message || err));
  }
}

async function insertBlankPage(tab) {
  toast('Inserting blank page…', 5000);
  try {
    const { PDFDocument } = PDFLib;
    const baseBytes = tab.pdfBytes || await vra.readFile(tab.path);
    const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
    doc.insertPage(tab.page, [595.28, 841.89]); // Standard A4 points
    const newBytes = await doc.save({ useObjectStreams: false });
    tab.pdfBytes = newBytes;
    await reloadTabBytes(tab, newBytes);
    toast(`Blank page inserted at page ${tab.page + 1}.`, 2500);
  } catch (err) {
    toast('Error inserting page: ' + (err.message || err));
  }
}

async function saveAnnotatedCopy() {
  const tab = state.active; if (!tab) return;
  const total = Object.values(tab.annots).reduce((n, l) => n + l.length, 0);
  if (!total) { toast('There are no highlights, underlines or notes to save yet.'); return; }
  try {
    toast('Preparing your copy...', 30000);
    const out = await buildAnnotatedPdf(tab);
    const def = tab.name.replace(/\.pdf$/i, '') + ' (annotated).pdf';
    const saved = await vra.saveCopy(def, out);
    if (saved) toast('Saved: ' + baseName(saved)); else $('#toast').hidden = true;
  } catch (e) { toast('Could not save the copy: ' + (e.message || e)); }
}

// =====================================================================
//  PRESENTATION MODE
// =====================================================================
function enterPresentation() {
  const t = state.active; if (!t || state.presentation) return;
  hideSelPop();
  state.presBackup = { viewMode: t.viewMode, zoomMode: t.zoomMode, scale: t.scale };
  state.presentation = true;
  document.body.classList.add('presentation');
  vra.setFullscreen(true);
  t.zoomMode = 'fit-page';
  setViewMode(t, 'single', false);
  setTimeout(() => { if (state.presentation) relayout(t); }, 400);
}
function exitPresentation() {
  const t = state.active;
  if (!state.presentation) return;
  state.presentation = false;
  document.body.classList.remove('presentation');
  vra.setFullscreen(false);
  if (t && state.presBackup) {
    const b = state.presBackup;
    t.zoomMode = b.zoomMode; t.scale = b.scale;
    setViewMode(t, b.viewMode, false);
    setTimeout(() => relayout(t, { keepAnchor: true }), 300);
  }
  state.presBackup = null;
}

// =====================================================================
//  THEME
// =====================================================================
const THEMES = ['light', 'dark', 'sepia'];
function applyTheme() {
  document.body.classList.remove('theme-light', 'theme-dark', 'theme-sepia');
  document.body.classList.add('theme-' + state.settings.theme);
}
function cycleTheme() {
  const i = THEMES.indexOf(state.settings.theme);
  state.settings.theme = THEMES[(i + 1) % THEMES.length];
  applyTheme(); saveSettings();
  toast('Theme: ' + state.settings.theme[0].toUpperCase() + state.settings.theme.slice(1), 1200);
}

// =====================================================================
//  SETTINGS / ABOUT
// =====================================================================
function togglePane(on) {
  state.settings.leftPane = on === undefined ? !state.settings.leftPane : on;
  saveSettings(); renderSidebar();
  const t = state.active; if (t && t.zoomMode !== 'custom') setTimeout(() => relayout(t, { keepAnchor: true }), 0);
}

function showSettings() {
  const s = state.settings;
  showModal(`<h2>Settings</h2>
    <div class="srow"><label for="st-pane">Show left pane<small>Thumbnails, bookmarks and notes. Turn this off for more room on small screens.</small></label><input type="checkbox" id="st-pane" ${s.leftPane ? 'checked' : ''}></div>
    <div class="srow"><label for="st-esc">Press Esc to close the viewer<small>Like Sumatra PDF. Esc first closes any open box or search.</small></label><input type="checkbox" id="st-esc" ${s.escClose ? 'checked' : ''}></div>
    <div class="srow"><label for="st-last">Remember last page of each file<small>Reopen a PDF where you stopped reading.</small></label><input type="checkbox" id="st-last" ${s.rememberLast ? 'checked' : ''}></div>
    <div class="srow"><label for="st-theme">Theme</label><select id="st-theme"><option value="light">Light</option><option value="dark">Dark</option><option value="sepia">Sepia</option></select></div>
    <div class="srow"><label for="st-view">Page view</label><select id="st-view"><option value="continuous">Continuous scrolling</option><option value="single">Single page</option></select></div>
    <div class="srow"><label>Default PDF app<small>Opens Windows settings. Choose "Eazy PDF Creator" for .pdf files.</small></label><button id="st-default">Set as default</button></div>
    <div class="srow"><label>Recent files list</label><button id="st-clear">Clear</button></div>
    <div class="mbtns"><button id="st-close" class="primary">Done</button></div>`);
  setTimeout(() => {
    $('#st-theme').value = s.theme; $('#st-view').value = s.viewMode;
    $('#st-pane').onchange = (e) => togglePane(e.target.checked);
    $('#st-esc').onchange = (e) => { s.escClose = e.target.checked; saveSettings(); };
    $('#st-last').onchange = (e) => { s.rememberLast = e.target.checked; saveSettings(); };
    $('#st-theme').onchange = (e) => { s.theme = e.target.value; applyTheme(); saveSettings(); };
    $('#st-view').onchange = (e) => { s.viewMode = e.target.value; saveSettings(); if (state.active) setViewMode(state.active, s.viewMode); };
    $('#st-default').onclick = () => vra.openDefaultApps();
    $('#st-clear').onclick = () => { state.recent = []; saveRecent(); renderRecent(); toast('Recent files cleared', 1500); };
    $('#st-close').onclick = () => closeModal();
  }, 0);
}

async function showAbout() {
  const v = await vra.version();
  showModal(`<div class="about"><img src="../../assets/logo.png" alt="Vidyasagar Academy">
    <h2>Eazy PDF Creator</h2><p>Version ${esc(v)}</p>
    <p><strong>Developed by:</strong><br>Prof. Dattaraj S. Vidyasagar &amp; Prof. Yash D. Vidyasagar</p>
    <p><strong>Publisher:</strong> Vidyasagar Academy</p>
    <p><a id="ab-link">www.vsa.edu.in</a> &nbsp;•&nbsp; <a id="ab-privacy">Privacy Policy</a></p>
    <p>Free software under GNU GPL v3. Copyright © 2026 Vidyasagar Academy.<br>All rights reserved.</p>
    <div class="keys">
      <b>Ctrl+O</b><span>Open a PDF</span>
      <b>Ctrl+S</b><span>Save annotated copy</span>
      <b>Ctrl+Shift+S</b><span>Save protected &amp; locked PDF</span>
      <b>Ctrl+F</b><span>Find in document (F3 = next)</span>
      <b>Ctrl+G</b><span>Go to page number</span>
      <b>F5</b><span>Presentation / Fullscreen mode</span>
      <b>F12</b><span>Toggle left sidebar</span>
      <b>R / Shift+R</b><span>Rotate page CW / CCW</span>
      <b>Esc</b><span>Close dialog / Exit fullscreen</span>
    </div>
    <div class="mbtns"><button id="ab-close" class="primary">Close</button></div></div>`);
  setTimeout(() => {
    $('#ab-link').onclick = () => vra.openExternal('https://www.vsa.edu.in');
    $('#ab-privacy').onclick = () => vra.openExternal('https://github.com/dsvakola/Eazy-PDF-Creator/blob/main/PRIVACY-POLICY.md');
    $('#ab-close').onclick = () => closeModal();
  }, 0);
}


// =====================================================================
//  PROTECT PDF  (password + permission locks — enterprise-grade encryption)
// =====================================================================

function showProtect() {
  const tab = state.active;
  if (!tab) return;
  showModal(`
    <h2>&#128274; Protect PDF</h2>
    <p class="protect-intro">Set a password and/or lock permissions, then save a protected copy.</p>

    <div class="prot-section">
      <div class="prot-row">
        <input type="checkbox" id="pt-open-chk" class="prot-chk">
        <label for="pt-open-chk" class="prot-label">
          <strong>Create password for opening</strong>
          <small>Anyone who opens the file will be asked for this password.</small>
        </label>
      </div>
      <div id="pt-open-wrap" hidden>
        <input type="password" id="pt-open-pw" placeholder="Enter password…" autocomplete="new-password">
        <input type="password" id="pt-open-pw2" placeholder="Confirm password…" autocomplete="new-password">
        <small id="pt-pw-err" class="prot-err" hidden>&#10060; Passwords do not match.</small>
      </div>
    </div>

    <div class="prot-section">
      <p class="prot-sec-title"><strong>Security options</strong><br><small>Printing, editing and/or copying of PDF pages can be locked separately.</small></p>
      <div class="prot-row"><input type="checkbox" id="pt-print" class="prot-chk"><label for="pt-print" class="prot-label">Lock printing</label></div>
      <div class="prot-row"><input type="checkbox" id="pt-copy"  class="prot-chk"><label for="pt-copy"  class="prot-label">Lock copying</label></div>
      <div class="prot-row"><input type="checkbox" id="pt-modify" class="prot-chk"><label for="pt-modify" class="prot-label">Lock modifying</label></div>
    </div>

    <div class="mbtns">
      <button id="pt-cancel">Cancel</button>
      <button id="pt-save" class="primary">&#128190; Save Protected PDF</button>
    </div>`);

  setTimeout(() => {
    const chk     = $('#pt-open-chk');
    const wrap    = $('#pt-open-wrap');
    const pw1     = $('#pt-open-pw');
    const pw2     = $('#pt-open-pw2');
    const pwErr   = $('#pt-pw-err');
    const saveBtn = $('#pt-save');

    chk.onchange = () => { wrap.hidden = !chk.checked; if (chk.checked) pw1.focus(); };

    function validatePw() {
      const bad = chk.checked && pw1.value && pw2.value && pw1.value !== pw2.value;
      pwErr.hidden = !bad; saveBtn.disabled = bad;
    }
    pw1.oninput = pw2.oninput = validatePw;

    $('#pt-cancel').onclick = () => closeModal(null);

    saveBtn.onclick = async () => {
      const usePassword  = chk.checked;
      const userPassword = usePassword ? pw1.value : '';
      if (usePassword && !userPassword) { pw1.focus(); toast('Please enter a password.', 2200); return; }
      if (usePassword && pw1.value !== pw2.value) { pwErr.hidden = false; return; }

      const lockPrinting  = $('#pt-print').checked;
      const lockCopying   = $('#pt-copy').checked;
      const lockModifying = $('#pt-modify').checked;

      if (!usePassword && !lockPrinting && !lockCopying && !lockModifying) {
        toast('Please choose at least one protection option.', 2200); return;
      }
      closeModal(null);
      await doProtectAndSave(tab, { userPassword, lockPrinting, lockCopying, lockModifying });
    };
  }, 0);
}

async function doProtectAndSave(tab, opts) {
  try {
    toast('Preparing protected PDF…', 30000);
    // Use annotated PDF as base if annotations exist, otherwise raw file bytes
    const totalAnnots = Object.values(tab.annots).reduce((n, l) => n + l.length, 0);
    const baseBytes = totalAnnots > 0 ? await buildAnnotatedPdf(tab) : await vra.readFile(tab.path);
    // Normalize via PDFLib (already loaded in renderer) so objects are uncompressed with standard xref
    const doc = await PDFLib.PDFDocument.load(baseBytes, { ignoreEncryption: true });
    const normalizedBytes = await doc.save({ useObjectStreams: false });
    const defaultName = tab.name.replace(/\.pdf$/i, '') + ' (protected).pdf';
    const saved = await vra.protectAndSave(defaultName, normalizedBytes, opts);
    if (saved) toast('Protected PDF saved: ' + baseName(saved));
    else $('#toast').hidden = true;
  } catch (e) {
    toast('Could not protect the PDF: ' + (e.message || e));
  }
}
