import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  // Supabase
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),

  // OpenAI
  OPENAI_API_KEY: z.string(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // WhatsApp (Baileys — personal number via WhatsApp Web protocol)
  // Path to the directory where Baileys saves the linked-device session.
  // The QR code is only needed once; subsequent starts reconnect automatically.
  WHATSAPP_SESSION_DIR: z.string().default('./whatsapp-session'),

  // Scheduler
  SCHEDULER_CRON: z.string().default('*/30 * * * *'),
  MAX_MESSAGES_PER_RUN: z.coerce.number().default(20),
  MIN_DELAY_BETWEEN_MESSAGES_MS: z.coerce.number().default(30000),
  MAX_DELAY_BETWEEN_MESSAGES_MS: z.coerce.number().default(120000),

  // Webhook Server
  WEBHOOK_PORT: z.coerce.number().default(3000),

  // Logging
  LOG_LEVEL: z.string().default('info'),
});

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formatted = error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      console.error(`Environment variable validation failed:\n${formatted}`);
    } else {
      console.error('Unexpected error loading environment variables:', error);
    }
    process.exit(1);
  }
}

export const env: Env = loadEnv();
