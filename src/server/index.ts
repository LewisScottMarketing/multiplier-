import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createUser, countUsers } from './auth/users';
import { loadConfig, loadDotEnv } from './config';
import { closeContext, createContext } from './context';
import { purgeExpiredSessions } from './auth/sessions';
import { startWebhookWorker } from './services/webhooks';

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const ctx = createContext(config);

  // Non-interactive first run: create the owner from env (handy for Docker / one-click deploys).
  if (config.adminEmail && config.adminPassword && countUsers(ctx) === 0) {
    await createUser(ctx, { email: config.adminEmail, password: config.adminPassword, name: 'Admin', role: 'owner' });
    ctx.log.info(`Created admin user ${config.adminEmail}`);
  }

  const app = createApp(ctx);
  const stopWebhooks = startWebhookWorker(ctx);
  const sessionTimer = setInterval(() => purgeExpiredSessions(ctx), 6 * 3600_000);
  sessionTimer.unref();
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    ctx.log.info(`Multiplier listening on http://localhost:${info.port}`, { env: config.env, data: config.dataDir });
  });

  const shutdown = (signal: string) => {
    ctx.log.info(`${signal} received, shutting down`);
    stopWebhooks();
    server.close(() => {
      closeContext(ctx);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
