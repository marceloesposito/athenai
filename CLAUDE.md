# Athenai — contesto per Claude Code

App di scrittura collaborativa in tempo reale nel browser, sorella di Alexandria (ne riprende tono e
aspetto, in versione ridotta): cifrata end-to-end, europea, open source (AGPL) e no-profit.
**Riprendendo il lavoro leggere prima `docs/HANDOVER.md`.** Piano e fasi: `docs/PIANO.md`. Nomi:
`docs/GLOSSARIO.md`. Sicurezza: `docs/MODELLO-MINACCE.md` (si aggiorna nello stesso commit in cui
cambia qualcosa di rilevante).

## Principi non negoziabili
- **Il server non legge mai i contenuti.** Tutto si cifra nel browser (libsodium). Nessun log o
  telemetria con contenuti; niente statistiche.
- **Chiavi**: la password non lascia il browser (Argon2id → chiave d'accesso + chiave che avvolge la
  chiave principale). La chiave principale in chiaro esiste solo in memoria; nel browser solo
  avvolta e solo con "resta connesso".
- **Solo servizi europei** (decisione del committente): nessun fornitore americano nell'app. Lo
  *sviluppo* resta su GitHub (repo, PR, CI). Prima di aggiungere un servizio o una dipendenza
  esterna verificare origine e privacy. Mai CDN o script di terzi (CSP in `web/index.html`).
- **Semplice come Alexandria**: dalla landing al primo documento in 2 clic; tre schede (Agorà,
  Grapheion, Anamnesis), Mod+K per andare ovunque, il resto nascosto finché non serve.
- **Nomi**: greci solo i luoghi (dove Alexandria usa il latino) e i ruoli; tutto il resto in parole
  semplici. Mai tradotti, con la maiuscola (test in `web/src/i18n/`). Niente grafica grecheggiante.
- **Logica in funzioni pure testate** (vitest); la logica condivisa con Alexandria sta in `logos`.

## Comandi
```sh
docker compose -f deploy/compose.yml up -d postgres   # Postgres per sviluppo e test
npm run dev:server   # API (server/.env da .env.example)
npm run dev          # web, API inoltrate a :8787
npm test             # protocol + web + server (vitest; il server usa Postgres vero)
npm run build        # web + typecheck del server
docker compose -f deploy/compose.yml up -d --build   # tutto in Docker su :8787
node scripts/e2e-athenai.mjs   # prova end-to-end in Chrome headless (server su :8787; PSQL, SHOTS)
```
Prima di ogni commit: `npm test` e `npm run build` verdi. Sul Mac Docker è Colima (`colima start`).
Sul PC Windows non c'è Docker: Postgres portabile in `%LOCALAPPDATA%\athenai-pg` (vedi HANDOVER).
Dopo una nuova build dell'app il server va riavviato (`@fastify/static` registra i file all'avvio).

## Struttura
- `protocol/` — tipi delle API, ruoli (archon/polites/xenos), testi firmati, buste, link (inviti
  nella Polis e link per ospiti), nomi greci per gli ospiti. Condiviso da web e server.
- `server/` — Fastify + Postgres, TypeScript nativo di Node 24: account con email e password
  (`routes/accounts.ts`), sessioni anche per ospiti (`auth.ts`), Polis/Symposia/inviti/link ospite
  e rotazione (`routes/polis.ts`), documenti e registro cifrato (`routes/documents.ts`), ospiti
  (`routes/guests.ts`), notifiche, tempo reale (`live.ts`). Test d'integrazione in `server/test/`.
- `web/src/crypto/` — libsodium: password e codice di recupero (`password.ts`), identità (`keys.ts`),
  Polis/Symposia/link (`polis.ts`), documenti e notifiche (`docs.ts`), "resta connesso"
  (`deviceKey.ts`, `keystore.ts`).
- `web/src/state/` — sessione (`signedOut | guestInvite | ready | guest`), lavoro aperto
  (`work.ts`: Polis, Symposia, documenti, viste), notifiche, preferenze cifrate.
- `web/src/grapheion/` — sincronizzazione cifrata di un documento (`sync.ts`, trasporto astratto,
  provato con un server finto), commenti nel documento Yjs, ancore, ricerca.
- `web/src/shell/` — barra in alto (Polis/Symposion, tre schede, presenza, salvataggio, Condividi,
  notifiche, profilo) e Cerca e vai (Mod+K).
- `web/src/screens/` — Welcome (landing, registrazione, accesso, recupero), GuestJoin, Home (la
  Polis), SymposionView (sezioni), Grapheion, commenti, condivisione, membri, impostazioni.
- `deploy/` — compose (Postgres + server con l'app), Dockerfile, guida.

## Convenzioni
- Commenti e messaggi di commit in italiano, identificatori in inglese. Ogni stringa visibile passa
  da `t()`, chiave in `it.ts` e `en.ts` (un test lo controlla).
- Colori solo dai token di `web/src/styles/tokens.css` (gli stessi di Alexandria, accento blu).
- Branch + PR per ogni lavoro, merge a CI verde (lo approva il committente).
- Prima di spendere soldi (hosting, Apple Developer) o attivare servizi pubblici (es. email): chiedere.
