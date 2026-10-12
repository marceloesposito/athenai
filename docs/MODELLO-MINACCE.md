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
| Fornitore d'identità (Zitadel, Google, GitHub, Apple) | sapere che l'utente usa Athenai; impedirgli l'accesso | leggere i contenuti: l'accesso non dà le chiavi |
| Destinazioni dei backup (Drive, iCloud, WebDAV) — dalla fase P7 | vedere che esiste un archivio cifrato e la sua dimensione | aprirlo |
| Chi intercetta la rete | — (TLS, e comunque contenuti cifrati end-to-end) | leggere o alterare senza essere scoperto |
| Chi ruba il disco o i dati del browser | trovare la chiave principale avvolta | aprirla senza la passkey (impronta/volto) o senza il browser stesso (chiave non esportabile) |
| Un ex membro di un Oikos — dalla fase P2 | leggere ciò che vedeva prima di uscire | leggere ciò che si scrive dopo (rotazione della chiave dell'Oikos) |

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

In P1 il relay è locale (schede dello stesso browser); fra dispositivi diversi lo fa il server (P2).

## Da fare prima del lancio pubblico
- Audit indipendente (es. Radically Open Security, gratuito per i progetti NLnet).
- `security.txt`, procedura di segnalazione, build riproducibili.
