import pg from 'pg';
import type { Config } from './config.ts';
pg.types.setTypeParser(1082, (value) => value);
export function createPool(config: Config) {
  const url = new URL(config.DATABASE_URL);
  if (config.DB_SSL) {
    for (const parameter of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
      url.searchParams.delete(parameter);
  }
  return new pg.Pool({
    connectionString: url.toString(),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl: config.DB_SSL ? { rejectUnauthorized: true } : false,
  });
}
export async function transaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
