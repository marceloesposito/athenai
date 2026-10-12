-- Schema di Athenai (versione 2). Il server conserva solo: email e chiavi pubbliche, appartenenze e
-- ruoli, date, e dati CIFRATI dal client (nomi di Polis, Symposia e documenti, profili, chiavi
-- avvolte, testi). La password non arriva mai: arriva una chiave d'accesso ricavata nel browser, di
-- cui si conserva solo l'hash. Idempotente: si applica a ogni avvio (vedi db.ts per le versioni).

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  -- sha256 della chiave d'accesso (gia' ricavata con Argon2id nel browser)
  auth_hash text not null,
  -- parametri di Argon2id e chiave principale avvolta (che il server non sa aprire)
  kdf jsonb not null,
  wrapped jsonb not null,
  sign_pk text not null unique,
  box_pk text not null,
  -- nome e preferenze, cifrati dal client
  prefs jsonb,
  -- codice di recupero facoltativo: hash della sua chiave d'accesso e chiave principale avvolta
  recovery_auth_hash text,
  recovery_wrapped jsonb,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  account_id uuid not null references accounts on delete cascade,
  expires_at timestamptz not null
);

create table if not exists polis (
  id uuid primary key,
  meta jsonb not null,
  epoch int not null default 1,
  rotation_needed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists polis_members (
  polis_id uuid not null references polis on delete cascade,
  account_id uuid not null references accounts on delete cascade,
  role text not null check (role in ('archon', 'polites')),
  profile jsonb,
  joined_at timestamptz not null default now(),
  primary key (polis_id, account_id)
);

-- chiave della Polis per membro ed epoca, cifrata verso la chiave X25519 del membro
create table if not exists polis_keys (
  polis_id uuid not null references polis on delete cascade,
  epoch int not null,
  account_id uuid not null references accounts on delete cascade,
  sealed text not null,
  primary key (polis_id, epoch, account_id)
);

-- catena all'indietro: per l'epoca e (>= 2) la chiave dell'epoca e-1 cifrata con quella di e
create table if not exists polis_key_chain (
  polis_id uuid not null references polis on delete cascade,
  epoch int not null,
  prev jsonb not null,
  primary key (polis_id, epoch)
);

create table if not exists symposia (
  id uuid primary key,
  polis_id uuid not null references polis on delete cascade,
  meta jsonb not null,
  epoch int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists symposion_keys (
  symposion_id uuid not null references symposia on delete cascade,
  epoch int not null,
  polis_epoch int not null,
  wrapped jsonb not null,
  primary key (symposion_id, epoch)
);

-- inviti nella Polis (per chi ha o crea un account): sempre come Polites
create table if not exists invites (
  id uuid primary key,
  polis_id uuid not null references polis on delete cascade,
  -- chiave della Polis cifrata con il segreto del link (che il server non vede)
  key jsonb not null,
  epoch int not null,
  expires_at timestamptz not null,
  uses_left int not null check (uses_left >= 0)
);

-- link privati per gli ospiti di un Symposion
create table if not exists guest_links (
  id uuid primary key,
  symposion_id uuid not null references symposia on delete cascade,
  mode text not null check (mode in ('edit', 'comment')),
  -- chiavi del Symposion e suo nome, cifrati con il segreto del link
  key jsonb not null,
  meta jsonb not null,
  epoch int not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ospiti: una sessione per scheda, con un nome di personaggio greco e chiavi usa e getta
create table if not exists guest_sessions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references guest_links on delete cascade,
  symposion_id uuid not null references symposia on delete cascade,
  name text not null,
  sign_pk text not null unique,
  box_pk text not null,
  token_hash text not null unique,
  expires_at timestamptz not null
);

create table if not exists documents (
  id uuid primary key,
  symposion_id uuid not null references symposia on delete cascade,
  meta jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- registro cifrato e firmato di ogni documento (Yjs: modifiche e stati interi), per flusso. Uno
-- stato intero sostituisce le voci che copre. L'autore (account o ospite) non e' una chiave esterna:
-- se se ne va, le sue modifiche restano nel documento.
create table if not exists doc_log (
  seq bigint generated always as identity primary key,
  document_id uuid not null references documents on delete cascade,
  stream text not null check (stream in ('text', 'scholia')),
  kind text not null check (kind in ('update', 'snapshot')),
  author uuid not null,
  box jsonb not null,
  sig text not null
);

-- notifiche cifrate verso la chiave del destinatario (il server sa solo a chi e quando)
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts on delete cascade,
  sealed text not null,
  created_at timestamptz not null default now()
);

create index if not exists polis_members_account on polis_members (account_id);
create index if not exists symposia_polis on symposia (polis_id);
create index if not exists sessions_expiry on sessions (expires_at);
create index if not exists guest_links_symposion on guest_links (symposion_id);
create index if not exists guest_sessions_symposion on guest_sessions (symposion_id);
create index if not exists documents_symposion on documents (symposion_id);
create index if not exists doc_log_document on doc_log (document_id, seq);
create index if not exists notices_account on notices (account_id, created_at);
