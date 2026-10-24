import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = 'C:/Users/32485/Desktop/_项目/案屿/.design';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP = 9231;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(dir, '.edge-check'), '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 80; i++) { try { targets = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); if (targets.length) break; } catch {} await sleep(250); }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
let id = 0; const pending = new Map(); let errors = [];
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push('exception');
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const nav = async file => {
  await send('Page.navigate', { url: pathToFileURL(path.join(dir, file)).href });
  for (let i = 0; i < 60; i++) { if (await evalJs(`document.readyState === 'complete'`).catch(() => false)) break; await sleep(100); }
  await sleep(250);
};
const click = async selector => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
await send('Page.enable'); await send('Runtime.enable');

await nav('01-chart.html');
await click('.index-item[data-id="prism"]');
const aPrism = await evalJs(`({ title: document.querySelector('#heroTitle').textContent, crumb: document.querySelector('#crumbName').textContent, rows: document.querySelectorAll('#rows .proj').length })`);
await click('.index-item[data-id="offline"]');
const aOffline = await evalJs(`({ title: document.querySelector('#heroTitle').textContent, disabled: document.querySelector('#handoffBtn').disabled, retry: !document.querySelector('#retryBtn').hidden })`);
await click('#addBtn');

await nav('02-slip.html');
await click('.tabs button[data-filter="paused"]');
const bFilter = await evalJs(`({ visible: [...document.querySelectorAll('.slip')].filter(s => !s.hidden).map(s => s.dataset.id), pressed: document.querySelector('.tabs button[data-filter="paused"]').getAttribute('aria-pressed') })`);
await click('.mini[data-handoff="orbit"]');
const bModal = await evalJs(`(() => { const d = document.querySelector('dialog[open]'); return d ? { title: document.querySelector('#handoffTitle').textContent, hasPrompt: document.querySelector('#prompt').value.includes('视觉方向') } : null; })()`);
await click('#closeDialog');

await nav('03-nightwatch.html');
await click('.row[data-id="muse"]');
const cMuse = await evalJs(`({ name: document.querySelector('#nowName').textContent, ws: document.querySelector('#nowWs').textContent, disabled: document.querySelector('#handoffBtn').disabled })`);
await click('.row[data-id="offline"]');
const cOffline = await evalJs(`({ name: document.querySelector('#nowName').textContent, disabled: document.querySelector('#handoffBtn').disabled })`);
await click('#handoffDialog');
await click('#addBtn');

console.log(JSON.stringify({ aPrism, aOffline, bFilter, bModal, cMuse, cOffline, errors }, null, 2));
ws.close(); edge.kill();
await sleep(300);
process.exit(0);
