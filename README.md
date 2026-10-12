# Athenai

Scrivere insieme, come nella prima democrazia: ogni voce conta, ogni testo resta tuo.

Athenai è una suite di scrittura collaborativa **nel browser**, **cifrata end-to-end**, con **soli
servizi europei** (nessun fornitore americano), **open source** (AGPL-3.0) e **no-profit**. È la sorella collaborativa di
[Alexandria](https://github.com/marceloesposito/alexandria) e ne condivide il nucleo
[logos](https://github.com/marceloesposito/logos).

- **I server non leggono mai i tuoi testi**: tutto si cifra nel browser.
- **Il tuo Symbolon**: 12 parole che solo tu conosci aprono i tuoi contenuti; sblocco con passkey.
- **Agorà**: una board collaborativa in stile Miro (carte, post-it, connettori, kanban), ambiente
  predefinito di ogni progetto.
- **Nulla nel tuo browser** se non lo scegli: tutto sta sul server, cifrato.
- **Tuoi per sempre**: esporti tutto in formati aperti, quando vuoi; puoi ospitarlo da te.

Stato: **fase P2** (server, Polis e Oikos cifrati, inviti, ruoli, rotazione delle chiavi). Piano: [docs/PIANO.md](docs/PIANO.md).

## Provare in locale

Con Docker (o Colima):

```sh
docker compose -f deploy/compose.yml up -d --build   # Postgres + server + app su http://localhost:8787
```

Per sviluppare:

```sh
npm install
docker compose -f deploy/compose.yml up -d postgres
cp server/.env.example server/.env
npm run dev:server   # API su :8787 (account di prova ammessi)
npm run dev          # app su :5173, con le API inoltrate al server
npm test             # protocollo, web, server (il server usa il Postgres di Docker)
```

Con Zitadel per l'accesso vero (passkey ed email): [deploy/README.md](deploy/README.md).

## Documenti
- [Piano e fasi](docs/PIANO.md)
- [Glossario](docs/GLOSSARIO.md)
- [Modello delle minacce](docs/MODELLO-MINACCE.md)

## Licenza
AGPL-3.0-or-later. Il nucleo `logos` è MIT.
