import { env } from './env.js';
import { logger } from './utils/logger.js';
import { channelRegistry } from './channels/channel.registry.js';
import { WhatsAppChannel } from './channels/whatsapp/whatsapp.channel.js';
import { startScheduler, stopScheduler } from './scheduler/scheduler.js';
import { createServer, startServer } from './server.js';
import type { ScheduledTask } from 'node-cron';

/**
 * MessengerOfGod - Main Entry Point
 *
 * Initializes all components and starts:
 * 1. Channel connections (WhatsApp via Twilio)
 * 2. Express webhook server (for inbound messages)
 * 3. Cron scheduler (for sending due messages)
 */

let schedulerTask: ScheduledTask | null = null;

async function main(): Promise<void> {
  logger.info('===========================================');
  logger.info('  MessengerOfGod - Starting up...');
  logger.info('===========================================');

  // --- Step 1: Register and initialize channels ---
  logger.info('Registering messaging channels...');
  channelRegistry.register(new WhatsAppChannel());
  // Future: channelRegistry.register(new TelegramChannel());
  // Future: channelRegistry.register(new LinkedInChannel());
  await channelRegistry.initializeAll();

  // --- Step 2: Start the webhook server ---
  logger.info('Starting webhook server...');
  const app = createServer();

  // Debug send endpoint — triggers a sendMessage() from WITHIN this process
  // so the sent-message echo arrives here too, allowing LID → phone learning.
  // Never open a second WhatsApp connection just to test a send.
  app.post('/debug/send', async (req, res) => {
    const { phone, message } = req.body as { phone?: string; message?: string };
    if (!phone || !message) {
      res.status(400).json({ error: 'phone and message are required' });
      return;
    }
    const channel = channelRegistry.get('whatsapp');
    if (!channel) {
      res.status(503).json({ error: 'WhatsApp channel not registered' });
      return;
    }
    logger.info({ phone }, '/debug/send triggered');
    const result = await channel.sendMessage(phone, message);
    res.json(result);
  });

  await startServer(app);

  // --- Step 3: Start the scheduler ---
  logger.info('Starting message scheduler...');
  schedulerTask = startScheduler();
  logger.info(
    { cron: env.SCHEDULER_CRON },
    'Scheduler started with cron expression'
  );

  logger.info('===========================================');
  logger.info('  MessengerOfGod is running!');
  logger.info(`  Health:   http://localhost:${env.WEBHOOK_PORT}/health`);
  logger.info(`  Session:  ${env.WHATSAPP_SESSION_DIR}`);
  logger.info('  Inbound messages → Baileys WebSocket (no HTTP webhook needed)');
  logger.info('===========================================');
}

/**
 * Graceful shutdown handler.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal, cleaning up...');

  // Stop scheduler
  if (schedulerTask) {
    stopScheduler(schedulerTask);
    logger.info('Scheduler stopped');
  }

  // Shutdown all channels
  await channelRegistry.shutdownAll();
  logger.info('All channels shut down');

  logger.info('MessengerOfGod shut down gracefully. Goodbye!');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception - shutting down');
  shutdown('uncaughtException').catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection - shutting down');
  shutdown('unhandledRejection').catch(() => process.exit(1));
});

// Start the application
main().catch((error) => {
  logger.fatal({ error }, 'Failed to start MessengerOfGod');
  process.exit(1);
});
