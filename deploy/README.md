# Accesso con Zitadel (sviluppo in locale)

Athenai usa **Zitadel** (Svizzera, open source) come fornitore d'identità: passkey ed email per
primi, Google e GitHub come fornitori esterni facoltativi. Senza Zitadel l'app parte in
**modalità di prova** (account locale al browser, crittografia vera): basta `npm run dev`.

> Stato: guida scritta sul compose ufficiale di Zitadel v4.19.4, **non ancora provata** su questa
> macchina (Docker non installato). Il `docker compose` dei servizi di Athenai (relay, Postgres,
> archivio cifrato) arriva con il server, nella fase P2.

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
4. **Fornitori esterni** (facoltativi): Google e GitHub. Annotare l'**ID** di ciascuno.
5. Nessun dato dei contenuti passa da qui: Zitadel conosce solo email, nome e i fornitori usati.

## 3. Collegare l'app

```sh
cp deploy/web.env.example web/.env.local   # e compilare i valori
npm run dev
```
