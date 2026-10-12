# Athenai — contesto per Claude Code

Suite di scrittura collaborativa nel browser, cifrata end-to-end, europea, open source (AGPL) e
no-profit. Piano e fasi: `docs/PIANO.md`. Nomi: `docs/GLOSSARIO.md`. Sicurezza:
`docs/MODELLO-MINACCE.md` (si aggiorna nello stesso commit in cui cambia qualcosa di rilevante).

## Principi non negoziabili
- **Il server non legge mai i contenuti.** Tutto si cifra nel browser (libsodium). Nessun log o
  telemetria con contenuti; niente statistiche.
- **Chiavi**: la chiave principale (dal Symbolon, 12 parole) non si salva mai in chiaro: solo
  avvolta (passkey PRF o chiave WebCrypto non esportabile). In memoria solo mentre è sbloccata.
- **Servizi europei e auto-ospitabili**, gratuiti prima di tutto; mai CDN o script di terzi (CSP in
  `web/index.html`).
- **Interfaccia minimale**: un'azione principale per schermata, il resto nel menu del profilo o
  nascosto finché non serve.
- **Logica in funzioni pure testate** (vitest); la logica condivisa con Alexandria sta in `logos`.
- **Nomi greci** del glossario: mai tradotti, con la maiuscola (test in `web/src/i18n/`).

## Comandi
```sh
npm run dev   # web, modalità di prova se manca web/.env.local
npm test      # vitest
npm run build # tsc + vite build
```
Prima di ogni commit: `npm test` e `npm run build` verdi.

## Struttura
- `web/src/crypto/` — libsodium: frase (recovery), chiavi e avvolgimento (keys), chiave del
  dispositivo (deviceKey), passkey PRF (passkey), collegamento (deviceLink, relay), archivio locale.
- `web/src/auth/` — OIDC verso Zitadel (oidc) o prova locale (trial).
- `web/src/state/` — sessione (fasi: signedOut, needsSymbolon, protect, locked, ready) e preferenze.
- `web/src/screens/` — Propylaia, Symbolon, sblocco, collegamento, Akropolis, Nomoi.
- `deploy/` — Zitadel e configurazione.

## Convenzioni
- Commenti e messaggi di commit in italiano, identificatori in inglese. Ogni stringa visibile passa
  da `t()`, chiave in `it.ts` e `en.ts` (un test lo controlla).
- Colori solo dai token di `web/src/styles/tokens.css`.
- Branch + PR per ogni lavoro, merge a CI verde (lo approva il committente).
- Prima di spendere soldi (hosting, Apple Developer) o attivare servizi pubblici: chiedere.
