// Postgres (libreria `postgres`): connessione e schema.
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';

export type Sql = postgres.Sql;

export function connect(url: string): Sql {
  return postgres(url, { max: 10, idle_timeout: 30, onnotice: () => undefined });
}

export async function migrate(sql: Sql): Promise<void> {
  const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await sql.unsafe(schema);
}
