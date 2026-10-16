# Handover — stato al 12 ottobre 2026 (notte, dopo la R1)

Documento per riprendere il lavoro in una sessione nuova. Leggere prima questo, poi `CLAUDE.md`,
`docs/PIANO.md` e `docs/MODELLO-MINACCE.md`.

## I tre progetti
| Progetto | Dove sta | Stato |
|---|---|---|
| **Alexandria** — app desktop offline (Tauri + Rust + React) | `alexandria`, GitHub `marceloesposito/alexandria` | `main` dopo la PR #34 (dentro l'app solo Codeberg come server git). |
| **logos** — nucleo puro condiviso (MIT) | `logos`, GitHub `marceloesposito/logos` | tag `v0.1.0`. Usato da Alexandria e dal web di Athenai (`lib/fuzzy`, `doc/counts`). |
| **Athenai** — app collaborativa nel browser (AGPL) | `athenai`, GitHub `marceloesposito/athenai` | P0–P3 su `main` (PR #1, #2). **R1** sul ramo `r1-accesso-shell` (PR verso `main`). |

## La riprogettazione (12/10, dopo la P3) — prevale su tutto il resto
Il committente ha trovato l'interfaccia della P3 troppo "greca" e il percorso troppo lungo. Decisioni:
1. **Tre sezioni** per progetto: **Agorà** (board collaborativa: brainstorming, risorse, schemi,
   post-it, commenti; ricalca l'Armarium), **Grapheion** (scrittura Markdown + commenti in tempo
   reale; come lo Scriptorium), **Anamnesis** (versioni semplici + **blame** + **contributi** per
   autore; come il Palimpsestus).
2. **Polis** (team) con **Archon** (proprietario), **Politai** (membri), **Xenoi** (ospiti);
   progetti = **Symposion** (pl. Symposia; forma greca, scelta dal committente).
3. **Nomi**: greci solo dove Alexandria usa il latino (Symposion, Agorà, Grapheion, Anamnesis,
   Scholia, Pinax, Hesychia) più Polis e i ruoli. Tutto il resto in parole semplici. Niente grafica
   grecheggiante: tono e aspetto di Alexandria.
4. **Accesso**: email e password gestiti dal server di Athenai, **E2E con la chiave dalla password**
   (Argon2id nel browser). Niente 12 parole, niente Zitadel. "Accedi con Proton": non esiste per
   terzi; c'è l'OIDC di SimpleLogin, possibile più avanti con una seconda password per la cifratura.
5. **Ospiti**: link privato per Symposion ("può modificare"/"può commentare"), sessione senza
   account, nome di un personaggio greco classico diverso da quelli presenti.
6. **Ordine scelto**: R1 accesso + shell → **R2 Agorà** → R3 Grapheion completo → R4 Anamnesis.

Restano valide le decisioni precedenti: nessun fornitore americano nell'app (sviluppo su GitHub sì),
no-profit, il committente approva i merge, chiedere prima di spendere o attivare servizi (email).

## Cosa fa Athenai oggi (R1)
- **Landing → registrazione (nome, email, password) → primo documento aperto**: 2 clic. Alla prima
  entrata si creano da soli Polis, "Il mio primo Symposion" e un documento con il cursore nel titolo.
- **Accesso**: email e password, "resta connesso" (proposto acceso), codice di recupero facoltativo
  nelle Impostazioni, cambio password, recupero con il codice. Parametri finti per le email
  sconosciute, stessa risposta per email sconosciuta e password sbagliata, limite di tentativi.
- **Shell** stile Alexandria: in alto Polis (menu con le altre Polis e "Nuova Polis") / Symposion,
  le tre schede (Mod+1/2/3), chi c'è, salvataggio, **Condividi** (Archon), notifiche, profilo;
  **Mod+K** cerca documenti, Symposia e azioni (fuzzy di `logos`).
- **Home della Polis**: Symposia come carte, "Nuovo Symposion" (Archon), Membri (invito con link).
- **Grapheion**: colonna dei documenti con ricerca nei testi (locale), editor TipTap collaborativo
  cifrato (registro Yjs firmato), commenti (Scholia) con @menzioni e notifiche, conteggio parole.
- **Agorà** e **Anamnesis**: schede presenti con "in arrivo".
- **Ospiti**: link da Condividi; chi lo apre entra con un clic e un nome greco; con "può commentare"
  il testo è in sola lettura. Revoca o uscita di un membro: gli ospiti escono subito, la chiave
  ruota; quello che hanno scritto resta verificabile (le sessioni restano come registro autori).

Verificato (12/10, Windows): `npm test` (protocol 9, web 20, server 15 su Postgres vero) e
`npm run build` verdi; `scripts/e2e-athenai.mjs` tutto ok (20 controlli: 2 clic al primo documento,
ospiti con nomi greci in modifica e in commento, invito di un membro con @menzione → notifica →
apre il commento, resta connesso, password sbagliata/giusta, rotazione dopo l'uscita, ospiti fuori,
niente in chiaro nel database, niente in `localStorage`).

## Ambiente
- **PC Windows**: niente Docker. Postgres 17 portabile in `%LOCALAPPDATA%\athenai-pg` (binari in
  `pgsql/`, dati in `data/`). Avvio da Git Bash:
  `~/AppData/Local/athenai-pg/pgsql/bin/pg_ctl -D ~/AppData/Local/athenai-pg/data -o "-p 55432" -l ~/AppData/Local/athenai-pg/log start`.
  Server: da `server/`, `DATABASE_URL=postgres://athenai:athenai-dev@127.0.0.1:55432/athenai PORT=8787 SERVER_SECRET=dev-secret STATIC_DIR=../web/dist node src/main.ts`.
  E2E: `PSQL="<psql> -p 55432 -U athenai -d athenai" SHOTS=<cartella> node scripts/e2e-athenai.mjs`
  (Chrome in `C:/Program Files/Google/Chrome`, lingua forzata a en-US in `cdp.mjs`).
- **Mac**: Docker = Colima (`colima start`). `docker compose -f deploy/compose.yml up -d --build`
  → tutto su :8787. **Da provare**: il Dockerfile installa `git` (serve per `logos` da GitHub).
- Lo schema è alla versione 2: un database della P1–P3 si ricrea da solo all'avvio (non c'erano
  dati di produzione).

## Prossimi passi
1. Merge della PR della R1 (approva il committente).
2. **R2 — Agorà**: board collaborativa con React Flow (`@xyflow/react`, come la Tabula di
   Alexandria), un documento Yjs per Symposion nello stesso registro cifrato (`sync.ts` è già
   generico). Post-it (colori, doppio clic, Tab per il successivo, voto), cornici, connettori con
   etichetta, disegno a mano libera e forme, carte risorsa (link, immagini cifrate, documenti del
   Grapheion), commenti, cursori. Logica pura in `web/src/agora/` con test.
3. R3 Grapheion completo, R4 Anamnesis (vedi `docs/PIANO.md`).

## Limiti e cose da sapere
- Niente email: niente verifica dell'indirizzo né reset via email (solo codice di recupero). Per
  la verifica serve un servizio europeo (Brevo/Infomaniak): chiedere prima di attivarlo.
- Gli ospiti non leggono i profili della Polis: vedono i nomi dei membri da cursori e commenti.
- Il controllo "solo commenti" per gli ospiti lo fa il server; niente orologi per autore firmati
  (un server malevolo potrebbe nascondere una modifica): vedi modello delle minacce.
- `npm audit` segnala dipendenze transitive di `logos` (mathjax, katex) che il web non importa.
- Il bundle principale è ~840 kB (libsodium sumo); l'editor si carica a parte (~535 kB).
