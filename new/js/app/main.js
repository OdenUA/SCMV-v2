// Дашборд (index.html): только шапка страницы + монтирование общего шаблона.
// Режимы: «Анализ истории» (пробег + стоянки + топливо + Анализ) и
// «Online Мониторинг» (Surv: транспорт на карте в реальном времени).

import { initDashboard } from './bootstrap.js';
import { initTheme } from '../core/theme.js';

initTheme();
initDashboard({
  modes: true, // переключатель режимов в шапке (Анализ истории / Online Мониторинг)
  tabs: ['stops', 'analysis', 'fuel-events', 'fuel-summary', 'fuel-daily'],
  actions: ['track', 'telemetry', 'analyze'],
  clipboard: false,
  telemetry: 'ondemand',
  analysisTabAutoHide: true, // вкладку «Анализ» показываем только когда есть данные анализа
  wireHeader: true,
  connect: true,
});
