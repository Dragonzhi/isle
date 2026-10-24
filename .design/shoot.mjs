import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = 'C:/Users/32485/Desktop/_项目/案屿';
const dir = path.join(root, '.design');
const shots = path.join(dir, 'screenshots');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP = 9230;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const files = [
  { file: '01-chart.html', key: '01-chart', label: '海图' },
  { file: '02-slip.html', key: '02-slip', label: '交接单' },
  { file: '03-nightwatch.html', key: '03-nightwatch', label: '夜航' },
  { file: '04-bxA.html', key: '04-bxA', label: 'B×A' },
  { file: '05-bxA-neutral.html', key: '05-bxA-neutral', label: '中性纸' },
  { file: '06-bxA-cool.html', key: '06-bxA-cool', label: '冷灰' },
];

await fs.mkdir(shots, { recursive: true });

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(dir, '.edge-profile'), '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 80; i++) { try { targets = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); if (targets.length) break; } catch {} await sleep(250); }
if (!targets) throw new Error('CDP not ready');
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
let id = 0; const pending = new Map(); let errors = [];
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('log: ' + msg.params.entry.text);
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const setViewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    const ok = await evalJs(`document.readyState === 'complete' && !!document.querySelector('button')`).catch(() => false);
    if (ok) return;
    await sleep(100);
  }
}
async function shot(name, full = false) {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: full });
  await fs.writeFile(path.join(shots, name), Buffer.from(r.data, 'base64'));
}
const report = {};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

for (const item of files) {
  errors = [];
  await setViewport(1440, 900);
  await send('Page.navigate', { url: pathToFileURL(path.join(dir, item.file)).href });
  await waitReady();
  await sleep(350);
  const desktop = await evalJs(`(() => {
    const textSizes = {};
    for (const el of document.querySelectorAll('body *')) {
      if (!el.textContent || !el.textContent.trim() || el.children.length) continue;
      const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
      textSizes[s.fontSize] = (textSizes[s.fontSize] || 0) + 1;
    }
    const small = [...document.querySelectorAll('button, a, summary, input')].map(el => { const r = el.getBoundingClientRect(); return { text: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,28), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.w > 0 && x.h > 0 && (x.h < 24 || x.w < 24));
    return {
      title: document.title, viewport: [innerWidth, innerHeight],
      scrollWidth: document.documentElement.scrollWidth, width: innerWidth,
      height: document.documentElement.scrollHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
      textSizes, smallTargets: small,
      buttons: [...document.querySelectorAll('button')].map(b => (b.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean)
    };
  })()`);
  await shot(item.key + '-1440.png');
  await shot(item.key + '-1440-full.png', true);

  // open the handoff surface
  await evalJs(`(() => { const b = document.querySelector('#handoffBtn') || document.querySelector('[data-handoff="isle"]'); if (!b) return false; b.click(); return true; })()`);
  await sleep(350);
  const modal = await evalJs(`(() => { const d = document.querySelector('dialog[open]'); if (!d) return null; const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), text: d.innerText.slice(0, 400) }; })()`);
  await shot(item.key + '-dialog-1440.png');
  await evalJs(`(() => { const b = document.querySelector('dialog[open] button[aria-label="关闭"]'); if (b) b.click(); return true; })()`);
  await sleep(250);

  // mobile
  await setViewport(390, 844);
  await sleep(450);
  const mobile = await evalJs(`(() => ({
    scrollWidth: document.documentElement.scrollWidth, width: innerWidth,
    overflow: document.documentElement.scrollWidth > innerWidth,
    height: document.documentElement.scrollHeight,
    textSizes: (() => { const out = {}; for (const el of document.querySelectorAll('body *')) { if (!el.textContent || !el.textContent.trim() || el.children.length) continue; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue; out[s.fontSize] = (out[s.fontSize]||0)+1; } return out; })(),
    smallTargets: [...document.querySelectorAll('button, a, summary, input')].map(el => { const r = el.getBoundingClientRect(); return { text: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,28), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.w > 0 && x.h > 0 && (x.h < 24 || x.w < 24))
  }))()`);
  await shot(item.key + '-390.png');
  await shot(item.key + '-390-full.png', true);
  report[item.key] = { desktop, modal, mobile, errors: [...new Set(errors)] };
  console.log(item.key, JSON.stringify({ desktopOverflow: desktop.overflow, mobileOverflow: mobile.overflow, modal: !!modal, errors: report[item.key].errors, sizes: Object.keys(desktop.textSizes).sort((a,b)=>parseFloat(a)-parseFloat(b)) }));
}

await fs.writeFile(path.join(shots, 'report.json'), JSON.stringify(report, null, 2));
ws.close(); edge.kill();
await sleep(400);
process.exit(0);
