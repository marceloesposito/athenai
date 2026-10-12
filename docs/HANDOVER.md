# Handover — stato al 12 ottobre 2026 (notte, dopo la P3)

Documento per riprendere il lavoro in una sessione nuova, dopo il clear della chat. Leggere prima
questo, poi `CLAUDE.md`, `docs/PIANO.md` e `docs/MODELLO-MINACCE.md` di questo repo.

## I tre progetti

| Progetto | Dove sta | Stato |
|---|---|---|
| **Alexandria** — app desktop offline (Tauri + Rust + React) | `~/Documents/GitHub/alexandria`, GitHub `marceloesposito/alexandria` | `main` = `9d410db`; **PR #34 aperta** (dentro l'app solo Codeberg come server git: tolti GitHub/GitLab/Device Flow, `remote_allowed` in `git.rs`). App per Mac in `/Applications` (build del 12/10, prima della #34). |
| **logos** — nucleo puro condiviso (MIT) | `~/Documents/GitHub/logos`, GitHub `marceloesposito/logos` | tag `v0.1.0` (45 moduli, 209 test). Alexandria lo usa come `logos@github:marceloesposito/logos#v0.1.0`. |
| **Athenai** — app collaborativa nel browser (AGPL) | `~/Documents/GitHub/athenai`, GitHub `marceloesposito/athenai` | P0–P3 fatte. P2 su `main` (PR #1); P3 sul ramo `p3-grapheion` (PR verso `main`). |

## Decisioni del committente che prevalgono su tutto
1. **Nessun fornitore americano** (12/10): niente accesso con Google, GitHub o Apple; niente Google Drive
   o iCloud; codice e versioning **non su GitHub**. Solo servizi europei e attenti alla privacy.
   - Accesso: **solo passkey ed email** con Zitadel auto-ospitato (CH).
   - Backup (Archeion): Nextcloud/WebDAV, Infomaniak kDrive, Hetzner Storage Box, pCloud — sempre cifrati.
   - Versioning di un Oikos, **dentro l'app**: repo git **cifrato** e **solo su Codeberg**.
   - **Sviluppo**: i tre progetti restano su **GitHub** (repo, PR, CI con `gh`). È una scelta del
     committente per lo sviluppo; le app non usano mai GitHub.
   - Vale **anche per Alexandria**: dentro l'app il remoto git è solo Codeberg o una cartella locale
     (PR #34).
2. **Nulla nel browser di default**: identità pubblica, chiave principale avvolta dalla passkey,
   preferenze e contenuti stanno sul server, cifrati. In locale solo con "Ricorda su questo browser".
3. **Cifratura end-to-end di default**; il server non legge mai contenuti né nomi.
4. **No-profit e open source**; piani a pagamento solo a prezzo di costo.
5. **Interfaccia minimale**: un'azione principale per schermata, il resto nel menu del profilo.
6. **Agorà** (P4) = le stesse basi dell'Armarium di Alexandria, ma grafiche e collaborative **stile
   Miro**, con **post-it** stile Miro, connettori, Topoi/kanban, presenza.
7. Il committente approva i merge (chiedere con una chiamata `gh pr merge`/equivalente che lui
   conferma); prima di spendere soldi o attivare servizi pubblici chiedere sempre.

## Identità (glossario completo in `docs/GLOSSARIO.md`)
App **Athenai** (Ἀθῆναι, la prima democrazia). Polis (team), Oikos (progetto), Agorà (board,
predefinita), Propylaia (accesso), Akropolis (home), Tomos (documento), Grapheion (editor), Pinax,
Syntagma, Hesychia, Typoi, Ekdosis, Thesauros (fonti), Anthologia, Topoi, Scholia, Dokimasia,
Symposion (sessione dal vivo), Keryx, Chronika, Heuresis, Anamnesis (versioni), Archeion (backup),
Symbolon (chiavi, 12 parole), Nomoi (preferenze). Ruoli: Archon, Polites, Mentore, Xenos.
I nomi non si traducono mai (test in `web/src/i18n/`).

## Cosa fa Athenai oggi (P0–P3)
- **Propylaia**: accesso con Zitadel (OIDC + PKCE) oppure modalità di prova (`ALLOW_TRIAL=true` sul
  server: account che dura quanto la scheda).
- **Symbolon**: 12 parole BIP39 (it/en) → chiave principale → X25519 + Ed25519; sblocco con passkey
  (estensione PRF; la chiave avvolta sta sul server), con le 12 parole, o "Ricorda su questo browser"
  (WebCrypto non esportabile, unico dato locale). Impronta di 32 cifre.
- **Collegamento dei dispositivi**: codice/QR sullo schermo del nuovo dispositivo, codice di verifica
  a 6 cifre, sealed box tramite il relay del server.
- **Server** (`server/`, Fastify + Postgres, TypeScript nativo di Node 24): account legati alla chiave
  (firma di una sfida → sessione 12 h), Polis, membri e ruoli, inviti con la chiave nel frammento del
  link, Oikos, **rotazione delle chiavi** con catena all'indietro (la fa da sé il primo Archon che
  apre la Polis dopo un'uscita), passkey e preferenze cifrate, relay.
- **Web**: Akropolis (Polis come carte), Polis (Oikos come carte, membri, inviti per ruolo), Oikos
  (Tomoi come carte, "Nuovo Tomos", Heuresis), Grapheion.
- **P3 — scrivere insieme**:
  - **Tomos**: titolo cifrato con la chiave dell'Oikos; registro Yjs cifrato e **firmato** dall'autore
    sul server (`tomos_log`), due flussi: `text` (Archon, Polites) e `scholia` (anche Mentore). Ogni
    50 voci, in un momento di quiete, chi scrive manda uno stato intero che sostituisce le voci
    coperte. `web/src/grapheion/sync.ts` (modello secsync, senza la libreria).
  - **Tempo reale**: WebSocket `/v1/live` (autenticazione con il primo messaggio, mai nell'URL):
    voci, presenza cifrata (cursori con nome e colore, Symposion), avvisi `polis` (la vista si
    ricarica da sola: niente più ricaricamento manuale) e `keryx`. Riconnessione automatica.
  - **Scholia**: su una selezione compare "Commenta"; discussioni con risposte, risolte, @menzioni con
    menu dei membri; l'ancora è una coppia di posizioni relative Yjs.
  - **Keryx**: campanella in alto, visibile solo con notifiche; sealed box firmata verso il
    destinatario; aprirla porta allo Scholion e la cancella dal server.
  - **Heuresis**: ricerca nell'Oikos, titoli (fuzzy di `logos`) e testi decifrati in memoria.
  - `logos` è dipendenza del web (`lib/fuzzy`, `doc/counts`); il Grapheion (TipTap) si carica a
    richiesta.

Verificato (12/10, su Windows): 51 test (9 protocol, 24 web, 18 server su Postgres vero, anche
WebSocket); `scripts/e2e-polis.mjs` e `scripts/e2e-tomos.mjs` passano (tre "dispositivi" in Chrome
headless: scrittura a due in tempo reale ~220 ms, presenza, Scholion con @menzione → Keryx → si apre
lo Scholion, Mentore che commenta ma non scrive, Heuresis, allontanamento con rotazione e scrittura
con la chiave nuova; nessun testo in chiaro nel database, niente in `localStorage`).

## Ambiente sul PC Windows (12/10)
- Niente Docker: per i test si usa un **Postgres 17 portabile** (binari EDB in una cartella
  temporanea, `initdb -U athenai --auth=trust`, `pg_ctl -o "-p 55432" start`, `create database
  athenai`). Il server: `DATABASE_URL=postgres://athenai:athenai-dev@127.0.0.1:55432/athenai
  PORT=8787 ALLOW_TRIAL=true STATIC_DIR=../web/dist node src/main.ts` (da `server/`).
- E2E: `PSQL="<psql> -p 55432 -U athenai -d athenai" node scripts/e2e-tomos.mjs` (Chrome in
  `C:/Program Files/Google/Chrome`, lingua forzata a en-US in `cdp.mjs`).
- **Da provare sul Mac**: `docker compose -f deploy/compose.yml up -d --build` con la P3 (il
  Dockerfile ora installa `git`, che serve per `logos` da GitHub).

## Ambiente su questo Mac
- **Docker = Colima** (open source) + `docker`/`docker-compose` da Homebrew. Se Docker non risponde:
  `colima start`. Plugin compose configurato in `~/.docker/config.json`.
- Athenai: `docker compose -f deploy/compose.yml up -d --build` → tutto su http://localhost:8787.
  Sviluppo: `docker compose -f deploy/compose.yml up -d postgres`, `cp server/.env.example server/.env`,
  `npm run dev:server`, `npm run dev` (Vite su :5173 inoltra `/v1` al server). `npm test`, `npm run build`.
- Prove nel browser: Chrome headless via CDP, mai finestre visibili (`scripts/cdp.mjs`,
  `CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`).
- Alexandria per Mac: `export PATH="$HOME/.cargo/bin:$PATH" SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`
  prima di `npx tauri build` (l'SDK 27 ha un linker incompatibile); poi copiare
  `src-tauri/target/release/bundle/macos/Alexandria.app` in `/Applications` se l'app è chiusa.
- `gh` ha lo scope `workflow`. Esiste una chiave SSH `~/.ssh/codeberg_ed25519` (+ `Host codeberg.org`
  in `~/.ssh/config`), generata quando sembrava che il codice andasse su Codeberg: non serve per lo
  sviluppo; può servire per provare la funzione Codeberg dell'app (account `marceloesposito`).

## Prossimi passi, in ordine
1. Merge della PR della P3 (approva il committente) e prova dello stack in Docker sul Mac.
2. **P4**: Agorà stile Miro (vedi decisione 6): il canvas sarà un altro documento Yjs dello stesso
   registro cifrato (un terzo flusso, o un Tomos speciale per Oikos) — `sync.ts` è già generico sui
   flussi. Poi P5–P8 come in `docs/PIANO.md`.

## Limiti e cose da sapere
- **Zitadel mai provato** davvero (solo modalità di prova); guida in `deploy/README.md` sul compose
  ufficiale v4.19.4. Da provare ora che c'è Docker.
- **Passkey con PRF** provate solo in teoria (Chrome headless non ha autenticatori): provare a mano
  in Safari/Chrome.
- Niente lettore del QR nel collegamento: si copia e incolla il codice (il QR si mostra).
- Elenco delle Polis: una richiesta per Polis per decifrare il nome (da ottimizzare).
- P3: niente orologi per autore firmati (secsync li ha): un server malevolo potrebbe nascondere
  una modifica a qualcuno senza che se ne accorga (vedi modello delle minacce).
- P3: il controllo "il Mentore non scrive nel testo" lo fa il server; i client accettano ogni voce
  firmata da un membro.
- P3: nessuna formattazione oltre a StarterKit (titoli, elenchi, citazioni, codice) e nessuna barra
  degli strumenti: si usano le scorciatoie Markdown di TipTap. Niente export (arriva con Ekdosis).
- `npm audit` segnala vulnerabilità in dipendenze transitive di `logos` (mathjax, katex); il web
  importa solo `lib/fuzzy` e `doc/counts`, che non le usano, quindi non finiscono nel bundle.
- Restano non europei: il registro npm e il portachiavi con cui l'utente sincronizza la passkey
  (segnalati nel modello delle minacce).
- Un account di prova si perde chiudendo la scheda (voluto: nulla in locale).
