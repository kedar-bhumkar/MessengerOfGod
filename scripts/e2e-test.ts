/**
 * End-to-End Test — Full Scheduler Pipeline
 *
 * Simulates exactly what happens when the cron fires and picks up a due contact:
 *   1. Finds the "E2E test dummy" contact in Supabase (initially inactive)
 *   2. Patches it → active=true, preferred_time window centred on NOW so the
 *      time-window check inside the server passes
 *   3. Calls POST /debug/run-for-contact on the running server — this executes
 *      the full processContact() pipeline (AI generation → WhatsApp send →
 *      message_history write), all inside the existing server process so there
 *      is no second WhatsApp session conflict
 *   4. Verifies a new "sent" row appears in message_history for this contact
 *      within 30 seconds
 *   5. Restores the contact to its original state (always, even on failure)
 *
 * Prerequisites
 *   • Main server must be running: npm run dev
 *   • "E2E test dummy" contact must exist in the config table
 *     (phone +19195187626 → unique_contact_id '19195187626@s.whatsapp.net')
 *
 * Usage
 *   npx tsx scripts/e2e-test.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT         = process.env.WEBHOOK_PORT ?? '3000';
const BASE_URL     = `http://localhost:${PORT}`;
const CONTACT_NAME = 'E2E test dummy';
const TIMEOUT_MS   = 30_000;   // how long to wait for message_history row

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a JS Date as HH:MM in the given IANA timezone. */
function toHHMM(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  }).format(date);
}

/** Add minutes to a Date, return a new Date. */
function addMinutes(date: Date, mins: number): Date {
  return new Date(date.getTime() + mins * 60_000);
}

/** Coloured terminal output helpers */
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runE2ETest(): Promise<void> {
  console.log(bold('\n════════════════════════════════════════════════'));
  console.log(bold('  MessengerOfGod — End-to-End Test'));
  console.log(bold('════════════════════════════════════════════════\n'));

  const startedAt = new Date();

  // ── Step 0: verify the server is up ───────────────────────────────────────
  console.log('Step 0 — Checking server is reachable...');
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as { status: string; whatsapp?: { connected: boolean } };
    if (body.whatsapp && !body.whatsapp.connected) {
      console.error(red('  ✗ /health reports WhatsApp disconnected — cannot send messages.'));
      console.error(red('    Is the server running and the QR scanned?'));
      process.exit(1);
    }
    console.log(green('  ✓ Server is up and WhatsApp is connected\n'));
  } catch {
    console.error(red(`  ✗ Could not reach ${BASE_URL}/health`));
    console.error(red('    Start the server first:  npm run dev'));
    process.exit(1);
  }

  // ── Step 1: find the contact ───────────────────────────────────────────────
  console.log(`Step 1 — Looking up "${CONTACT_NAME}" in Supabase...`);
  const { data: contacts, error: findErr } = await supabase
    .from('config')
    .select('*')
    .ilike('contact_name', CONTACT_NAME)
    .limit(1);

  if (findErr) {
    console.error(red(`  ✗ DB error: ${findErr.message}`));
    process.exit(1);
  }
  if (!contacts || contacts.length === 0) {
    console.error(red(`  ✗ Contact "${CONTACT_NAME}" not found in config table.`));
    console.error(red('    Insert it first — see sql/ for the schema.'));
    process.exit(1);
  }

  const contact = contacts[0] as {
    id: string;
    contact_name: string;
    active: boolean;
    preferred_time_start: string;
    preferred_time_end: string;
    timezone: string;
    unique_contact_id: string;
  };

  console.log(green(`  ✓ Found: id=${contact.id}`));
  console.log(`     active=${contact.active}  tz=${contact.timezone}`);
  console.log(`     window=${contact.preferred_time_start}–${contact.preferred_time_end}\n`);

  // Snapshot for cleanup
  const originalActive     = contact.active;
  const originalTimeStart  = contact.preferred_time_start;
  const originalTimeEnd    = contact.preferred_time_end;

  // ── Step 2: patch → active + in-window ────────────────────────────────────
  console.log('Step 2 — Patching contact to be active and within sending window...');

  const now       = new Date();
  const winStart  = toHHMM(addMinutes(now, -30), contact.timezone);  // 30 min ago
  const winEnd    = toHHMM(addMinutes(now,  90), contact.timezone);  // 90 min from now

  console.log(`     New window: ${winStart}–${winEnd} (${contact.timezone})`);

  const { error: patchErr } = await supabase
    .from('config')
    .update({
      active:               true,
      preferred_time_start: winStart,
      preferred_time_end:   winEnd,
    })
    .eq('id', contact.id);

  if (patchErr) {
    console.error(red(`  ✗ Failed to patch contact: ${patchErr.message}`));
    process.exit(1);
  }
  console.log(green('  ✓ Contact patched\n'));

  // ── Steps 3–4: run the pipeline via the server ────────────────────────────
  let pipelineSuccess  = false;
  let pipelineMessage  = '';
  let pipelineError    = '';

  try {
    console.log(`Step 3 — Invoking pipeline via POST ${BASE_URL}/debug/run-for-contact ...`);
    console.log('   (This generates an AI message and sends it over WhatsApp)');

    const res = await fetch(`${BASE_URL}/debug/run-for-contact`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contactName: CONTACT_NAME }),
    });

    const body = await res.json() as {
      success: boolean;
      contactName: string;
      message?: string;
      error?: string;
    };

    if (!res.ok || !body.success) {
      pipelineError = body.error ?? `HTTP ${res.status}`;
      console.error(red(`  ✗ Pipeline failed: ${pipelineError}`));
    } else {
      pipelineSuccess = true;
      pipelineMessage = body.message ?? '';
      console.log(green('  ✓ Pipeline returned success'));
      console.log(`     Message: "${pipelineMessage.slice(0, 80)}${pipelineMessage.length > 80 ? '…' : ''}"\n`);
    }
  } catch (err) {
    pipelineError = err instanceof Error ? err.message : String(err);
    console.error(red(`  ✗ Fetch failed: ${pipelineError}`));
  }

  // ── Step 5: verify message_history row ────────────────────────────────────
  let verifiedInDb = false;

  if (pipelineSuccess) {
    console.log('Step 4 — Verifying message_history row in Supabase...');

    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { data: rows, error: histErr } = await supabase
        .from('message_history')
        .select('id, message, status, created_at')
        .eq('config_id', contact.id)
        .eq('direction', 'outbound')
        .eq('status', 'sent')
        .gte('created_at', startedAt.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      if (histErr) {
        console.error(yellow(`     DB query error: ${histErr.message} — retrying…`));
      } else if (rows && rows.length > 0) {
        const row = rows[0] as { id: string; message: string; status: string; created_at: string };
        console.log(green('  ✓ message_history row confirmed:'));
        console.log(`     id:      ${row.id}`);
        console.log(`     status:  ${row.status}`);
        console.log(`     at:      ${row.created_at}`);
        console.log(`     message: "${row.message.slice(0, 80)}${row.message.length > 80 ? '…' : ''}"`);
        verifiedInDb = true;
        break;
      }

      await new Promise(r => setTimeout(r, 1_500));
    }

    if (!verifiedInDb) {
      console.error(red(`  ✗ No "sent" message_history row found within ${TIMEOUT_MS / 1000}s`));
    }
  }

  // ── Cleanup: always restore original state ─────────────────────────────────
  console.log('\nCleanup — Restoring original contact state...');
  const { error: restoreErr } = await supabase
    .from('config')
    .update({
      active:               originalActive,
      preferred_time_start: originalTimeStart,
      preferred_time_end:   originalTimeEnd,
    })
    .eq('id', contact.id);

  if (restoreErr) {
    console.error(yellow(`  ⚠  Could not restore contact — fix manually: ${restoreErr.message}`));
  } else {
    console.log(green('  ✓ Contact restored to original state\n'));
  }

  // ── Final verdict ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(bold('════════════════════════════════════════════════'));
  if (pipelineSuccess && verifiedInDb) {
    console.log(green(bold('  ✅  E2E TEST PASSED')));
    console.log(green(`      Pipeline ran and message confirmed in DB in ${elapsed}s`));
  } else {
    console.log(red(bold('  ❌  E2E TEST FAILED')));
    if (!pipelineSuccess) console.log(red(`      Pipeline error: ${pipelineError}`));
    if (!verifiedInDb)    console.log(red('      No "sent" row found in message_history'));
  }
  console.log(bold('════════════════════════════════════════════════\n'));

  process.exit(pipelineSuccess && verifiedInDb ? 0 : 1);
}

runE2ETest().catch((err) => {
  console.error(red(`\nFatal: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
