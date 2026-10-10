// Niogen Tracker: light/dark theme. The saved choice is auto, light, or dark.

const BAR = { light: '#12344f', dark: '#1b1b19' };
let pref = 'auto';
const mq = window.matchMedia?.('(prefers-color-scheme: dark)');

export function resolveTheme(p = pref) {
  return p === 'auto' ? (mq?.matches ? 'dark' : 'light') : p;
}

export function applyTheme(p = pref) {
  pref = ['auto', 'light', 'dark'].includes(p) ? p : 'auto';
  const t = resolveTheme(pref);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', BAR[t]);
  try { localStorage.setItem('niogen-theme', pref); } catch { /* storage may be blocked; the saved setting still applies */ }
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
}

mq?.addEventListener?.('change', () => { if (pref === 'auto') applyTheme('auto'); });
export const currentPref = () => pref;
