// Resolve o tema antes de pintar (Claro / Escuro / Sistema). Só a preferência visual fica no navegador.
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('nb-theme') || 'system'; } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
