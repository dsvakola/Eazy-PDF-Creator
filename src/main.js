// Eazy PDF Creator - main process
// Free software under GPL. Copyright (C) 2026 Vidyasagar Academy.
// Developed by Prof. Dattaraj S. Vidyasagar & Prof. Yash D. Vidyasagar.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const { protectPdf } = require('./pdf-protect');
const path = require('path');
const fs = require('fs');

const ICON = path.join(__dirname, '..', 'assets', 'logo.png');
let win = null;
let pendingFiles = [];

// ---------- tiny JSON store (settings, recent files, last pages, annotations) ----------
const storeCache = {};
function storePath(name) { return path.join(app.getPath('userData'), name + '.json'); }
function storeGet(name) {
  if (storeCache[name] !== undefined) return storeCache[name];
  try { storeCache[name] = JSON.parse(fs.readFileSync(storePath(name), 'utf8')); }
  catch (e) { storeCache[name] = {}; }
  return storeCache[name];
}
function storeSet(name, data) {
  storeCache[name] = data;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(storePath(name), JSON.stringify(data));
  } catch (e) { console.error('store write failed', e); }
}

function pdfArgs(argv) {
  return argv.slice(app.isPackaged ? 1 : 2)
    .filter(a => !a.startsWith('--') && /\.pdf$/i.test(a) && fs.existsSync(a))
    .map(a => path.resolve(a));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = pdfArgs(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (files.length) win.webContents.send('open-files', files);
    }
  });
  pendingFiles = pdfArgs(process.argv);
  app.whenReady().then(createWindow);
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const b = storeGet('window');
  win = new BrowserWindow({
    width: b.width || 1150, height: b.height || 800,
    minWidth: 520, minHeight: 400,
    icon: ICON,
    title: 'Eazy PDF Creator',
    backgroundColor: '#2b2f36',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', () => {
    if (!win.isFullScreen()) {
      const bounds = win.getBounds();
      storeSet('window', { width: bounds.width, height: bounds.height, maximized: win.isMaximized() });
    }
  });
  win.on('closed', () => { win = null; });
  // Links inside the app never navigate the window away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.on('window-all-closed', () => app.quit());

// ---------- IPC ----------
ipcMain.handle('initial-files', () => { const f = pendingFiles; pendingFiles = []; return f; });

ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open PDF', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('open-converter-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select files to convert', properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Supported files (PDF & Images)', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] },
      { name: 'PDF documents', extensions: ['pdf'] },
      { name: 'Images (JPG, PNG, WebP, BMP, GIF)', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('read-file', async (_e, p) => {
  const buf = await fs.promises.readFile(p);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});

ipcMain.handle('file-info', async (_e, p) => {
  try { const s = await fs.promises.stat(p); return { exists: true, size: s.size, mtime: s.mtimeMs }; }
  catch (e) { return { exists: false }; }
});

ipcMain.handle('store-get', (_e, name) => storeGet(name));
ipcMain.on('store-set', (_e, name, data) => storeSet(name, data));

ipcMain.handle('save-copy', async (_e, defaultName, bytes) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save copy with annotations', defaultPath: defaultName,
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(bytes));
  return r.filePath;
});

ipcMain.handle('print', () => new Promise((resolve) => {
  win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => resolve({ ok, reason }));
}));

ipcMain.on('set-fullscreen', (_e, on) => { if (win) win.setFullScreen(!!on); });
ipcMain.on('set-title', (_e, t) => { if (win) win.setTitle(t); });
ipcMain.on('close-app', () => app.quit());
ipcMain.on('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('open-default-apps', () => shell.openExternal('ms-settings:defaultapps'));
ipcMain.on('open-external', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.handle('app-version', () => app.getVersion());

ipcMain.handle('protect-and-save', async (_e, defaultName, bytes, opts) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save protected PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const protected_ = protectPdf(bytes, opts);
  await fs.promises.writeFile(r.filePath, protected_);
  return r.filePath;
});
