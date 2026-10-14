import { DurableObject } from 'cloudflare:workers';

interface Env {
  HABIT_TRACKER: DurableObjectNamespace<HabitTrackerContainer>;
  DATABASE_URL: string;
  ACCESS_TOKEN_SECRET: string;
  OPENAI_API_KEY?: string;
  WEB_ORIGIN: string;
}

const PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

export class HabitTrackerContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        ctx.container!.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForReadiness().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = 'http:';
    url.host = 'container';
    const forwarded = new Request(url, request);
    forwarded.headers.delete('host');
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWaitForReadiness(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: 'lite',
        enableInternet: true,
        env: {
          NODE_ENV: 'production',
          HOST: '0.0.0.0',
          PORT: String(PORT),
          HOSTED: 'true',
          DB_SSL: 'true',
          LOG_LEVEL: 'info',
          DATABASE_URL: this.env.DATABASE_URL,
          ACCESS_TOKEN_SECRET: this.env.ACCESS_TOKEN_SECRET,
          OPENAI_API_KEY: this.env.OPENAI_API_KEY ?? '',
          WEB_ORIGIN: this.env.WEB_ORIGIN,
        },
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(PORT);
    let lastError: unknown;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await port.fetch('http://container/health/live', {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.ok) return;
        lastError = new Error(`Health check returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await scheduler.wait(200);
    }
    throw new Error('Container did not become ready', { cause: lastError });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.HABIT_TRACKER.getByName('primary').fetch(request);
  },
} satisfies ExportedHandler<Env>;
