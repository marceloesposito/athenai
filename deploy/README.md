# Athenai su un server

Athenai è un solo servizio (il server, che serve anche l'app) più Postgres. L'accesso è con
**email e password**, gestito dal server stesso. La password non arriva mai al server: il browser ne
ricava due chiavi con Argon2id, una per entrare (il server ne salva solo l'hash) e una che apre la
chiave principale dell'utente (resta nel browser). Nessun fornitore d'identità esterno.

## Avviare

```sh
docker compose -f deploy/compose.yml up -d --build   # http://localhost:8787
```

Variabili utili (in un file `.env` accanto al compose, o nell'ambiente):

| Variabile | Default | A cosa serve |
|---|---|---|
| `POSTGRES_PASSWORD` | `athenai-dev` | password del database (cambiarla in produzione) |
| `SERVER_SECRET` | `cambiami-in-produzione` | rende stabili i parametri finti restituiti per le email sconosciute (così non si scopre chi è registrato) |
| `ALLOW_SIGNUP` | `true` | `false` per un server privato: entrano solo gli account già creati e gli ospiti dei link |
| `ATHENAI_PORT` | `8787` | porta su cui ascolta (solo su 127.0.0.1: davanti serve un proxy con HTTPS) |

In produzione serve **HTTPS** (es. Caddy o Traefik davanti al servizio, anche per il WebSocket
`/v1/live`).

## Email

Al lancio non si mandano email: niente verifica dell'indirizzo né reset via email. Chi dimentica
la password rientra con il **codice di recupero** (si crea dalle impostazioni); senza codice i testi
cifrati non si possono riaprire, per costruzione. Per la verifica dell'indirizzo servirà un servizio
email europeo (Brevo o Infomaniak): si attiverà più avanti, dopo averlo deciso insieme.

## Senza Docker (sviluppo)

```sh
cp server/.env.example server/.env   # DATABASE_URL verso un Postgres 17
npm run dev:server                   # API su :8787
npm run dev                          # app su :5173 con le API inoltrate
```
