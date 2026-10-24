'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('viewer', {
  init: () => ipcRenderer.invoke('app:init'),
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  loadFile: (filePath) => ipcRenderer.invoke('file:load', filePath),
  reload: () => ipcRenderer.invoke('file:reload'),
  saveFile: (payload) => ipcRenderer.invoke('file:save', payload),
  openLink: (payload) => ipcRenderer.invoke('link:open', payload),
  reveal: () => ipcRenderer.invoke('shell:reveal'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  clearRecent: () => ipcRenderer.invoke('app:clear-recent'),
  quit: () => ipcRenderer.invoke('app:quit'),
  setDirty: (dirty) => ipcRenderer.send('editor:dirty', Boolean(dirty)),
  confirmClose: () => ipcRenderer.invoke('window:confirm-close'),
  findStart: (text) => ipcRenderer.invoke('find:start', text),
  findNext: (direction) => ipcRenderer.invoke('find:next', direction),
  findStop: () => ipcRenderer.invoke('find:stop'),
  setNativeTheme: (mode) => ipcRenderer.invoke('theme:set', mode),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (_) { return ''; }
  },
  onFileOpened: (callback) => subscribe('file:opened', callback),
  onFileError: (callback) => subscribe('file:error', callback),
  onFileChanged: (callback) => subscribe('file:changed', callback),
  onOpenRequest: (callback) => subscribe('app:open-request', callback),
  onCloseRequested: (callback) => subscribe('app:close-requested', callback),
  onFindResult: (callback) => subscribe('find:result', callback),
  rendered: (meta) => ipcRenderer.send('app:rendered', meta),
  renderError: (message) => ipcRenderer.send('app:render-error', String(message || 'unknown'))
});
