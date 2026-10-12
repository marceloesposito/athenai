// Prova end-to-end della P3 con tre "dispositivi" (contesti separati di Chrome headless, via CDP):
// Pericle fonda una Polis con un Oikos e invita Aspasia (Polites) e Socrate (Mentore). Pericle e
// Aspasia scrivono nello stesso Tomos e si vedono a vicenda in tempo reale; Aspasia commenta un passo
// chiamando @Pericle, che riceve la notifica (Keryx) e la apre; Socrate commenta ma non puo' scrivere;
// Heuresis trova il Tomos per una parola del testo. Alla fine: nessun testo in chiaro nel database.
// Uso: server con l'app compilata su :8787 (vedi CLAUDE.md), poi
//      node scripts/e2e-tomos.mjs
// Variabili: ATHENAI_URL, CHROME, PSQL (comando psql; di default via docker exec athenai-postgres-1).
import { launch, connect } from './cdp.mjs';
import { execSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = process.env.ATHENAI_URL ?? 'http://localhost:8787/';
const PSQL = process.env.PSQL ?? 'docker exec athenai-postgres-1 psql -U athenai -d athenai';
const psql = (q) => execSync(`${PSQL} -tAc ${JSON.stringify(q)}`).toString().trim();
const SECRET = 'Isegoria-parola-segreta';
let failed = 0;
const check = (what, ok, extra = '') => {
  console.log(`${ok ? 'ok ' : 'NO '} ${what}${extra ? ` (${extra})` : ''}`);
  if (!ok) failed++;
};

const { proc, ws } = await launch();
const c = await connect(ws);
const devices = [];

async function device(name) {
  const { browserContextId } = await c.send('Target.createBrowserContext');
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => c.send(m, p, sessionId);
  await s('Runtime.enable');
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  const errors = [];
  c.on((m) => {
    if (m.sessionId === sessionId && m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  const ev = async (expr) => {
    const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(name + ': ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expr, ms = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await ev(expr)) return true;
      } catch {}
      await sleep(100);
    }
    throw new Error(`${name}: tempo scaduto per ${expr}`);
  };
  const btn = (txt) =>
    ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes(${JSON.stringify(txt)})); if(!b) throw new Error('manca: ' + ${JSON.stringify(txt)}); b.click(); return true; })()`);
  const type = (sel, text) =>
    ev(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const key = async (k, code, vk) => {
    await s('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  const shot = async (path) => {
    const { data } = await s('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(path, Buffer.from(data, 'base64'));
  };
  const d = { name, s, ev, waitFor, btn, type, key, shot, errors, nav: (u) => s('Page.navigate', { url: u }) };
  devices.push(d);
  return d;
}

/** Account di prova con un nome, Symbolon creato e controllato, sblocco "ogni volta le 12 parole". */
async function newAccount(d, url, name) {
  await d.nav(url);
  await d.waitFor(`document.readyState === 'complete' && !!document.querySelector('button')`);
  await d.ev(`sessionStorage.setItem('athenai:trial-user', JSON.stringify({ id: 'trial-' + crypto.randomUUID(), name: ${JSON.stringify(name)} })); true`);
  // di nuovo all'indirizzo di partenza (l'app al primo caricamento ha gia' tolto l'invito dall'URL)
  await d.nav(url);
  await d.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Create my Symbolon'))`);
  await d.btn('Create my Symbolon');
  await d.waitFor(`document.querySelectorAll('.words li').length === 12`);
  const words = await d.ev(`[...document.querySelectorAll('.words li')].map(li => li.textContent.replace(/^\\d+\\s*/, '').trim())`);
  await d.btn("I've written them down");
  await d.waitFor(`document.querySelectorAll('.form__row').length > 0`);
  await d.ev(`(() => { const ws=${JSON.stringify(words)}; document.querySelectorAll('.form__row').forEach(row => { const n = Number(row.querySelector('span').textContent.match(/\\d+/)[0]); const inp=row.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inp, ws[n-1]); inp.dispatchEvent(new Event('input',{bubbles:true})); }); return true; })()`);
  await d.btn('Check');
  await d.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Ask for the 12 words every time'))`);
  await d.btn('Ask for the 12 words every time');
  await d.waitFor(`!!document.querySelector('.akropolis__main')`);
}

const text = (d) => d.ev(`document.querySelector('.sheet__text')?.innerText ?? ''`);

try {
  // --- Pericle: Polis, Oikos, inviti
  const P = await device('Pericle');
  await newAccount(P, URL0, 'Pericle');
  await P.btn('Found a Polis');
  await P.type('.card--form input', 'Accademia');
  await P.ev(`document.querySelector('.card--form').requestSubmit()`);
  await P.waitFor(`document.querySelector('.topbar__name')?.textContent === 'Accademia'`);
  await P.btn('New Oikos');
  await P.type('.card--form input', 'Simposio');
  await P.ev(`document.querySelector('.card--form').requestSubmit()`);
  await P.waitFor(`!!document.querySelector('.card--oikos')`);
  const invite = async (role) => {
    await P.ev(`document.querySelector('.avatars').click()`);
    await P.waitFor(`!!document.querySelector('.modal')`);
    await P.btn(role);
    await P.btn('Create the link');
    await P.waitFor(`!!document.querySelector('.invite .code')`);
    const link = await P.ev(`document.querySelector('.invite .code').textContent`);
    await P.ev(`document.querySelector('.modal .icon-btn').click()`);
    return link;
  };
  const linkA = await invite('Polites');
  const linkS = await invite('Mentore');

  // --- Aspasia e Socrate entrano
  const A = await device('Aspasia');
  await newAccount(A, linkA, 'Aspasia');
  await A.waitFor(`!!document.querySelector('.banner')`);
  await A.btn('Join');
  await A.waitFor(`document.querySelector('.topbar__name')?.textContent === 'Accademia'`);
  const S = await device('Socrate');
  await newAccount(S, linkS, 'Socrate');
  await S.waitFor(`!!document.querySelector('.banner')`);
  await S.btn('Join');
  await S.waitFor(`document.querySelector('.topbar__name')?.textContent === 'Accademia'`);
  // Pericle vede i nuovi membri senza ricaricare (avviso in tempo reale)
  await P.waitFor(`document.querySelector('.avatars__count')?.textContent.trim() === '3'`);
  check('i membri nuovi compaiono da soli', true);

  // --- Pericle apre l'Oikos e crea un Tomos
  await P.ev(`document.querySelector('.card--oikos').click()`);
  await P.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('New Tomos'))`);
  await P.btn('New Tomos');
  await P.waitFor(`!!document.querySelector('.sheet__text')`);
  await P.ev(`document.querySelector('.sheet__title').focus(); true`);
  await P.type('.sheet__title', 'Discorso funebre');
  await P.ev(`document.querySelector('.sheet__title').blur(); true`);
  await P.ev(`document.querySelector('.sheet__text').focus(); true`);
  await P.s('Input.insertText', { text: `La nostra costituzione si chiama democrazia. ${SECRET}.` });

  // Aspasia: il Tomos compare da solo nell'Oikos, con il titolo
  await A.ev(`document.querySelector('.card--oikos').click()`);
  await A.waitFor(`[...document.querySelectorAll('.card--tomos .card__title')].some(x => x.textContent === 'Discorso funebre')`);
  check('il Tomos nuovo compare agli altri con il titolo', true);
  await A.ev(`document.querySelector('.card--tomos').click()`);
  await A.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes(${JSON.stringify(SECRET)})`);
  check('Aspasia legge il testo di Pericle', true);

  // scrivono insieme: Aspasia aggiunge in fondo, Pericle lo vede subito
  await A.ev(`(() => { const el = document.querySelector('.sheet__text'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  await sleep(200);
  await A.key('Enter', 'Enter', 13);
  await A.s('Input.insertText', { text: 'Amiamo il bello con semplicità.' });
  const t0 = Date.now();
  await P.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('Amiamo il bello')`);
  check('Pericle vede la modifica di Aspasia', true, `${Date.now() - t0} ms`);
  // presenza: ciascuno vede l'altro (Symposion)
  await P.waitFor(`[...document.querySelectorAll('.avatar--presence')].some(a => a.title === 'Aspasia')`);
  check('Symposion: Pericle vede Aspasia nel Tomos', true);

  // --- Scholion di Aspasia su "democrazia" con @Pericle
  await A.ev(`(() => {
    const el = document.querySelector('.sheet__text');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) { const i = n.textContent.indexOf('democrazia'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 'democrazia'.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; } }
    throw new Error('parola non trovata');
  })()`);
  await A.waitFor(`!!document.querySelector('.scholion-bubble')`);
  await A.ev(`document.querySelector('.scholion-bubble').click(); true`);
  await A.waitFor(`!!document.querySelector('.scholion--draft textarea')`);
  await A.ev(`document.querySelector('.scholion--draft textarea').focus(); true`);
  await A.s('Input.insertText', { text: 'Chiariamo il termine, @Peri' });
  await A.waitFor(`!!document.querySelector('.mention__menu')`);
  await A.key('Enter', 'Enter', 13);
  await A.s('Input.insertText', { text: 'che ne pensi?' });
  const body = await A.ev(`document.querySelector('.scholion--draft textarea').value`);
  check('la menzione si completa dal menu', body.includes('@Pericle '), body);
  await A.btn('Add');
  await P.waitFor(`!!document.querySelector('.scholion-mark')`);
  check('Pericle vede il passo commentato evidenziato', true);
  // Keryx: la campanella di Pericle
  await P.waitFor(`!!document.querySelector('.keryx__count')`);
  await P.ev(`document.querySelector('.keryx__bell').click(); true`);
  const notice = await P.ev(`document.querySelector('.keryx__item')?.innerText ?? ''`);
  check('Keryx avvisa Pericle della menzione', notice.includes('Aspasia') && notice.includes('Discorso funebre'), notice.replace(/\n/g, ' | '));
  await P.ev(`document.querySelector('.keryx__item').click(); true`);
  await P.waitFor(`!document.querySelector('.keryx__count')`);
  // la notifica apre lo Scholion; Pericle risponde
  await P.waitFor(`!!document.querySelector('.scholia .scholion.is-active textarea')`);
  check('la notifica apre lo Scholion in cui si e chiamati', true);
  await P.ev(`document.querySelector('.scholia .scholion textarea').focus(); true`);
  await P.s('Input.insertText', { text: 'Governo dei molti, non dei pochi.' });
  await P.s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 });
  await P.s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 });
  await A.waitFor(`(document.querySelector('.scholia')?.innerText ?? '').includes('Governo dei molti')`);
  check('Aspasia vede la risposta di Pericle', true);

  // --- Socrate (Mentore): legge e commenta, ma non scrive nel testo
  await S.ev(`document.querySelector('.card--oikos').click()`);
  await S.waitFor(`!!document.querySelector('.card--tomos')`);
  await S.ev(`document.querySelector('.card--tomos').click()`);
  await S.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('Amiamo il bello')`);
  check('il testo per il Mentore non e\' modificabile', (await S.ev(`document.querySelector('.sheet__text').getAttribute('contenteditable')`)) === 'false');
  await S.ev(`(() => { const el = document.querySelector('.sheet__text'); const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const i = n.textContent.indexOf('bello'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 5); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } throw new Error('x'); })()`);
  await S.waitFor(`!!document.querySelector('.scholion-bubble')`);
  await S.ev(`document.querySelector('.scholion-bubble').click(); true`);
  await S.waitFor(`!!document.querySelector('.scholion--draft textarea')`);
  await S.type('.scholion--draft textarea', 'Che cos\'e\' il bello?');
  await S.btn('Add');
  await P.waitFor(`document.querySelectorAll('.scholion-mark').length >= 2`);
  check('lo Scholion del Mentore arriva agli altri', true);

  await P.shot(`${process.env.SHOTS ?? '.'}/grapheion-pericle.png`).catch(() => undefined);
  await A.shot(`${process.env.SHOTS ?? '.'}/grapheion-aspasia.png`).catch(() => undefined);

  // --- Heuresis: Aspasia cerca una parola del testo
  await A.ev(`document.querySelector('.topbar .icon-btn').click(); true`);
  await A.waitFor(`!!document.querySelector('.heuresis__input')`);
  await A.type('.heuresis__input', 'semplicita');
  await A.waitFor(`(document.querySelector('.hits')?.innerText ?? '').includes('Discorso funebre')`);
  check('Heuresis trova il Tomos per una parola del testo (senza accenti)', true, (await A.ev(`document.querySelector('.hit .hint')?.textContent`)) ?? '');

  // --- Socrate viene allontanato: le chiavi ruotano da sole e si continua a scrivere con quelle nuove
  await A.ev(`document.querySelector('.hit').click(); true`);
  await A.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('Amiamo il bello')`);
  await P.ev(`document.querySelector('.topbar .icon-btn').click(); true`); // all'Oikos
  await P.waitFor(`!!document.querySelector('.card--tomos')`);
  await P.ev(`document.querySelector('.topbar .icon-btn').click(); true`); // alla Polis
  await P.waitFor(`!!document.querySelector('.avatars')`);
  await P.ev(`document.querySelector('.avatars').click()`);
  await P.waitFor(`!!document.querySelector('.modal')`);
  await P.ev(`[...document.querySelectorAll('.member__main')].find(b => b.textContent.includes('Socrate')).click(); true`);
  await P.btn('Remove');
  await S.waitFor(`!!document.querySelector('.akropolis__main')`);
  check('chi viene allontanato torna da solo all’Akropolis', true);
  await P.waitFor(`document.querySelector('.avatars__count')?.textContent.trim() === '2'`);
  await P.ev(`document.querySelector('.modal .icon-btn').click(); true`);
  await sleep(500);
  const epoch = psql(`select o.epoch from oikos o join tomos t on t.oikos_id = o.id where t.meta is not null order by t.created_at desc limit 1`);
  check('l’Oikos e’ passato alla chiave nuova', epoch === '2', `epoca ${epoch}`);
  await P.ev(`document.querySelector('.card--oikos').click()`);
  await P.waitFor(`!!document.querySelector('.card--tomos')`);
  await P.ev(`document.querySelector('.card--tomos').click()`);
  await P.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('Amiamo il bello')`);
  await P.ev(`(() => { const el = document.querySelector('.sheet__text'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  await sleep(200);
  await P.key('Enter', 'Enter', 13);
  await P.s('Input.insertText', { text: 'Dopo la rotazione.' });
  await A.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('Dopo la rotazione')`);
  await A.ev(`(() => { const el = document.querySelector('.sheet__text'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  await sleep(200);
  await A.s('Input.insertText', { text: ' Anche Aspasia.' });
  await P.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('Anche Aspasia')`);
  const e2 = psql(`select count(*) from tomos_log where (box->>'e')::int = 2`);
  check('dopo la rotazione si scrive insieme con la chiave nuova', Number(e2) >= 2, `${e2} voci all'epoca 2`);

  // --- il server non vede nulla in chiaro
  const leaks = psql(
    `select count(*) from (select box::text t from tomos_log union all select meta::text from tomos union all select sealed from keryx) x where t ilike '%${SECRET}%' or t ilike '%democrazia%' or t ilike '%Discorso%' or t ilike '%Governo dei molti%'`,
  );
  check('nessun testo, titolo o Scholion in chiaro nel database', leaks === '0', leaks);
  check('nessun dato nel localStorage', (await P.ev('localStorage.length')) === 0 && (await A.ev('localStorage.length')) === 0);
  for (const [n, d] of [['Pericle', P], ['Aspasia', A], ['Socrate', S]]) if (d.errors.length) check(`nessun errore in ${n}`, false, d.errors.join(' | '));
} catch (e) {
  console.log('ERRORE', e.message);
  failed++;
  // dove si e' fermato ciascun dispositivo
  for (const d of devices) {
    console.log(`--- ${d.name}:`, (await d.ev(`document.body.innerText.slice(0, 600)`).catch(() => '?')).replace(/\n+/g, ' | '));
    if (d.errors.length) console.log('    errori:', d.errors.join(' | '));
  }
} finally {
  c.close();
  proc.kill();
  console.log(failed ? `\n${failed} controlli falliti` : '\ntutto ok');
  process.exitCode = failed ? 1 : 0;
}
