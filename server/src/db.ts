// Postgres (libreria `postgres`): connessione e schema.
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';

export type Sql = postgres.Sql;

export const SCHEMA_VERSION = 2;

export function connect(url: string): Sql {
  return postgres(url, { max: 10, idle_timeout: 30, onnotice: () => undefined });
}

/** Tabelle della versione 1 (P1-P3), sostituite dalla 2. Nessun dato di produzione da portare. */
const V1_TABLES = ['account_passkeys', 'keryx', 'tomos_log', 'tomos', 'oikos_keys', 'oikos', 'invites', 'polis_key_chain', 'polis_keys', 'polis_members', 'polis', 'sessions', 'accounts'];

export async function migrate(sql: Sql): Promise<void> {
  await sql`create table if not exists schema_version (v int not null)`;
  const [row] = await sql<{ v: number }[]>`select v from schema_version`;
  if (!row || row.v < SCHEMA_VERSION) {
    // un database di sviluppo della versione 1: si riparte puliti
    const [old] = await sql`select 1 from information_schema.columns where table_name = 'accounts' and column_name = 'binding'`;
    if (old) for (const t of V1_TABLES) await sql.unsafe(`drop table if exists ${t} cascade`);
    await sql`delete from schema_version`;
    await sql`insert into schema_version (v) values (${SCHEMA_VERSION})`;
  }
  const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await sql.unsafe(schema);
}
