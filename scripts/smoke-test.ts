/**
 * Smoke test — end-to-end sanity check for the running MessengerOfGod service.
 *
 * Run after every deploy or whenever something feels off:
 *   npm run smoke
 *   npx tsx scripts/smoke-test.ts [base-url]
 *
 * Checks (no new WhatsApp connection opened — all via HTTP + Supabase):
 *   1. /health returns 200 and whatsapp.connected === true
 *   2. Most recent outbound sent message in message_history (how long ago?)
 *   3. Most recent connection_events row (what happened last?)
 *
 * Exit code 0 = all checks passed. Exit code 1 = at least one check failed.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { env } from '../src/env.js';

const BASE_URL = process.argv[2] ?? `http://localhost:${env.WEBHOOK_PORT}`;
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

const pass  = (msg: string) => console.log(`${GREEN}✅ ${msg}${RESET}`);
const warn  = (msg: string) => console.log(`${YELLOW}⚠️  ${msg}${RESET}`);
const fail  = (msg: string) => console.log(`${RED}❌ ${msg}${RESET}`);

let allPassed = true;

console.log(`\n${BOLD}MessengerOfGod — Smoke Test${RESET}`);
console.log(`Target: ${BASE_URL}\n`);

// ── Check 1: /health endpoint ─────────────────────────────────────────────────

console.log(`${BOLD}[1/3] Health endpoint${RESET}`);
try {
  const res  = await fetch(`${BASE_URL}/health`);
  const body = await res.json() as {
    status: string;
    whatsapp?: { connected: boolean; connectedAs: string | null; reconnectAttempts: number; lastConnectedAt: string | null };
    scheduler?: { lastTickAt: string | null; lastTickContactsProcessed: number };
  };

  if (res.ok && body.status === 'ok') {
    pass(`HTTP ${res.status} — status: ok`);
  } else {
    fail(`HTTP ${res.status} — status: ${body.status}`);
    allPassed = false;
  }

  if (body.whatsapp) {
    const wa = body.whatsapp;
    if (wa.connected) {
      pass(`WhatsApp connected as ${wa.connectedAs ?? 'unknown'}`);
    } else {
      fail(`WhatsApp NOT connected (reconnectAttempts: ${wa.reconnectAttempts})`);
      allPassed = false;
    }
    if (wa.lastConnectedAt) {
      const ago = Math.round((Date.now() - new Date(wa.lastConnectedAt).getTime()) / 1000);
      pass(`Last connected ${ago}s ago`);
    }
  } else {
    warn('No whatsapp status in response (server may not have registry wired up)');
  }

  if (body.scheduler?.lastTickAt) {
    const ago = Math.round((Date.now() - new Date(body.scheduler.lastTickAt).getTime()) / 1000);
    const mins = Math.round(ago / 60);
    pass(`Scheduler last ticked ${mins}m ago — processed ${body.scheduler.lastTickContactsProcessed} contact(s)`);
  } else {
    warn('Scheduler has not ticked yet since last restart');
  }
} catch (err) {
  fail(`Could not reach ${BASE_URL}/health — is the server running? (npm run dev)`);
  allPassed = false;
}

// ── Check 2: Last outbound message ───────────────────────────────────────────

console.log(`\n${BOLD}[2/3] Last outbound sent message${RESET}`);
try {
  const { data, error } = await supabase
    .from('message_history')
    .select('created_at, status, ai_model_used')
    .eq('direction', 'outbound')
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    warn('No outbound sent messages found in message_history yet');
  } else {
    const ago = Date.now() - new Date(data.created_at as string).getTime();
    const hours = Math.round(ago / 3_600_000);
    const model = data.ai_model_used ?? 'unknown model';

    if (hours > 48) {
      warn(`Last outbound sent ${hours}h ago via ${model} — check if scheduler is running`);
      allPassed = false;
    } else {
      pass(`Last outbound sent ${hours}h ago via ${model}`);
    }
  }
} catch (err) {
  fail(`Supabase query failed: ${err instanceof Error ? err.message : err}`);
  allPassed = false;
}

// ── Check 3: Last connection event ───────────────────────────────────────────

console.log(`\n${BOLD}[3/3] Last connection event (Baileys history)${RESET}`);
try {
  const { data, error } = await supabase
    .from('connection_events')
    .select('event_type, status_code, details, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    warn('No connection events recorded yet (table may not exist — run sql/003_connection_events.sql)');
  } else {
    const ago = Math.round((Date.now() - new Date(data.occurred_at as string).getTime()) / 1000 / 60);
    const line = `[${data.event_type}] ${data.details ?? ''} (${ago}m ago, code=${data.status_code ?? '-'})`;

    if (data.event_type === 'fatal') {
      fail(`Last event: ${line}`);
      allPassed = false;
    } else if (data.event_type === 'connected') {
      pass(`Last event: ${line}`);
    } else {
      warn(`Last event: ${line}`);
    }
  }
} catch (err) {
  fail(`Supabase query failed: ${err instanceof Error ? err.message : err}`);
  allPassed = false;
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log();
if (allPassed) {
  console.log(`${GREEN}${BOLD}✅ All checks passed — MessengerOfGod looks healthy.${RESET}\n`);
} else {
  console.log(`${RED}${BOLD}❌ One or more checks failed — see above.${RESET}\n`);
  process.exit(1);
}
