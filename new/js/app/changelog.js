// Список изменений SCMV v2 (от новых к старым) + модалка «Что нового».

export const CHANGELOG = [
  {
    version: '2.0.2',
    date: '2026-10-23',
    items: [
      'Режим «Карта на весь экран»: вход — кнопка в правом нижнем углу карты, выход — «Свернуть» рядом с бейджем «Общий пробег» или Esc.',
    ],
  },
  {
    version: '2.0.1',
    date: '2026-10-22',
    items: [
      'Админ-панель: в разделе «Мониторинг» показываются все устройства (Vehicle Show) вместо списка ТС текущего пользователя (Vehicle Select Min); у таких ТС статус «нет данных» (серый индикатор).',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-10-22',
    items: [
      'Новая версия интерфейса SCMV v2.',
    ],
  },
];

const STORAGE_KEY = 'changelogSeenVersion21';

function renderEntries(container, versions) {
  container.innerHTML = versions.map((v) => `
    <div>
      <div class="flex items-center space-x-2 mb-1.5">
        <span class="font-bold text-white">v ${v.version}</span>
        <span class="text-gray-500">${v.date || ''}</span>
      </div>
      <ul class="list-disc pl-5 space-y-1 text-gray-300">
        ${v.items.map((i) => `<li>${i}</li>`).join('')}
      </ul>
    </div>`).join('');
}

export function initChangelog() {
  const link = document.getElementById('versionLink');
  const btn = document.getElementById('changelogBtn');
  const modal = document.getElementById('changelogModal');
  const entries = document.getElementById('changelogEntries');
  const versionEl = document.getElementById('changelogVersion');
  const okBtn = document.getElementById('changelogOkBtn');
  if (!modal || !entries) return;

  const current = CHANGELOG[0];
  if (link) {
    link.textContent = 'v ' + current.version;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      versionEl.textContent = '';
      renderEntries(entries, CHANGELOG);
      modal.classList.add('open');
    });
  }

  const openWhatsNew = () => {
    versionEl.textContent = `v ${current.version}`;
    renderEntries(entries, CHANGELOG.slice(0, 2));
    modal.classList.add('open');
  };

  if (btn) btn.addEventListener('click', openWhatsNew);

  okBtn && okBtn.addEventListener('click', () => {
    try { localStorage.setItem(STORAGE_KEY, current.version); } catch (e) { /* ignore */ }
    modal.classList.remove('open');
  });

  // Авто-показ двух последних версий
  let seen = null;
  try { seen = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  if (seen !== current.version) {
    setTimeout(openWhatsNew, 600);
  }
}
