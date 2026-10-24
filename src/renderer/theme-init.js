(function () {
  try {
    var mode = localStorage.getItem('mdv-theme') || 'auto';
    if (mode !== 'light' && mode !== 'dark' && mode !== 'auto') mode = 'auto';
    var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeMode = mode;
    var size = parseInt(localStorage.getItem('mdv-font'), 10);
    if (size >= 14 && size <= 24) document.documentElement.style.setProperty('--reading-size', size + 'px');
  } catch (_) {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.themeMode = 'auto';
  }
})();
