'use strict';
// Eazy PDF Creator — 100% Lossless PDF Creation, Merging & Protection Engine
// Copyright (C) 2026 Vidyasagar Academy — GPL-3.0-or-later

const converterState = {
  files: [],       // Array of file items
  activeTab: 'protection', // 'protection' | 'layout' | 'quality'
  mergeMode: 'merge',      // 'merge' | 'individual'
  converting: false,
};

let convIdCounter = 1;

// ── Image Helper: Convert WebP/BMP/GIF/other formats to PNG bytes ─────────────
async function imageToPngBytes(uint8Array, mime) {
  const blob = new Blob([uint8Array], { type: mime || 'image/png' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const buf = await pngBlob.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Parse page range string (e.g. "1-5, 8, 10-end" or "all") ──────────────────
function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || rangeStr.trim().toLowerCase() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }
  const result = new Set();
  const parts = rangeStr.split(/[,;\s]+/);
  for (const part of parts) {
    if (!part) continue;
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = Math.max(1, parseInt(startStr, 10) || 1);
      const end = endStr.toLowerCase() === 'end' ? totalPages : Math.min(totalPages, parseInt(endStr, 10) || totalPages);
      for (let p = start; p <= end; p++) result.add(p - 1);
    } else {
      const p = parseInt(part, 10);
      if (p >= 1 && p <= totalPages) result.add(p - 1);
    }
  }
  const sorted = Array.from(result).sort((a, b) => a - b);
  return sorted.length ? sorted : Array.from({ length: totalPages }, (_, i) => i);
}

// ── Add files to Converter Queue ──────────────────────────────────────────────
async function addFilesToConverter(filePaths) {
  if (!filePaths || !filePaths.length) return;
  const statusEl = $('#conv-status');
  if (statusEl) statusEl.textContent = 'Inspecting files…';

  for (const p of filePaths) {
    const ext = p.split('.').pop().toLowerCase();
    const isPdf = ext === 'pdf';
    const isImg = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'].includes(ext);
    if (!isPdf && !isImg) continue;

    try {
      const bytes = await vra.readFile(p);
      const info = await vra.fileInfo(p);
      const name = p.split(/[\\/]/).pop();
      const id = 'conv-' + (convIdCounter++);

      const item = {
        id,
        path: p,
        name,
        size: info.size || bytes.byteLength,
        ext,
        type: isPdf ? 'pdf' : 'image',
        bytes,
        pageCount: 1,
        dimensions: null,
        rotation: 0,
        pageRange: 'all',
        thumbUrl: null,
      };

      if (isPdf) {
        try {
          const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
          item.pageCount = doc.getPageCount();
          // Render quick thumbnail of first page via PDF.js
          const pdfjsTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
          const pdfDoc = await pdfjsTask.promise;
          const page = await pdfDoc.getPage(1);
          const vp = page.getViewport({ scale: 0.35 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          item.thumbUrl = canvas.toDataURL('image/jpeg', 0.85);
        } catch (e) {
          console.warn('PDF inspection fallback:', e);
        }
      } else if (isImg) {
        // Thumbnail for images
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
        const blob = new Blob([bytes], { type: mime });
        item.thumbUrl = URL.createObjectURL(blob);
      }

      converterState.files.push(item);
    } catch (err) {
      console.error('Error loading file for converter:', p, err);
      toast(`Could not load "${p.split(/[\\/]/).pop()}": ${err.message || err}`);
    }
  }

  renderConverterQueue();
  updateConverterOptionsSummary();
  if (statusEl) statusEl.textContent = '';
}

// ── Render the File Queue ────────────────────────────────────────────────────
function renderConverterQueue() {
  const container = $('#conv-file-list');
  const countBadge = $('#conv-queue-count');
  const emptyState = $('#conv-empty-state');
  const actionsBar = $('#conv-actions-bar');
  if (!container) return;

  const files = converterState.files;
  if (countBadge) countBadge.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;

  if (!files.length) {
    container.innerHTML = '';
    if (emptyState) emptyState.hidden = false;
    if (actionsBar) actionsBar.hidden = true;
    return;
  }

  if (emptyState) emptyState.hidden = true;
  if (actionsBar) actionsBar.hidden = false;
  container.innerHTML = '';

  files.forEach((file, index) => {
    const card = document.createElement('div');
    card.className = 'conv-card';
    card.dataset.id = file.id;

    const thumbHtml = file.thumbUrl
      ? `<img src="${file.thumbUrl}" alt="thumb" class="conv-thumb">`
      : `<div class="conv-thumb conv-thumb-placeholder">${file.type === 'pdf' ? '📄' : '🖼️'}</div>`;

    const sizeStr = (file.size / 1024 > 1024)
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.round(file.size / 1024)} KB`;

    const typeBadge = file.type === 'pdf'
      ? `<span class="conv-badge badge-pdf">PDF · ${file.pageCount} page${file.pageCount === 1 ? '' : 's'}</span>`
      : `<span class="conv-badge badge-img">${file.ext.toUpperCase()} image</span>`;

    card.innerHTML = `
      <div class="conv-card-left">
        <span class="conv-handle" title="Position #${index + 1}">${index + 1}</span>
        ${thumbHtml}
        <div class="conv-details">
          <div class="conv-name" title="${esc(file.path)}">${esc(file.name)}</div>
          <div class="conv-meta">
            ${typeBadge}
            <span class="conv-size">${sizeStr}</span>
            ${file.rotation ? `<span class="conv-rot-badge">↻ ${file.rotation}°</span>` : ''}
          </div>
        </div>
      </div>

      <div class="conv-card-right">
        ${file.type === 'pdf' ? `
          <div class="conv-range-box" title="e.g. 1-5, 8 or 'all'">
            <label>Pages:</label>
            <input type="text" class="conv-range-input" value="${esc(file.pageRange)}" placeholder="all">
          </div>
        ` : ''}

        <button class="conv-btn-icon conv-btn-rotate" title="Rotate clockwise 90°">↻</button>
        <button class="conv-btn-icon conv-btn-up" title="Move Up" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button class="conv-btn-icon conv-btn-down" title="Move Down" ${index === files.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="conv-btn-icon conv-btn-remove" title="Remove file">✕</button>
      </div>
    `;

    // Wire events
    const rangeInp = card.querySelector('.conv-range-input');
    if (rangeInp) {
      rangeInp.onchange = (e) => {
        file.pageRange = e.target.value.trim() || 'all';
      };
    }

    card.querySelector('.conv-btn-rotate').onclick = () => {
      file.rotation = (file.rotation + 90) % 360;
      renderConverterQueue();
    };

    const upBtn = card.querySelector('.conv-btn-up');
    if (upBtn) {
      upBtn.onclick = () => {
        if (index > 0) {
          const temp = files[index - 1];
          files[index - 1] = files[index];
          files[index] = temp;
          renderConverterQueue();
        }
      };
    }

    const downBtn = card.querySelector('.conv-btn-down');
    if (downBtn) {
      downBtn.onclick = () => {
        if (index < files.length - 1) {
          const temp = files[index + 1];
          files[index + 1] = files[index];
          files[index] = temp;
          renderConverterQueue();
        }
      };
    }

    card.querySelector('.conv-btn-remove').onclick = () => {
      converterState.files.splice(index, 1);
      renderConverterQueue();
      updateConverterOptionsSummary();
    };

    container.appendChild(card);
  });
}

function updateConverterOptionsSummary() {
  const count = converterState.files.length;
  const btn = $('#conv-execute-btn');
  if (btn) btn.disabled = count === 0;
}

// ── Tab Switching in Options (Protection | Layout | Quality) ─────────────────
function initConverterOptionTabs() {
  const tabs = $$('.conv-opt-tab');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      converterState.activeTab = target;
      $$('.conv-tab-pane').forEach(p => {
        p.hidden = p.id !== `conv-pane-${target}`;
      });
    };
  });

  // Password checkbox toggle
  const chk = $('#conv-pt-open-chk');
  const wrap = $('#conv-pt-open-wrap');
  if (chk && wrap) {
    chk.onchange = () => {
      wrap.hidden = !chk.checked;
      if (chk.checked) $('#conv-pt-open-pw').focus();
    };
  }
}

// ── Core Lossless Conversion & Assembly Engine ───────────────────────────────
async function runConversion() {
  const files = converterState.files;
  if (!files.length) {
    toast('Please add at least one document or image to convert.');
    return;
  }

  const progressBar = $('#conv-progress-fill');
  const progressText = $('#conv-progress-text');
  const progressBox = $('#conv-progress-box');
  const executeBtn = $('#conv-execute-btn');

  function setProgress(pct, msg) {
    if (progressBox) progressBox.hidden = false;
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressText) progressText.textContent = msg;
  }

  executeBtn.disabled = true;
  converterState.converting = true;

  try {
    setProgress(5, 'Initializing PDF engine…');

    // Options from UI
    const layoutSize = $('#conv-opt-size')?.value || 'original'; // original | a4 | letter
    const layoutOrient = $('#conv-opt-orient')?.value || 'auto'; // auto | portrait | landscape
    const layoutMargin = parseFloat($('#conv-opt-margin')?.value || '0');

    // Security options
    const usePassword = $('#conv-pt-open-chk')?.checked;
    const userPassword = usePassword ? ($('#conv-pt-open-pw')?.value || '') : '';
    const confirmPassword = usePassword ? ($('#conv-pt-open-pw2')?.value || '') : '';

    if (usePassword) {
      if (!userPassword) {
        toast('Please enter an opening password.');
        $('#conv-pt-open-pw').focus();
        executeBtn.disabled = false;
        converterState.converting = false;
        if (progressBox) progressBox.hidden = true;
        return;
      }
      if (userPassword !== confirmPassword) {
        toast('Passwords do not match. Please verify.');
        $('#conv-pt-open-pw2').focus();
        executeBtn.disabled = false;
        converterState.converting = false;
        if (progressBox) progressBox.hidden = true;
        return;
      }
    }

    const lockPrinting = $('#conv-pt-print')?.checked || false;
    const lockCopying = $('#conv-pt-copy')?.checked || false;
    const lockModifying = $('#conv-pt-modify')?.checked || false;
    const hasProtection = usePassword || lockPrinting || lockCopying || lockModifying;

    // Standard paper dimensions in points (72 pt/in)
    const PAGE_SIZES = {
      a4: [595.28, 841.89],
      letter: [612.0, 792.0],
    };

    // Create the master output PDF document
    const outDoc = await PDFLib.PDFDocument.create();

    const totalFiles = files.length;
    for (let fIdx = 0; fIdx < totalFiles; fIdx++) {
      const item = files[fIdx];
      const fileProgress = Math.round(10 + (fIdx / totalFiles) * 70);
      setProgress(fileProgress, `Processing ${esc(item.name)} (${fIdx + 1}/${totalFiles})…`);

      if (item.type === 'pdf') {
        // ── LOSSLESS NATIVE VECTOR PDF COPYING ────────────────────────────────
        // Loads source PDF and copies vector glyphs, fonts, and streams directly
        const srcDoc = await PDFLib.PDFDocument.load(item.bytes, { ignoreEncryption: true });
        const totalSrcPages = srcDoc.getPageCount();
        const pageIndices = parsePageRange(item.pageRange, totalSrcPages);
        const copiedPages = await outDoc.copyPages(srcDoc, pageIndices);

        for (const page of copiedPages) {
          if (item.rotation) {
            const currentRot = page.getRotation().angle;
            page.setRotation(PDFLib.degrees((currentRot + item.rotation) % 360));
          }
          outDoc.addPage(page);
        }
      } else if (item.type === 'image') {
        // ── LOSSLESS IMAGE EMBEDDING ──────────────────────────────────────────
        // Native DCT for JPG, Flate for PNG (zero recompression artifacts)
        let embeddedImg;
        if (item.ext === 'jpg' || item.ext === 'jpeg') {
          embeddedImg = await outDoc.embedJpg(item.bytes);
        } else if (item.ext === 'png') {
          embeddedImg = await outDoc.embedPng(item.bytes);
        } else {
          // Fallback for WebP / BMP / GIF: canvas to lossless PNG bytes
          const pngBytes = await imageToPngBytes(item.bytes, `image/${item.ext}`);
          embeddedImg = await outDoc.embedPng(pngBytes);
        }

        const imgWidth = embeddedImg.width;
        const imgHeight = embeddedImg.height;

        let pageWidth, pageHeight;
        if (layoutSize === 'original') {
          // 1:1 pixel perfection matching the image
          pageWidth = imgWidth;
          pageHeight = imgHeight;
        } else {
          // Standard A4 or Letter
          const dims = PAGE_SIZES[layoutSize] || PAGE_SIZES.a4;
          let [w, h] = dims;
          if (layoutOrient === 'landscape' || (layoutOrient === 'auto' && imgWidth > imgHeight)) {
            pageWidth = Math.max(w, h);
            pageHeight = Math.min(w, h);
          } else {
            pageWidth = Math.min(w, h);
            pageHeight = Math.max(w, h);
          }
        }

        const page = outDoc.addPage([pageWidth, pageHeight]);

        // Calculate fitted image positioning respecting margins
        const margin = layoutMargin * 2.83465; // mm to points
        const availW = Math.max(10, pageWidth - margin * 2);
        const availH = Math.max(10, pageHeight - margin * 2);

        let drawW, drawH;
        if (layoutSize === 'original') {
          drawW = imgWidth;
          drawH = imgHeight;
        } else {
          const scale = Math.min(availW / imgWidth, availH / imgHeight);
          drawW = imgWidth * scale;
          drawH = imgHeight * scale;
        }

        const drawX = margin + (availW - drawW) / 2;
        const drawY = margin + (availH - drawH) / 2;

        page.drawImage(embeddedImg, {
          x: drawX,
          y: drawY,
          width: drawW,
          height: drawH,
        });

        if (item.rotation) {
          page.setRotation(PDFLib.degrees(item.rotation));
        }
      }
    }

    setProgress(85, 'Finalizing document structure…');
    // Save without object streams so standard objects & xref are preserved
    const finalPdfBytes = await outDoc.save({ useObjectStreams: false });

    setProgress(92, hasProtection ? 'Applying PDF security locks…' : 'Saving PDF document…');

    // Choose default filename based on first file or custom input
    const customName = $('#conv-output-name')?.value.trim();
    let defaultFilename;
    if (customName) {
      defaultFilename = customName.endsWith('.pdf') ? customName : customName + '.pdf';
    } else if (files.length === 1) {
      defaultFilename = files[0].name.replace(/\.[^/.]+$/, '') + '.pdf';
    } else {
      defaultFilename = 'Converted Document.pdf';
    }

    let savedPath = null;
    if (hasProtection) {
      savedPath = await vra.protectAndSave(defaultFilename, finalPdfBytes, {
        userPassword,
        lockPrinting,
        lockCopying,
        lockModifying,
      });
    } else {
      savedPath = await vra.saveCopy(defaultFilename, finalPdfBytes);
    }

    if (savedPath) {
      setProgress(100, 'Conversion complete!');
      showConversionSuccessModal(savedPath);
    } else {
      setProgress(0, 'Conversion cancelled.');
      if (progressBox) progressBox.hidden = true;
    }
  } catch (err) {
    console.error('Conversion error:', err);
    toast('Conversion error: ' + (err.message || err));
    setProgress(0, 'Error during conversion');
  } finally {
    executeBtn.disabled = false;
    converterState.converting = false;
  }
}

// ── Success Dialog with "Open in Viewer" & "Show in Folder" ──────────────────
function showConversionSuccessModal(filePath) {
  const fileName = baseName(filePath);
  showModal(`
    <div class="conv-success-modal">
      <div class="conv-success-icon">✓</div>
      <h2>Conversion Successful!</h2>
      <p class="conv-success-name"><strong>${esc(fileName)}</strong></p>
      <p class="conv-success-path">${esc(filePath)}</p>

      <div class="mbtns conv-success-btns">
        <button id="conv-btn-folder">📁 Show in Folder</button>
        <button id="conv-btn-view" class="primary">📖 Open in Viewer</button>
      </div>
    </div>
  `);

  setTimeout(() => {
    $('#conv-btn-folder').onclick = () => {
      vra.showInFolder(filePath);
    };
    $('#conv-btn-view').onclick = async () => {
      closeModal();
      // Switch back to viewer mode and open the new PDF
      setAppMode('viewer');
      await openFile(filePath);
    };
  }, 0);
}

// ── App Mode Switcher (Viewer vs Converter) ──────────────────────────────────
function setAppMode(mode) {
  const viewerToolbar = $('#toolbar');
  const viewerMain = $('#main');
  const converterView = $('#converter-view');
  const btnViewer = $('#btn-mode-viewer');
  const btnConverter = $('#btn-mode-converter');

  if (mode === 'converter') {
    if (viewerToolbar) viewerToolbar.hidden = true;
    if (viewerMain) viewerMain.hidden = true;
    if (converterView) converterView.hidden = false;
    if (btnViewer) btnViewer.classList.remove('active');
    if (btnConverter) btnConverter.classList.add('active');
  } else {
    if (viewerToolbar) viewerToolbar.hidden = false;
    if (viewerMain) viewerMain.hidden = false;
    if (converterView) converterView.hidden = true;
    if (btnViewer) btnViewer.classList.add('active');
    if (btnConverter) btnConverter.classList.remove('active');
  }
}

// ── Drag and Drop handling on Converter Dropzone ──────────────────────────────
function initConverterDragDrop() {
  const dropArea = $('#conv-drop-area');
  if (!dropArea) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropArea.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropArea.classList.remove('dragover');
    }, false);
  });

  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files) {
      const paths = Array.from(e.dataTransfer.files)
        .map(f => vra.pathForFile(f))
        .filter(Boolean);
      if (paths.length) addFilesToConverter(paths);
    }
  });

  $('#conv-browse-btn').onclick = async () => {
    const files = await vra.openConverterDialog();
    if (files && files.length) addFilesToConverter(files);
  };

  $('#conv-clear-all-btn').onclick = () => {
    converterState.files = [];
    renderConverterQueue();
    updateConverterOptionsSummary();
  };

  $('#conv-add-more-btn').onclick = async () => {
    const files = await vra.openConverterDialog();
    if (files && files.length) addFilesToConverter(files);
  };

  $('#conv-execute-btn').onclick = runConversion;
}

// ── Startup initialization ──────────────────────────────────────────────────
function initConverter() {
  initConverterOptionTabs();
  initConverterDragDrop();

  $('#btn-mode-viewer').onclick = () => setAppMode('viewer');
  $('#btn-mode-converter').onclick = () => setAppMode('converter');
}
