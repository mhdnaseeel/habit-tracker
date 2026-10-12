import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPool } from '../apps/api/src/database.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { runMigrations } from '../apps/api/src/migrate.ts';

if (existsSync('.env')) loadEnvFile('.env');
const pool = createPool(loadConfig());
try {
  await runMigrations(pool);
} finally {
  await pool.end();
}
