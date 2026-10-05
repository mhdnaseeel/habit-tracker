import { z } from 'zod';
export const configSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    WEB_ORIGIN: z.url().default('http://127.0.0.1:5173'),
    DATABASE_URL: z
      .url()
      .refine(
        (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
        'PostgreSQL URL required',
      ),
    ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
    DB_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((v, ctx) => {
    if (
      v.NODE_ENV === 'production' &&
      (!v.DB_SSL ||
        !v.WEB_ORIGIN.startsWith('https://') ||
        !v.ACCESS_TOKEN_SECRET)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Production requires verified DB TLS, HTTPS web origin and access-token secret',
      });
  });
export type Config = z.infer<typeof configSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  return result.data;
}
