import express from 'express';
import { env } from './env.js';
import { logger } from './utils/logger.js';

/**
 * Create and configure the Express server.
 *
 * With Baileys, inbound WhatsApp messages are delivered via the persistent
 * WebSocket connection inside WhatsAppChannel — not via HTTP webhooks.
 * This server is kept for the /health endpoint (useful for uptime monitoring
 * and deployment health checks).
 */
export function createServer(): express.Express {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
