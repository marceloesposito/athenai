// Prova end-to-end di Athenai con piu' "dispositivi" (contesti separati di Chrome headless, via CDP):
// 1. Pericle: landing → registrazione → primo documento (si contano i clic) e scrive.
// 2. Un ospite con il link "puo' modificare" entra con un nome greco e scrive con Pericle.
// 3. Un ospite con il link "puo' commentare" non scrive ma commenta.
// 4. Aspasia, invitata nella Polis, si registra dal link e chiama @Pericle in un commento: notifica.
// 5. "Resta connesso", uscita e accesso con la password; Aspasia allontanata: chiavi nuove.
// 6. Nel database niente in chiaro; nel browser niente salvo "resta connesso".
// Uso: server con l'app compilata su :8787 (vedi CLAUDE.md), poi  node scripts/e2e-athenai.mjs
// Variabili: ATHENAI_URL, CHROME, PSQL (comando psql), SHOTS (cartella per gli screenshot).
import { launch, connect } from './cdp.mjs';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = process.env.ATHENAI_URL ?? 'http://localhost:8787/';
const PSQL = process.env.PSQL ?? 'docker exec athenai-postgres-1 psql -U athenai -d athenai';
const SHOTS = process.env.SHOTS;
const psql = (q) => execSync(`${PSQL} -tAc ${JSON.stringify(q)}`).toString().trim();
const SECRET = 'Isegoria-parola-segreta';
const RUN = Date.now().toString(36);
const PASSWORD = 'Atene-democrazia-431';
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
  await s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
  const errors = [];
  c.on((m) => {
    if (m.sessionId === sessionId && m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  const ev = async (expr) => {
    const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(name + ': ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expr, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await ev(expr)) return true;
      } catch {}
      await sleep(100);
    }
    throw new Error(`${name}: tempo scaduto per ${expr}`);
  };
  let clicks = 0;
  const btn = async (txt) => {
    clicks++;
    return ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes(${JSON.stringify(txt)}) && !b.disabled); if(!b) throw new Error('manca: ' + ${JSON.stringify(txt)}); b.click(); return true; })()`);
  };
  const type = (sel, text) =>
    ev(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); el.focus(); const proto = el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const fill = (label, text) =>
    ev(`(() => { const f=[...document.querySelectorAll('label.field')].find(l=>l.querySelector('.field__label').textContent===${JSON.stringify(label)}); const el=f.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const key = async (k, code, vk, modifiers = 0) => {
    await s('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const shot = async (file) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const { data } = await s('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/${file}`, Buffer.from(data, 'base64'));
  };
  const text = () => ev(`document.querySelector('.sheet__text')?.innerText ?? ''`);
  const atEnd = () => ev(`(() => { const el = document.querySelector('.sheet__text'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  const selectWord = (word) =>
    ev(`(() => { const el = document.querySelector('.sheet__text'); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.textContent.indexOf(${JSON.stringify(word)}); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ${word.length}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } throw new Error('parola non trovata'); })()`);
  const d = { name, s, ev, waitFor, btn, type, fill, key, shot, text, atEnd, selectWord, errors, clicks: () => clicks, nav: (u) => s('Page.navigate', { url: u }) };
  devices.push(d);
  return d;
}

const ready = (d) => d.waitFor(`document.readyState === 'complete' && !!document.querySelector('button')`);

async function signUp(d, url, name, email) {
  await d.nav(url);
  await ready(d);
  if (await d.ev(`!!document.querySelector('.landing')`)) await d.btn('Start writing');
  await d.waitFor(`!!document.querySelector('.auth-card')`);
  await d.fill('Name', name);
  await d.fill('Email', email);
  await d.fill('Password', PASSWORD);
  await d.btn('Create account and start');
}

try {
  // --- 1. Pericle: dalla landing al primo documento
  const P = await device('Pericle');
  const pericle = `pericle-${RUN}@atene.gr`;
  await P.nav(URL0);
  await ready(P);
  await P.shot('01-landing.png');
  const t0 = Date.now();
  await P.btn('Start writing');
  await P.waitFor(`!!document.querySelector('.auth-card')`);
  await P.shot('02-signup.png');
  await P.fill('Name', 'Pericle');
  await P.fill('Email', pericle);
  await P.fill('Password', PASSWORD);
  await P.btn('Create account and start');
  await P.waitFor(`!!document.querySelector('.sheet__text')`, 30000);
  check('dalla landing al primo documento in 2 clic', P.clicks() === 2, `${P.clicks()} clic, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check('il titolo del primo documento ha gia\' il cursore', await P.ev(`document.activeElement?.classList.contains('sheet__title')`));
  await P.type('.sheet__title', 'Discorso funebre');
  await P.ev(`document.querySelector('.sheet__title').blur(); true`);
  await P.atEnd();
  await P.s('Input.insertText', { text: `La nostra costituzione si chiama democrazia. ${SECRET}.` });
  await P.waitFor(`document.querySelector('.save')?.textContent.includes('Saved')`);
  await P.shot('03-grapheion.png');

  // --- 2. ospite "puo' modificare"
  await P.btn('Share');
  await P.waitFor(`!!document.querySelector('.modal')`);
  await P.btn('Create the link');
  await P.waitFor(`!!document.querySelector('.copy-link__input')`);
  const editLink = await P.ev(`document.querySelector('.copy-link__input').value`);
  await P.btn('Can comment');
  await P.btn('Create the link');
  await P.waitFor(`!!document.querySelector('.copy-link__input') && document.querySelector('.copy-link__input').value !== ${JSON.stringify(editLink)}`);
  const commentLink = await P.ev(`document.querySelector('.copy-link__input').value`);
  await P.shot('04-share.png');
  await P.ev(`document.querySelector('.modal .icon-btn').click(); true`);

  const G = await device('Ospite');
  await G.nav(editLink);
  await G.waitFor(`!!document.querySelector('.auth-card')`);
  await G.shot('05-guest-join.png');
  await G.btn('Join as a guest');
  await G.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes(${JSON.stringify(SECRET)})`);
  const guestName = await G.ev(`document.querySelector('.avatar--guest').title`);
  check('l’ospite entra con un nome greco e legge il testo', /^[A-Z][a-z]+$/.test(guestName), guestName);
  await G.atEnd();
  await G.key('Enter', 'Enter', 13);
  await G.s('Input.insertText', { text: 'Amiamo il bello con semplicità.' });
  await P.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('Amiamo il bello')`);
  check('Pericle vede le modifiche dell’ospite', true);
  await P.waitFor(`[...document.querySelectorAll('.presence .avatar')].some(a => a.title === ${JSON.stringify(guestName)})`);
  check('Pericle vede l’ospite fra i presenti', true, guestName);
  await G.shot('06-guest-grapheion.png');

  // --- 3. ospite "puo' commentare"
  const C = await device('Commentatore');
  await C.nav(commentLink);
  await C.waitFor(`!!document.querySelector('.auth-card')`);
  await C.btn('Join as a guest');
  await C.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('Amiamo')`);
  const cName = await C.ev(`document.querySelector('.avatar--guest').title`);
  check('i due ospiti hanno nomi diversi', cName !== guestName, `${guestName} / ${cName}`);
  check('con il link "puo’ commentare" il testo non si modifica', (await C.ev(`document.querySelector('.sheet__text').getAttribute('contenteditable')`)) === 'false');
  await C.selectWord('bello');
  await C.waitFor(`!!document.querySelector('.comment-bubble')`);
  await C.ev(`document.querySelector('.comment-bubble').click(); true`);
  await C.waitFor(`!!document.querySelector('.scholion--draft textarea')`);
  await C.type('.scholion--draft textarea', 'Che cos’è il bello?');
  await C.btn('Add');
  await P.waitFor(`!!document.querySelector('.scholion-mark')`);
  check('il commento dell’ospite arriva a Pericle', true);

  // --- 4. Aspasia invitata nella Polis
  await P.ev(`document.querySelector('.topbar__home').click(); true`);
  await P.waitFor(`!!document.querySelector('.home')`);
  await P.btn('Members');
  await P.btn('Create the invite link');
  await P.waitFor(`!!document.querySelector('.copy-link__input')`);
  const inviteLink = await P.ev(`document.querySelector('.copy-link__input').value`);
  await P.ev(`document.querySelector('.modal .icon-btn').click(); true`);
  await P.shot('07-home.png');

  const A = await device('Aspasia');
  const aspasia = `aspasia-${RUN}@atene.gr`;
  await signUp(A, inviteLink, 'Aspasia', aspasia);
  await A.waitFor(`!!document.querySelector('.home')`, 30000);
  check('Aspasia entra nella Polis di Pericle dal link d’invito', (await A.ev(`document.querySelector('.home__title').textContent`)).includes('Pericle'));
  await P.waitFor(`document.body.innerText.includes('Members · 2')`);
  check('Pericle vede il nuovo membro da solo', true);
  await A.ev(`document.querySelector('.card').click(); true`);
  await A.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('democrazia')`);
  await A.selectWord('democrazia');
  await A.waitFor(`!!document.querySelector('.comment-bubble')`);
  await A.ev(`document.querySelector('.comment-bubble').click(); true`);
  await A.waitFor(`!!document.querySelector('.scholion--draft textarea')`);
  await A.ev(`document.querySelector('.scholion--draft textarea').focus(); true`);
  await A.s('Input.insertText', { text: 'Chiariamo il termine, @Peri' });
  await A.waitFor(`!!document.querySelector('.mention__menu')`);
  await A.key('Enter', 'Enter', 13);
  await A.btn('Add');
  await P.waitFor(`!!document.querySelector('.badge-count')`);
  await P.ev(`document.querySelector('.bell').click(); true`);
  const notice = await P.ev(`document.querySelector('.notices__item')?.innerText ?? ''`);
  check('Pericle riceve la notifica della menzione', notice.includes('Aspasia') && notice.includes('Discorso funebre'), notice.replace(/\n/g, ' | '));
  await P.ev(`document.querySelector('.notices__item').click(); true`);
  await P.waitFor(`!!document.querySelector('.scholia .scholion.is-active')`);
  check('la notifica apre il commento', true);
  await P.shot('08-comments.png');

  // --- 5. resta connesso, uscita e accesso con la password
  await P.nav(URL0);
  await P.waitFor(`!!document.querySelector('.topbar')`, 20000);
  check('"resta connesso": dopo il ricaricamento si e’ ancora dentro', true);
  await P.ev(`document.querySelector('.topbar .avatar').click(); true`);
  await P.btn('Sign out');
  await P.waitFor(`!!document.querySelector('.welcome')`);
  await P.btn('Sign in');
  await P.waitFor(`!!document.querySelector('.auth-card')`);
  await P.fill('Email', pericle);
  await P.fill('Password', 'password-sbagliata');
  await P.ev(`document.querySelector('.auth-card').requestSubmit(); true`);
  await P.waitFor(`!!document.querySelector('.auth-card .error')`);
  check('password sbagliata: rifiutata', true);
  await P.fill('Password', PASSWORD);
  await P.ev(`document.querySelector('.auth-card').requestSubmit(); true`);
  await P.waitFor(`!!document.querySelector('.home')`, 20000);
  check('accesso con email e password', true);

  // Aspasia allontanata: chiavi nuove, gli ospiti escono, Pericle continua a scrivere
  await P.btn('Members');
  await P.ev(`[...document.querySelectorAll('.people__row')].find(r => r.textContent.includes('Aspasia')).querySelector('.icon-btn').click(); true`);
  await P.waitFor(`!document.body.innerText.includes('Aspasia')`);
  await P.ev(`document.querySelector('.modal .icon-btn').click(); true`);
  await sleep(800);
  const epoch = psql(`select s.epoch from symposia s join polis_members m on m.polis_id = s.polis_id join accounts a on a.id = m.account_id where a.email = '${pericle}'`);
  check('dopo l’uscita le chiavi ruotano da sole', epoch === '2', `epoca ${epoch}`);
  await G.waitFor(`!!document.querySelector('.welcome') || !document.querySelector('.sheet__text')`, 15000).catch(() => undefined);
  check('gli ospiti escono (i link non valgono piu’)', await G.ev(`!document.querySelector('.sheet__text')`));
  await P.ev(`document.querySelector('.card').click(); true`);
  await P.waitFor(`(document.querySelector('.sheet__text')?.innerText ?? '').includes('Amiamo')`);
  await P.atEnd();
  await P.s('Input.insertText', { text: ' Dopo la rotazione.' });
  await sleep(1200);
  const e2 = psql(`select count(*) from doc_log where (box->>'e')::int = 2`);
  check('si scrive con la chiave nuova', Number(e2) >= 1, `${e2} voci`);

  // --- 6. niente in chiaro
  const leaks = psql(
    `select count(*) from (select box::text t from doc_log union all select meta::text from documents union all select meta::text from symposia union all select coalesce(profile::text,'') from polis_members union all select sealed from notices) x where t ilike '%${SECRET}%' or t ilike '%democrazia%' or t ilike '%Discorso%' or t ilike '%Pericle%' or t ilike '%bello%'`,
  );
  check('nessun testo, titolo, nome o commento in chiaro nel database', leaks === '0', leaks);
  check('niente nel localStorage', (await P.ev('localStorage.length')) === 0 && (await G.ev('localStorage.length')) === 0);
  for (const d of devices) if (d.errors.length) check(`nessun errore in ${d.name}`, false, d.errors.join(' | '));
} catch (e) {
  console.log('ERRORE', e.message);
  failed++;
  for (const d of devices) {
    console.log(`--- ${d.name}:`, (await d.ev(`document.body.innerText.slice(0, 500)`).catch(() => '?')).replace(/\n+/g, ' | '));
    if (d.errors.length) console.log('    errori:', d.errors.join(' | '));
  }
} finally {
  c.close();
  proc.kill();
  console.log(failed ? `\n${failed} controlli falliti` : '\ntutto ok');
  process.exitCode = failed ? 1 : 0;
}
