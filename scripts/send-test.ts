/**
 * Manual send test — triggers a send via the RUNNING server's /debug/send endpoint.
 *
 * This avoids opening a second WhatsApp connection (which causes a conflict),
 * and ensures the sent-message echo is received by the same WhatsAppChannel
 * instance that handles inbound messages — enabling LID → phone learning.
 *
 * Usage:
 *   npx tsx scripts/send-test.ts <phone> [message]
 *
 * Examples:
 *   npx tsx scripts/send-test.ts +919876543210
 *   npx tsx scripts/send-test.ts +919876543210 "Hey, testing MessengerOfGod!"
 *
 * Requires the main server to be running (npm run dev).
 */

const phone   = process.argv[2];
const message = process.argv[3] ?? `MessengerOfGod test — ${new Date().toLocaleTimeString()}`;
const port    = process.env.PORT ?? '3000';
const baseUrl = `http://localhost:${port}`;

if (!phone) {
  console.error('Usage: npx tsx scripts/send-test.ts <phone> [message]');
  console.error('Example: npx tsx scripts/send-test.ts +919876543210');
  process.exit(1);
}

if (!/^\+\d{7,15}$/.test(phone)) {
  console.error(`"${phone}" doesn't look like a valid E.164 number (e.g. +919876543210)`);
  process.exit(1);
}

console.log(`\n📤 Sending to ${phone} via running server (${baseUrl}):`);
console.log(`   "${message}"\n`);

try {
  const res = await fetch(`${baseUrl}/debug/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message }),
  });

  const body = await res.json() as { success: boolean; platformMessageId?: string; error?: string };

  if (!res.ok || !body.success) {
    console.error(`❌ Failed (HTTP ${res.status}): ${body.error ?? JSON.stringify(body)}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ Sent! Message ID: ${body.platformMessageId}`);
    console.log('⏳ Waiting 6s for the echo to arrive at the server (watch server logs for LID learning)...');
    await new Promise(r => setTimeout(r, 6_000));
    console.log('✅ Done — check server logs for "Learned LID from sent-message echo ✓"');
  }
} catch (err) {
  console.error('❌ Could not reach server — is it running? (npm run dev)');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
