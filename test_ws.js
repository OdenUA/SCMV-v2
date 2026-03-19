// Minimal Node.js WebSocket tester for the current auth flow.
// Usage:
//   npm install ws
//   $env:USER_NAME='zheleznov'; $env:USER_PASSWORD='secret'; node test_ws.js
//   $env:COOKIE='m=...; map=...; n=0; relogin=no'; node test_ws.js

const WebSocket = require('ws');

const URL = process.env.URL || 'wss://scmv.vpngps.com:4445';
const ORIGIN = process.env.ORIGIN || 'https://scmv.vpngps.com';
const USER_NAME = process.env.USER_NAME || 'qqq';
const USER_PASSWORD = process.env.USER_PASSWORD || 'qqq';
const USER_UID = Number(process.env.USER_UID || 0) || 0;
const COOKIE_M = process.env.COOKIE_M || '';
const COOKIE_MAP = process.env.COOKIE_MAP || 'http%3A//%7Bs%7D.tile.openstreetmap.org/%7Bz%7D/%7Bx%7D/%7By%7D.png';
const COOKIE_N = process.env.COOKIE_N || '0';
const COOKIE_RELOGIN = process.env.COOKIE_RELOGIN || 'no';
const COOKIE = process.env.COOKIE || (COOKIE_M ? `m=${COOKIE_M}; map=${COOKIE_MAP}; n=${COOKIE_N}; relogin=${COOKIE_RELOGIN}` : '');
const REQUEST_NAME = process.env.REQUEST_NAME || 'Vehicle Select Min';
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 250);
const CLOSE_AFTER_MS = Number(process.env.CLOSE_AFTER_MS || 12000);

function maskCookie(header) {
  if (!header) return '(none)';
  return String(header).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const eq = part.indexOf('=');
    return eq === -1 ? part : `${part.slice(0, eq)}=***`;
  }).join('; ');
}

const headers = { Origin: ORIGIN };
if (COOKIE) headers.Cookie = COOKIE;

const ws = new WebSocket(URL, { headers });
let sessionUid = USER_UID;
let requestSent = false;

function sendSelectMinRequests(uid) {
  const initReq = JSON.stringify({ name: 'Vehicle Select Min', type: 'etbl', mid: 4, act: 'init', usr: USER_NAME, pwd: USER_PASSWORD, uid, lang: 'en' });
  const setupReq = JSON.stringify({ name: 'Vehicle Select Min', type: 'etbl', mid: 4, act: 'setup', filter: [{ selecteduid: [uid] }], nowait: true, waitfor: [], usr: USER_NAME, pwd: USER_PASSWORD, uid, lang: 'en' });
  ws.send(initReq);
  setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.send(setupReq); }, REQUEST_DELAY_MS);
}

function sendVehicleShow(uid) {
  const req = JSON.stringify({ name: 'Vehicle Show', type: 'etbl', mid: 2, act: 'setup', filter: [], nowait: true, waitfor: [], usr: USER_NAME, pwd: USER_PASSWORD, uid, lang: 'en' });
  ws.send(req);
}

console.log('URL=', URL);
console.log('Origin=', ORIGIN);
console.log('Cookie=', maskCookie(COOKIE));
console.log('Request=', REQUEST_NAME);

ws.on('upgrade', (response) => {
  console.log('upgrade headers=', JSON.stringify(response.headers || {}));
});

ws.on('open', () => {
  console.log('open');
  const loginReq = JSON.stringify({ name: 'login', type: 'login', mid: 0, act: 'setup', usr: USER_NAME, pwd: USER_PASSWORD, uid: 0, lang: 'en' });
  ws.send(loginReq);
});

ws.on('message', (message) => {
  const text = message.toString();
  console.log(text);
  if (requestSent) return;
  try {
    const data = JSON.parse(text);
    if (data && data.name === 'login' && data.res && data.res[0] && data.res[0].uid) {
      sessionUid = Number(data.res[0].uid) || sessionUid;
      requestSent = true;
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (REQUEST_NAME === 'Vehicle Show') sendVehicleShow(sessionUid);
        else sendSelectMinRequests(sessionUid);
      }, REQUEST_DELAY_MS);
    }
  } catch (_) {}
});

ws.on('error', (error) => { console.error('ERR', error && error.message ? error.message : error); });
ws.on('close', (code, reasonBuffer) => {
  const reason = reasonBuffer ? reasonBuffer.toString('utf8') : '';
  console.log('closed', code, reason);
  process.exit(0);
});

setTimeout(() => {
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  } catch (_) {}
}, CLOSE_AFTER_MS);
