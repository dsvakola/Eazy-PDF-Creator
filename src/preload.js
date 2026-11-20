const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('vra', {
  initialFiles: () => ipcRenderer.invoke('initial-files'),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  openConverterDialog: () => ipcRenderer.invoke('open-converter-dialog'),
  convertToPdf: (p, opts) => ipcRenderer.invoke('convert-to-pdf', p, opts),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  fileInfo: (p) => ipcRenderer.invoke('file-info', p),
  storeGet: (name) => ipcRenderer.invoke('store-get', name),
  storeSet: (name, data) => ipcRenderer.send('store-set', name, data),
  saveCopy: (name, bytes) => ipcRenderer.invoke('save-copy', name, bytes),
  print: () => ipcRenderer.invoke('print'),
  setFullscreen: (on) => ipcRenderer.send('set-fullscreen', on),
  setTitle: (t) => ipcRenderer.send('set-title', t),
  closeApp: () => ipcRenderer.send('close-app'),
  showInFolder: (p) => ipcRenderer.send('show-in-folder', p),
  openDefaultApps: () => ipcRenderer.send('open-default-apps'),
  openExternal: (u) => ipcRenderer.send('open-external', u),
  version: () => ipcRenderer.invoke('app-version'),
  protectAndSave: (name, bytes, opts) => ipcRenderer.invoke('protect-and-save', name, bytes, opts),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, files) => cb(files)),
});
