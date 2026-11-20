'use strict';
// Eazy PDF Creator — 100% Lossless PDF Creation, Merging & Protection Engine
// Copyright (C) 2026 Vidyasagar Academy — GPL-3.0-or-later

const converterState = {
  files: [],       // Array of file items
  activeTab: 'compression', // 'compression' | 'view' | 'images' | 'protection' | 'headerfooter' | 'excel' | 'layout' | 'optimization'
  mergeMode: 'merge',
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

// ── Image Quality, DPI Downsampling & Color Mode Processing ──────────────────
async function processImageWithOptions(bytes, ext, { qualityLevel = 8, dpi = 300, colorMode = 'color', retainOriginal = false, autocontrast = false }) {
  if (retainOriginal) {
    return { bytes, ext };
  }

  // Quality 1..10 maps to JPEG encoder quality 0.22..0.98
  const qMap = { 1: 0.22, 2: 0.32, 3: 0.42, 4: 0.52, 5: 0.62, 6: 0.72, 7: 0.80, 8: 0.88, 9: 0.94, 10: 0.98 };
  const quality = qMap[qualityLevel] || 0.88;

  return new Promise((resolve) => {
    const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
    const blob = new Blob([bytes], { type: mime });
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;

      // Downsample if image resolution exceeds target DPI on A4 dimensions (8.27in x 11.69in)
      const maxW = Math.round(8.27 * dpi);
      const maxH = Math.round(11.69 * dpi);
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w = Math.max(1, Math.round(w * ratio));
        h = Math.max(1, Math.round(h * ratio));
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      // Color / Grayscale / Monochrome filter
      if (colorMode === 'gray' || colorMode === 'mono') {
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const isMono = colorMode === 'mono';
        for (let i = 0; i < d.length; i += 4) {
          const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
          const val = isMono ? (lum >= 128 ? 255 : 0) : lum;
          d[i] = val;
          d[i + 1] = val;
          d[i + 2] = val;
        }
        ctx.putImageData(imgData, 0, 0);
      }

      // Auto-contrast enhancement for scanned pages / faint text
      if (autocontrast) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        let minLum = 255, maxLum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum < minLum) minLum = lum;
          if (lum > maxLum) maxLum = lum;
        }
        if (maxLum > minLum && (minLum > 10 || maxLum < 245)) {
          const factor = 255 / (maxLum - minLum);
          for (let i = 0; i < d.length; i += 4) {
            d[i] = Math.min(255, Math.max(0, (d[i] - minLum) * factor));
            d[i + 1] = Math.min(255, Math.max(0, (d[i + 1] - minLum) * factor));
            d[i + 2] = Math.min(255, Math.max(0, (d[i + 2] - minLum) * factor));
          }
          ctx.putImageData(imgData, 0, 0);
        }
      }

      canvas.toBlob((resBlob) => {
        if (!resBlob) { resolve({ bytes, ext }); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ bytes: new Uint8Array(reader.result), ext: 'jpeg' });
        reader.readAsArrayBuffer(resBlob);
      }, 'image/jpeg', quality);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ bytes, ext });
    };

    img.src = url;
  });
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
  if (statusEl) statusEl.textContent = 'Inspecting & preparing files…';

  for (const p of filePaths) {
    const ext = p.split('.').pop().toLowerCase();
    const isPdf = ext === 'pdf';
    const isImg = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'svg'].includes(ext);
    const isWord = ['docx', 'doc', 'dotx', 'dot', 'rtf'].includes(ext);
    const isExcel = ['xlsx', 'xls', 'csv', 'tsv', 'xlsm', 'xlsb', 'ods'].includes(ext);
    const isPpt = ['pptx', 'ppt', 'ppsx', 'pps'].includes(ext);
    const isText = ['txt', 'md', 'markdown', 'html', 'htm', 'json', 'xml', 'log'].includes(ext);

    let fileType = isPdf ? 'pdf' : isImg ? 'image' : isWord ? 'word' : isExcel ? 'excel' : isPpt ? 'powerpoint' : isText ? 'text' : 'doc';
    const name = p.split(/[\\/]/).pop();

    try {
      let bytes;
      const info = await vra.fileInfo(p);
      const id = 'conv-' + (convIdCounter++);

      if (!isPdf && !isImg) {
        toast(`Converting ${name} to PDF…`, 60000);
        const xlSheets = $('#conv-xl-sheets')?.value || 'all';
        const xlGrid = $('#conv-xl-gridlines')?.checked !== false;
        bytes = await vra.convertToPdf(p, { excelSheets: xlSheets, excelGridlines: xlGrid });
        $('#toast').hidden = true;
      } else {
        bytes = await vra.readFile(p);
      }

      const item = {
        id,
        path: p,
        name,
        size: info.size || bytes.byteLength,
        ext,
        type: fileType,
        bytes,
        pageCount: 1,
        dimensions: null,
        rotation: 0,
        pageRange: 'all',
        thumbUrl: null,
      };

      if (isPdf || !isImg) {
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
          console.warn('Document inspection thumbnail fallback:', e);
        }
      } else if (isImg) {
        const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
        const blob = new Blob([bytes], { type: mime });
        item.thumbUrl = URL.createObjectURL(blob);
      }

      converterState.files.push(item);
    } catch (err) {
      console.error('Error loading file for converter:', p, err);
      toast(`Could not convert "${name}": ${err.message || err}`);
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

    let typeBadge = '';
    if (file.type === 'pdf') {
      typeBadge = `<span class="conv-badge badge-pdf">📕 PDF · ${file.pageCount} page${file.pageCount === 1 ? '' : 's'}</span>`;
    } else if (file.type === 'word') {
      typeBadge = `<span class="conv-badge badge-word">📘 Word · ${file.pageCount} page${file.pageCount === 1 ? '' : 's'}</span>`;
    } else if (file.type === 'excel') {
      typeBadge = `<span class="conv-badge badge-excel">📊 Excel · ${file.pageCount} page${file.pageCount === 1 ? '' : 's'}</span>`;
    } else if (file.type === 'powerpoint') {
      typeBadge = `<span class="conv-badge badge-ppt">📙 PowerPoint · ${file.pageCount} slide${file.pageCount === 1 ? '' : 's'}</span>`;
    } else if (file.type === 'text') {
      typeBadge = `<span class="conv-badge badge-text">📝 Text/MD · ${file.pageCount} page${file.pageCount === 1 ? '' : 's'}</span>`;
    } else {
      typeBadge = `<span class="conv-badge badge-img">🖼️ ${file.ext.toUpperCase()} image</span>`;
    }

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
        ${file.type !== 'image' ? `
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

    // Compression & Quality options
    const retainOriginal = $('#conv-opt-retain-orig')?.checked !== false;
    const qualityLevel = parseInt($('#conv-opt-quality')?.value, 10) || 8;
    const dpi = parseInt($('#conv-opt-dpi')?.value, 10) || 300;
    const colorMode = $('#conv-opt-colormode')?.value || 'color';

    // View options
    const pageMode = $('#conv-view-pagemode')?.value || 'continuous';
    const viewRotate = parseInt($('#conv-view-rotate')?.value, 10) || 0;

    // Image options
    const imgFit = $('#conv-img-fit')?.value || 'contain';
    const imgBorder = $('#conv-img-border')?.value || 'none';

    // Optimization options
    const autocontrast = $('#conv-opt-autocontrast')?.checked || false;
    const stripUnused = $('#conv-opt-strip-unused')?.checked !== false;

    // Layout options
    const layoutSize = $('#conv-opt-size')?.value || 'original'; // original | a4 | letter | legal | a3 | a5
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
      legal: [612.0, 1008.0],
      a3: [841.89, 1190.55],
      a5: [419.53, 595.28],
    };

    // Create the master output PDF document
    const outDoc = await PDFLib.PDFDocument.create();

    const totalFiles = files.length;
    for (let fIdx = 0; fIdx < totalFiles; fIdx++) {
      const item = files[fIdx];
      const fileProgress = Math.round(10 + (fIdx / totalFiles) * 70);
      setProgress(fileProgress, `Processing ${esc(item.name)} (${fIdx + 1}/${totalFiles})…`);

      if (item.type !== 'image') {
        if (!retainOriginal) {
          // ── RECOMPRESS PDF PAGES AT SELECTED DPI & QUALITY ──
          try {
            const pdfjsTask = pdfjsLib.getDocument({ data: item.bytes.slice(0) });
            const pdfDoc = await pdfjsTask.promise;
            const totalSrcPages = pdfDoc.numPages;
            const pageIndices = parsePageRange(item.pageRange, totalSrcPages);
            const scale = Math.max(0.4, Math.min(3.5, dpi / 72));

            for (const pIdx of pageIndices) {
              const pdfPage = await pdfDoc.getPage(pIdx + 1);
              const vp = pdfPage.getViewport({ scale });
              const canvas = document.createElement('canvas');
              canvas.width = Math.floor(vp.width);
              canvas.height = Math.floor(vp.height);
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;

              if (colorMode === 'gray' || colorMode === 'mono' || autocontrast) {
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const d = imgData.data;
                const isMono = colorMode === 'mono';
                const applyGray = colorMode === 'gray' || isMono;
                for (let i = 0; i < d.length; i += 4) {
                  if (applyGray) {
                    const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
                    const val = isMono ? (lum >= 128 ? 255 : 0) : lum;
                    d[i] = val; d[i + 1] = val; d[i + 2] = val;
                  }
                }
                ctx.putImageData(imgData, 0, 0);
              }

              const qMap = { 1: 0.22, 2: 0.32, 3: 0.42, 4: 0.52, 5: 0.62, 6: 0.72, 7: 0.80, 8: 0.88, 9: 0.94, 10: 0.98 };
              const q = qMap[qualityLevel] || 0.88;
              const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
              const arrBuf = await blob.arrayBuffer();
              const embeddedJpg = await outDoc.embedJpg(new Uint8Array(arrBuf));

              const origVp = pdfPage.getViewport({ scale: 1.0 });
              const page = outDoc.addPage([origVp.width, origVp.height]);
              page.drawImage(embeddedJpg, { x: 0, y: 0, width: origVp.width, height: origVp.height });
              if (item.rotation) {
                const cur = page.getRotation().angle;
                page.setRotation(PDFLib.degrees((cur + item.rotation) % 360));
              }
            }
          } catch (pdfCompErr) {
            console.warn('PDF recompression fallback:', pdfCompErr);
            const srcDoc = await PDFLib.PDFDocument.load(item.bytes, { ignoreEncryption: true });
            const totalSrcPages = srcDoc.getPageCount();
            const pageIndices = parsePageRange(item.pageRange, totalSrcPages);
            const copiedPages = await outDoc.copyPages(srcDoc, pageIndices);
            for (const page of copiedPages) {
              if (item.rotation) {
                const cur = page.getRotation().angle;
                page.setRotation(PDFLib.degrees((cur + item.rotation) % 360));
              }
              outDoc.addPage(page);
            }
          }
        } else {
          // ── 100% BIT-FOR-BIT LOSSLESS VECTOR PDF COPYING ────────────
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
        }
      } else if (item.type === 'image') {
        // ── IMAGE PROCESSING WITH QUALITY & DPI DOWNSAMPLING ──
        const processed = await processImageWithOptions(item.bytes, item.ext, { qualityLevel, dpi, colorMode, retainOriginal, autocontrast });
        let embeddedImg;
        if (processed.ext === 'png') {
          embeddedImg = await outDoc.embedPng(processed.bytes);
        } else {
          embeddedImg = await outDoc.embedJpg(processed.bytes);
        }

        const imgWidth = embeddedImg.width;
        const imgHeight = embeddedImg.height;

        let pageWidth, pageHeight;
        if (layoutSize === 'original') {
          pageWidth = imgWidth;
          pageHeight = imgHeight;
        } else {
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
        if (layoutSize === 'original' && imgFit === 'original') {
          drawW = imgWidth;
          drawH = imgHeight;
        } else if (imgFit === 'cover') {
          const scale = Math.max(availW / imgWidth, availH / imgHeight);
          drawW = imgWidth * scale;
          drawH = imgHeight * scale;
        } else {
          // contain (preserve aspect ratio)
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

        // Apply border if configured in Images tab
        if (imgBorder === 'thin') {
          page.drawRectangle({
            x: drawX,
            y: drawY,
            width: drawW,
            height: drawH,
            borderColor: PDFLib.rgb(0.5, 0.5, 0.5),
            borderWidth: 1,
          });
        } else if (imgBorder === 'medium') {
          page.drawRectangle({
            x: drawX,
            y: drawY,
            width: drawW,
            height: drawH,
            borderColor: PDFLib.rgb(0.2, 0.2, 0.2),
            borderWidth: 2,
          });
        } else if (imgBorder === 'frame') {
          page.drawRectangle({
            x: Math.max(2, drawX - 3),
            y: Math.max(2, drawY - 3),
            width: drawW + 6,
            height: drawH + 6,
            borderColor: PDFLib.rgb(0.15, 0.15, 0.15),
            borderWidth: 2.5,
          });
        }

        if (item.rotation) {
          page.setRotation(PDFLib.degrees(item.rotation));
        }
      }
    }

    // ── Apply Global View Rotation & Page Layout ───────────
    if (viewRotate) {
      for (let i = 0; i < outDoc.getPageCount(); i++) {
        const p = outDoc.getPage(i);
        const curRot = p.getRotation().angle;
        p.setRotation(PDFLib.degrees((curRot + viewRotate) % 360));
      }
    }

    if (pageMode === 'single') {
      outDoc.catalog.set(PDFLib.PDFName.of('PageLayout'), PDFLib.PDFName.of('SinglePage'));
    } else if (pageMode === 'facing') {
      outDoc.catalog.set(PDFLib.PDFName.of('PageLayout'), PDFLib.PDFName.of('TwoColumnLeft'));
    } else {
      outDoc.catalog.set(PDFLib.PDFName.of('PageLayout'), PDFLib.PDFName.of('OneColumn'));
    }

    // ── Apply Header & Footer if configured ────────────────
    const hfHeadLeft = $('#conv-hf-head-left')?.value.trim() || '';
    const hfHeadCenter = $('#conv-hf-head-center')?.value.trim() || '';
    const hfHeadRight = $('#conv-hf-head-right')?.value.trim() || '';
    const hfFootLeft = $('#conv-hf-foot-left')?.value.trim() || '';
    const hfFootCenter = $('#conv-hf-foot-center')?.value.trim() || '';
    const hfFootRight = $('#conv-hf-foot-right')?.value.trim() || '';
    const hfFontSize = parseInt($('#conv-hf-fontsize')?.value, 10) || 9;
    const hfSkipFirst = $('#conv-hf-skip-first')?.checked || false;

    const hasHf = hfHeadLeft || hfHeadCenter || hfHeadRight || hfFootLeft || hfFootCenter || hfFootRight;
    if (hasHf) {
      const { rgb, StandardFonts } = PDFLib;
      const font = await outDoc.embedFont(StandardFonts.Helvetica);
      const totalPages = outDoc.getPageCount();
      const startIdx = hfSkipFirst ? 1 : 0;
      const now = new Date().toLocaleDateString();

      for (let i = startIdx; i < totalPages; i++) {
        const p = outDoc.getPage(i);
        const { width, height } = p.getSize();
        const formatTxt = (t) => t
          .replace(/\[page\]/gi, String(i + 1))
          .replace(/\[total\]/gi, String(totalPages))
          .replace(/\[date\]/gi, now)
          .replace(/\[filename\]/gi, defaultFilename || 'Document');

        // Header (top margin)
        if (hfHeadLeft) p.drawText(formatTxt(hfHeadLeft), { x: 36, y: height - 24, size: hfFontSize, font, color: rgb(0.35, 0.35, 0.35) });
        if (hfHeadCenter) {
          const txt = formatTxt(hfHeadCenter);
          const w = font.widthOfTextAtSize(txt, hfFontSize);
          p.drawText(txt, { x: (width - w) / 2, y: height - 24, size: hfFontSize, font, color: rgb(0.35, 0.35, 0.35) });
        }
        if (hfHeadRight) {
          const txt = formatTxt(hfHeadRight);
          const w = font.widthOfTextAtSize(txt, hfFontSize);
          p.drawText(txt, { x: width - w - 36, y: height - 24, size: hfFontSize, font, color: rgb(0.35, 0.35, 0.35) });
        }

        // Footer (bottom margin)
        if (hfFootLeft) p.drawText(formatTxt(hfFootLeft), { x: 36, y: 18, size: hfFontSize, font, color: rgb(0.35, 0.35, 0.35) });
        if (hfFootCenter) {
          const txt = formatTxt(hfFootCenter);
          const w = font.widthOfTextAtSize(txt, hfFontSize);
          p.drawText(txt, { x: (width - w) / 2, y: 18, size: hfFontSize, font, color: rgb(0.35, 0.35, 0.35) });
        }
        if (hfFootRight) {
          const txt = formatTxt(hfFootRight);
          const w = font.widthOfTextAtSize(txt, hfFontSize);
          p.drawText(txt, { x: width - w - 36, y: 18, size: hfFontSize, font, color: rgb(0.35, 0.35, 0.35) });
        }
      }
    }

    if (stripUnused) {
      outDoc.setTitle(customName || 'Converted Document');
      outDoc.setProducer('Eazy PDF Creator (Vidyasagar Academy)');
      outDoc.setCreator('Eazy PDF Creator');
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
