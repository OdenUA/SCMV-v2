// UI-кирпичики: модалки, оверлей загрузки. Используются дашбордом и админкой.

/** Открыть модалку по id (.modal-overlay). */
export function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}

export function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

/** Закрытие по крестику/клику по фону/Escape для всех .modal-overlay на странице. */
export function initModals() {
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('mousedown', (ev) => {
      if (ev.target === overlay) overlay.classList.remove('open');
    });
    const closeBtn = overlay.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
  });
}

export function showLoading(text = 'Загрузка...') {
  let el = document.getElementById('globalLoadingOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalLoadingOverlay';
    el.innerHTML = '<div class="global-loading-spinner"></div><div class="global-loading-text"></div>';
    document.body.appendChild(el);
  }
  const t = el.querySelector('.global-loading-text');
  if (t) t.textContent = text;
  el.classList.add('visible');
}

export function hideLoading() {
  const el = document.getElementById('globalLoadingOverlay');
  if (el) el.classList.remove('visible');
}
