/* Applies the saved theme before first paint (classic script, CSP-safe, no module loading delay). */
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('gdls.theme') || '"auto"');
    var dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) { /* default light */ }
})();
