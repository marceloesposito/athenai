# Modello delle minacce

Priorità del progetto, nell'ordine: **proprietà dei dati, privacy, sicurezza**. Questo documento
dice cosa Athenai protegge, da chi, e cosa no. Si aggiorna nello stesso commit in cui cambia
qualcosa di rilevante. Ultima revisione: riprogettazione R1 (12 ottobre 2026).

## Cosa si protegge
- **Contenuti**: documenti, commenti (Scholia), titoli, nomi di Polis e Symposia, profili, e in
  futuro la board (Agorà) e i file. Cifrati nel browser (XChaCha20-Poly1305); il server conserva e
  inoltra solo dati cifrati.
- **Chiavi dell'utente**: una chiave principale casuale (32 byte) da cui nascono l'identità X25519
  (per ricevere chiavi) ed Ed25519 (per firmare). Esiste in chiaro solo in memoria mentre l'utente è
  dentro.

## Account con email e password (modello Bitwarden/Proton)
- Nel browser: Argon2id(password, sale; 3 passaggi, 64 MiB) → 64 byte. I primi 32 sono la **chiave
  d'accesso**, che va al server; il server ne salva solo lo **sha256** (è già ad alta entropia: chi
  ruba il database deve comunque rifare Argon2id per ogni tentativo di password). Gli altri 32
  **avvolgono la chiave principale** e non lasciano mai il browser.
- Il server non vede mai la password né la chiave principale. Restituisce i parametri di Argon2id
  anche per le email sconosciute (finti ma stabili, HMAC con un segreto del server), risponde allo
  stesso modo a email sconosciuta e password sbagliata, e limita i tentativi per email.
- **Codice di recupero** facoltativo: 120 bit casuali, 24 caratteri. Avvolge anche lui la chiave
  principale; il server ne conserva l'hash della chiave d'accesso. Senza password e senza codice la
  chiave principale non si riapre: è il prezzo della cifratura end-to-end, detto all'utente alla
  registrazione.
- **Cambio password**: la chiave principale si riavvolge (non cambia), le altre sessioni si chiudono.
- **"Resta connesso"** (proposto acceso): la chiave principale avvolta da una chiave WebCrypto non
  esportabile, in IndexedDB; al ritorno si firma una sfida del server con la chiave Ed25519. È
  l'unica cosa che Athenai salva nel browser.
- **Limite**: chi sceglie una password debole la espone ad attacchi offline se il database viene
  rubato (Argon2id li rallenta, non li impedisce). L'interfaccia chiede almeno 10 caratteri e
  mostra la robustezza.

## Ospiti (Xenoi) con un link privato
- Il link porta nel **frammento** (dopo `#`, che il browser non manda al server) il segreto che apre
  le chiavi del Symposion e il suo nome. Il server vede solo l'id del link.
- Chi lo apre genera nella scheda chiavi usa e getta (tenute in `sessionStorage`, cancellate alla
  chiusura della scheda), riceve una sessione legata a quel Symposion e un nome di personaggio
  greco scelto dal server. Con "può commentare" il server accetta solo commenti.
- Un ospite non legge i profili della Polis: vede i nomi dei membri solo dai cursori e dai commenti.
- **Revoca**: il link smette subito di valere, le connessioni degli ospiti si chiudono e la chiave
  del Symposion va ruotata (la conoscevano): lo fa da sé il primo Archon che apre la Polis. Anche
  l'uscita di un membro invalida tutti i link della Polis.
- Le sessioni degli ospiti restano nel database, senza validità, come **registro degli autori**: la
  loro chiave pubblica serve a verificare quello che hanno scritto.
- **Limite**: chi riceve il link (anche per errore) entra finché il link vale; per questo ha una
  scadenza, si vede chi è presente e si revoca con un clic.

## Da chi
| Avversario | Cosa può fare | Cosa non può fare |
|---|---|---|
| Chi gestisce i server di Athenai (o chi li compromette) | vedere metadati: email, appartenenze, chi scrive dove e quando, dimensioni; tentare password deboli offline; negare il servizio | leggere i contenuti; avere la password o la chiave principale; fabbricare modifiche (non ha le chiavi dei Symposia) |
| Chi riceve (o intercetta) un invito nella Polis | entrare come Polites finché l'invito vale (una volta, 3 giorni) | — : va mandato per un canale fidato; l'Archon vede chi entra e può allontanarlo (la chiave ruota) |
| Chi riceve un link per ospiti | entrare nel solo Symposion del link, con quello che il link permette | entrare nella Polis o in altri Symposia; restare dopo la revoca |
| Chi intercetta la rete | — (TLS, e comunque contenuti cifrati end-to-end) | leggere o alterare senza essere scoperto |
| Chi ruba i dati del browser | con "resta connesso", trovare la chiave principale avvolta | aprirla fuori da quel browser (chiave non esportabile) |
| Un ex membro | leggere ciò che vedeva prima di uscire | leggere ciò che si scrive dopo (rotazione); ricevere ancora le modifiche (il server lo stacca subito) |
| Un membro o un ospite | scrivere ciò che il suo ruolo permette; mettere un nome falso nel proprio cursore | attribuire ad altri una modifica o un commento (ogni voce è firmata); mandare notifiche a nome di altri |

## Cosa sa il server
Email, chiavi pubbliche, hash delle chiavi d'accesso, chi è membro di quale Polis e con che ruolo,
quanti Symposia e documenti ci sono, chi modifica quale documento e quando (autore, orario,
dimensione), chi è connesso in quel momento, gli ospiti (nome di fantasia, link, scadenza) e a chi
arriva una notifica. Non sa nomi di Polis, Symposia, documenti e persone (cifrati), né testi,
commenti, cursori o parole cercate.

## Scrivere insieme
- **Registro di un documento**: ogni modifica Yjs (e ogni tanto lo stato intero) è una busta con la
  chiave del Symposion, legata (AD) a documento, flusso, tipo e autore, e **firmata** Ed25519
  dall'autore. Il server verifica firma, ruolo ed epoca prima di conservarla; i client la
  riverificano prima di aprirla.
- **Ruoli**: testo e commenti sono due flussi separati; il server accetta il testo solo da Archon,
  Politai e ospiti con "può modificare". **Limite**: questo controllo lo fa il server.
- **Epoca**: dopo un'uscita o una revoca la chiave ruota e si scrive con quella nuova; le voci
  vecchie si aprono con la catena all'indietro.
- **Limite: ordine e completezza.** Il server può trattenere o ripresentare voci (Yjs le applica in
  modo coerente, ma un server malevolo potrebbe nascondere a qualcuno una modifica). Mitigazione
  futura: orologi per autore firmati, come in secsync.
- **Presenza**: cursori e nomi cifrati con la chiave del Symposion, senza firma, mai salvati.
- **Notifiche**: sealed box verso il destinatario con la firma del mittente; cancellate appena lette
  (al massimo dopo 30 giorni).
- **Ricerca**: nel browser, sui testi decifrati tenuti solo in memoria.

## Nessun fornitore americano
Per scelta del committente nessun servizio americano dentro l'app (niente accesso con Google,
GitHub o Apple, niente Drive o iCloud). Il codice si sviluppa su GitHub, ma l'app non lo usa mai.
Resta da sorvegliare il registro npm (dipendenze verificate dal lockfile).

## Cosa *non* si protegge (detto chiaramente)
- **Dispositivo compromesso** o lasciato aperto: chi controlla il browser vede quello che vede
  l'utente.
- **Password e codice di recupero perduti**: i testi cifrati non si recuperano. Nessuno, nemmeno chi
  gestisce Athenai, può farlo. Gli altri membri di una Polis possono però invitare di nuovo il nuovo
  account.
- **Codice dell'app servito dal server**: un server malevolo potrebbe servire JavaScript alterato
  (limite comune alle app web cifrate). Mitigazioni: CSP rigida, build riproducibili, Subresource
  Integrity, auto-ospitalità; in futuro una PWA o un'estensione che verifica le versioni.
- **Metadati**: chi collabora con chi e quando, la dimensione dei documenti.

## Da fare prima del lancio pubblico
- Audit indipendente (es. Radically Open Security, gratuito per i progetti NLnet).
- `security.txt`, procedura di segnalazione, build riproducibili.
- Verifica dell'email (servizio europeo, da decidere) e limite ai tentativi anche per indirizzo IP.
