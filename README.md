# Athenai

Scrivere insieme, in tempo reale.

Athenai è lo studio di scrittura collaborativo **nel browser** per chi scrive: si progetta, si scrive
e si rilegge insieme. È la sorella di [Alexandria](https://github.com/marceloesposito/alexandria)
(desktop, offline) e ne condivide il nucleo [logos](https://github.com/marceloesposito/logos).
**Cifrata end-to-end**, **solo servizi europei**, **open source** (AGPL-3.0) e **no-profit**.

Ogni progetto (**Symposion**) di un team (**Polis**) ha tre sezioni:
- **Agorà**: idee, risorse, schemi e post-it, insieme (in arrivo);
- **Grapheion**: si scrive a più mani in Markdown, con i commenti a margine;
- **Anamnesis**: versioni, chi ha scritto cosa, i contributi di ciascuno (in arrivo).

Ci si registra con email e password (la password non lascia mai il browser) e si scrive subito.
Chi non ha un account può entrare da un **link privato**, come ospite, con il nome di un personaggio
dell'antica Grecia.

Stato: **R1** (accesso, ospiti, nuova interfaccia; Grapheion collaborativo). Piano: [docs/PIANO.md](docs/PIANO.md).

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
npm run dev:server   # API su :8787
npm run dev          # app su :5173, con le API inoltrate al server
npm test             # protocollo, web, server (il server usa il Postgres di Docker)
```

Configurazione del server: [deploy/README.md](deploy/README.md).

## Documenti
- [Piano e fasi](docs/PIANO.md)
- [Glossario](docs/GLOSSARIO.md)
- [Modello delle minacce](docs/MODELLO-MINACCE.md)

## Licenza
AGPL-3.0-or-later. Il nucleo `logos` è MIT.
