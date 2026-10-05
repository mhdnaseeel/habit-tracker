import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { transaction } from '../apps/api/src/database.ts';
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString)
  throw new Error(
    'TEST_DATABASE_URL required: use a disposable migrated PostgreSQL database',
  );
const pool = new pg.Pool({ connectionString });
test('ownership, duplicate check-ins, active names, valid statuses and rollback are enforced by PostgreSQL', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const users = await client.query<{ id: string }>(
      "INSERT INTO users(email,password_hash,name,timezone) VALUES('a-'||gen_random_uuid()||'@example.test','not-a-real-hash','A','Asia/Kolkata'),('b-'||gen_random_uuid()||'@example.test','not-a-real-hash','B','UTC') RETURNING id",
    );
    const a = users.rows[0]?.id,
      b = users.rows[1]?.id;
    assert.ok(a && b);
    const habit = await client.query<{ id: number }>(
      'INSERT INTO habits(user_id,name,start_date) VALUES($1,$2,$3) RETURNING id',
      [a, 'Read', '2026-10-01'],
    );
    const h = habit.rows[0]?.id;
    assert.ok(h);
    const schedule = await client.query<{ id: number }>(
      'INSERT INTO habit_schedules(habit_id,user_id,effective_from,frequency) VALUES($1,$2,$3,$4) RETURNING id',
      [h, a, '2026-10-01', 'daily'],
    );
    const s = schedule.rows[0]?.id;
    assert.ok(s);
    const reject = async (sql: string, params: unknown[], code: string) => {
      await client.query('SAVEPOINT negative');
      await assert.rejects(
        client.query(sql, params),
        (e: unknown) => e instanceof Error && 'code' in e && e.code === code,
      );
      await client.query('ROLLBACK TO SAVEPOINT negative');
    };
    await reject(
      'INSERT INTO habits(user_id,name,start_date) VALUES($1,$2,$3)',
      [a, 'read', '2026-10-01'],
      '23505',
    );
    await reject(
      'INSERT INTO habit_instances(habit_id,user_id,schedule_id,date,timezone,status,value,target) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [h, b, s, '2026-10-01', 'UTC', 'completed', 1, 1],
      '23503',
    );
    await client.query(
      'INSERT INTO habit_instances(habit_id,user_id,schedule_id,date,timezone,status,value,target) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [h, a, s, '2026-10-01', 'UTC', 'completed', 1, 1],
    );
    await reject(
      'INSERT INTO habit_instances(habit_id,user_id,schedule_id,date,timezone,status,value,target) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [h, a, s, '2026-10-01', 'UTC', 'completed', 1, 1],
      '23505',
    );
    await reject(
      'INSERT INTO habit_instances(habit_id,user_id,schedule_id,date,timezone,status,value,target) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [h, a, s, '2026-10-02', 'UTC', 'completed', 0, 1],
      '23514',
    );
    await reject(
      'INSERT INTO habit_schedules(habit_id,user_id,effective_from,frequency,weekdays) VALUES($1,$2,$3,$4,$5)',
      [h, a, '2026-10-03', 'weekly', [9]],
      '23514',
    );
    await client.query(
      'INSERT INTO freeze_usage(habit_id,user_id,month,occurrence_date) VALUES($1,$2,$3,$4)',
      [h, a, '2026-10-01', '2026-10-02'],
    );
    await reject(
      'INSERT INTO freeze_usage(habit_id,user_id,month,occurrence_date) VALUES($1,$2,$3,$4)',
      [h, a, '2026-10-01', '2026-10-03'],
      '23505',
    );
    const goal = await client.query<{ id: number }>(
      'INSERT INTO goals(user_id,title,start_date) VALUES($1,$2,$3) RETURNING id',
      [b, 'Goal', '2026-10-01'],
    );
    await reject(
      'INSERT INTO goal_habits(goal_id,habit_id,user_id,linked_on) VALUES($1,$2,$3,$4)',
      [goal.rows[0]?.id, h, b, '2026-10-01'],
      '23503',
    );
    await client.query(
      'UPDATE habits SET active=false,archived_on=$2 WHERE id=$1',
      [h, '2026-10-05'],
    );
    await client.query(
      'INSERT INTO habits(user_id,name,start_date) VALUES($1,$2,$3)',
      [a, 'Read', '2026-10-05'],
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
test('transaction helper rolls back failed work', async () => {
  const email = `rollback-${crypto.randomUUID()}@example.test`;
  await assert.rejects(
    transaction(pool, async (client) => {
      await client.query(
        'INSERT INTO users(email,password_hash,name,timezone) VALUES($1,$2,$3,$4)',
        [email, 'fixture', 'Rollback', 'UTC'],
      );
      throw new Error('failure');
    }),
    /failure/,
  );
  assert.equal(
    (await pool.query('SELECT 1 FROM users WHERE email=$1', [email])).rowCount,
    0,
  );
});
test.after(async () => pool.end());
