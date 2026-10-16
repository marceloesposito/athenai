# Athenai — piano

App di **scrittura collaborativa in tempo reale** pensata per chi scrive, **nel browser**. È la sorella
di [Alexandria](https://github.com/marceloesposito/alexandria) (desktop, offline) e ne riprende il
tono e l'aspetto in versione ridotta; con Alexandria condivide il nucleo
[logos](https://github.com/marceloesposito/logos) (MIT). Open source (AGPL-3.0), europea, no-profit.
Nomi: [GLOSSARIO.md](GLOSSARIO.md).

## Riprogettazione del 12 ottobre 2026 (dopo la P3)
Il committente ha rivisto la direzione: meno personalità greca, percorso semplice dalla landing al
primo documento, account classico, ospiti senza account. Prevale su quanto scritto prima.

- **Tre sezioni** per ogni progetto (Symposion), come le viste di Alexandria:
  - **Agorà**: la piazza di discussione. Brainstorming, raccolta di risorse, co-progettazione; ricalca
    l'Armarium di Alexandria con più collaborazione in tempo reale, disegno di schemi e diagrammi,
    progettazione agile con post-it e commenti.
  - **Grapheion**: l'ambiente di scrittura, come lo Scriptorium. Markdown e commenti in tempo reale;
    la scrittura a più mani non crea conflitti (vedi sotto).
  - **Anamnesis**: il versioning, semplificato come il Palimpsestus. Versioni, confronto, ripristino,
    **blame** (chi ha scritto cosa) e **contributi** di ciascun autore.
- **Polis** = il team; il proprietario è l'**Archon**, i membri sono **Politai**, gli ospiti **Xenoi**.
  L'Archon crea i Symposia (progetti) e invita.
- **Accesso**: email e password (gestiti dal server di Athenai), cifratura end-to-end con la chiave
  ricavata dalla password; "resta connesso"; codice di recupero facoltativo. Niente 12 parole.
- **Ospiti**: l'Archon condivide un **link privato** di un Symposion ("può modificare" o "può
  commentare"); chi lo apre entra per una sessione senza account, con il nome di un personaggio del
  mondo greco classico.
- **Tono**: quello di Alexandria. Greci solo i nomi dei luoghi (dove Alexandria usa il latino), tutto
  il resto in parole semplici; niente elementi grafici grecheggianti.

## Priorità (nell'ordine)
1. **Proprietà dei dati, privacy, sicurezza.** Il server non legge i contenuti. Esportazione completa
   in formati aperti. Auto-ospitabile.
2. **Solo servizi europei** (nessun fornitore americano), gratuiti prima di tutto.
3. **Semplicità**: dalla landing al primo documento in due passaggi; interfaccia ridotta ma con
   accesso chiaro e rapido a tutto (tre schede, Mod+K per cercare e andare ovunque).
4. **No-profit**: piani a pagamento solo a prezzo di costo.

## Scrivere a più mani senza conflitti
Il testo è un documento Yjs (CRDT): le modifiche di tutti si uniscono carattere per carattere, quindi
non nascono conflitti da risolvere come in git. Per non pestarsi i piedi: cursori con nome e colore,
in futuro un segno sul paragrafo in cui qualcuno sta scrivendo (senza bloccarlo), e le versioni
automatiche di Anamnesis per tornare indietro.

## Servizi (solo europei)
| Bisogno | Scelta | Origine |
|---|---|---|
| Server | Hetzner Cloud (alternativa Scaleway) | DE (FR) |
| File cifrati (Agorà) | Hetzner Object Storage o Garage auto-ospitato | DE / FR |
| Accesso | server di Athenai: email e password (E2E), codice di recupero | — |
| Database (solo metadati minimi) | PostgreSQL | — |
| Tempo reale | WebSocket del server (registro Yjs cifrato e firmato, modello secsync) | — |
| Email (verifica, in futuro) | Brevo (o Infomaniak), da attivare previo accordo | FR (CH) |
| Errori | GlitchTip auto-ospitato | — |
| Statistiche | nessuna | — |
| Dominio e DNS | Infomaniak o Gandi | CH / FR |
| Codice sorgente e CI (sviluppo) | GitHub — scelta del committente per lo sviluppo; **mai usato dall'app** | — |
| Backup (in futuro) | Nextcloud/WebDAV, Infomaniak kDrive, Hetzner Storage Box, pCloud — sempre cifrati | DE / CH |

Accedere con Proton: Proton non offre un "Accedi con Proton" per app di terzi; c'è l'OIDC di
SimpleLogin (Proton). Possibile più avanti, con una seconda password solo per la cifratura (un login
esterno non può dare la chiave).

## Crittografia
Vedi [MODELLO-MINACCE.md](MODELLO-MINACCE.md). In breve: libsodium; chiave principale casuale avvolta
con una chiave ricavata dalla password (Argon2id nel browser); identità X25519 + Ed25519 derivata da
lei; chiave per Polis e per Symposion, consegnata ai membri cifrata con la loro chiave pubblica e
ruotata quando qualcuno esce; agli ospiti nel frammento del link; registro Yjs cifrato e firmato;
ricerca locale.

## Fasi (una PR ciascuna, CI verde, merge approvato dal committente)
| Fase | Contenuto | Stato |
|---|---|---|
| P0–P3 | Nucleo `logos`; accesso e chiavi; Polis e progetti cifrati con rotazione; editor collaborativo cifrato con commenti, notifiche, ricerca | fatto (prima della riprogettazione) |
| R1 | Accesso con email e password, ospiti con link privato e nomi greci, nomi ridotti (Symposion, documenti, ruoli Archon/Polites/Xenos), nuova interfaccia stile Alexandria (tre schede, Mod+K, landing → primo documento in 2 clic) | fatto |
| R2 | **Agorà**: board collaborativa (React Flow come la Tabula): post-it, cornici, connettori, disegno a mano libera e forme, carte risorsa (link, immagini cifrate, documenti), commenti, cursori | |
| R3 | **Grapheion** completo: colonne a linguetta, indice (Pinax), barra di formattazione e menu `/`, commenti allineati al testo, segno del paragrafo occupato, scrittura senza distrazioni (Hesychia), import/export Markdown con `logos` | |
| R4 | **Anamnesis**: versioni automatiche e con nome, confronto (logos `docDiff`), ripristino, blame per carattere, contributi per autore | |
| Poi | backup cifrati, fonti e citazioni (dal nucleo di Alexandria), lancio no-profit (costi pubblici, Open Collective Europe, NLnet, audit) | |
