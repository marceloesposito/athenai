// Pilota Chrome headless via CDP (WebSocket integrata di Node): nessuna finestra visibile.
// Uso: node scripts/cdp.mjs <url> <script.mjs con export default async (page) => {...}>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  const dir = `${process.env.TEMP ?? '/tmp'}/alexandria-cdp-${Date.now()}`;
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return { proc, ws: (await r.json()).webSocketDebuggerUrl };
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome non risponde');
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const handlers = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method) handlers.forEach((h) => h(m));
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
  return { send, on: (h) => handlers.push(h), close: () => ws.close() };
}

export async function openPage(url) {
  const { proc, ws } = await launch();
  const c = await connect(ws);
  const { browserContextId } = await c.send('Target.createBrowserContext');
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => c.send(m, p, sessionId);
  const logs = [];
  c.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  });
  await s('Runtime.enable');
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await s('Page.navigate', { url });
  const page = {
    logs,
    send: s,
    sleep,
    async eval(expr) {
      const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expr, ms = 15000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        try { if (await page.eval(expr)) return true; } catch {}
        await sleep(100);
      }
      throw new Error('Timeout: ' + expr);
    },
    async shot(path) {
      const { data } = await s('Page.captureScreenshot', { format: 'png' });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(data, 'base64'));
    },
    async click(selector) {
      const box = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error('Non trovato: ' + selector);
      await page.mouse('mousePressed', box.x, box.y);
      await page.mouse('mouseReleased', box.x, box.y);
      return box;
    },
    async mouse(type, x, y, extra = {}) {
      await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
    },
    async type(text) {
      await s('Input.insertText', { text });
    },
    async key(key, code, modifiers = 0, extra = {}) {
      await s('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: extra.vk, ...extra });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: extra.vk });
    },
    close() {
      c.close();
      proc.kill();
    },
  };
  return page;
}

if (process.argv[1].endsWith('cdp.mjs') && process.argv[3]) {
  const page = await openPage(process.argv[2]);
  try {
    const mod = await import(pathToFileURL(process.argv[3]).href);
    await mod.default(page);
  } catch (e) {
    console.error('ERRORE', e.message);
    process.exitCode = 1;
  } finally {
    if (page.logs.length) console.log('--- console\n' + page.logs.slice(-30).join('\n'));
    page.close();
  }
}
