# Accesso con Zitadel (sviluppo in locale)

Athenai usa **Zitadel** (Svizzera, open source, auto-ospitato) come fornitore d'identità: **solo
passkey ed email**, nessun fornitore esterno (né americano né altro). Senza Zitadel il server può
partire in **modalità di prova** (`ALLOW_TRIAL=true`: account che dura quanto la scheda,
crittografia vera).

> Stato: il compose di Athenai (`deploy/compose.yml`: Postgres + server con l'app) è provato. La
> parte di Zitadel è scritta sul compose ufficiale v4.19.4 ma **non ancora provata**.

## 1. Avviare Zitadel

Si usa il compose ufficiale, fissato a una versione:

```sh
mkdir zitadel && cd zitadel
curl -LO https://raw.githubusercontent.com/zitadel/zitadel/v4.19.4/deploy/compose/docker-compose.yml
curl -L  https://raw.githubusercontent.com/zitadel/zitadel/v4.19.4/deploy/compose/.env.example -o .env
# in .env: ZITADEL_VERSION=v4.19.4, ZITADEL_MASTERKEY (32 caratteri casuali),
# LOGIN_SESSION_COOKIE_SECRET (openssl rand -base64 32), dominio localhost
docker compose up -d
```

## 2. Configurare Athenai nella console di Zitadel

1. **Progetto** "Athenai" → **Applicazione** di tipo *User Agent* (app nel browser), metodo
   **PKCE**, senza segreto client.
2. Redirect URI: `http://localhost:5173/` (e lo stesso come *post logout*). In produzione
   l'indirizzo pubblico, solo `https`.
3. **Login policy**: abilitare *passwordless* (passkey) e la registrazione via email; nessuna
   password obbligatoria.
4. **Nessun fornitore esterno**: niente Google, GitHub o Apple.
5. Nessun dato dei contenuti passa da qui: Zitadel conosce solo email, nome e i fornitori usati.

## 3. Collegare Athenai

```sh
# app (sviluppo)
cp deploy/web.env.example web/.env.local      # VITE_OIDC_ISSUER, VITE_OIDC_CLIENT_ID
# server: OIDC_ISSUER e OIDC_AUDIENCE (= client id) in server/.env, ALLOW_TRIAL=false
# oppure con Docker: OIDC_ISSUER=... OIDC_AUDIENCE=... ALLOW_TRIAL=false docker compose -f deploy/compose.yml up -d --build
```
