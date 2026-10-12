# Athenai — contesto per Claude Code

Suite di scrittura collaborativa nel browser, cifrata end-to-end, europea, open source (AGPL) e
no-profit. **Riprendendo il lavoro leggere prima `docs/HANDOVER.md`.** Piano e fasi: `docs/PIANO.md`. Nomi: `docs/GLOSSARIO.md`. Sicurezza:
`docs/MODELLO-MINACCE.md` (si aggiorna nello stesso commit in cui cambia qualcosa di rilevante).

## Principi non negoziabili
- **Il server non legge mai i contenuti.** Tutto si cifra nel browser (libsodium). Nessun log o
  telemetria con contenuti; niente statistiche.
- **Chiavi**: la chiave principale (dal Symbolon, 12 parole) non si salva mai in chiaro: solo
  avvolta (passkey PRF o chiave WebCrypto non esportabile). In memoria solo mentre è sbloccata.
- **Solo servizi europei** (decisione del committente): nessun fornitore americano — niente login
  Google/GitHub/Apple, niente Drive/iCloud; dentro l'app l'unico servizio git è **Codeberg**. Lo
  *sviluppo* invece resta su GitHub (repo, PR, CI). Prima di aggiungere un servizio o una
  dipendenza esterna verificare origine e privacy. Mai CDN o script di terzi (CSP in `web/index.html`).
- **Nulla nel browser di default**: tutto sul server, cifrato; in locale solo su scelta esplicita.
- **Interfaccia minimale**: un'azione principale per schermata, il resto nel menu del profilo o
  nascosto finché non serve.
- **Logica in funzioni pure testate** (vitest); la logica condivisa con Alexandria sta in `logos`.
- **Nomi greci** del glossario: mai tradotti, con la maiuscola (test in `web/src/i18n/`).

## Comandi
```sh
docker compose -f deploy/compose.yml up -d postgres   # Postgres per sviluppo e test
npm run dev:server   # API (server/.env da .env.example)
npm run dev          # web, API inoltrate a :8787
npm test             # protocol + web + server (vitest; il server usa Postgres vero)
npm run build        # web + typecheck del server
docker compose -f deploy/compose.yml up -d --build   # tutto in Docker su :8787
```
Prima di ogni commit: `npm test` e `npm run build` verdi. Su questo Mac Docker è Colima
(`colima start` se non risponde).

## Struttura
- `web/src/crypto/` — libsodium: frase (recovery), chiavi e avvolgimento (keys), chiave del
  dispositivo (deviceKey), passkey PRF (passkey), collegamento (deviceLink, relay), archivio locale.
- `web/src/auth/` — OIDC verso Zitadel (oidc) o prova locale (trial).
- `web/src/state/` — sessione (fasi: signedOut, needsSymbolon, protect, locked, ready) e preferenze.
- `web/src/screens/` — Propylaia, Symbolon, sblocco, collegamento, Akropolis, Polis, Oikos
  (Tomoi + Heuresis), Grapheion (TipTap, caricato a richiesta), Scholia, Keryx, Nomoi.
- `web/src/grapheion/` — sincronizzazione cifrata di un Tomos (`sync.ts`, trasporto astratto,
  provato con un server finto), Scholia nel documento Yjs, ancore, Heuresis.
- `web/src/live/socket.ts` — WebSocket `/v1/live`: registro dei Tomos, presenza, avvisi
  (Polis cambiata → la vista si ricarica da sola; Keryx).
- `protocol/` — tipi delle API, testi firmati, buste cifrate, link d'invito, ruoli (condiviso).
- `server/` — Fastify + Postgres, TypeScript nativo di Node 24 (`node src/main.ts`, solo sintassi
  cancellabile): account con firma della chiave, sessioni, Polis, inviti, Oikos, rotazione, relay,
  Tomos con registro cifrato e firmato (`routes/tomos.ts`), Keryx, tempo reale (`live.ts`).
  Test d'integrazione in `server/test/` (anche WebSocket, con `injectWS`).
- `scripts/` — prove end-to-end in Chrome headless: `e2e-polis.mjs` (P2), `e2e-tomos.mjs` (P3).
  Con il server avviato su :8787; `PSQL` per il comando psql. Dopo una nuova build dell'app il
  server va riavviato (`@fastify/static` registra i file all'avvio).
- `web/src/api/` — client delle API; `web/src/state/polis.ts` — Polis e Oikos decifrati.
- `deploy/` — compose (Postgres + server con l'app), Dockerfile, guida a Zitadel.

## Convenzioni
- Commenti e messaggi di commit in italiano, identificatori in inglese. Ogni stringa visibile passa
  da `t()`, chiave in `it.ts` e `en.ts` (un test lo controlla).
- Colori solo dai token di `web/src/styles/tokens.css`.
- Branch + PR per ogni lavoro, merge a CI verde (lo approva il committente).
- Prima di spendere soldi (hosting, Apple Developer) o attivare servizi pubblici: chiedere.
