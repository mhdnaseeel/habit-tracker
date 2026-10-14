import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHabitMentorServer } from './server.ts';

let instance: ReturnType<typeof createHabitMentorServer>;
try {
  instance = createHabitMentorServer(
    process.env.MCP_READ_TOKEN ?? '',
    process.env.HABIT_API_URL ?? 'http://api:3001',
  );
  await instance.verify();
} catch {
  process.stderr.write('Habit Tracker authorization failed or unavailable.\n');
  process.exit(1);
}
await instance.server.connect(new StdioServerTransport());
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void instance.server.close().finally(() => process.exit(0));
  });
}
