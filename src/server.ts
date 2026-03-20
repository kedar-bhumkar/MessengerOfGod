import express from 'express';
import { env } from './env.js';
import { logger } from './utils/logger.js';
import type { ChannelRegistry } from './channels/channel.registry.js';
import { getSchedulerStatus } from './scheduler/scheduler.js';
import type { WhatsAppChannel } from './channels/whatsapp/whatsapp.channel.js';

/**
 * Create and configure the Express server.
 *
 * With Baileys, inbound WhatsApp messages are delivered via the persistent
 * WebSocket connection inside WhatsAppChannel — not via HTTP webhooks.
 * This server exposes /health for uptime monitoring and deployment checks.
 */
export function createServer(registry?: ChannelRegistry): express.Express {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    const waChannel = registry?.get('whatsapp') as WhatsAppChannel | undefined;
    const waStatus  = waChannel?.getStatus?.() ?? null;
    const scheduler = getSchedulerStatus();

    const status = waStatus && !waStatus.connected ? 'degraded' : 'ok';

    res.status(status === 'ok' ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      whatsapp:  waStatus,
      scheduler,
    });
  });

  return app;
}

/**
 * Start the Express server listening on the configured port.
 */
export function startServer(app: express.Express): Promise<void> {
  // process.env.PORT is injected by the Claude Preview system (autoPort).
  // Fall back to WEBHOOK_PORT from .env for normal runs.
  const port = process.env.PORT ? Number(process.env.PORT) : env.WEBHOOK_PORT;
  return new Promise((resolve) => {
    app.listen(port, () => {
      logger.info({ port }, `Health server listening on port ${port}`);
      resolve();
    });
  });
}
