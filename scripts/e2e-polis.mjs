// Prova end-to-end con tre "dispositivi" (contesti separati di Chrome headless, via CDP):
// A fonda una Polis con un Oikos e invita B; B entra; A allontana B (rotazione delle chiavi);
// C = account di A su un altro dispositivo, collegato tramite il relay. Nessuna finestra visibile.
// Uso: docker compose -f deploy/compose.yml up -d --build  poi
//      CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/e2e-polis.mjs
// (ATHENAI_URL per un altro indirizzo; PSQL per il comando psql, di default il container athenai-postgres-1)
import { launch, connect } from './cdp.mjs';
import { execSync } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = process.env.ATHENAI_URL ?? 'http://localhost:8787/';
const { proc, ws } = await launch();
const c = await connect(ws);
async function device(name) {
  const { browserContextId } = await c.send('Target.createBrowserContext');
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => c.send(m, p, sessionId);
  await s('Runtime.enable'); await s('Page.enable');
  const errors = [];
  c.on((m) => { if (m.sessionId === sessionId && m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
  const ev = async (expr) => { const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(name + ': ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r.result.value; };
  const btn = (txt) => ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes(${JSON.stringify(txt)})); if(!b) throw new Error('manca: ' + ${JSON.stringify(txt)}); b.click(); return true; })()`);
  const type = (sel, text) => ev(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const h1 = () => ev(`document.querySelector('h1')?.textContent ?? document.querySelector('.topbar__name')?.textContent`);
  return { s, ev, btn, type, h1, errors, nav: async (u) => { await s('Page.navigate', { url: u }); await sleep(2500); } };
}
async function newAccount(d) {
  await d.btn('Try it out'); await sleep(900);
  await d.btn('Create my Symbolon'); await sleep(300);
  const words = await d.ev(`[...document.querySelectorAll('.words li')].map(li => li.textContent.replace(/^\\d+\\s*/, '').trim())`);
  await d.btn("I've written them down"); await sleep(300);
  await d.ev(`(() => { const ws=${JSON.stringify(words)}; document.querySelectorAll('.form__row').forEach(row => { const n = Number(row.querySelector('span').textContent.match(/\\d+/)[0]); const inp=row.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inp, ws[n-1]); inp.dispatchEvent(new Event('input',{bubbles:true})); }); return true; })()`);
  await d.btn('Check'); await sleep(1500);
  await d.btn('Ask for the 12 words every time'); await sleep(1200);
  return words;
}
const PSQL = process.env.PSQL ?? 'docker exec athenai-postgres-1 psql -U athenai -d athenai';
const psql = (q) => execSync(`${PSQL} -tAc ${JSON.stringify(q)}`).toString().trim();
try {
  const A = await device('A');
  await A.nav(URL0);
  await newAccount(A);
  console.log('A:', await A.h1());
  await A.btn('Found a Polis'); await sleep(200);
  await A.type('.card--form input', 'Accademia'); await A.ev(`document.querySelector('.card--form').requestSubmit()`); await sleep(1500);
  console.log('A nella Polis:', await A.h1());
  await A.btn('New Oikos'); await sleep(200);
  await A.type('.card--form input', 'Simposio'); await A.ev(`document.querySelector('.card--form').requestSubmit()`); await sleep(1500);
  console.log('A Oikos:', await A.ev(`[...document.querySelectorAll('.card--oikos .card__title')].map(x=>x.textContent).join(',')`));
  await A.ev(`document.querySelector('.avatars').click()`); await sleep(400);
  await A.btn('Create the link'); await sleep(1200);
  const link = await A.ev(`document.querySelector('.invite .code').textContent`);
  console.log('link:', link.replace(/#.*/, '#<segreto>'));
  await A.ev(`document.querySelector('.modal .icon-btn').click()`); await sleep(200);

  const B = await device('B');
  await B.nav(link);
  await newAccount(B);
  await sleep(1200);
  console.log('B banner:', await B.ev(`document.querySelector('.banner')?.textContent`));
  await B.btn('Join'); await sleep(2000);
  console.log('B nella Polis:', await B.h1(), '| Oikos:', await B.ev(`[...document.querySelectorAll('.card--oikos .card__title')].map(x=>x.textContent).join(',')`), '| membri:', await B.ev(`document.querySelector('.avatars__count').textContent.trim()`));

  console.log('nomi in chiaro nel DB?', psql("select count(*) from (select meta::text t from polis union all select meta::text from oikos union all select coalesce(profile::text,'') from polis_members) x where t ilike '%Accademia%' or t ilike '%Simposio%' or t ilike '%Xenos%'"));

  // A allontana B: la rotazione avviene da sola quando A ricarica la Polis
  await A.ev(`document.querySelector('.avatars').click()`); await sleep(400);
  await A.ev(`(() => { const items=[...document.querySelectorAll('.member__main')]; const other=items.find(b=>!b.textContent.includes('you')); other.click(); return true; })()`); await sleep(200);
  await A.btn('Remove'); await sleep(2500);
  console.log('epoca della Polis dopo l\'uscita:', psql("select epoch || ' rotation_needed=' || rotation_needed from polis"));
  console.log('A membri:', await A.ev(`document.querySelector('.avatars__count').textContent.trim()`));

  // C: lo stesso account di A su un altro "dispositivo", collegato tramite il relay del server
  const trialA = await A.ev(`sessionStorage.getItem('athenai:trial-user')`);
  const C = await device('C');
  await C.nav(URL0);
  await C.ev(`sessionStorage.setItem('athenai:trial-user', ${JSON.stringify(trialA)}); location.reload(); true`); await sleep(3000);
  console.log('C:', await C.h1());
  await C.btn('Link from another device'); await sleep(1200);
  const code = await C.ev(`document.querySelector('.code').textContent`);
  const verC = await C.ev(`document.querySelector('.verify strong').textContent`);
  await A.ev(`document.querySelector('.modal .icon-btn')?.click(); document.querySelector('.avatar:not(.avatar--small)').click(); true`); await sleep(300);
  await A.btn('Link a device'); await sleep(300);
  await A.type('.modal input', code); await A.btn('Continue'); await sleep(400);
  console.log('A vede codice:', (await A.ev(`document.querySelector('.modal p').textContent`)).includes(verC) ? 'uguale' : 'DIVERSO');
  await A.btn('Yes, link it'); await sleep(2500);
  console.log('C dopo:', await C.h1(), '| Polis di C:', await C.ev(`[...document.querySelectorAll('.card__title')].map(x=>x.textContent).join(',')`));
  for (const [n, d] of [['A', A], ['B', B], ['C', C]]) if (d.errors.length) console.log('errori', n, d.errors);
  console.log('storage locale A/B/C:', await A.ev(`localStorage.length`), await B.ev(`localStorage.length`), await C.ev(`localStorage.length`));
} catch (e) { console.log('ERRORE', e.message); } finally { c.close(); proc.kill(); }
