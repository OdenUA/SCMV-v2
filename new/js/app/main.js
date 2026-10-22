// Дашборд (index.html): только шапка страницы + монтирование общего шаблона.
// Базовый мониторинг: пробег + стоянки (Vehicle Track нет, без проигрывателя и графика).

import { initDashboard } from './bootstrap.js';

initDashboard({
  tabs: ['stops', 'analysis', 'fuel-events', 'fuel-summary', 'fuel-daily'],
  actions: ['track', 'telemetry', 'analyze'],
  clipboard: false,
  telemetry: 'ondemand',
  analysisTabAutoHide: true, // вкладку «Анализ» показываем только когда есть данные анализа
  wireHeader: true,
  connect: true,
});
