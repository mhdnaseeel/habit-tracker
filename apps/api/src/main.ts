import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { createPool } from './database.ts';
import { createApp } from './app.ts';
if (existsSync('.env')) loadEnvFile('.env');
const config = loadConfig();
if (!config.ACCESS_TOKEN_SECRET)
  throw new Error('ACCESS_TOKEN_SECRET is required');
const pool = createPool(config);
const app = await createApp(
  config,
  async () => {
    await pool.query('SELECT 1');
  },
  pool,
);
pool.on('error', () => app.log.error('Idle database connection failed'));
app.addHook('onClose', async () => {
  await pool.end();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: config.HOST, port: config.PORT });
