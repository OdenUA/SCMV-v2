const THEME_KEY = 'scmv_theme';

function normalizeTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

export function getTheme() {
  return normalizeTheme(document.documentElement.dataset.theme);
}

function syncThemeButtons(theme) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = nextTheme === 'light' ? 'Светлая тема' : 'Тёмная тема';
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(theme === 'light'));
    const icon = btn.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-circle-half-stroke', nextTheme === 'light');
      icon.classList.toggle('fa-moon', nextTheme === 'dark');
    }
  });
}

export function applyTheme(theme, persist = true) {
  const next = normalizeTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = next;
  root.classList.toggle('dark', next === 'dark');
  root.style.colorScheme = next;
  if (persist) {
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  }
  syncThemeButtons(next);
  document.dispatchEvent(new CustomEvent('scmv:themechange', { detail: { theme: next } }));
}

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  applyTheme(saved || getTheme(), false);
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    if (btn.dataset.themeBound === '1') return;
    btn.dataset.themeBound = '1';
    btn.addEventListener('click', () => applyTheme(getTheme() === 'dark' ? 'light' : 'dark'));
  });
}

window.addEventListener('storage', (event) => {
  if (event.key === THEME_KEY && event.newValue) applyTheme(event.newValue, false);
});
