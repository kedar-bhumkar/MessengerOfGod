import cron, { type ScheduledTask } from 'node-cron';
import { configRepository } from '../db/config.repository.js';
import { processContact } from '../pipeline/message-pipeline.js';
import { channelRegistry } from '../channels/channel.registry.js';
import { isWithinTimeWindow, getCurrentTimeInZone, randomDelay } from '../utils/time.js';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';

// Module-level state updated every tick — read by getSchedulerStatus()
let lastTickAt: string | null = null;
let lastTickContactsProcessed = 0;

/** Returns the scheduler's last known activity — used by the /health endpoint. */
export function getSchedulerStatus() {
  return { lastTickAt, lastTickContactsProcessed };
}

export function startScheduler(): ScheduledTask {
  const task = cron.schedule(env.SCHEDULER_CRON, async () => {
    try {
      const tickTime = new Date().toISOString();
      lastTickAt = tickTime;
      lastTickContactsProcessed = 0;
      logger.info({ tickTime }, '─── Scheduler tick ───────────────────────────────');

      // ── Step 0: abort early if any channel is unhealthy ──────────────────
      // Avoids running the full AI pipeline and writing spurious 'failed' rows
      // to Supabase when WhatsApp is mid-reconnect. The channel's sendMessage
      // already has a waitForConnection() guard, but skipping here is cheaper.
      for (const channel of channelRegistry.getAll()) {
        const healthy = await channel.isHealthy();
        if (!healthy) {
          logger.warn(
            { channelType: channel.channelType },
            'Channel not healthy — skipping scheduler tick to avoid spurious failures',
          );
          return;
        }
      }

      // ── Step 1: fetch every contact the SQL function considers due ───────
      const dueContacts = await configRepository.getDueContacts();
      logger.info(`Step 1 — getDueContacts() returned ${dueContacts.length} contact(s)`);

      if (dueContacts.length === 0) {
        logger.info('No contacts are due for a message right now. Tick done.');
        return;
      }

      // ── Step 2: log each contact and decide whether time window allows it
      logger.info('Step 2 — Evaluating time windows for each due contact:');

      const eligibleContacts = dueContacts.filter((contact) => {
        const localTime   = getCurrentTimeInZone(contact.timezone);
        const inWindow    = isWithinTimeWindow(
          contact.timezone,
          contact.preferred_time_start,
          contact.preferred_time_end,
        );
        const lastSent    = contact.last_message_at
          ? `last sent ${contact.days_since_last_message}d ago (${contact.last_message_at.slice(0, 10)})`
          : 'never messaged';
        const windowStr   = `${contact.preferred_time_start}–${contact.preferred_time_end} ${contact.timezone}`;
        const verdict     = inWindow ? '✓ IN WINDOW  → will send' : '✗ OUT OF WINDOW → skipped';

        logger.info(
          `  [${contact.contact_name}]  local=${localTime}  window=${windowStr}  due=${lastSent}  ${verdict}`,
        );

        return inWindow;
      });

      logger.info(
        `Step 2 — ${eligibleContacts.length} of ${dueContacts.length} contact(s) are within their time window`,
      );

      // ── Step 3: apply per-run cap ─────────────────────────────────────────
      const contactsToProcess = eligibleContacts.slice(0, env.MAX_MESSAGES_PER_RUN);

      if (eligibleContacts.length > env.MAX_MESSAGES_PER_RUN) {
        logger.warn(
          `Step 3 — Capped at ${env.MAX_MESSAGES_PER_RUN} (MAX_MESSAGES_PER_RUN); ` +
          `${eligibleContacts.length - env.MAX_MESSAGES_PER_RUN} contact(s) deferred to next tick`,
        );
      } else {
        logger.info(`Step 3 — Processing all ${contactsToProcess.length} eligible contact(s)`);
      }

      // ── Step 4: process each contact through the pipeline ─────────────────
      for (let i = 0; i < contactsToProcess.length; i++) {
        const contact = contactsToProcess[i];
        logger.info(`Step 4 — [${i + 1}/${contactsToProcess.length}] Processing "${contact.contact_name}"…`);

        try {
          const result = await processContact(contact);

          if (result.success) {
            lastTickContactsProcessed++;
            logger.info(
              `  ✓ "${contact.contact_name}" — message sent${result.message ? `: "${result.message.slice(0, 60)}${result.message.length > 60 ? '…' : ''}"` : ''}`,
            );
          } else {
            logger.warn(`  ✗ "${contact.contact_name}" — pipeline failed: ${result.error}`);
          }
        } catch (error) {
          logger.error(
            `  ✗ "${contact.contact_name}" — unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        // Random delay between messages so they don't all fire at the same second
        if (i < contactsToProcess.length - 1) {
          const delayMs = await randomDelayLogged(
            env.MIN_DELAY_BETWEEN_MESSAGES_MS,
            env.MAX_DELAY_BETWEEN_MESSAGES_MS,
          );
          logger.info(`  … waiting ${(delayMs / 1000).toFixed(1)}s before next contact`);
        }
      }

      logger.info('─── Tick complete ────────────────────────────────────');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Scheduler tick failed');
    }
  });

  logger.info({ cron: env.SCHEDULER_CRON }, 'Scheduler started');
  return task;
}

export function stopScheduler(task: ScheduledTask): void {
  task.stop();
  logger.info('Scheduler stopped');
}

/** Like randomDelay but returns the chosen delay so the caller can log it. */
async function randomDelayLogged(minMs: number, maxMs: number): Promise<number> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
  return delay;
}
