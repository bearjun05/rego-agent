import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (_db) return _db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  _client = postgres(url, {
    max: 10,
    idle_timeout: 30,
    prepare: false, // Railway pgbouncer compat
  });

  _db = drizzle(_client, { schema });
  return _db;
}

export async function closeDb() {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _db = null;
  }
}

export { schema };
export type Db = ReturnType<typeof getDb>;
