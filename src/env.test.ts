import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-define the schema here so we can test it without triggering dotenv or process.exit.
// This mirrors src/env.ts exactly.
const envSchema = z.object({
  SUPABASE_URL:                    z.url(),
  SUPABASE_SERVICE_ROLE_KEY:       z.string(),
  OPENAI_API_KEY:                  z.string(),
  OPENAI_MODEL:                    z.string().default('gpt-4o-mini'),
  WHATSAPP_SESSION_DIR:            z.string().default('./whatsapp-session'),
  SCHEDULER_CRON:                  z.string().default('*/30 * * * *'),
  MAX_MESSAGES_PER_RUN:            z.coerce.number().default(20),
  MIN_DELAY_BETWEEN_MESSAGES_MS:   z.coerce.number().default(30000),
  MAX_DELAY_BETWEEN_MESSAGES_MS:   z.coerce.number().default(120000),
  WEBHOOK_PORT:                    z.coerce.number().default(3000),
  LOG_LEVEL:                       z.string().default('info'),
});

const VALID_BASE = {
  SUPABASE_URL:              'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'secret-key',
  OPENAI_API_KEY:            'sk-test',
};

describe('env schema', () => {
  it('accepts a valid minimal config and fills in defaults', () => {
    const result = envSchema.parse(VALID_BASE);
    expect(result.OPENAI_MODEL).toBe('gpt-4o-mini');
    expect(result.WEBHOOK_PORT).toBe(3000);
    expect(result.SCHEDULER_CRON).toBe('*/30 * * * *');
    expect(result.WHATSAPP_SESSION_DIR).toBe('./whatsapp-session');
    expect(result.MAX_MESSAGES_PER_RUN).toBe(20);
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('accepts a full config with overrides', () => {
    const result = envSchema.parse({
      ...VALID_BASE,
      WEBHOOK_PORT: '4000',
      MAX_MESSAGES_PER_RUN: '5',
      LOG_LEVEL: 'debug',
    });
    expect(result.WEBHOOK_PORT).toBe(4000);
    expect(result.MAX_MESSAGES_PER_RUN).toBe(5);
    expect(result.LOG_LEVEL).toBe('debug');
  });

  it('throws when SUPABASE_URL is missing', () => {
    const { SUPABASE_URL, ...rest } = VALID_BASE;
    expect(() => envSchema.parse(rest)).toThrow();
  });

  it('throws when SUPABASE_URL is not a valid URL', () => {
    expect(() => envSchema.parse({ ...VALID_BASE, SUPABASE_URL: 'not-a-url' })).toThrow();
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = VALID_BASE;
    expect(() => envSchema.parse(rest)).toThrow();
  });

  it('throws when OPENAI_API_KEY is missing', () => {
    const { OPENAI_API_KEY, ...rest } = VALID_BASE;
    expect(() => envSchema.parse(rest)).toThrow();
  });

  it('coerces string numbers correctly', () => {
    const result = envSchema.parse({
      ...VALID_BASE,
      MAX_MESSAGES_PER_RUN:          '10',
      MIN_DELAY_BETWEEN_MESSAGES_MS: '5000',
      MAX_DELAY_BETWEEN_MESSAGES_MS: '60000',
      WEBHOOK_PORT:                  '8080',
    });
    expect(result.MAX_MESSAGES_PER_RUN).toBe(10);
    expect(result.MIN_DELAY_BETWEEN_MESSAGES_MS).toBe(5000);
    expect(result.WEBHOOK_PORT).toBe(8080);
  });
});
