// Аутентификация: сессия, guard страниц, логаут.
// Ключи localStorage совместимы с v2: dt_user, dt_pwd, dt_session, dt_remember.

export const STORAGE_KEYS = {
  user: 'dt_user',
  pwd: 'dt_pwd',
  session: 'dt_session',
  remember: 'dt_remember',
};

export const auth = {
  loggedIn: false,
  uid: null,
  user: '',
  pwd: '',
  loginInProgress: false,
  lastLoginFailed: false,
};

const listeners = new Set();
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => { try { fn(auth); } catch (e) { console.error(e); } });
}

export function storedCredentials() {
  try {
    return {
      user: localStorage.getItem(STORAGE_KEYS.user) || '',
      pwd: localStorage.getItem(STORAGE_KEYS.pwd) || '',
    };
  } catch (e) {
    return { user: '', pwd: '' };
  }
}

export function initAuth() {
  const { user, pwd } = storedCredentials();
  auth.user = user;
  auth.pwd = pwd;
  return auth;
}

export function setAuthInfo(uid, user, pwd) {
  auth.loggedIn = true;
  auth.uid = uid;
  auth.user = user != null ? user : auth.user;
  auth.pwd = pwd != null ? pwd : auth.pwd;
  auth.loginInProgress = false;
  auth.lastLoginFailed = false;
  emit();
}

export function resetAuthState() {
  auth.loggedIn = false;
  auth.uid = null;
  auth.loginInProgress = false;
  emit();
}

// Сохранить учётные данные как это делает login.html v2
export function persistCredentials(user, pwd, remember) {
  try {
    localStorage.setItem(STORAGE_KEYS.user, user);
    localStorage.setItem(STORAGE_KEYS.pwd, pwd);
    localStorage.setItem(STORAGE_KEYS.session, '1');
    if (remember) localStorage.setItem(STORAGE_KEYS.remember, '1');
    else localStorage.removeItem(STORAGE_KEYS.remember);
  } catch (e) { /* ignore */ }
}

// Guard: страницы дашборда/админки требуют активной сессии
export function requireSession() {
  try {
    if (localStorage.getItem(STORAGE_KEYS.session) !== '1') {
      location.replace('login.html');
      return false;
    }
  } catch (e) { /* ignore */ }
  return true;
}

export function performLogout() {
  try {
    localStorage.removeItem(STORAGE_KEYS.session);
    localStorage.removeItem(STORAGE_KEYS.remember);
    localStorage.removeItem(STORAGE_KEYS.user);
    localStorage.removeItem(STORAGE_KEYS.pwd);
  } catch (e) { /* ignore */ }
  location.replace('login.html');
}
