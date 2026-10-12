# Athenai

Scrivere insieme, come nella prima democrazia: ogni voce conta, ogni testo resta tuo.

Athenai è una suite di scrittura collaborativa **nel browser**, **cifrata end-to-end**, con servizi
**europei**, **open source** (AGPL-3.0) e **no-profit**. È la sorella collaborativa di
[Alexandria](https://github.com/marceloesposito/alexandria) e ne condivide il nucleo
[logos](https://github.com/marceloesposito/logos).

- **I server non leggono mai i tuoi testi**: tutto si cifra nel browser.
- **Il tuo Symbolon**: 12 parole che solo tu conosci aprono i tuoi contenuti; sblocco con passkey.
- **Agorà**: una board collaborativa in stile Miro (carte, post-it, connettori, kanban), ambiente
  predefinito di ogni progetto.
- **Tuoi per sempre**: esporti tutto in formati aperti, quando vuoi; puoi ospitarlo da te.

Stato: **fase P1** (accesso, chiavi, collegamento dei dispositivi). Piano: [docs/PIANO.md](docs/PIANO.md).

## Provare in locale

```sh
npm install
npm run dev     # http://localhost:5173 — modalità di prova senza server d'identità
npm test
```

Con Zitadel per l'accesso vero: [deploy/README.md](deploy/README.md).

## Documenti
- [Piano e fasi](docs/PIANO.md)
- [Glossario](docs/GLOSSARIO.md)
- [Modello delle minacce](docs/MODELLO-MINACCE.md)

## Licenza
AGPL-3.0-or-later. Il nucleo `logos` è MIT.
