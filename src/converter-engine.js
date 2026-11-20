'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const MarkdownIt = require('markdown-it');
const JSZip = require('jszip');

const mdParser = new MarkdownIt({ html: true, linkify: true, typographer: true });

/**
 * Universal Converter Engine for Eazy PDF Creator
 * Supports:
 * - Word (.docx, .doc, .rtf, .dotx)
 * - Excel (.xlsx, .xls, .csv, .tsv)
 * - PowerPoint (.pptx, .ppt, .ppsx)
 * - Markdown (.md, .markdown)
 * - Text & Code (.txt, .html, .htm, .json, .xml, .log)
 * - Images (handled directly or via HTML)
 */

// Helper to escape HTML characters
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Execute PowerShell script with arguments safely
function runPowerShellScript(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { maxBuffer: 10 * 1024 * 1024, timeout: 60000 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(stderr || error.message || 'PowerShell execution failed'));
        }
        resolve(stdout.trim());
      }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MS Office COM Conversion (Windows Native)
// ─────────────────────────────────────────────────────────────────────────────

async function tryOfficeComConvert(filePath, ext) {
  if (process.platform !== 'win32') return null;

  const tempOut = path.join(os.tmpdir(), `eazy_conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.pdf`);
  const escapedInput = filePath.replace(/'/g, "''");
  const escapedOutput = tempOut.replace(/'/g, "''");

  let psScript = '';

  if (['docx', 'doc', 'dotx', 'dot', 'rtf'].includes(ext)) {
    psScript = `
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open('${escapedInput}', $false, $true)
  $doc.SaveAs([ref]'${escapedOutput}', [ref]17) # 17 = wdFormatPDF
  $doc.Close($false)
  Write-Output 'OK'
} finally {
  $word.Quit()
}
`;
  } else if (['xlsx', 'xls', 'xlsm', 'xlsb'].includes(ext)) {
    psScript = `
$ErrorActionPreference = 'Stop'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $wb = $excel.Workbooks.Open('${escapedInput}', $false, $true)
  $wb.ExportAsFixedFormat(0, '${escapedOutput}') # 0 = xlTypePDF
  $wb.Close($false)
  Write-Output 'OK'
} finally {
  $excel.Quit()
}
`;
  } else if (['pptx', 'ppt', 'ppsx', 'pps'].includes(ext)) {
    psScript = `
$ErrorActionPreference = 'Stop'
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Open('${escapedInput}', 1, 0, 0) # ReadOnly=1, Untitled=0, WithWindow=0
  $pres.SaveAs('${escapedOutput}', 32) # 32 = ppSaveAsPDF
  $pres.Close()
  Write-Output 'OK'
} finally {
  $ppt.Quit()
}
`;
  }

  if (!psScript) return null;

  try {
    const res = await runPowerShellScript(psScript);
    if (res.includes('OK') && fs.existsSync(tempOut)) {
      const bytes = await fs.promises.readFile(tempOut);
      fs.promises.unlink(tempOut).catch(() => {});
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
  } catch (err) {
    // Clean up temp file if any
    if (fs.existsSync(tempOut)) fs.promises.unlink(tempOut).catch(() => {});
    // Fall back to pure-JS converter
    console.warn(`[Office COM Warning] Conversion failed via COM for ${filePath}, falling back to built-in converter:`, err.message);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Pure JavaScript Parsers to HTML
// ─────────────────────────────────────────────────────────────────────────────

// Word (.docx) -> HTML
async function convertDocxToHtml(filePath) {
  const buf = await fs.promises.readFile(filePath);
  const result = await mammoth.convertToHtml({ buffer: buf });
  const htmlBody = result.value || '<p>(Empty Document)</p>';
  return `
<div class="doc-body">
  ${htmlBody}
</div>`;
}

// Excel (.xlsx, .xls, .csv, .tsv) -> HTML
async function convertExcelToHtml(filePath, options = {}) {
  const buf = await fs.promises.readFile(filePath);
  const workbook = XLSX.read(buf, { type: 'buffer' });
  let html = `<div class="spreadsheet-container">`;

  const sheetNames = (options.excelSheets === 'first') ? [workbook.SheetNames[0]] : workbook.SheetNames;
  const showGrid = options.excelGridlines !== false;

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const sheetHtml = XLSX.utils.sheet_to_html(sheet, { header: '', footer: '' });
    html += `
    <div class="sheet-section ${showGrid ? 'grid-borders' : ''}">
      <h2 class="sheet-title">${escapeHtml(sheetName)}</h2>
      <div class="table-wrap">
        ${sheetHtml}
      </div>
    </div>`;
  }
  html += `</div>`;
  return html;
}

// PowerPoint (.pptx) -> HTML Slides
async function convertPptxToHtml(filePath) {
  const buf = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);

  // Read slide list from ppt/presentation.xml if available
  const slideFiles = Object.keys(zip.files).filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k));
  // Sort naturally by slide number: slide1, slide2, slide10...
  slideFiles.sort((a, b) => {
    const numA = parseInt((a.match(/\d+/) || [0])[0], 10);
    const numB = parseInt((b.match(/\d+/) || [0])[0], 10);
    return numA - numB;
  });

  if (!slideFiles.length) {
    return `<div class="slide-page"><h1>Presentation</h1><p>No slides found.</p></div>`;
  }

  // Pre-load media files (images) into base64 data URIs
  const mediaMap = {};
  for (const fileName of Object.keys(zip.files)) {
    if (fileName.startsWith('ppt/media/')) {
      const ext = path.extname(fileName).toLowerCase().replace('.', '');
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      const fileData = await zip.files[fileName].async('base64');
      mediaMap[path.basename(fileName)] = `data:${mime};base64,${fileData}`;
    }
  }

  let html = `<div class="presentation-container">`;

  for (let i = 0; i < slideFiles.length; i++) {
    const slidePath = slideFiles[i];
    const slideXml = await zip.files[slidePath].async('string');

    // Extract text paragraphs
    const paragraphs = [];
    const pMatches = slideXml.match(/<a:p[\s>].*?<\/a:p>/gs) || [];
    for (const pXml of pMatches) {
      const tMatches = pXml.match(/<a:t[^>]*>(.*?)<\/a:t>/gs) || [];
      const textParts = tMatches.map(t => t.replace(/<[^>]+>/g, '')).filter(Boolean);
      const text = textParts.join('').trim();
      if (text) paragraphs.push(text);
    }

    // Check relationship file for images in this slide
    const relsPath = `ppt/slides/_rels/${path.basename(slidePath)}.rels`;
    const slideImages = [];
    if (zip.files[relsPath]) {
      const relsXml = await zip.files[relsPath].async('string');
      const targetMatches = relsXml.match(/Target="([^"]+)"/g) || [];
      for (const tm of targetMatches) {
        const target = tm.replace(/Target="|"/g, '');
        const imgName = path.basename(target);
        if (mediaMap[imgName]) slideImages.push(mediaMap[imgName]);
      }
    }

    html += `
    <div class="slide-page">
      <div class="slide-header">
        <span class="slide-number">Slide ${i + 1} of ${slideFiles.length}</span>
      </div>
      <div class="slide-content">`;

    if (paragraphs.length) {
      html += `<h2 class="slide-title">${escapeHtml(paragraphs[0])}</h2>`;
      if (paragraphs.length > 1) {
        html += `<ul class="slide-bullets">`;
        for (let j = 1; j < paragraphs.length; j++) {
          html += `<li>${escapeHtml(paragraphs[j])}</li>`;
        }
        html += `</ul>`;
      }
    } else {
      html += `<h2>(Visual Slide)</h2>`;
    }

    if (slideImages.length) {
      html += `<div class="slide-media-grid">`;
      for (const imgUri of slideImages) {
        html += `<img class="slide-img" src="${imgUri}" alt="Slide image">`;
      }
      html += `</div>`;
    }

    html += `
      </div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

// Markdown (.md) -> HTML
async function convertMarkdownToHtml(filePath) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  const bodyHtml = mdParser.render(content);
  return `<div class="markdown-body">${bodyHtml}</div>`;
}

// Plain Text / Code / CSV -> HTML
async function convertTextToHtml(filePath, ext) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  const base = path.basename(filePath);

  if (ext === 'csv' || ext === 'tsv') {
    const workbook = XLSX.read(content, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const tableHtml = XLSX.utils.sheet_to_html(sheet);
    return `<div class="spreadsheet-container"><h2 class="sheet-title">${escapeHtml(base)}</h2>${tableHtml}</div>`;
  }

  if (['html', 'htm'].includes(ext)) {
    return content;
  }

  return `
<div class="text-document">
  <div class="text-header">
    <strong>${escapeHtml(base)}</strong>
  </div>
  <pre class="text-content"><code>${escapeHtml(content)}</code></pre>
</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Render HTML to Vector PDF via Chromium printToPDF
// ─────────────────────────────────────────────────────────────────────────────

async function renderHtmlToPdf(htmlBody, title = 'Document', { isLandscape = false } = {}) {
  const { BrowserWindow } = require('electron');

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page {
    size: ${isLandscape ? 'A4 landscape' : 'A4 portrait'};
    margin: 15mm 15mm 15mm 15mm;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1a1a1a;
    background: #ffffff;
    line-height: 1.6;
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, h4, h5, h6 { color: #0f172a; margin-top: 1.2em; margin-bottom: 0.5em; font-weight: 700; }
  h1 { font-size: 24pt; border-bottom: 2px solid #0066cc; padding-bottom: 6px; }
  h2 { font-size: 18pt; }
  h3 { font-size: 14pt; }
  p { margin: 0 0 10pt 0; }
  
  /* Tables */
  table { border-collapse: collapse; width: 100%; margin: 15pt 0; page-break-inside: auto; font-size: 10pt; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  th, td { border: 1px solid #cbd5e1; padding: 6pt 10pt; text-align: left; vertical-align: top; }
  th { background-color: #0066cc !important; color: #ffffff !important; font-weight: 600; }
  tr:nth-child(even) td { background-color: #f8fafc; }
  
  /* Code & Text */
  pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 12pt;
    font-family: Consolas, "Courier New", monospace;
    font-size: 9.5pt;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.45;
  }
  code { font-family: Consolas, monospace; background: #f1f5f9; padding: 2px 4px; border-radius: 3px; font-size: 9pt; }
  
  /* Images */
  img { max-width: 100%; height: auto; display: block; margin: 10pt auto; border-radius: 4px; }
  
  /* PowerPoint Slides */
  .slide-page {
    page-break-after: always;
    min-height: 185mm;
    border: 2px solid #0066cc;
    border-radius: 8px;
    padding: 24pt;
    margin-bottom: 20pt;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
  }
  .slide-header {
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 8pt;
    margin-bottom: 16pt;
    display: flex;
    justify-content: flex-end;
  }
  .slide-number { font-size: 9pt; color: #64748b; font-weight: 600; }
  .slide-title { font-size: 20pt; color: #0066cc; margin-top: 0; }
  .slide-bullets { font-size: 13pt; line-height: 1.8; margin-left: 20pt; }
  .slide-media-grid { display: flex; flex-wrap: wrap; gap: 12pt; justify-content: center; margin-top: 14pt; }
  .slide-img { max-height: 250px; max-width: 90%; object-fit: contain; border: 1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  
  /* Header & Footer */
  .doc-watermark { font-size: 8pt; color: #94a3b8; text-align: right; margin-bottom: 10pt; }
</style>
</head>
<body>
  <div class="doc-watermark">Created with Eazy PDF Creator — Vidyasagar Academy</div>
  ${htmlBody}
</body>
</html>`;

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);
    // Allow DOM to layout completely
    await new Promise(r => setTimeout(r, 300));

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: isLandscape,
      margins: { marginType: 'none' }, // @page CSS rules apply
    });

    win.destroy();
    return new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength);
  } catch (err) {
    if (!win.isDestroyed()) win.destroy();
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Master Converter Function: Convert any file to PDF bytes
// ─────────────────────────────────────────────────────────────────────────────

async function convertFileToPdf(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const title = path.basename(filePath);

  // If already a PDF, read bytes directly
  if (ext === 'pdf') {
    const buf = await fs.promises.readFile(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  // 1. First attempt: Native Office COM (on Windows)
  const comBytes = await tryOfficeComConvert(filePath, ext);
  if (comBytes) {
    return comBytes;
  }

  // 2. Pure JavaScript Fallbacks
  let html = '';
  let isLandscape = false;

  if (['docx', 'doc', 'dotx', 'dot', 'rtf'].includes(ext)) {
    html = await convertDocxToHtml(filePath);
  } else if (['xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'tsv', 'ods'].includes(ext)) {
    html = await convertExcelToHtml(filePath, options);
    isLandscape = true; // Spreadsheets look much better in landscape
  } else if (['pptx', 'ppt', 'ppsx', 'pps'].includes(ext)) {
    html = await convertPptxToHtml(filePath);
    isLandscape = true; // Slides are widescreen / landscape
  } else if (['md', 'markdown'].includes(ext)) {
    html = await convertMarkdownToHtml(filePath);
  } else if (['txt', 'html', 'htm', 'json', 'xml', 'log', 'css', 'js', 'py', 'c', 'cpp', 'java'].includes(ext)) {
    html = await convertTextToHtml(filePath, ext);
  } else if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'svg'].includes(ext)) {
    // Render high-res image page
    const fileBytes = await fs.promises.readFile(filePath);
    const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const b64 = fileBytes.toString('base64');
    html = `<div style="text-align:center; padding:10mm 0;"><img src="data:${mime};base64,${b64}" style="max-width:100%; max-height:260mm; object-fit:contain; margin:auto;" alt="${escapeHtml(title)}"></div>`;
  } else {
    // Generic fallback for any other file type: read as text or binary hex view
    try {
      html = await convertTextToHtml(filePath, ext);
    } catch {
      throw new Error(`Unsupported file type: .${ext}`);
    }
  }

  // Render to PDF via Chromium
  return await renderHtmlToPdf(html, title, { isLandscape });
}

module.exports = {
  convertFileToPdf,
  renderHtmlToPdf,
};
