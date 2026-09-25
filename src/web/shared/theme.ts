/* Theme controller. Light and dark via [data-theme] on <html>, persisted. */

const KEY = 'certainty_theme';

export function initTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(KEY);
  const theme = stored === 'dark' || stored === 'light'
    ? stored
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function toggleTheme(): 'light' | 'dark' {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(KEY, next);
  return next;
}
