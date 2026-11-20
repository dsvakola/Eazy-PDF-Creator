'use strict';
// Eazy PDF Creator — Desktop Menu Bar Manager
// Copyright (C) 2026 Vidyasagar Academy — GPL-3.0-or-later

let activeMenu = null;

function initMenuBar() {
  const menuBar = $('#menubar');
  if (!menuBar) return;

  const items = $$('.menu-item', menuBar);

  function closeAllMenus() {
    items.forEach(it => it.classList.remove('open'));
    activeMenu = null;
  }

  items.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = item.classList.contains('open');
      closeAllMenus();
      if (!isOpen) {
        item.classList.add('open');
        activeMenu = item;
      }
    });

    item.addEventListener('mouseenter', () => {
      if (activeMenu && activeMenu !== item) {
        closeAllMenus();
        item.classList.add('open');
        activeMenu = item;
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menubar')) {
      closeAllMenus();
    }
  });

  // ── Action Handlers ────────────────────────────────────────────────────────
  function onAction(id, fn) {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllMenus();
      fn();
    });
  }

  // File menu
  onAction('ma-open', () => pickFiles());
  onAction('ma-open-converter', async () => {
    setAppMode('converter');
    const f = await vra.openConverterDialog();
    if (f && f.length) addFilesToConverter(f);
  });
  onAction('ma-recent', (e) => {
    const el = $('#ma-recent');
    showMenu(el, state.recent.map(p => ({ label: baseName(p), sub: p, action: () => openFile(p) })));
  });
  onAction('ma-save', () => saveAnnotatedCopy());
  onAction('ma-protect', () => showProtect());
  onAction('ma-print', () => printDocument());
  onAction('ma-exit', () => vra.closeApp());

  // Edit menu
  onAction('ma-copy', () => {
    const sel = window.getSelection()?.toString();
    if (sel) {
      navigator.clipboard.writeText(sel);
      toast('Text copied to clipboard', 1200);
    } else {
      toast('Select text in the PDF first to copy.');
    }
  });
  onAction('ma-find', () => openSearch());
  onAction('ma-find-next', () => searchNext(1));
  onAction('ma-goto', () => {
    if (state.active) $('#page-input').focus();
  });

  // View menu
  onAction('ma-mode-viewer', () => setAppMode('viewer'));
  onAction('ma-mode-converter', () => setAppMode('converter'));
  onAction('ma-view-continuous', () => {
    if (state.active) setViewMode(state.active, 'continuous');
  });
  onAction('ma-view-single', () => {
    if (state.active) setViewMode(state.active, 'single');
  });
  onAction('ma-fit-width', () => {
    if (state.active) setZoomMode(state.active, 'fit-width');
  });
  onAction('ma-fit-page', () => {
    if (state.active) setZoomMode(state.active, 'fit-page');
  });
  onAction('ma-actual-size', () => {
    if (state.active) setZoom(state.active, 1);
  });
  onAction('ma-zoom-in', () => {
    if (state.active) zoomStep(state.active, 1);
  });
  onAction('ma-zoom-out', () => {
    if (state.active) zoomStep(state.active, -1);
  });
  onAction('ma-rotate-cw', () => {
    if (state.active) rotate(state.active, 90);
  });
  onAction('ma-rotate-ccw', () => {
    if (state.active) rotate(state.active, -90);
  });
  onAction('ma-sidebar', () => togglePane());
  onAction('ma-fullscreen', () => {
    state.presentation ? exitPresentation() : enterPresentation();
  });
  onAction('ma-theme-cycle', () => cycleTheme());

  // Tools menu
  onAction('ma-tool-text', () => setTextMode(!state.textMode));
  onAction('ma-tool-draw', () => setDrawMode(!state.drawMode));
  onAction('ma-tool-whiteout', () => setWhiteoutMode(!state.whiteoutMode));
  onAction('ma-tool-note', () => setNoteMode(!state.noteMode));
  onAction('ma-tool-highlight', () => addMarkup('highlight', '#ffe14d'));
  onAction('ma-tool-underline', () => addMarkup('underline', '#d62828'));
  onAction('ma-tool-add-page', () => { if (state.active) insertBlankPage(state.active); });
  onAction('ma-tool-del-page', () => { if (state.active) deleteActivePage(state.active); });
  onAction('ma-tool-protect', () => showProtect());
  onAction('ma-tool-convert', () => setAppMode('converter'));
  onAction('ma-settings', () => showSettings());

  // Help menu
  onAction('ma-shortcuts', () => showAbout());
  onAction('ma-privacy', () => vra.openExternal('https://github.com/dsvakola/Eazy-PDF-Creator/blob/main/PRIVACY-POLICY.md'));
  onAction('ma-website', () => vra.openExternal('https://www.vsa.edu.in'));
  onAction('ma-about', () => showAbout());
}
