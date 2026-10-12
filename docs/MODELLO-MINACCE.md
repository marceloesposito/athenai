# Modello delle minacce

Priorità del progetto, nell'ordine: **proprietà dei dati, privacy, sicurezza**. Questo documento
dice cosa Athenai protegge, da chi, e cosa no. Si aggiorna in ogni fase.

## Cosa si protegge
- **Contenuti**: Tomoi, Agorà, Scholia, fonti, file, titoli. Cifrati nel browser (XChaCha20-Poly1305);
  il server conserva e inoltra solo dati cifrati.
- **Chiavi dell'utente** (Symbolon): derivate da 12 parole BIP39 (128 bit). Sul dispositivo la chiave
  principale esiste solo *avvolta* (passkey PRF o chiave WebCrypto non esportabile) e in memoria
  mentre l'app è sbloccata; "Blocca" la cancella.

## Da chi
| Avversario | Cosa può fare | Cosa non può fare |
|---|---|---|
| Chi gestisce i server di Athenai (o chi li compromette) | vedere metadati minimi: account, appartenenze, dimensioni e orari dei messaggi cifrati; negare il servizio | leggere i contenuti; ricavare le chiavi; impersonare un utente verso gli altri membri senza che l'impronta cambi |
| Fornitore d'identità (Zitadel, auto-ospitato) | sapere che l'utente usa Athenai; impedirgli l'accesso | leggere i contenuti: l'accesso non dà le chiavi; da solo nemmeno entrare nelle Polis (serve la firma della chiave dell'utente) |
| Destinazioni dei backup (Nextcloud/WebDAV, kDrive, Storage Box, pCloud) — dalla fase P7 | vedere che esiste un archivio cifrato e la sua dimensione | aprirlo |
| Chi riceve (o intercetta) un link d'invito | entrare nella Polis con il ruolo dell'invito, finché l'invito vale (una volta, 3 giorni) | — : per questo il link va mandato per un canale fidato; l'Archon vede chi è entrato e può allontanarlo (la chiave ruota) |
| Chi intercetta la rete | — (TLS, e comunque contenuti cifrati end-to-end) | leggere o alterare senza essere scoperto |
| Chi ruba il disco o i dati del browser | trovare la chiave principale avvolta | aprirla senza la passkey (impronta/volto) o senza il browser stesso (chiave non esportabile) |
| Un ex membro di un Oikos — dalla fase P2 | leggere ciò che vedeva prima di uscire | leggere ciò che si scrive dopo (rotazione della chiave dell'Oikos); ricevere ancora le modifiche (il server lo stacca subito dai Tomoi) |
| Un membro della Polis — dalla fase P3 | scrivere ciò che il suo ruolo permette; mettere un nome falso nella propria presenza (cursore) | attribuire a un altro una modifica o uno Scholion (ogni voce è firmata dall'autore); mandare una notifica a nome di un altro (Keryx è firmato e legato al destinatario) |

## Cosa resta nel browser
**Nulla, di default.** L'identità pubblica, la chiave principale avvolta dalla passkey e le
preferenze (cifrate) stanno sul server; la chiave principale in chiaro solo in memoria finché
l'app è sbloccata. `sessionStorage` tiene il token d'accesso (o l'account di prova) e si svuota
alla chiusura della scheda. Solo "Ricorda su questo browser" salva (in IndexedDB) la chiave
principale avvolta da una chiave WebCrypto non esportabile.

## Cosa sa il server
Chiavi pubbliche, a quale account d'accesso sono legate (`sub` di Zitadel), chi è membro di quale
Polis e con che ruolo, quanti Oikos e Tomoi ha una Polis, date e dimensioni dei dati cifrati. Dalla
P3 anche: chi modifica quale Tomos e quando (autore, orario e dimensione di ogni voce), chi è
connesso a un Tomos in quel momento, e a chi arriva una notifica e quando. Non sa nomi di Polis,
Oikos, Tomoi e persone (cifrati), né il testo, gli Scholia, i cursori o le parole cercate, né email
(le ha solo Zitadel).

## Nessun fornitore americano
Per scelta del committente (12 ottobre 2026) nessun servizio americano: niente accesso con
Google, GitHub o Apple, niente Drive o iCloud; dentro l'app l'unico servizio git è Codeberg (il
codice di Athenai si sviluppa su GitHub, ma l'app non lo usa mai). Restano da sorvegliare il
registro npm (dipendenze, verificate dal lockfile) e il portachiavi con cui l'utente sincronizza
la propria passkey.

## Cosa *non* si protegge (detto chiaramente)
- **Dispositivo compromesso o sbloccato**: chi controlla il browser mentre Athenai è sbloccato vede
  quello che vede l'utente. "Ricorda su questo browser" è comodo ma più debole della passkey.
- **Frase di recupero perduta** senza altri dispositivi collegati: i dati non si recuperano.
  Nessuno, nemmeno chi gestisce Athenai, può farlo.
- **Codice dell'app servito dal server**: un server malevolo potrebbe servire JavaScript alterato
  (limite comune alle app web cifrate). Mitigazioni previste: CSP rigida, build riproducibili,
  Subresource Integrity, auto-ospitalità, in futuro un'estensione o una PWA che verifica le
  versioni.
- **Metadati**: chi collabora con chi e quando, la dimensione dei documenti.

## Collegamento di un nuovo dispositivo
Il codice (QR o testo) passa **dallo schermo**, mai dal server: contiene la chiave pubblica usa e
getta del nuovo dispositivo. Il dispositivo già sbloccato cifra la chiave principale verso quella
chiave (sealed box); il relay vede solo il messaggio cifrato. Un codice di verifica a 6 cifre,
uguale sui due schermi, conferma che si è inquadrato il dispositivo giusto. Il nuovo dispositivo
controlla che l'identità ricostruita sia quella dell'account.

Il relay è il server di Athenai (dalla P2): tiene il messaggio cifrato al massimo 10 minuti.

## Scrivere insieme (dalla P3)
- **Registro di un Tomos**: ogni modifica Yjs (e ogni tanto lo stato intero) è una busta
  XChaCha20-Poly1305 con la chiave dell'Oikos, legata (AD) a Tomos, flusso, tipo e autore, e
  **firmata** Ed25519 dall'autore. Il server verifica la firma e il ruolo prima di conservarla; i
  client la riverificano prima di aprirla. Per un ex membro vale la chiave pubblica che il server
  ricorda: il server non può comunque fabbricare voci, perché non ha la chiave dell'Oikos.
- **Ruoli**: testo e Scholia sono due flussi separati; il server accetta il testo solo da Archon e
  Polites, gli Scholia anche dal Mentore, nulla dallo Xenos. **Limite**: il controllo del ruolo
  per flusso lo fa il server; un server malevolo potrebbe accettare testo da un Mentore (che resta
  comunque firmato e riconoscibile).
- **Epoca**: le voci nuove devono usare la chiave dell'epoca attuale dell'Oikos; dopo un'uscita la
  rotazione avviene da sola e chi resta continua a scrivere con la chiave nuova (le voci vecchie si
  aprono con la catena all'indietro).
- **Limite: ordine e completezza.** Il server può trattenere, ritardare o ripresentare voci (Yjs
  le applica comunque in modo coerente, ma un server malevolo potrebbe nascondere a qualcuno una
  modifica). Mitigazione futura: orologi per autore firmati (come in secsync) per accorgersene.
- **Presenza (Symposion)**: cursori e nomi viaggiano cifrati con la chiave dell'Oikos, senza
  firma; il server li attribuisce alla connessione autenticata e non li conserva.
- **Keryx**: una notifica è una sealed box verso la chiave del destinatario con dentro la firma
  del mittente, legata al destinatario; il server sa a chi arriva e quando, e la cancella appena
  letta (al massimo dopo 30 giorni).
- **Heuresis**: la ricerca avviene nel browser sui testi decifrati, tenuti solo in memoria e
  cancellati al blocco; al server non arriva nessuna parola cercata.

## Da fare prima del lancio pubblico
- Audit indipendente (es. Radically Open Security, gratuito per i progetti NLnet).
- `security.txt`, procedura di segnalazione, build riproducibili.
