import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPool } from '../apps/api/src/database.ts';
import { loadConfig } from '../apps/api/src/config.ts';
if (existsSync('.env')) loadEnvFile('.env');
const pool = createPool(loadConfig());
const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(81726341)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const directory = fileURLToPath(
    new URL('../db/migrations/', import.meta.url),
  );
  const files = (await readdir(directory))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();
  for (const name of files) {
    const sql = await readFile(`${directory}/${name}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE name=$1',
      [name],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum)
        throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',
        [name, checksum],
      );
      await client.query('COMMIT');
      console.info(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(81726341)');
  client.release();
  await pool.end();
}
