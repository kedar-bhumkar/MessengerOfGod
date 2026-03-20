/**
 * Run a SQL migration file against your Supabase project using the Management API.
 *
 * Requires a Supabase Personal Access Token (PAT) — different from the service role key.
 * Generate one at: https://supabase.com/dashboard/account/tokens
 *
 * Usage:
 *   npx tsx scripts/run-migration.ts <sql-file> <pat>
 *
 * Example:
 *   npx tsx scripts/run-migration.ts sql/003_connection_events.sql sbp_xxxx...
 */

import fs from 'node:fs';

const [, , sqlFile, pat] = process.argv;

if (!sqlFile || !pat) {
  console.error('Usage: npx tsx scripts/run-migration.ts <sql-file> <pat>');
  console.error('');
  console.error('Get a PAT at: https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

if (!fs.existsSync(sqlFile)) {
  console.error(`File not found: ${sqlFile}`);
  process.exit(1);
}

// Extract project ref from SUPABASE_URL in .env
const envRaw = fs.readFileSync('.env', 'utf8');
const urlMatch = envRaw.match(/SUPABASE_URL=https:\/\/([a-z0-9]+)\.supabase\.co/);
if (!urlMatch) {
  console.error('Could not parse SUPABASE_URL from .env');
  process.exit(1);
}
const ref = urlMatch[1];
const sql = fs.readFileSync(sqlFile, 'utf8');

console.log(`\n📦 Running migration: ${sqlFile}`);
console.log(`   Project ref: ${ref}\n`);

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${pat}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const body = await res.json() as unknown;

if (res.ok) {
  console.log('✅ Migration applied successfully.');
  if (Array.isArray(body) && (body as []).length > 0) {
    console.log('Result:', JSON.stringify(body, null, 2));
  }
} else {
  console.error(`❌ Migration failed (HTTP ${res.status}):`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}
