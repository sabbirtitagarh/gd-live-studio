/* GD LIVE STUDIO — light/dark theme. Preference stored in localStorage (non-sensitive). */
import { ls } from './storage.js';
const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
let pref = ls.get('theme', 'auto');
export const currentTheme = () => pref;
function apply() {
  const dark = pref === 'dark' || (pref === 'auto' && mq && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? '#071226' : '#07347F';
}
export function setTheme(p) { pref = ['auto', 'light', 'dark'].includes(p) ? p : 'auto'; ls.set('theme', pref); apply(); }
export function initTheme() { apply(); mq?.addEventListener?.('change', () => pref === 'auto' && apply()); }
