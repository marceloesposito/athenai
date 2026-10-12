# Handover — stato al 12 ottobre 2026 (sera)

Documento per riprendere il lavoro in una sessione nuova, dopo il clear della chat. Leggere prima
questo, poi `CLAUDE.md`, `docs/PIANO.md` e `docs/MODELLO-MINACCE.md` di questo repo.

## I tre progetti

| Progetto | Dove sta | Stato |
|---|---|---|
| **Alexandria** — app desktop offline (Tauri + Rust + React) | `~/Documents/GitHub/alexandria`, GitHub `marceloesposito/alexandria` | `main` = `9d410db`; **PR #34 aperta** (dentro l'app solo Codeberg come server git: tolti GitHub/GitLab/Device Flow, `remote_allowed` in `git.rs`). App per Mac in `/Applications` (build del 12/10, prima della #34). |
| **logos** — nucleo puro condiviso (MIT) | `~/Documents/GitHub/logos`, GitHub `marceloesposito/logos` | tag `v0.1.0` (45 moduli, 209 test). Alexandria lo usa come `logos@github:marceloesposito/logos#v0.1.0`. |
| **Athenai** — app collaborativa nel browser (AGPL) | `~/Documents/GitHub/athenai`, GitHub `marceloesposito/athenai` | P0–P2 fatte, su GitHub (ramo `p2-server` → PR verso `main`). |

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

## Cosa fa Athenai oggi (P0–P2)
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
- **Web**: Akropolis (Polis come carte), Polis (Oikos come carte, membri, inviti per ruolo).
  Aprire un Oikos dice "L'Agorà arriva con la P4".

Verificato: 32 test (5 protocol, 15 web, 12 server su Postgres vero); `scripts/e2e-polis.mjs` (tre
"dispositivi" in Chrome headless: invito, ingresso, allontanamento con rotazione, collegamento) passa
sia in sviluppo sia con lo stack in Docker; nessun dato in `localStorage`.

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
1. **P3**: Grapheion collaborativo cifrato (TipTap + Yjs con protocollo secsync sul relay del server),
   cursori e presenza (Symposion), Scholia con @menzioni, Keryx, Heuresis locale; `logos` torna nel
   web come dipendenza (da GitHub, come in Alexandria). Con il tempo reale togliere il ricaricamento manuale della Polis.
2. **P4**: Agorà stile Miro (vedi decisione 6). Poi P5–P8 come in `docs/PIANO.md`.

## Limiti e cose da sapere
- **Zitadel mai provato** davvero (solo modalità di prova); guida in `deploy/README.md` sul compose
  ufficiale v4.19.4. Da provare ora che c'è Docker.
- **Passkey con PRF** provate solo in teoria (Chrome headless non ha autenticatori): provare a mano
  in Safari/Chrome.
- Niente lettore del QR nel collegamento: si copia e incolla il codice (il QR si mostra).
- Elenco delle Polis: una richiesta per Polis per decifrare il nome (da ottimizzare).
- Restano non europei: il registro npm e il portachiavi con cui l'utente sincronizza la passkey
  (segnalati nel modello delle minacce).
- Un account di prova si perde chiudendo la scheda (voluto: nulla in locale).
