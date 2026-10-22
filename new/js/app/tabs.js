// Реестр вкладок таблицы событий. Модули регистрируют вкладки, main.js строит UI.

const tabs = new Map(); // id -> {id, title, icon, render(panel), onShow?(), lazy?}

export function registerTab(def) {
  tabs.set(def.id, def);
}

export function getTabs() {
  return [...tabs.values()];
}

export function getTab(id) {
  return tabs.get(id);
}
