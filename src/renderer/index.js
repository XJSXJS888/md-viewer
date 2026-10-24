import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

marked.setOptions({ gfm: true, breaks: false });

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'),
  docName: $('docName'),
  docPath: $('docPath'),
  modeSwitch: $('modeSwitch'),
  btnOpen: $('btnOpen'),
  btnOpenEmpty: $('btnOpenEmpty'),
  btnOutline: $('btnOutline'),
  btnReload: $('btnReload'),
  btnSave: $('btnSave'),
  btnTheme: $('btnTheme'),
  btnFontDown: $('btnFontDown'),
  btnFontUp: $('btnFontUp'),
  fontLabel: $('fontLabel'),
  btnFind: $('btnFind'),
  btnReveal: $('btnReveal'),
  emptyState: $('emptyState'),
  documentWrap: $('documentWrap'),
  editorShell: $('editorShell'),
  editor: $('editor'),
  content: $('content'),
  sidebar: $('sidebar'),
  sidebarScrim: $('sidebarScrim'),
  outline: $('outline'),
  recentWrap: $('recentWrap'),
  recentList: $('recentList'),
  btnClearRecent: $('btnClearRecent'),
  scrollArea: $('scrollArea'),
  progress: $('progress'),
  progressBar: $('progressBar'),
  findbar: $('findbar'),
  findInput: $('findInput'),
  findCount: $('findCount'),
  findPrev: $('findPrev'),
  findNext: $('findNext'),
  findClose: $('findClose'),
  statusbar: document.querySelector('.statusbar'),
  statusEncoding: $('statusEncoding'),
  statusModified: $('statusModified'),
  statusStats: $('statusStats'),
  dropOverlay: $('dropOverlay'),
  unsavedModal: $('unsavedModal'),
  modalText: $('modalText'),
  modalCancel: $('modalCancel'),
  modalDiscard: $('modalDiscard'),
  modalSave: $('modalSave'),
  toast: $('toast')
};

const state = {
  doc: null,
  draft: '',
  recent: [],
  headings: [],
  headingMap: new Map(),
  outlineButtons: new Map(),
  activeHeadingId: '',
  outlineOpen: true,
  mode: 'read',
  dirty: false,
  saving: false,
  loading: false,
  fontSize: 16,
  themeMode: 'auto',
  isNarrow: false,
  findOpen: false,
  findQuery: '',
  testMode: false,
  initError: '',
  externalChanged: false,
  modalOpen: false,
  modalResolver: null,
  modalFocus: null,
  closePending: false
};

const THEME_MODES = ['auto', 'light', 'dark'];
const THEME_LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };
const narrowQuery = window.matchMedia('(max-width: 980px)');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let toastTimer = 0;
let findTimer = 0;
let scrollRaf = 0;

function hasViewer() {
  return Boolean(window.viewer && typeof window.viewer.init === 'function');
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatRelative(value) {
  const timestamp = Number(value);
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' 小时前';
  if (seconds < 604800) return Math.floor(seconds / 86400) + ' 天前';
  const date = new Date(timestamp);
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function parentPath(filePath) {
  if (!filePath) return '';
  const parts = String(filePath).split(/[\\/]/);
  parts.pop();
  return parts.join('\\') || filePath;
}

function decodeFragment(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function showToast(message, isError) {
  if (!els.toast) return;
  window.clearTimeout(toastTimer);
  els.toast.textContent = String(message || '');
  els.toast.classList.toggle('error', Boolean(isError));
  els.toast.classList.add('show');
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), isError ? 3600 : 2200);
}

function applyThemeMode(mode, persist) {
  if (!THEME_MODES.includes(mode)) mode = 'auto';
  state.themeMode = mode;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = mode === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : mode;
  if (els.btnTheme) {
    els.btnTheme.title = '外观：' + THEME_LABELS[mode];
    els.btnTheme.setAttribute('aria-label', '外观：' + THEME_LABELS[mode]);
  }
  if (hasViewer() && window.viewer.setNativeTheme) {
    try { window.viewer.setNativeTheme(mode === 'auto' ? 'system' : mode); } catch (_) {}
  }
  if (persist) {
    try { localStorage.setItem('mdv-theme', mode); } catch (_) {}
  }
}

function cycleTheme() {
  applyThemeMode(THEME_MODES[(THEME_MODES.indexOf(state.themeMode) + 1) % THEME_MODES.length], true);
}

function setFontSize(value, persist) {
  const size = clamp(Math.round(Number(value) || 16), 14, 22);
  state.fontSize = size;
  document.documentElement.style.setProperty('--reading-size', size + 'px');
  if (els.fontLabel) els.fontLabel.textContent = String(size);
  if (els.btnFontDown) els.btnFontDown.disabled = size <= 14;
  if (els.btnFontUp) els.btnFontUp.disabled = size >= 22;
  if (persist) {
    try { localStorage.setItem('mdv-font', String(size)); } catch (_) {}
  }
  scheduleScrollUpdate();
}

function setLoading(loading) {
  state.loading = Boolean(loading);
  if (els.progress) els.progress.classList.toggle('loading', state.loading);
}

function initialOutlinePreference() {
  if (state.isNarrow) return false;
  try { return localStorage.getItem('mdv-outline') !== '0'; } catch (_) { return true; }
}

function syncUI() {
  const hasDoc = Boolean(state.doc);
  const editing = hasDoc && state.mode === 'edit';
  els.app.classList.toggle('has-document', hasDoc);
  els.app.classList.toggle('outline-open', hasDoc && state.outlineOpen && !editing);
  els.app.classList.toggle('mode-edit', editing);
  els.app.classList.toggle('is-dirty', hasDoc && state.dirty);
  els.emptyState.hidden = hasDoc;
  els.documentWrap.hidden = !hasDoc || editing;
  els.editorShell.hidden = !hasDoc || !editing;

  if (els.modeSwitch) {
    els.modeSwitch.hidden = !hasDoc;
    els.modeSwitch.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  if (els.btnSave) {
    els.btnSave.hidden = !hasDoc || (state.mode === 'read' && !state.dirty);
    els.btnSave.disabled = !state.dirty || state.saving;
  }
  if (els.btnOutline) {
    els.btnOutline.disabled = !hasDoc || editing;
    els.btnOutline.classList.toggle('active', hasDoc && state.outlineOpen && !editing);
    els.btnOutline.setAttribute('aria-pressed', String(hasDoc && state.outlineOpen && !editing));
  }
  if (els.btnReload) els.btnReload.disabled = !hasDoc || state.saving;
  if (els.btnFind) els.btnFind.disabled = !hasDoc || editing;
  if (els.btnReveal) els.btnReveal.disabled = !hasDoc;
  if (els.sidebarScrim) els.sidebarScrim.hidden = !(hasDoc && state.outlineOpen && state.isNarrow && !editing);
  if (els.docName) els.docName.classList.toggle('dirty', hasDoc && state.dirty);
  const title = hasDoc ? (state.dirty ? '● ' : '') + state.doc.name + ' — MD Viewer' : 'MD Viewer';
  if (document.title !== title) document.title = title;
}

function setDirty(dirty) {
  const next = Boolean(dirty) && Boolean(state.doc) && state.draft !== state.doc.content;
  if (next === state.dirty) {
    if (els.btnSave) els.btnSave.disabled = !state.dirty || state.saving;
    return;
  }
  state.dirty = next;
  if (!next) state.externalChanged = false;
  if (hasViewer()) window.viewer.setDirty(next);
  syncUI();
  updateStatusBar();
}

function setOutline(open, persist) {
  state.outlineOpen = Boolean(open);
  if (persist && !state.isNarrow) {
    try { localStorage.setItem('mdv-outline', state.outlineOpen ? '1' : '0'); } catch (_) {}
  }
  syncUI();
}

function slugifyHeading(text) {
  return String(text || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripFrontMatter(text) {
  const source = String(text || '');
  const lines = source.split('\n');
  if (lines[0].trim() !== '---') return source;
  for (let i = 1; i < Math.min(lines.length, 200); i += 1) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') {
      const metadata = lines.slice(1, i);
      const looksLikeMetadata = metadata.every((line) => {
        const trimmed = line.trim();
        return !trimmed || /^[\w-]+\s*:/.test(trimmed) || /^\s+/.test(line) || trimmed.startsWith('#');
      });
      if (!looksLikeMetadata) return source;
      return lines.slice(i + 1).join('\n');
    }
  }
  return source;
}

function resolveLocalAsset(source) {
  if (!source) return '';
  const src = String(source).trim();
  if (!src) return '';
  if (/^\/\//.test(src)) return 'https:' + src;
  if (/^(?:https?|data|file):/i.test(src)) return src;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return '';
  if (!state.doc || !state.doc.dirUrl) return '';
  if (/^[a-zA-Z]:[\\/]/.test(src)) {
    const normalized = src.replace(/\\/g, '/');
    const drive = normalized.slice(0, 2);
    const rest = normalized.slice(3).split('/').map(encodeURIComponent).join('/');
    return 'file:///' + drive + '/' + rest;
  }
  try { return new URL(src, state.doc.dirUrl).href; } catch (_) { return ''; }
}

function waitForImages(timeout) {
  const images = Array.from(document.images || []);
  if (!images.length) return Promise.resolve();
  const pending = images.filter((image) => !image.complete).map((image) => new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
  }));
  return Promise.race([
    Promise.all(pending),
    new Promise((resolve) => window.setTimeout(resolve, timeout || 1200))
  ]);
}

function renderDocumentBody(markdown) {
  const body = stripFrontMatter(markdown || '');
  if (!body.trim()) {
    els.content.innerHTML = '<div class="blank-document">空白文档</div>';
    state.headings = [];
    state.headingMap = new Map();
    state.outlineButtons = new Map();
    state.activeHeadingId = '';
    renderOutline();
    return;
  }

  const rawHtml = marked.parse(body, { gfm: true, breaks: false });
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['align', 'checked', 'disabled'],
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style', 'srcset'],
    ALLOW_DATA_ATTR: false
  });
  els.content.innerHTML = cleanHtml;
  postProcessContent();
  assignHeadingIds();
  buildOutline();
}

function postProcessContent() {
  els.content.querySelectorAll('table').forEach((table) => {
    if (table.parentElement && table.parentElement.classList.contains('table-wrap')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrap';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });

  els.content.querySelectorAll('img').forEach((image) => {
    const source = image.getAttribute('src') || '';
    if (!source) {
      image.classList.add('img-broken');
      return;
    }
    const resolved = resolveLocalAsset(source);
    if (resolved) image.src = resolved;
    else image.removeAttribute('src');
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.classList.add('img-broken');
      if (!image.alt) image.alt = '图片无法加载';
    }, { once: true });
  });

  els.content.querySelectorAll('pre').forEach((pre) => {
    const codeEl = pre.querySelector('code');
    const languageClass = codeEl ? Array.from(codeEl.classList).find((name) => name.startsWith('language-')) : '';
    const language = languageClass ? languageClass.slice('language-'.length).toLowerCase() : '';
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    if (language) {
      const badge = document.createElement('span');
      badge.className = 'code-lang';
      badge.textContent = language;
      wrapper.appendChild(badge);
    }

    if (codeEl) {
      if (language && hljs.getLanguage(language)) {
        try {
          codeEl.innerHTML = hljs.highlight(codeEl.textContent, { language, ignoreIllegals: true }).value;
          codeEl.classList.add('hljs');
        } catch (_) {}
      } else if (!language && codeEl.textContent.length < 5000) {
        try { hljs.highlightElement(codeEl); } catch (_) {}
      }
    }

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-btn';
    copyButton.textContent = '复制';
    copyButton.title = '复制';
    copyButton.addEventListener('click', async () => {
      try {
        await window.viewer.copyText(pre.textContent || '');
        copyButton.textContent = '已复制';
        window.setTimeout(() => { copyButton.textContent = '复制'; }, 1200);
      } catch (_) {
        showToast('复制失败', true);
      }
    });
    wrapper.appendChild(copyButton);
  });

  els.content.querySelectorAll('a').forEach((link) => {
    link.removeAttribute('target');
    const href = link.getAttribute('href') || '';
    if (href) link.title = href;
  });

  els.content.querySelectorAll('blockquote').forEach((quote) => {
    const firstParagraph = quote.querySelector('p');
    if (!firstParagraph) return;
    const sourceHtml = firstParagraph.innerHTML;
    const match = sourceHtml.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?/i);
    if (!match) return;
    const type = match[1].toLowerCase();
    firstParagraph.innerHTML = sourceHtml.slice(match[0].length);
    const labels = { note: '提示', tip: '提示', important: '重要', warning: '注意', caution: '警告' };
    quote.classList.add('callout', 'callout-' + type);
    const label = document.createElement('div');
    label.className = 'callout-label';
    label.textContent = labels[type] || '提示';
    quote.insertBefore(label, quote.firstChild);
  });

  els.content.querySelectorAll('li > input[type="checkbox"]').forEach((checkbox) => {
    const item = checkbox.closest('li');
    if (item) item.classList.add('task-list-item');
  });

  els.content.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.disabled = true;
    checkbox.tabIndex = -1;
    checkbox.setAttribute('aria-hidden', 'true');
  });

  els.content.querySelectorAll('details').forEach((details) => { details.open = true; });
}

function assignHeadingIds() {
  const nodes = Array.from(els.content.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const used = new Set();
  nodes.forEach((heading, index) => {
    const base = String(heading.id || '').trim() || slugifyHeading(heading.textContent) || ('heading-' + (index + 1));
    let candidate = base;
    let suffix = 1;
    while (used.has(candidate)) {
      candidate = base + '-' + suffix;
      suffix += 1;
    }
    heading.id = candidate;
    used.add(candidate);
  });
  state.headingMap = new Map(nodes.map((heading) => [heading.id, heading]));
}

function buildOutline() {
  state.headings = Array.from(els.content.querySelectorAll('h1,h2,h3'))
    .filter((heading) => heading.textContent.trim().length > 0);
  state.outlineButtons = new Map();
  state.activeHeadingId = state.headings.length ? state.headings[0].id : '';
  renderOutline();
}

function renderOutline() {
  els.outline.textContent = '';
  state.outlineButtons.clear();
  if (!state.headings.length) {
    const empty = document.createElement('div');
    empty.className = 'outline-empty';
    empty.textContent = '无标题';
    els.outline.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  state.headings.forEach((heading) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline-item depth-' + heading.tagName.slice(1) + (heading.id === state.activeHeadingId ? ' active' : '');
    button.dataset.headingId = heading.id;
    button.textContent = heading.textContent.replace(/\s+/g, ' ').trim();
    button.title = button.textContent;
    button.addEventListener('click', () => {
      scrollToAnchor(heading.id, true);
      if (state.isNarrow) setOutline(false, false);
    });
    fragment.appendChild(button);
    state.outlineButtons.set(heading.id, button);
  });
  els.outline.appendChild(fragment);
}

function setActiveHeading(id) {
  if (!id || id === state.activeHeadingId) return;
  const previous = state.outlineButtons.get(state.activeHeadingId);
  if (previous) previous.classList.remove('active');
  state.activeHeadingId = id;
  const current = state.outlineButtons.get(id);
  if (current) {
    current.classList.add('active');
    const top = current.offsetTop;
    const viewTop = els.outline.scrollTop;
    const viewBottom = viewTop + els.outline.clientHeight;
    if (top < viewTop || top > viewBottom - 28) {
      els.outline.scrollTop = Math.max(0, top - els.outline.clientHeight / 2);
    }
  }
}

function scrollToAnchor(id, smooth) {
  if (!id) return false;
  const decoded = decodeFragment(id);
  let target = state.headingMap.get(decoded) || state.headingMap.get(id);
  if (!target) {
    try { target = els.content.querySelector('[id="' + CSS.escape(decoded) + '"]'); } catch (_) {}
  }
  if (!target) return false;
  target.scrollIntoView({ behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto', block: 'start' });
  setActiveHeading(target.id);
  return true;
}

function renderPreview() {
  try {
    renderDocumentBody(state.draft);
  } catch (error) {
    console.error(error);
    els.content.innerHTML = '<div class="blank-document">无法显示文件内容</div>';
    state.headings = [];
    state.headingMap = new Map();
    state.outlineButtons = new Map();
    state.activeHeadingId = '';
    renderOutline();
    showToast('无法显示文件内容', true);
  }
}

function updateDocChrome() {
  if (!state.doc) return;
  els.docName.textContent = state.doc.name;
  els.docPath.textContent = state.doc.dir;
  els.docPath.title = state.doc.path;
  els.docName.title = state.doc.path;
  els.btnReveal.title = state.doc.path;
}

function updateStatusBar() {
  if (!state.doc) {
    els.statusEncoding.textContent = '';
    els.statusModified.hidden = true;
    els.statusStats.textContent = '';
    return;
  }
  const encoding = state.doc.encoding || 'UTF-8';
  els.statusEncoding.textContent = encoding;
  els.statusModified.hidden = !state.dirty;
  els.statusModified.textContent = state.dirty ? '未保存' : '';
  if (state.mode === 'edit') {
    const chars = state.draft.replace(/\s/g, '').length;
    const lines = state.draft.length ? state.draft.split('\n').length : 0;
    els.statusStats.textContent = formatNumber(lines) + ' 行 · ' + formatNumber(chars) + ' 字符';
  } else {
    const text = els.content.innerText || '';
    const chars = text.replace(/\s/g, '').length;
    const lines = state.draft.length ? state.draft.split('\n').length : 0;
    els.statusStats.textContent = formatNumber(lines) + ' 行 · ' + formatNumber(chars) + ' 字';
  }
}

function syncRecentAfterOpen(doc) {
  const entry = { path: doc.path, name: doc.name, openedAt: Date.now() };
  state.recent = [entry, ...state.recent.filter((item) => item.path !== doc.path)].slice(0, 8);
  renderRecent(state.recent);
}

function renderRecent(items) {
  state.recent = Array.isArray(items) ? items.slice(0, 8) : [];
  els.recentList.textContent = '';
  if (!state.recent.length) {
    els.recentWrap.hidden = true;
    return;
  }
  els.recentWrap.hidden = false;
  const fragment = document.createDocumentFragment();
  state.recent.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-item';
    button.title = item.path;

    const icon = document.createElement('span');
    icon.className = 'recent-icon';
    icon.innerHTML = '<svg class="icon"><use href="#i-file"/></svg>';

    const main = document.createElement('span');
    main.className = 'recent-main';
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = item.name || item.path;
    const sub = document.createElement('span');
    sub.className = 'recent-sub';
    sub.textContent = parentPath(item.path);
    main.appendChild(name);
    main.appendChild(sub);

    const time = document.createElement('span');
    time.className = 'recent-time';
    time.textContent = formatRelative(item.openedAt);

    button.appendChild(icon);
    button.appendChild(main);
    button.appendChild(time);
    button.addEventListener('click', () => openSelectedPath(item.path));
    fragment.appendChild(button);
  });
  els.recentList.appendChild(fragment);
}

async function clearRecent() {
  try {
    await window.viewer.clearRecent();
    state.recent = [];
    renderRecent([]);
    showToast('已清除');
  } catch (_) {
    showToast('清除失败', true);
  }
}

function askUnsaved() {
  if (!state.doc) return Promise.resolve('discard');
  if (state.modalResolver) return Promise.resolve('cancel');
  state.modalFocus = document.activeElement;
  if (els.toast) {
    window.clearTimeout(toastTimer);
    els.toast.classList.remove('show');
  }
  els.modalText.textContent = '“' + state.doc.name + '”有未保存的更改。';
  els.unsavedModal.hidden = false;
  state.modalOpen = true;
  return new Promise((resolve) => {
    state.modalResolver = (choice) => {
      els.unsavedModal.hidden = true;
      state.modalOpen = false;
      const fn = state.modalResolver;
      state.modalResolver = null;
      if (state.modalFocus && state.modalFocus.focus) {
        try { state.modalFocus.focus(); } catch (_) {}
      }
      if (fn) resolve(choice);
    };
    window.setTimeout(() => els.modalSave.focus(), 0);
  });
}

function finishModal(choice) {
  if (state.modalResolver) state.modalResolver(choice);
}

function revertDraft() {
  if (!state.doc) return;
  state.draft = state.doc.content;
  if (els.editor.value !== state.draft) els.editor.value = state.draft;
  setDirty(false);
  if (state.mode === 'read') {
    renderPreview();
    updateStatusBar();
    scheduleScrollUpdate();
  }
}

async function ensureCanReplace() {
  if (!state.dirty) return true;
  const choice = await askUnsaved();
  if (choice === 'save') return saveCurrent();
  if (choice === 'discard') {
    revertDraft();
    return true;
  }
  return false;
}

function onEditorInput() {
  if (!state.doc) return;
  state.draft = els.editor.value;
  const nextDirty = state.draft !== state.doc.content;
  setDirty(nextDirty);
  updateStatusBar();
}

function insertEditorText(text) {
  const start = els.editor.selectionStart;
  const end = els.editor.selectionEnd;
  els.editor.setRangeText(text, start, end, 'end');
  onEditorInput();
  els.editor.focus();
}

function wrapSelection(marker) {
  const start = els.editor.selectionStart;
  const end = els.editor.selectionEnd;
  const selected = els.editor.value.slice(start, end);
  const replacement = marker + selected + marker;
  els.editor.setRangeText(replacement, start, end, 'select');
  if (!selected) els.editor.setSelectionRange(start + marker.length, start + marker.length);
  else els.editor.setSelectionRange(start + marker.length, end + marker.length);
  onEditorInput();
  els.editor.focus();
}

function setMode(mode) {
  if (!state.doc || (mode !== 'read' && mode !== 'edit') || state.mode === mode) return;
  if (mode === 'edit') {
    const max = Math.max(1, els.scrollArea.scrollHeight - els.scrollArea.clientHeight);
    const ratio = els.scrollArea.scrollTop / max;
    closeFind(false);
    state.mode = 'edit';
    if (state.isNarrow) state.outlineOpen = false;
    if (els.editor.value !== state.draft) els.editor.value = state.draft;
    syncUI();
    updateStatusBar();
    nextFrame().then(() => {
      try { els.editor.focus({ preventScroll: true }); } catch (_) { els.editor.focus(); }
      let offset = Math.floor(state.draft.length * ratio);
      const lineStart = state.draft.lastIndexOf('\n', Math.max(0, offset - 1));
      if (lineStart >= 0) offset = lineStart + 1;
      els.editor.setSelectionRange(offset, offset);
      const maxEditor = Math.max(0, els.editor.scrollHeight - els.editor.clientHeight);
      els.editor.scrollTop = ratio * maxEditor;
    });
  } else {
    const maxEditor = Math.max(1, els.editor.scrollHeight - els.editor.clientHeight);
    const ratio = els.editor.scrollTop / maxEditor;
    state.mode = 'read';
    renderPreview();
    syncUI();
    updateStatusBar();
    nextFrame().then(() => {
      const max = Math.max(0, els.scrollArea.scrollHeight - els.scrollArea.clientHeight);
      els.scrollArea.scrollTop = ratio * max;
      scheduleScrollUpdate();
    });
  }
}

async function saveCurrent() {
  if (!state.doc || !state.dirty || state.saving) return !state.dirty;
  state.saving = true;
  syncUI();
  try {
    const result = await window.viewer.saveFile({
      path: state.doc.path,
      content: state.draft,
      encodingKey: state.doc.encodingKey,
      bom: state.doc.bom,
      eol: state.doc.eol
    });
    if (!result || !result.ok) {
      showToast((result && result.error) || '保存失败', true);
      return false;
    }
    state.doc = result;
    state.draft = result.content;
    if (els.editor.value !== state.draft) els.editor.value = state.draft;
    state.externalChanged = false;
    setDirty(false);
    updateDocChrome();
    updateStatusBar();
    syncUI();
    showToast('已保存');
    return true;
  } catch (_) {
    showToast('保存失败', true);
    return false;
  } finally {
    state.saving = false;
    syncUI();
  }
}

async function chooseFile() {
  if (!hasViewer() || state.loading) return;
  try {
    const selection = await window.viewer.openDialog();
    if (!selection || selection.canceled || !selection.path) return;
    if (!(await ensureCanReplace())) return;
    await loadSelectedPath(selection.path);
  } catch (_) {
    showToast('无法打开文件', true);
  }
}

async function loadSelectedPath(filePath) {
  if (!filePath || state.loading) return false;
  setLoading(true);
  try {
    const result = await window.viewer.loadFile(filePath);
    if (!result || !result.ok) {
      showToast((result && result.error) || '无法打开文件', true);
      return false;
    }
    await displayDocument(result, { initial: false });
    return true;
  } catch (_) {
    showToast('无法打开文件', true);
    return false;
  } finally {
    setLoading(false);
  }
}

async function openSelectedPath(filePath) {
  if (!filePath || state.loading) return;
  if (!(await ensureCanReplace())) return;
  await loadSelectedPath(filePath);
}

async function reloadCurrent(auto) {
  if (!state.doc || state.loading) return;
  if (state.dirty) {
    if (auto) return;
    if (!(await ensureCanReplace())) return;
  }
  const max = Math.max(1, els.scrollArea.scrollHeight - els.scrollArea.clientHeight);
  const readRatio = els.scrollArea.scrollTop / max;
  const maxEditor = Math.max(1, els.editor.scrollHeight - els.editor.clientHeight);
  const editorRatio = els.editor.scrollTop / maxEditor;
  const activeId = state.activeHeadingId;
  const keepMode = state.mode === 'edit';
  setLoading(true);
  try {
    const result = await window.viewer.reload();
    if (!result || !result.ok) {
      showToast((result && result.error) || '重新加载失败', true);
      return;
    }
    const changed = result.content !== state.doc.content || result.mtime !== state.doc.mtime;
    await displayDocument(result, {
      keepMode,
      preserveRead: readRatio,
      preserveEditor: editorRatio,
      preserveHeading: activeId
    });
    if (auto) {
      if (changed) showToast('文件已更新');
    } else {
      showToast('已重新加载');
    }
  } catch (_) {
    showToast('重新加载失败', true);
  } finally {
    setLoading(false);
  }
}

async function displayDocument(doc, options) {
  const opts = options || {};
  if (!doc || !doc.ok) {
    showToast((doc && doc.error) || '无法打开文件', true);
    return false;
  }
  const hadDoc = Boolean(state.doc);
  const previousMode = state.mode;
  state.doc = doc;
  state.draft = doc.content;
  state.dirty = false;
  state.externalChanged = false;
  if (hasViewer()) window.viewer.setDirty(false);
  closeFind(true);
  state.mode = opts.keepMode ? previousMode : 'read';
  if (!hadDoc) state.outlineOpen = initialOutlinePreference();
  if (els.editor.value !== state.draft) els.editor.value = state.draft;
  if (state.mode === 'read') renderPreview();
  syncUI();
  updateDocChrome();
  updateStatusBar();
  syncRecentAfterOpen(doc);

  if (state.mode === 'read') {
    if (opts.anchor) {
      await nextFrame();
      scrollToAnchor(opts.anchor, false);
    } else if (typeof opts.preserveRead === 'number') {
      await nextFrame();
      const heading = opts.preserveHeading ? state.headingMap.get(opts.preserveHeading) : null;
      if (heading) {
        heading.scrollIntoView({ behavior: 'auto', block: 'start' });
        setActiveHeading(heading.id);
      } else {
        const max = Math.max(0, els.scrollArea.scrollHeight - els.scrollArea.clientHeight);
        els.scrollArea.scrollTop = opts.preserveRead * max;
      }
    } else {
      els.scrollArea.scrollTop = 0;
      scheduleScrollUpdate();
    }
  } else {
    await nextFrame();
    if (typeof opts.preserveEditor === 'number') {
      const maxEditor = Math.max(0, els.editor.scrollHeight - els.editor.clientHeight);
      els.editor.scrollTop = opts.preserveEditor * maxEditor;
    }
  }
  return true;
}

function requestClose() {
  if (state.closePending) return;
  state.closePending = true;
  ensureCanReplace().then((ok) => {
    if (ok) {
      try { window.viewer.confirmClose(); } catch (_) {}
    }
  }).catch(() => {
    showToast('保存失败', true);
  }).finally(() => {
    state.closePending = false;
  });
}

function openFind() {
  if (!state.doc || state.mode !== 'read') return;
  const selection = String(window.getSelection ? window.getSelection().toString() : '').trim();
  state.findOpen = true;
  els.findbar.hidden = false;
  if (selection && selection.length <= 80 && !selection.includes('\n')) els.findInput.value = selection;
  els.findInput.focus();
  els.findInput.select();
  if (els.findInput.value.trim()) runFind();
  else {
    els.findCount.textContent = '0 / 0';
    els.findCount.classList.remove('no-result');
  }
}

function closeFind(clearInput) {
  const wasOpen = state.findOpen || !els.findbar.hidden;
  state.findOpen = false;
  state.findQuery = '';
  els.findbar.hidden = true;
  if (clearInput) els.findInput.value = '';
  if (wasOpen && hasViewer()) window.viewer.findStop();
  els.findCount.textContent = '0 / 0';
  els.findCount.classList.remove('no-result');
}

function runFind() {
  if (!hasViewer()) return;
  const value = els.findInput.value;
  if (!value.trim()) {
    state.findQuery = '';
    window.viewer.findStop();
    els.findCount.textContent = '0 / 0';
    els.findCount.classList.remove('no-result');
    return;
  }
  state.findQuery = value;
  els.findCount.textContent = '…';
  els.findCount.classList.remove('no-result');
  window.viewer.findStart(value);
}

function nextFind(direction) {
  if (!state.findOpen) return;
  if (els.findInput.value !== state.findQuery) {
    runFind();
    return;
  }
  if (state.findQuery) window.viewer.findNext(direction === 'backward' ? 'backward' : 'forward');
}

function scheduleScrollUpdate() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    updateScrollState();
  });
}

function updateScrollState() {
  if (!state.doc || state.mode !== 'read') return;
  const maxScroll = Math.max(0, els.scrollArea.scrollHeight - els.scrollArea.clientHeight);
  const ratio = maxScroll > 0 ? clamp(els.scrollArea.scrollTop / maxScroll, 0, 1) : 0;
  els.progressBar.style.transform = 'scaleX(' + ratio.toFixed(5) + ')';
  if (!state.headings.length) return;
  const threshold = els.scrollArea.getBoundingClientRect().top + 108;
  let active = state.headings[0].id;
  for (const heading of state.headings) {
    if (heading.getBoundingClientRect().top <= threshold) active = heading.id;
    else break;
  }
  if (maxScroll > 0 && els.scrollArea.scrollTop + els.scrollArea.clientHeight >= els.scrollArea.scrollHeight - 8) {
    active = state.headings[state.headings.length - 1].id;
  }
  setActiveHeading(active);
}

function handleExternalChange(payload) {
  if (!state.doc || !payload) return;
  if (payload.path && payload.path !== state.doc.path) return;
  if (payload.exists === false) {
    showToast('文件已被移动或删除', true);
    return;
  }
  if (typeof payload.mtime === 'number' && typeof state.doc.mtime === 'number' && Math.abs(payload.mtime - state.doc.mtime) < 1) return;
  if (state.dirty) {
    if (!state.externalChanged) {
      state.externalChanged = true;
      showToast('文件已在外部修改');
    }
    return;
  }
  reloadCurrent(true);
}

function onNarrowChange() {
  const narrow = narrowQuery.matches;
  if (narrow === state.isNarrow) return;
  state.isNarrow = narrow;
  state.outlineOpen = narrow ? false : initialOutlinePreference();
  syncUI();
  scheduleScrollUpdate();
}

function onKeyDown(event) {
  if (!els.unsavedModal.hidden) {
    if (event.key === 'Escape') {
      event.preventDefault();
      finishModal('cancel');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      finishModal('save');
    }
    return;
  }
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key;
  if (event.isComposing) return;

  if (mod && !event.altKey) {
    const lower = key.toLowerCase();
    if (lower === 's') {
      event.preventDefault();
      if (state.doc) saveCurrent();
      return;
    }
    if (lower === 'o') {
      event.preventDefault();
      chooseFile();
      return;
    }
    if (lower === 'r') {
      event.preventDefault();
      reloadCurrent(false);
      return;
    }
    if (lower === 'f') {
      event.preventDefault();
      if (state.mode === 'read') openFind();
      return;
    }
    if (lower === 'b') {
      event.preventDefault();
      if (state.mode === 'edit') wrapSelection('**');
      else if (state.doc) setOutline(!state.outlineOpen, true);
      return;
    }
    if (lower === 'i' && state.mode === 'edit') {
      event.preventDefault();
      wrapSelection('*');
      return;
    }
    if (key === '=' || key === '+') {
      event.preventDefault();
      setFontSize(state.fontSize + 1, true);
      return;
    }
    if (key === '-') {
      event.preventDefault();
      setFontSize(state.fontSize - 1, true);
      return;
    }
    if (key === '0') {
      event.preventDefault();
      setFontSize(16, true);
      return;
    }
  }

  if (state.mode === 'edit' && event.key === 'Tab') {
    event.preventDefault();
    insertEditorText('  ');
    return;
  }

  if (key === 'F5') {
    event.preventDefault();
    reloadCurrent(false);
    return;
  }
  if (key === 'Escape') {
    if (state.findOpen) {
      event.preventDefault();
      closeFind(false);
      return;
    }
    if (state.isNarrow && state.outlineOpen) {
      event.preventDefault();
      setOutline(false, false);
    }
  }
}

async function openExternalFromLink(href) {
  return window.viewer.openLink({ href });
}

function isExternalLink(href) {
  return /^(?:https?|mailto):/i.test(href);
}

function isMarkdownLink(href) {
  try {
    const clean = href.split('#')[0].split('?')[0];
    return /\.(?:md|markdown|mdown|mkd)$/i.test(clean);
  } catch (_) {
    return false;
  }
}

function bindEvents() {
  els.btnOpen.addEventListener('click', chooseFile);
  els.btnOpenEmpty.addEventListener('click', chooseFile);
  els.btnSave.addEventListener('click', saveCurrent);
  els.btnReload.addEventListener('click', () => reloadCurrent(false));
  els.btnTheme.addEventListener('click', cycleTheme);
  els.btnFontDown.addEventListener('click', () => setFontSize(state.fontSize - 1, true));
  els.btnFontUp.addEventListener('click', () => setFontSize(state.fontSize + 1, true));
  els.btnFind.addEventListener('click', openFind);
  els.btnOutline.addEventListener('click', () => {
    if (!state.doc) return;
    setOutline(!state.outlineOpen, true);
  });
  els.btnReveal.addEventListener('click', () => {
    if (hasViewer() && state.doc) window.viewer.reveal().catch(() => {});
  });
  els.btnClearRecent.addEventListener('click', clearRecent);
  els.sidebarScrim.addEventListener('click', () => setOutline(false, false));
  els.modeSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (button) setMode(button.dataset.mode);
  });

  els.modalSave.addEventListener('click', () => finishModal('save'));
  els.modalDiscard.addEventListener('click', () => finishModal('discard'));
  els.modalCancel.addEventListener('click', () => finishModal('cancel'));
  els.unsavedModal.addEventListener('click', (event) => {
    if (event.target === els.unsavedModal) finishModal('cancel');
  });

  els.scrollArea.addEventListener('scroll', scheduleScrollUpdate, { passive: true });
  els.editor.addEventListener('input', onEditorInput);
  window.addEventListener('resize', () => {
    onNarrowChange();
    scheduleScrollUpdate();
  });
  if (narrowQuery.addEventListener) narrowQuery.addEventListener('change', onNarrowChange);
  else if (narrowQuery.addListener) narrowQuery.addListener(onNarrowChange);
  darkQuery.addEventListener('change', () => {
    if (state.themeMode === 'auto') applyThemeMode('auto', false);
  });

  document.addEventListener('keydown', onKeyDown, true);

  els.content.addEventListener('click', async (event) => {
    const anchor = event.target.closest ? event.target.closest('a') : null;
    if (!anchor || !els.content.contains(anchor)) return;
    const href = anchor.getAttribute('href') || '';
    if (!href) return;
    event.preventDefault();
    if (/^(?:javascript|vbscript|data):/i.test(href)) return;
    if (href.startsWith('#')) {
      scrollToAnchor(href.slice(1), true);
      return;
    }
    if (!hasViewer() || !state.doc) return;
    if (isExternalLink(href)) {
      openExternalFromLink(href).catch(() => showToast('无法打开链接', true));
      return;
    }
    if (isMarkdownLink(href) && !(await ensureCanReplace())) return;
    window.viewer.openLink({ href, baseDir: state.doc.dir, dirUrl: state.doc.dirUrl })
      .then((result) => {
        if (result && result.ok === false && result.error) showToast(result.error, true);
      })
      .catch(() => showToast('无法打开链接', true));
  });

  els.findInput.addEventListener('input', () => {
    window.clearTimeout(findTimer);
    findTimer = window.setTimeout(runFind, 150);
  });
  els.findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      nextFind(event.shiftKey ? 'backward' : 'forward');
    }
  });
  els.findPrev.addEventListener('click', () => nextFind('backward'));
  els.findNext.addEventListener('click', () => nextFind('forward'));
  els.findClose.addEventListener('click', () => closeFind(false));

  if (hasViewer()) {
    window.viewer.onFindResult((result) => {
      if (!state.findOpen || !result) return;
      if (result.matches > 0) {
        els.findCount.textContent = result.active + ' / ' + result.matches;
        els.findCount.classList.remove('no-result');
      } else {
        els.findCount.textContent = '无结果';
        els.findCount.classList.add('no-result');
      }
    });
    window.viewer.onFileOpened((payload) => {
      if (!payload) return;
      if (payload.ok) {
        if (state.dirty) {
          showToast('请先保存当前文件');
          return;
        }
        displayDocument(payload, { initial: false, anchor: payload.anchor || '' });
      } else {
        showToast(payload.error || '无法打开文件', true);
      }
    });
    window.viewer.onFileError((payload) => {
      if (payload && payload.error) showToast(payload.error, true);
    });
    window.viewer.onFileChanged(handleExternalChange);
    window.viewer.onOpenRequest((payload) => {
      if (payload && payload.path) openSelectedPath(payload.path);
    });
    window.viewer.onCloseRequested(requestClose);
  }

  window.addEventListener('dragenter', (event) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    setDropOverlay(true);
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setDropOverlay(true);
  });
  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) setDropOverlay(false);
  });
  window.addEventListener('dragend', () => setDropOverlay(false));
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    setDropOverlay(false);
    const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
    if (!files.length) return;
    const paths = files.map((file) => {
      try { return window.viewer.getPathForFile(file); } catch (_) { return ''; }
    }).filter(Boolean);
    const markdown = paths.find((filePath) => /\.(?:md|markdown|mdown|mkd)$/i.test(filePath));
    if (!markdown) {
      showToast('请选择 Markdown 文件', true);
      return;
    }
    openSelectedPath(markdown);
  });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => event.preventDefault());
}

function hasFileDrag(event) {
  const dt = event.dataTransfer;
  if (!dt) return false;
  try { return Array.from(dt.types || []).includes('Files'); } catch (_) { return false; }
}

function setDropOverlay(visible) {
  els.dropOverlay.classList.toggle('visible', Boolean(visible));
}

async function signalRendered(extra) {
  if (!state.testMode) return;
  try {
    await document.fonts.ready;
    await waitForImages(1400);
    await nextFrame();
  } catch (_) {}
  const brokenImages = Array.from(document.images || [])
    .filter((image) => image.complete && image.naturalWidth === 0)
    .map((image) => image.getAttribute('src') || '');
  const meta = Object.assign({
    title: document.title,
    path: state.doc ? state.doc.path : '',
    encoding: state.doc ? state.doc.encoding : '',
    mode: state.mode,
    dirty: state.dirty,
    headings: state.headingMap.size,
    outlines: state.headings.length,
    codeBlocks: els.content.querySelectorAll('.code-block').length,
    tables: els.content.querySelectorAll('.table-wrap').length,
    taskItems: els.content.querySelectorAll('.task-list-item').length,
    checkboxes: els.content.querySelectorAll('input[type="checkbox"]').length,
    callouts: els.content.querySelectorAll('blockquote.callout').length,
    images: Array.from(document.images || []).length,
    brokenImages,
    theme: document.documentElement.dataset.theme,
    lines: state.doc ? state.doc.lineCount : 0,
    textLength: (els.content.innerText || '').length,
    status: els.statusStats.textContent
  }, extra || {});
  try { window.viewer.rendered(meta); } catch (_) {}
}

async function initApp() {
  if (!hasViewer()) {
    showToast('程序初始化失败', true);
    return;
  }
  try {
    const info = await window.viewer.init();
    state.testMode = Boolean(info && info.testMode);
    if (info && Array.isArray(info.recent)) renderRecent(info.recent);
    if (info && info.initialState) {
      if (info.initialState.ok) await displayDocument(info.initialState, { initial: true });
      else showToast(info.initialState.error || '无法打开文件', true);
    }
  } catch (error) {
    console.error(error);
    state.initError = error && error.message ? error.message : String(error);
    showToast('程序初始化失败', true);
  }
  if (state.testMode) await signalRendered(state.initError ? { error: state.initError } : {});
}

function boot() {
  try { state.themeMode = localStorage.getItem('mdv-theme') || 'auto'; } catch (_) { state.themeMode = 'auto'; }
  try { state.fontSize = parseInt(localStorage.getItem('mdv-font'), 10) || 16; } catch (_) { state.fontSize = 16; }
  state.isNarrow = narrowQuery.matches;
  state.outlineOpen = initialOutlinePreference();
  applyThemeMode(state.themeMode, false);
  setFontSize(state.fontSize, false);
  bindEvents();
  syncUI();
  updateStatusBar();
  initApp();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
