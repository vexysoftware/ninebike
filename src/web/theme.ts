export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'nb-theme';
let memory: ThemePref = 'system';
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function getThemePref(): ThemePref {
  try {
    return (localStorage.getItem(KEY) as ThemePref) || memory;
  } catch {
    return memory;
  }
}

export function applyTheme(pref: ThemePref) {
  memory = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* preferência fica só na sessão atual */
  }
  resolve();
}

function resolve() {
  const pref = getThemePref();
  const dark = pref === 'dark' || (pref === 'system' && !!mq?.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

mq?.addEventListener('change', () => getThemePref() === 'system' && resolve());
