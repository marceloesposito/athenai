# Athenai — piano

Suite di scrittura collaborativa **nel browser**, **cifrata end-to-end**, con servizi **europei**,
**open source** (AGPL-3.0) e **no-profit**. App sorella di [Alexandria](https://github.com/marceloesposito/alexandria)
(desktop, offline), con cui condivide il nucleo [logos](https://github.com/marceloesposito/logos) (MIT).
Nome: Ἀθῆναι, Atene, la prima grande democrazia. Glossario: [GLOSSARIO.md](GLOSSARIO.md).

## Priorità (nell'ordine)
1. **Proprietà dei dati, privacy, sicurezza.** Il server non legge mai i contenuti. Esportazione
   completa in formati aperti in qualunque momento. Auto-ospitabile.
2. **Solo servizi europei e attenti alla privacy** (decisione del 12 ottobre 2026, che prevale su
   tutto il piano precedente): **nessun fornitore americano** — niente accesso con Google, GitHub o
   Apple, niente Google Drive o iCloud, niente GitHub per il codice o per i progetti. Gratuiti prima
   di tutto.
3. **Nulla nel browser di default.** Identità pubblica, chiave principale avvolta dalla passkey,
   preferenze e contenuti stanno sul server, cifrati. In locale solo su scelta esplicita ("Ricorda su
   questo browser"; in futuro "Disponibile offline").
4. **No-profit**: piani a pagamento solo a prezzo di costo, per sostenere i server.
5. **Interfaccia minimale**: pochi strumenti visibili, un'azione principale per schermata, il resto
   nascosto finché non serve. La collaborazione deve essere fluida, mai interrotta da opzioni.

## Servizi (solo europei)
| Bisogno | Scelta | Origine |
|---|---|---|
| Server | Hetzner Cloud (alternativa Scaleway) | DE (FR) |
| File cifrati | Hetzner Object Storage o Garage auto-ospitato | DE / FR |
| Accesso | Zitadel auto-ospitato: **solo passkey ed email** | CH |
| Database (solo metadati minimi) | PostgreSQL | — |
| Tempo reale | relay proprio (protocollo secsync, Yjs cifrato) | — |
| Email (notifiche senza contenuti) | Brevo (o Infomaniak) | FR (CH) |
| Errori | GlitchTip auto-ospitato | — |
| Statistiche | nessuna | — |
| Dominio e DNS | Infomaniak o Gandi | CH / FR |
| Codice sorgente e CI | **Codeberg** (Forgejo; no-profit) | DE |
| Versioning di un Oikos | repo git **cifrato** su Codeberg o su un Forgejo auto-ospitato | DE / proprio |
| Backup (Archeion) | Nextcloud/WebDAV, Infomaniak kDrive, Hetzner Storage Box, pCloud — sempre cifrati | DE / CH |

**Restano pezzi non europei, da tenere d'occhio:** il registro npm (le dipendenze si installano da
`registry.npmjs.org`; mitigazione: lockfile con integrità, in futuro uno specchio europeo) e la
sincronizzazione delle passkey, che dipende dal portachiavi scelto dall'utente sul proprio
dispositivo (consigliati gestori europei come Proton Pass, CH, o KeePassXC, locale).

## Crittografia
Vedi [MODELLO-MINACCE.md](MODELLO-MINACCE.md). In breve: libsodium; identità (X25519 + Ed25519)
derivata dal Symbolon (12 parole); chiave principale avvolta da passkey PRF o chiave WebCrypto non
esportabile; chiave simmetrica per Oikos consegnata ai membri cifrata con la loro chiave pubblica e
ruotata quando qualcuno esce; aggiornamenti Yjs cifrati (secsync); file cifrati prima del
caricamento; ricerca (Heuresis) locale; link pubblici con la chiave nel frammento dell'URL.

## Agorà — l'ambiente predefinito
Le **stesse basi dell'Armarium** di Alexandria, ma **grafiche e collaborative, in stile Miro**:

| Armarium (Alexandria) | Agorà (Athenai) |
|---|---|
| risorse di ogni tipo (PDF, web, YouTube, immagini, audio/video, snippet, voci bibliografiche) | **carte** con anteprima ricca sul canvas; si creano trascinando file, link o testo direttamente sulla board |
| Tabula (nodi, note, cornici) | **canvas infinito** con zoom fluido |
| note della Tabula | **post-it** stile Miro: colori, doppio clic per crearne uno, testo che si adatta, duplicazione rapida (Tab/Invio crea il successivo accanto), raggruppamento, voto a puntini |
| collegamenti fra risorse e pergamene | **connettori** fra carte, post-it e Tomoi |
| cornici | **Topoi**: zone con titolo; una zona può diventare **kanban** (colonne = stato, carte trascinabili) |
| Strata (layer, filtri) | una sola **lente** discreta: filtra per persona, tag o tipo |
| grafo e albero | viste alternative nascoste in un menu, non strumenti sempre visibili |
| Excerpta | **Anthologia**: estratti dalle fonti come carte |
| proprietà e tipi | proprietà essenziali sulla carta (assegnatario, scadenza, stato); il resto nel pannello della carta |

**Interfaccia dell'Agorà (minimale):**
- una barra verticale con 5–6 strumenti: seleziona, post-it, testo, connettore, Topos, carica;
- una mini-barra contestuale solo sulla selezione (colore, dimensione, collega, elimina);
- **presenza**: cursori con nome e colore, avatar di chi c'è, "segui" un collega, reazioni rapide.

Il Tomos si apre con un doppio clic sulla sua carta, nel **Grapheion** (editor con TipTap e
Markdown da `logos`).

## Fasi (una PR per milestone, CI verde)
| Fase | Contenuto | Stato |
|---|---|---|
| P0 | Nucleo `logos` estratto da Alexandria | fatto (logos v0.1.0, Alexandria #32 #33) |
| — | Trasloco del codice (athenai, logos, Alexandria) su Codeberg con CI europea | da fare (serve l'account Codeberg) |
| P1 | Repo, identità e glossario, Propylaia (Zitadel OIDC o prova), Symbolon (12 parole, passkey PRF, chiave del dispositivo), collegamento dei dispositivi, Akropolis, Nomoi, modello delle minacce | fatto |
| P2 | Polis e Oikos cifrati: server (relay + API minime, Postgres), inviti e ruoli, consegna e rotazione delle chiavi, collegamento fra dispositivi diversi, nulla in locale di default, `docker compose` | fatto |
| P3 | Grapheion collaborativo cifrato (secsync), cursori, Scholia con @menzioni, Keryx, Heuresis locale | |
| P4 | **Agorà**: canvas, carte, **post-it stile Miro**, connettori, Topoi e kanban, presenza | |
| P5 | Thesauros (fonti CSL, DOI/ISBN, file cifrati), Anthologia | |
| P6 | Anamnesis (versioni), Dokimasia (ruolo Mentore, Suggerisci), Chronika | |
| P7 | Archeion: backup cifrati automatici (WebDAV/Nextcloud, kDrive, Storage Box, pCloud) e ripristino; versioning su repo git cifrato (Codeberg/Forgejo) | |
| P8 | Lancio no-profit: costi pubblici, Open Collective Europe, Liberapay, NLnet, guida all'auto-ospitalità, audit | |
