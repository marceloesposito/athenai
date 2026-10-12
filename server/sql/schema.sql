-- Schema di Athenai. Il server conserva solo: chiavi pubbliche, appartenenze e ruoli, date, e dati
-- CIFRATI dal client (nomi delle Polis e degli Oikos, profili, chiavi avvolte). Nessun contenuto in
-- chiaro, nessuna email. Idempotente: si applica a ogni avvio.

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  sign_pk text not null unique,
  box_pk text not null,
  -- a chi appartiene l'account: 'oidc:<sub>' (Zitadel) o 'trial:<id>' (solo server di prova)
  binding text not null unique,
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
  role text not null check (role in ('archon', 'polites', 'mentore', 'xenos')),
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

create table if not exists oikos (
  id uuid primary key,
  polis_id uuid not null references polis on delete cascade,
  meta jsonb not null,
  epoch int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists oikos_keys (
  oikos_id uuid not null references oikos on delete cascade,
  epoch int not null,
  polis_epoch int not null,
  wrapped jsonb not null,
  primary key (oikos_id, epoch)
);

create table if not exists invites (
  id uuid primary key,
  polis_id uuid not null references polis on delete cascade,
  role text not null check (role in ('polites', 'mentore', 'xenos')),
  -- chiave della Polis cifrata con il segreto del link (che il server non vede)
  key jsonb not null,
  epoch int not null,
  expires_at timestamptz not null,
  uses_left int not null check (uses_left >= 0)
);

-- passkey dell'utente: la chiave principale avvolta (non apribile dal server) per sbloccare da
-- qualunque dispositivo senza salvare nulla nel browser
create table if not exists account_passkeys (
  account_id uuid not null references accounts on delete cascade,
  credential_id text not null,
  salt text not null,
  wrapped jsonb not null,
  created_at timestamptz not null default now(),
  primary key (account_id, credential_id)
);

-- preferenze (tema, lingua): cifrate dal client
alter table accounts add column if not exists prefs jsonb;

create index if not exists polis_members_account on polis_members (account_id);
create index if not exists oikos_polis on oikos (polis_id);
create index if not exists sessions_expiry on sessions (expires_at);
