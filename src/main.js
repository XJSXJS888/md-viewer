'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard, nativeTheme } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');
const iconv = require('iconv-lite');

const APP_NAME = 'MD Viewer';
const MD_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TEST_MD = process.env.MDVIEWER_TEST_MD || '';
const TEST_EMPTY = process.env.MDVIEWER_TEST_EMPTY === '1';
const TEST_MODE = Boolean(TEST_MD) || TEST_EMPTY;
const TEST_SHOT = process.env.MDVIEWER_TEST_SHOT || '';
const TEST_SHOT_2 = process.env.MDVIEWER_TEST_SHOT_2 || '';
const TEST_THEME = process.env.MDVIEWER_TEST_THEME || '';
const TEST_EDIT = process.env.MDVIEWER_TEST_MODE === 'edit';
const TEST_JSON = process.env.MDVIEWER_TEST_JSON || '';

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('local.mdviewer.app');
if (TEST_MODE) {
  try { app.setPath('userData', path.join(app.getPath('temp'), 'md-viewer-test-profile')); } catch (_) {}
}

let mainWindow = null;
let currentFile = null;
let currentDir = null;
let watchTimer = null;
let findText = '';
let statePath = '';
let saveTimer = null;
let initialFilePath = '';
let testFinishTimer = null;
let rendererDirty = false;
let allowClose = false;
let state = {
  recent: [],
  window: { width: 1280, height: 860, maximized: false }
};

function findMarkdownArg(argv) {
  if (!Array.isArray(argv)) return '';
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-')) continue;
    const candidate = raw.replace(/^"|"$/g, '');
    try {
      const resolved = path.resolve(candidate);
      if (MD_EXTENSIONS.has(path.extname(resolved).toLowerCase()) && fs.existsSync(resolved)) return resolved;
    } catch (_) { /* ignore malformed argv */ }
  }
  return '';
}

initialFilePath = TEST_MD ? path.resolve(TEST_MD) : findMarkdownArg(process.argv);
let shouldStartApp = true;

if (!TEST_MODE) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    shouldStartApp = false;
    app.quit();
  } else {
    app.on('second-instance', (_event, argv) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      const file = findMarkdownArg(argv);
      if (file) openAndSend(file);
    });
  }
}

function getStatePath() {
  return path.join(app.getPath('userData'), 'viewer-state.json');
}

function loadState() {
  statePath = getStatePath();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.recent)) {
        state.recent = parsed.recent
          .filter((item) => item && typeof item.path === 'string')
          .slice(0, 8)
          .map((item) => ({
            path: item.path,
            name: String(item.name || path.basename(item.path)),
            openedAt: Number(item.openedAt) || 0
          }));
      }
      if (parsed.window && Number.isFinite(parsed.window.width) && Number.isFinite(parsed.window.height)) {
        state.window.width = Math.max(780, Math.min(2400, parsed.window.width));
        state.window.height = Math.max(540, Math.min(1600, parsed.window.height));
        state.window.maximized = Boolean(parsed.window.maximized);
      }
    }
  } catch (_) { /* first run */ }
}

function saveStateNow() {
  if (!statePath) return;
  try {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      const [width, height] = mainWindow.getSize();
      state.window.width = width;
      state.window.height = height;
    }
    if (mainWindow && !mainWindow.isDestroyed()) state.window.maximized = mainWindow.isMaximized();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) {}
}

function scheduleSaveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, 250);
}

function addRecent(docPath) {
  const normalized = path.resolve(docPath);
  state.recent = [
    { path: normalized, name: path.basename(normalized), openedAt: Date.now() },
    ...state.recent.filter((item) => item.path !== normalized)
  ].slice(0, 8);
  scheduleSaveState();
}

function assertMarkdownPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    const error = new Error('没有选择文件');
    error.code = 'EMPTY_PATH';
    throw error;
  }
  const abs = path.resolve(filePath);
  if (!MD_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
    const error = new Error('请选择 Markdown 文件');
    error.code = 'UNSUPPORTED_FILE';
    throw error;
  }
  return abs;
}

function decodeMarkdown(buffer) {
  let raw = '';
  let encoding = 'UTF-8';
  let encodingKey = 'utf8';
  let bom = false;

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    raw = buffer.subarray(3).toString('utf8');
    encoding = 'UTF-8 BOM';
    encodingKey = 'utf8';
    bom = true;
  } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    raw = buffer.subarray(2).toString('utf16le');
    encoding = 'UTF-16 LE';
    encodingKey = 'utf16le';
    bom = true;
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    let body = Buffer.from(buffer.subarray(2));
    if (body.length % 2 !== 0) body = body.subarray(0, body.length - 1);
    body.swap16();
    raw = body.toString('utf16le');
    encoding = 'UTF-16 BE';
    encodingKey = 'utf16be';
    bom = true;
  } else {
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (_) {
      const candidates = [
        ['gb18030', 'GB18030'],
        ['big5', 'Big5']
      ];
      for (const [key, label] of candidates) {
        try {
          raw = new TextDecoder(key, { fatal: true }).decode(buffer);
          encoding = label;
          encodingKey = key;
          break;
        } catch (_) {}
      }
      if (!raw) {
        raw = buffer.toString('latin1');
        encoding = 'Latin-1';
        encodingKey = 'latin1';
      }
    }
  }

  const eol = raw.includes('\r\n') ? 'crlf' : (raw.includes('\r') ? 'cr' : 'lf');
  return {
    text: raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'),
    encoding,
    encodingKey,
    bom,
    eol
  };
}

function encodeMarkdown(content, meta) {
  const normalized = String(content == null ? '' : content).replace(/\r\n?/g, '\n');
  const eol = meta && meta.eol === 'crlf' ? '\r\n' : (meta && meta.eol === 'cr' ? '\r' : '\n');
  const text = normalized.split('\n').join(eol);
  const key = meta && meta.encodingKey ? meta.encodingKey : 'utf8';
  const withBom = Boolean(meta && meta.bom);

  if (key === 'utf16le') {
    const body = Buffer.from(text, 'utf16le');
    return withBom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
  }
  if (key === 'utf16be') {
    const body = Buffer.from(text, 'utf16le');
    body.swap16();
    return withBom ? Buffer.concat([Buffer.from([0xfe, 0xff]), body]) : body;
  }
  if (key === 'gb18030' || key === 'big5') {
    return iconv.encode(text, key);
  }
  if (key === 'latin1') {
    return Buffer.from(text, 'latin1');
  }
  const body = Buffer.from(text, 'utf8');
  return withBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

async function readMarkdown(filePath) {
  const abs = assertMarkdownPath(filePath);
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: false, code: 'ENOENT', error: '文件不存在' };
    if (error.code === 'EACCES' || error.code === 'EPERM') return { ok: false, code: 'EACCES', error: '没有权限读取这个文件' };
    return { ok: false, code: error.code || 'STAT_FAILED', error: '无法读取文件信息' };
  }
  if (!stat.isFile()) return { ok: false, code: 'NOT_FILE', error: '请选择 Markdown 文件' };
  if (stat.size > MAX_FILE_BYTES) return { ok: false, code: 'TOO_LARGE', error: '文件超过 20 MB' };

  let buffer;
  try {
    buffer = await fsp.readFile(abs);
  } catch (error) {
    return { ok: false, code: error.code || 'READ_FAILED', error: '无法读取文件' };
  }

  const decoded = decodeMarkdown(buffer);
  const content = decoded.text;
  const dir = path.dirname(abs);
  addRecent(abs);
  watchFile(abs);
  currentFile = abs;
  currentDir = dir;

  return {
    ok: true,
    path: abs,
    name: path.basename(abs),
    dir,
    dirUrl: pathToFileURL(dir + path.sep).href,
    content,
    encoding: decoded.encoding,
    encodingKey: decoded.encodingKey,
    bom: decoded.bom,
    eol: decoded.eol,
    size: stat.size,
    mtime: stat.mtimeMs,
    modifiedAt: stat.mtime.toISOString(),
    lineCount: content.length ? content.split('\n').length : 0
  };
}

function watchFile(filePath) {
  stopWatching();
  currentFile = filePath;
  try {
    fs.watchFile(filePath, { interval: 700, persistent: false }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file:changed', {
            path: filePath,
            mtime: curr.mtimeMs,
            size: curr.size,
            exists: curr.mtimeMs !== 0
          });
        }
      }, 180);
    });
  } catch (_) {}
}

function stopWatching() {
  if (currentFile) {
    try { fs.unwatchFile(currentFile); } catch (_) {}
  }
  clearTimeout(watchTimer);
  watchTimer = null;
}

async function openAndSend(filePath) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (rendererDirty) {
    mainWindow.webContents.send('app:open-request', { path: filePath });
    return;
  }
  try {
    const payload = await readMarkdown(filePath);
    if (payload.ok) {
      mainWindow.setTitle(payload.name + ' — ' + APP_NAME);
      mainWindow.webContents.send('file:opened', payload);
    } else {
      mainWindow.webContents.send('file:error', payload);
    }
  } catch (error) {
    mainWindow.webContents.send('file:error', { ok: false, error: error.message || '无法打开文件' });
  }
}

function isAllowedExternal(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch (_) {
    return false;
  }
}

function createWindow() {
  const bounds = {
    width: state.window.width,
    height: state.window.height,
    minWidth: 780,
    minHeight: 540,
    show: false,
    backgroundColor: '#f4f8ff',
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false
    }
  };
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  if (fs.existsSync(iconPath)) bounds.icon = iconPath;

  mainWindow = new BrowserWindow(bounds);
  Menu.setApplicationMenu(null);
  if (state.window.maximized) mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (isAllowedExternal(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  mainWindow.webContents.on('found-in-page', (_event, result) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('find:result', {
      matches: result.matches || 0,
      active: result.activeMatchOrdinal || 0,
      finalUpdate: Boolean(result.finalUpdate)
    });
  });

  mainWindow.webContents.on('console-message', (...args) => {
    const first = args[0];
    let message = '';
    let level = 'log';
    if (first && typeof first === 'object' && 'message' in first) {
      message = String(first.message);
      level = String(first.level || 'log');
    } else {
      level = String(args[1] || 'log');
      message = String(args[2] || '');
    }
    if (message) console.log('[renderer:' + level + '] ' + message);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer gone]', details.reason);
    if (TEST_MODE) process.exitCode = 3;
  });

  mainWindow.on('resize', scheduleSaveState);
  mainWindow.on('maximize', scheduleSaveState);
  mainWindow.on('unmaximize', scheduleSaveState);
  mainWindow.on('close', (event) => {
    if (!allowClose && rendererDirty) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:close-requested');
      return;
    }
    saveStateNow();
    stopWatching();
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

function startTest(meta) {
  if (!TEST_MODE) return;
  if (TEST_JSON) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(TEST_JSON)), { recursive: true });
      fs.writeFileSync(path.resolve(TEST_JSON), JSON.stringify(meta || {}, null, 2), 'utf8');
    } catch (_) {}
  }
  clearTimeout(testFinishTimer);
  testFinishTimer = setTimeout(async () => {
    try {
      if (TEST_EDIT && mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.webContents.executeJavaScript("document.querySelector('[data-mode=\\\"edit\\\"]').click();");
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (TEST_THEME && mainWindow && !mainWindow.isDestroyed()) {
        const theme = TEST_THEME === 'dark' ? 'dark' : 'light';
        await mainWindow.webContents.executeJavaScript(
          'document.documentElement.dataset.theme = ' + JSON.stringify(theme) + ';' +
          'document.documentElement.dataset.themeMode = ' + JSON.stringify(theme) + ';'
        );
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (TEST_SHOT && mainWindow && !mainWindow.isDestroyed()) {
        const image = await mainWindow.webContents.capturePage();
        fs.mkdirSync(path.dirname(path.resolve(TEST_SHOT)), { recursive: true });
        fs.writeFileSync(path.resolve(TEST_SHOT), image.toPNG());
        if (TEST_SHOT_2) {
          await mainWindow.webContents.executeJavaScript('const area = document.getElementById("scrollArea"); const table = document.querySelector(".table-wrap"); if (table) table.scrollIntoView({ block: "center", behavior: "instant" }); else area.scrollTo({ top: 1100, behavior: "instant" });');
          await new Promise((resolve) => setTimeout(resolve, 500));
          const image2 = await mainWindow.webContents.capturePage();
          fs.mkdirSync(path.dirname(path.resolve(TEST_SHOT_2)), { recursive: true });
          fs.writeFileSync(path.resolve(TEST_SHOT_2), image2.toPNG());
        }
      }
      app.exit(0);
    } catch (error) {
      console.error('[test capture failed]', error);
      app.exit(4);
    }
  }, 1300);
}

function registerIpc() {
  ipcMain.handle('app:init', async () => {
    let initial = null;
    if (initialFilePath) {
      try {
        initial = await readMarkdown(initialFilePath);
        if (initial && initial.ok && mainWindow) mainWindow.setTitle(initial.name + ' — ' + APP_NAME);
      } catch (error) {
        initial = { ok: false, error: error.message || '无法打开文件' };
      }
      initialFilePath = '';
    }
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      initialState: initial,
      recent: state.recent,
      testMode: TEST_MODE
    };
  });

  ipcMain.handle('dialog:open', async () => {
    if (!mainWindow) return { ok: false, error: '窗口不可用' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开文件',
      properties: ['openFile'],
      defaultPath: currentDir || app.getPath('documents'),
      filters: [
        { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('file:load', async (_event, filePath) => {
    try {
      const payload = await readMarkdown(filePath);
      if (payload.ok && mainWindow) mainWindow.setTitle(payload.name + ' — ' + APP_NAME);
      return payload;
    } catch (error) {
      return { ok: false, error: error.message || '无法打开文件' };
    }
  });

  ipcMain.handle('file:reload', async () => {
    if (!currentFile) return { ok: false, error: '没有打开的文件' };
    try {
      const payload = await readMarkdown(currentFile);
      if (payload.ok && mainWindow) mainWindow.setTitle(payload.name + ' — ' + APP_NAME);
      return payload;
    } catch (error) {
      return { ok: false, error: error.message || '重新加载失败' };
    }
  });

  ipcMain.handle('file:save', async (_event, payload) => {
    if (!currentFile) return { ok: false, error: '没有打开的文件' };
    if (!payload || typeof payload.content !== 'string') return { ok: false, error: '没有可保存的内容' };
    if (payload.path && path.resolve(payload.path) !== currentFile) return { ok: false, code: 'STALE', error: '文件已切换' };
    try {
      const buffer = encodeMarkdown(payload.content, payload);
      if (buffer.length > MAX_FILE_BYTES) return { ok: false, code: 'TOO_LARGE', error: '文件超过 20 MB' };
      await fsp.writeFile(currentFile, buffer);
      const updated = await readMarkdown(currentFile);
      if (updated.ok) {
        rendererDirty = false;
        if (mainWindow) mainWindow.setTitle(updated.name + ' — ' + APP_NAME);
      }
      return updated;
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') return { ok: false, code: error.code, error: '没有写入权限' };
      if (error.code === 'EBUSY') return { ok: false, code: error.code, error: '文件正被其他程序占用' };
      return { ok: false, code: error.code || 'WRITE_FAILED', error: '保存失败' };
    }
  });

  ipcMain.handle('link:open', async (_event, payload) => {
    if (!payload || typeof payload.href !== 'string') return { ok: false };
    const href = payload.href.trim();
    if (!href || href.startsWith('#')) return { ok: false };
    if (isAllowedExternal(href)) {
      await shell.openExternal(href);
      return { ok: true, external: true };
    }
    let anchor = '';
    let cleanHref = href;
    const hashIndex = href.indexOf('#');
    if (hashIndex >= 0) {
      try { anchor = decodeURIComponent(href.slice(hashIndex + 1)); } catch (_) { anchor = href.slice(hashIndex + 1); }
      cleanHref = href.slice(0, hashIndex);
    }
    if (!cleanHref) return { ok: false };
    let target = cleanHref;
    if (cleanHref.startsWith('file:')) {
      try { target = new URL(cleanHref).pathname; } catch (_) { return { ok: false }; }
      if (/^\/[A-Za-z]:/.test(target)) target = target.slice(1);
      try { target = decodeURIComponent(target); } catch (_) {}
    } else {
      if (!currentDir) return { ok: false, error: '没有打开的文件' };
      try { target = path.resolve(currentDir, decodeURIComponent(cleanHref)); } catch (_) { return { ok: false }; }
    }
    if (MD_EXTENSIONS.has(path.extname(target).toLowerCase())) {
      const doc = await readMarkdown(target);
      if (doc.ok) {
        doc.anchor = anchor;
        if (mainWindow) {
          mainWindow.setTitle(doc.name + ' — ' + APP_NAME);
          mainWindow.webContents.send('file:opened', doc);
        }
      } else if (mainWindow) {
        mainWindow.webContents.send('file:error', doc);
      }
      return doc;
    }
    const result = await shell.openPath(target);
    return { ok: !result, error: result || undefined };
  });

  ipcMain.handle('shell:reveal', async () => {
    if (!currentFile) return false;
    shell.showItemInFolder(currentFile);
    return true;
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    if (typeof text === 'string') clipboard.writeText(text.slice(0, 2 * 1024 * 1024));
    return true;
  });

  ipcMain.handle('theme:set', (_event, mode) => {
    if (mode === 'light' || mode === 'dark' || mode === 'system') nativeTheme.themeSource = mode;
    return nativeTheme.shouldUseDarkColors;
  });

  ipcMain.handle('find:start', (_event, text) => {
    if (!mainWindow) return;
    findText = typeof text === 'string' ? text : '';
    if (findText) mainWindow.webContents.findInPage(findText, { forward: true, findNext: false });
    else mainWindow.webContents.stopFindInPage('clearSelection');
  });

  ipcMain.handle('find:next', (_event, direction) => {
    if (!mainWindow || !findText) return;
    mainWindow.webContents.findInPage(findText, {
      forward: direction !== 'backward',
      findNext: true
    });
  });

  ipcMain.handle('find:stop', () => {
    findText = '';
    if (mainWindow) mainWindow.webContents.stopFindInPage('clearSelection');
  });

  ipcMain.handle('app:clear-recent', () => {
    state.recent = [];
    scheduleSaveState();
    return [];
  });

  ipcMain.handle('app:quit', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window:confirm-close', () => {
    allowClose = true;
    rendererDirty = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return true;
  });

  ipcMain.on('editor:dirty', (_event, dirty) => {
    rendererDirty = Boolean(dirty);
  });

  ipcMain.on('app:rendered', (_event, meta) => {
    startTest(meta);
  });

  ipcMain.on('app:render-error', (_event, message) => {
    console.error('[render error]', message);
    if (TEST_JSON) {
      try { fs.writeFileSync(path.resolve(TEST_JSON), JSON.stringify({ error: message }, null, 2)); } catch (_) {}
    }
    if (TEST_MODE) app.exit(5);
  });
}

if (shouldStartApp) {
  app.whenReady().then(() => {
    loadState();
    registerIpc();
    createWindow();
    if (TEST_MODE) {
      setTimeout(() => {
        console.error('[test timeout] renderer did not finish in time');
        app.exit(6);
      }, 20000);
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  saveStateNow();
  stopWatching();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  saveStateNow();
  stopWatching();
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) openAndSend(filePath);
  else initialFilePath = filePath;
});
