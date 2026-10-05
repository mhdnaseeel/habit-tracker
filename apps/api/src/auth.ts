import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Config } from './config.ts';
import { transaction } from './database.ts';
import { timezoneSchema } from '../../../packages/contracts/src/index.ts';

const signupSchema = z
  .object({
    email: z
      .email()
      .max(255)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(128),
    name: z.string().trim().min(1).max(100),
    timezone: timezoneSchema,
  })
  .strict();
const loginSchema = z
  .object({
    email: z.email().transform((v) => v.toLowerCase()),
    password: z.string().min(1),
  })
  .strict();
const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: timezoneSchema.optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine(
    (v) => v.name !== undefined || v.timezone !== undefined,
    'Nothing to update',
  );
const uuid = z.uuid();
interface UserRow {
  id: string;
  email: string;
  name: string;
  timezone: string;
  role: 'user' | 'admin';
  version: number;
  password_hash: string;
}
interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  refresh_hash: string;
  revoked_at: Date | null;
  expires_at: Date;
  device_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
}
function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
    role: user.role,
    version: user.version,
  };
}
function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function refreshToken() {
  return randomBytes(48).toString('base64url');
}
function cookieName(config: Config) {
  return config.NODE_ENV === 'production'
    ? '__Host-habit-refresh'
    : 'habit-refresh';
}
function setRefresh(reply: FastifyReply, config: Config, token: string) {
  const parts = [
    `${cookieName(config)}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    `Path=${config.NODE_ENV === 'production' ? '/' : '/api/v1'}`,
    'Max-Age=2592000',
  ];
  if (config.NODE_ENV === 'production') parts.push('Secure');
  reply.header('Set-Cookie', parts.join('; '));
}
function clearRefresh(reply: FastifyReply, config: Config) {
  const parts = [
    `${cookieName(config)}=`,
    'HttpOnly',
    'SameSite=Strict',
    `Path=${config.NODE_ENV === 'production' ? '/' : '/api/v1'}`,
    'Max-Age=0',
  ];
  if (config.NODE_ENV === 'production') parts.push('Secure');
  reply.header('Set-Cookie', parts.join('; '));
}
function readRefresh(
  request: FastifyRequest,
  config: Config,
): string | undefined {
  const cookies = request.headers.cookie?.split(';') ?? [];
  const prefix = `${cookieName(config)}=`;
  const value = cookies
    .map((v) => v.trim())
    .find((v) => v.startsWith(prefix))
    ?.slice(prefix.length);
  return value && /^[A-Za-z0-9_-]{64}$/.test(value) ? value : undefined;
}
function error(
  reply: FastifyReply,
  request: FastifyRequest,
  code: number,
  message: string,
) {
  return reply
    .code(code)
    .send({ success: false, error: { code, message, requestId: request.id } });
}
function parse<T>(
  schema: z.ZodType<T>,
  body: unknown,
  reply: FastifyReply,
  request: FastifyRequest,
): T | undefined {
  const result = schema.safeParse(body);
  if (!result.success) {
    error(reply, request, 400, 'Validation failed');
    return undefined;
  }
  return result.data;
}
function trustedOrigin(
  request: FastifyRequest,
  config: Config,
  reply: FastifyReply,
) {
  if (request.headers.origin !== config.WEB_ORIGIN) {
    error(reply, request, 403, 'Origin not allowed');
    return false;
  }
  return true;
}
async function issueAccess(
  secret: Uint8Array,
  user: UserRow,
  sessionId: string,
) {
  return new SignJWT({ role: user.role, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer('habit-tracker')
    .setAudience('habit-tracker-web')
    .sign(secret);
}
export interface Principal {
  userId: string;
  sessionId: string;
  role: 'user' | 'admin';
}
export function authHeaders(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ')) return undefined;
  return value.slice(7);
}
export async function registerAuth(
  app: FastifyInstance,
  pool: pg.Pool,
  config: Config,
) {
  if (!config.ACCESS_TOKEN_SECRET)
    throw new Error('ACCESS_TOKEN_SECRET required for authentication');
  const secret = new TextEncoder().encode(config.ACCESS_TOKEN_SECRET);
  const authLimit = {
    config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
  };
  const refreshLimit = {
    config: { rateLimit: { max: 120, timeWindow: '15 minutes' } },
  };
  async function principal(
    request: FastifyRequest,
  ): Promise<Principal | undefined> {
    const token = authHeaders(request);
    if (!token) return;
    try {
      const verified = await jwtVerify(token, secret, {
        issuer: 'habit-tracker',
        audience: 'habit-tracker-web',
        algorithms: ['HS256'],
      });
      const id = uuid.safeParse(verified.payload.sub);
      const sid = uuid.safeParse(verified.payload.sid);
      if (!id.success || !sid.success) return;
      const session = await pool.query<{
        user_id: string;
        role: 'user' | 'admin';
      }>(
        `SELECT s.user_id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now()`,
        [sid.data, id.data],
      );
      const row = session.rows[0];
      if (!row) return;
      return { userId: row.user_id, sessionId: sid.data, role: row.role };
    } catch {
      return undefined;
    }
  }
  async function requirePrincipal(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const found = await principal(request);
    if (!found) error(reply, request, 401, 'Authentication required');
    return found;
  }
  async function createSession(
    client: pg.Pool | pg.PoolClient,
    user: UserRow,
    request: FastifyRequest,
  ) {
    const token = refreshToken();
    const family = randomUUID();
    const deviceId = z
      .string()
      .max(255)
      .safeParse(request.headers['x-device-id']);
    const result = await client.query<{ id: string }>(
      `INSERT INTO sessions(user_id,refresh_hash,family_id,device_id,ip_address,user_agent,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days') RETURNING id`,
      [
        user.id,
        hash(token),
        family,
        deviceId.success ? deviceId.data : null,
        request.ip,
        request.headers['user-agent'] ?? null,
      ],
    );
    const sid = result.rows[0]?.id;
    if (!sid) throw new Error('Session insert failed');
    return { token, sid };
  }
  async function sessionResponse(
    user: UserRow,
    session: { token: string; sid: string },
    reply: FastifyReply,
  ) {
    const { token, sid } = session;
    setRefresh(reply, config, token);
    return {
      user: publicUser(user),
      token: {
        accessToken: await issueAccess(secret, user, sid),
        expiresIn: 900,
      },
    };
  }
  async function newSession(
    user: UserRow,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    return sessionResponse(
      user,
      await createSession(pool, user, request),
      reply,
    );
  }
  app.post(
    '/api/v1/signup',
    {
      ...authLimit,
      schema: {
        tags: ['Auth'],
        summary: 'Create an account and session',
        body: {
          type: 'object',
          required: ['email', 'password', 'name', 'timezone'],
          additionalProperties: false,
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
            name: { type: 'string' },
            timezone: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      if (!trustedOrigin(request, config, reply)) return;
      const input = parse(signupSchema, request.body, reply, request);
      if (!input) return;
      const passwordHash = await argon2.hash(input.password, {
        type: argon2.argon2id,
      });
      let created: { user: UserRow; session: { token: string; sid: string } };
      try {
        created = await transaction(pool, async (client) => {
          const inserted = await client.query<UserRow>(
            `INSERT INTO users(email,password_hash,name,timezone) VALUES($1,$2,$3,$4) RETURNING *`,
            [input.email, passwordHash, input.name, input.timezone],
          );
          const row = inserted.rows[0];
          if (!row) throw new Error('User insert failed');
          await client.query(`INSERT INTO settings(user_id) VALUES($1)`, [
            row.id,
          ]);
          const session = await createSession(client, row, request);
          return { user: row, session };
        });
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === '23505')
          return error(reply, request, 409, 'Account already exists');
        throw cause;
      }
      return reply
        .code(201)
        .send(await sessionResponse(created.user, created.session, reply));
    },
  );
  app.post(
    '/api/v1/login',
    {
      ...authLimit,
      schema: { tags: ['Auth'], summary: 'Sign in with email and password' },
    },
    async (request, reply) => {
      if (!trustedOrigin(request, config, reply)) return;
      const input = parse(loginSchema, request.body, reply, request);
      if (!input) return;
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE lower(email)=lower($1)`,
        [input.email],
      );
      const user = result.rows[0];
      if (!user) {
        await argon2.hash(input.password, { type: argon2.argon2id });
        return error(reply, request, 401, 'Invalid email or password');
      }
      if (!(await argon2.verify(user.password_hash, input.password)))
        return error(reply, request, 401, 'Invalid email or password');
      return newSession(user, request, reply);
    },
  );
  app.get(
    '/api/v1/session',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Check for a refresh cookie without rotating it',
      },
    },
    async (request) => ({ hasSession: Boolean(readRefresh(request, config)) }),
  );
  app.post(
    '/api/v1/refresh',
    {
      ...refreshLimit,
      schema: { tags: ['Auth'], summary: 'Rotate refresh session' },
    },
    async (request, reply) => {
      if (!trustedOrigin(request, config, reply)) return;
      const token = readRefresh(request, config);
      if (!token) return error(reply, request, 401, 'Session required');
      const next = refreshToken();
      const outcome = await transaction(pool, async (client) => {
        const found = await client.query<SessionRow>(
          `SELECT * FROM sessions WHERE refresh_hash=$1 FOR UPDATE`,
          [hash(token)],
        );
        const old = found.rows[0];
        if (!old) return { kind: 'invalid' as const };
        if (old.revoked_at) {
          await client.query(
            `UPDATE sessions SET revoked_at=now() WHERE family_id=$1 AND revoked_at IS NULL`,
            [old.family_id],
          );
          return { kind: 'replayed' as const };
        }
        if (old.expires_at <= new Date()) return { kind: 'expired' as const };
        const userResult = await client.query<UserRow>(
          `SELECT * FROM users WHERE id=$1`,
          [old.user_id],
        );
        const user = userResult.rows[0];
        if (!user) return { kind: 'invalid' as const };
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO sessions(user_id,refresh_hash,family_id,device_id,ip_address,user_agent,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days') RETURNING id`,
          [
            old.user_id,
            hash(next),
            old.family_id,
            old.device_id,
            request.ip,
            request.headers['user-agent'] ?? old.user_agent,
          ],
        );
        const sid = inserted.rows[0]?.id;
        if (!sid) throw new Error('Session insert failed');
        await client.query(
          `UPDATE sessions SET revoked_at=now(),replaced_by=$1 WHERE id=$2`,
          [sid, old.id],
        );
        return { kind: 'ok' as const, user, sid };
      });
      if (outcome.kind !== 'ok') {
        clearRefresh(reply, config);
        return error(reply, request, 401, 'Session expired');
      }
      setRefresh(reply, config, next);
      return {
        user: publicUser(outcome.user),
        token: {
          accessToken: await issueAccess(secret, outcome.user, outcome.sid),
          expiresIn: 900,
        },
      };
    },
  );
  app.post(
    '/api/v1/logout',
    { schema: { tags: ['Auth'], summary: 'Revoke current session' } },
    async (request, reply) => {
      if (!trustedOrigin(request, config, reply)) return;
      const found = await requirePrincipal(request, reply);
      if (!found) return;
      await pool.query(
        `UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2`,
        [found.sessionId, found.userId],
      );
      clearRefresh(reply, config);
      return reply.code(204).send();
    },
  );
  app.post(
    '/api/v1/logout-all',
    { schema: { tags: ['Auth'], summary: 'Revoke all account sessions' } },
    async (request, reply) => {
      if (!trustedOrigin(request, config, reply)) return;
      const found = await requirePrincipal(request, reply);
      if (!found) return;
      await pool.query(
        `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
        [found.userId],
      );
      clearRefresh(reply, config);
      return reply.code(204).send();
    },
  );
  app.get(
    '/api/v1/user',
    { schema: { tags: ['User'], summary: 'Read current profile' } },
    async (request, reply) => {
      const found = await requirePrincipal(request, reply);
      if (!found) return;
      const user = await pool.query<UserRow>(
        `SELECT id,email,name,timezone,role,version FROM users WHERE id=$1`,
        [found.userId],
      );
      const row = user.rows[0];
      if (!row) return error(reply, request, 401, 'Authentication required');
      return { user: publicUser(row) };
    },
  );
  app.put(
    '/api/v1/user',
    {
      schema: { tags: ['User'], summary: 'Update profile with version check' },
    },
    async (request, reply) => {
      if (!trustedOrigin(request, config, reply)) return;
      const found = await requirePrincipal(request, reply);
      if (!found) return;
      const input = parse(profileSchema, request.body, reply, request);
      if (!input) return;
      const updated = await pool.query<UserRow>(
        `UPDATE users SET name=coalesce($1,name),timezone=coalesce($2,timezone),version=version+1,updated_at=now() WHERE id=$3 AND version=$4 RETURNING id,email,name,timezone,role,version`,
        [
          input.name ?? null,
          input.timezone ?? null,
          found.userId,
          input.version,
        ],
      );
      const row = updated.rows[0];
      if (!row)
        return error(reply, request, 409, 'Profile changed on another device');
      return { user: publicUser(row) };
    },
  );
  return { requirePrincipal };
}
