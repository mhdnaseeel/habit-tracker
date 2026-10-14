import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Activity integration tests only run against a local server');
const origin = new URL(base).origin;
const date = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const tomorrow = new Date(`${date}T12:00:00Z`);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const nextDate = tomorrow.toISOString().slice(0, 10);

async function call(token, path, method = 'GET', body) {
  const response = await globalThis.fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = response.status === 204 ? null : await response.json();
  return { status: response.status, value };
}
async function account() {
  const password = `Qa-${randomUUID()}-password`;
  const result = await call(null, '/api/v1/signup', 'POST', {
    email: `qa-${randomUUID()}@example.test`,
    name: 'Activity QA',
    password,
    timezone: 'Asia/Kolkata',
  });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  return { token: result.value.token.accessToken, password };
}
async function good(token, path, method = 'GET', body, status = 200) {
  const response = await call(token, path, method, body);
  assert.equal(response.status, status, JSON.stringify(response.value));
  return response.value;
}
test('Today activities reuse task and habit records without duplicate progress', async () => {
  const first = await account();
  const second = await account();
  try {
    const activityBody = (title, startTime, endTime) => ({
      title,
      description: null,
      activityType: 'appointment',
      scheduledDate: date,
      startTime,
      endTime,
      priority: 3,
      reminderTime: null,
      notes: null,
      linkedTaskId: null,
      linkedHabitId: null,
      linkedGoalId: null,
    });
    const early = (
      await good(
        first.token,
        '/api/v1/activities',
        'POST',
        activityBody('Early appointment', '09:00', '10:00'),
        201,
      )
    ).activity;
    const overlap = (
      await good(
        first.token,
        '/api/v1/activities',
        'POST',
        activityBody('Overlapping appointment', '09:30', '10:30'),
        201,
      )
    ).activity;
    const flexible = (
      await good(
        first.token,
        '/api/v1/activities',
        'POST',
        activityBody('Flexible appointment', null, null),
        201,
      )
    ).activity;
    const list = await good(first.token, `/api/v1/activities?date=${date}`);
    assert.deepEqual(
      list.activities.map((item) => item.id),
      [early.id, overlap.id, flexible.id],
    );
    assert.equal(
      (await call(second.token, `/api/v1/activities/${early.id}`)).status,
      404,
    );
    assert.equal(
      (
        await call(
          first.token,
          '/api/v1/activities',
          'POST',
          activityBody('Bad time', '11:00', '10:00'),
        )
      ).status,
      400,
    );
    assert.equal(
      (await call(null, `/api/v1/activities?date=${date}`)).status,
      401,
    );

    const [editA, editB] = await Promise.all([
      call(first.token, `/api/v1/activities/${early.id}`, 'PATCH', {
        title: 'Edited A',
        version: early.version,
      }),
      call(first.token, `/api/v1/activities/${early.id}`, 'PATCH', {
        title: 'Edited B',
        version: early.version,
      }),
    ]);
    assert.deepEqual([editA.status, editB.status].sort(), [200, 409]);
    let current = (await good(first.token, `/api/v1/activities/${early.id}`))
      .activity;
    await good(
      first.token,
      `/api/v1/activities/${early.id}/reschedule`,
      'POST',
      {
        version: current.version,
        scheduledDate: nextDate,
        startTime: '12:00',
        endTime: '12:30',
      },
    );
    assert.equal(
      (
        await call(
          first.token,
          `/api/v1/activities/${early.id}/complete`,
          'POST',
        )
      ).status,
      400,
    );
    current = (await good(first.token, `/api/v1/activities/${early.id}`))
      .activity;
    await good(
      first.token,
      `/api/v1/activities/${early.id}`,
      'DELETE',
      { version: current.version },
      204,
    );
    assert.equal(
      (await call(first.token, `/api/v1/activities/${early.id}`)).status,
      404,
    );

    await good(
      first.token,
      `/api/v1/activities/${overlap.id}/complete`,
      'POST',
    );
    await good(
      first.token,
      `/api/v1/activities/${overlap.id}/complete`,
      'POST',
    );
    assert.equal(
      (await good(first.token, `/api/v1/activities/${overlap.id}`)).activity
        .status,
      'completed',
    );
    await good(first.token, `/api/v1/activities/${overlap.id}/undo`, 'POST');
    await good(first.token, `/api/v1/activities/${overlap.id}/skip`, 'POST');
    assert.equal(
      (
        await call(
          first.token,
          `/api/v1/activities/${overlap.id}/complete`,
          'POST',
        )
      ).status,
      409,
    );
    await good(first.token, `/api/v1/activities/${overlap.id}/undo`, 'POST');

    const taskActivity = (
      await good(
        first.token,
        '/api/v1/activities',
        'POST',
        {
          title: 'Linked task',
          description: null,
          activityType: 'task',
          scheduledDate: date,
          startTime: '11:00',
          endTime: '11:30',
          priority: 2,
          reminderTime: null,
          notes: null,
          linkedTaskId: null,
          linkedHabitId: null,
          linkedGoalId: null,
        },
        201,
      )
    ).activity;
    assert.ok(taskActivity.linkedTaskId);
    const taskList = await good(
      first.token,
      `/api/v1/tasks?from=${date}&to=${date}`,
    );
    assert.equal(
      taskList.tasks.filter((task) => task.id === taskActivity.linkedTaskId)
        .length,
      1,
    );
    await good(
      first.token,
      `/api/v1/tasks/${taskActivity.linkedTaskId}/complete`,
      'POST',
    );
    assert.equal(
      (await good(first.token, `/api/v1/activities/${taskActivity.id}`))
        .activity.status,
      'completed',
    );
    await good(
      first.token,
      `/api/v1/tasks/${taskActivity.linkedTaskId}/undo`,
      'POST',
    );
    assert.equal(
      (await good(first.token, `/api/v1/activities/${taskActivity.id}`))
        .activity.status,
      'planned',
    );
    const taskVersion = (
      await good(first.token, `/api/v1/tasks?from=${date}&to=${date}`)
    ).tasks.find((task) => task.id === taskActivity.linkedTaskId).version;
    await good(
      first.token,
      `/api/v1/tasks/${taskActivity.linkedTaskId}`,
      'PUT',
      {
        dueDate: nextDate,
        version: taskVersion,
      },
    );
    assert.equal(
      (await good(first.token, `/api/v1/activities/${taskActivity.id}`))
        .activity.scheduledDate,
      nextDate,
    );
    await good(
      first.token,
      `/api/v1/tasks/${taskActivity.linkedTaskId}`,
      'DELETE',
      undefined,
      204,
    );
    assert.equal(
      (await call(first.token, `/api/v1/activities/${taskActivity.id}`)).status,
      404,
    );

    const habit = (
      await good(
        first.token,
        '/api/v1/habits',
        'POST',
        {
          name: 'Linked habit',
          category: 'Wellbeing',
          schedule: { frequency: 'daily' },
          target: 1,
          startDate: date,
        },
        201,
      )
    ).habit;
    const habitActivity = (
      await good(
        first.token,
        '/api/v1/activities',
        'POST',
        {
          title: habit.name,
          description: null,
          activityType: 'habit',
          scheduledDate: date,
          startTime: '08:00',
          endTime: '08:15',
          priority: 3,
          reminderTime: null,
          notes: null,
          linkedTaskId: null,
          linkedHabitId: habit.id,
          linkedGoalId: null,
        },
        201,
      )
    ).activity;
    assert.equal(
      (
        await call(first.token, '/api/v1/activities', 'POST', {
          title: habit.name,
          activityType: 'habit',
          scheduledDate: date,
          startTime: null,
          endTime: null,
          linkedHabitId: habit.id,
        })
      ).status,
      409,
    );
    await good(first.token, `/api/v1/habits/${habit.id}/complete`, 'POST', {
      date,
    });
    await good(first.token, `/api/v1/habits/${habit.id}/complete`, 'POST', {
      date,
    });
    assert.equal(
      (await good(first.token, `/api/v1/activities/${habitActivity.id}`))
        .activity.status,
      'completed',
    );

    const measured = (
      await good(
        first.token,
        '/api/v1/habits',
        'POST',
        {
          name: 'Three glasses of water',
          category: 'Wellbeing',
          schedule: { frequency: 'daily' },
          target: 3,
          startDate: date,
        },
        201,
      )
    ).habit;
    const measuredBlock = (
      await good(
        first.token,
        '/api/v1/activities',
        'POST',
        {
          title: measured.name,
          activityType: 'habit',
          scheduledDate: date,
          startTime: null,
          endTime: null,
          linkedHabitId: measured.id,
        },
        201,
      )
    ).activity;
    assert.equal(measuredBlock.habitTarget, 3);
    const firstMutation = randomUUID();
    await good(first.token, `/api/v1/habits/${measured.id}/complete`, 'POST', {
      date,
      value: 1,
      mutationId: firstMutation,
    });
    await good(first.token, `/api/v1/habits/${measured.id}/complete`, 'POST', {
      date,
      value: 1,
      mutationId: firstMutation,
    });
    assert.equal(
      (await good(first.token, `/api/v1/activities/${measuredBlock.id}`))
        .activity.habitValue,
      1,
    );
    assert.equal(
      (await good(first.token, `/api/v1/activities/${measuredBlock.id}`))
        .activity.status,
      'partial',
    );
    for (let i = 0; i < 2; i++)
      await good(
        first.token,
        `/api/v1/habits/${measured.id}/complete`,
        'POST',
        {
          date,
          value: 1,
          mutationId: randomUUID(),
        },
      );
    assert.equal(
      (await good(first.token, `/api/v1/activities/${measuredBlock.id}`))
        .activity.status,
      'completed',
    );
    const history = await good(
      first.token,
      `/api/v1/history?from=${date}&to=${date}`,
    );
    assert.equal(
      history.habits.find((entry) => entry.id === habit.id).days[0].status,
      'completed',
    );
    const today = await good(first.token, '/api/v1/today');
    assert.equal(
      today.habits.find((entry) => entry.id === habit.id).streak.current,
      1,
    );
    const futureHabitActivity = (
      await good(
        first.token,
        '/api/v1/activities',
        'POST',
        {
          title: habit.name,
          activityType: 'habit',
          scheduledDate: nextDate,
          startTime: '08:00',
          endTime: '08:15',
          linkedHabitId: habit.id,
        },
        201,
      )
    ).activity;
    await good(
      first.token,
      `/api/v1/habits/${habit.id}`,
      'DELETE',
      undefined,
      204,
    );
    assert.equal(
      (await call(first.token, `/api/v1/activities/${futureHabitActivity.id}`))
        .status,
      404,
    );
    assert.equal(
      (await good(first.token, `/api/v1/activities/${habitActivity.id}`))
        .activity.status,
      'completed',
    );

    const goal = (
      await good(
        first.token,
        '/api/v1/goals',
        'POST',
        {
          title: 'Keep learning',
          description: '',
          category: 'Learning',
          deadline: null,
        },
        201,
      )
    ).goal;
    const goalAction = (
      await good(
        first.token,
        '/api/v1/activities',
        'POST',
        {
          title: 'Read a chapter',
          activityType: 'goal_action',
          scheduledDate: date,
          startTime: null,
          endTime: null,
          linkedGoalId: goal.id,
        },
        201,
      )
    ).activity;
    await good(
      first.token,
      `/api/v1/activities/${goalAction.id}/complete`,
      'POST',
    );
    const goalAfter = (await good(first.token, '/api/v1/goals')).goals.find(
      (entry) => entry.id === goal.id,
    );
    assert.deepEqual(goalAfter.progress, goal.progress);
    const exported = await good(first.token, '/api/v1/account/export');
    assert.ok(
      exported.dailyActivities.some((entry) => entry.id === goalAction.id),
    );
  } finally {
    for (const user of [first, second]) {
      const result = await call(user.token, '/api/v1/account', 'DELETE', {
        password: user.password,
      });
      assert.equal(result.status, 204, JSON.stringify(result.value));
    }
  }
});
