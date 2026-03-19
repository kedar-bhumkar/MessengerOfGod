/**
 * Manually register a WhatsApp LID → phone number mapping.
 *
 * Use this when an inbound message is dropped with "LID not in map" and you
 * can identify the sender's phone number from context (e.g. they told you, or
 * you see who recently messaged your WhatsApp).
 *
 * Usage:
 *   npx tsx scripts/register-lid.ts <lid> <phone>
 *
 * Examples:
 *   npx tsx scripts/register-lid.ts 37693220196412@lid +19195187626
 *   npx tsx scripts/register-lid.ts 37693220196412@lid 19195187626   (@ suffix auto-added)
 *
 * The mapping is written to whatsapp-session/lid-map.json and loaded on the
 * next server restart (or hot-reload if using tsx watch).
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../src/env.js';

let lid   = process.argv[2];
let phone = process.argv[3];

if (!lid || !phone) {
  console.error('Usage: npx tsx scripts/register-lid.ts <lid> <phone>');
  console.error('Example: npx tsx scripts/register-lid.ts 37693220196412@lid +19195187626');
  process.exit(1);
}

// Normalise LID — ensure it ends with @lid
if (!lid.includes('@')) lid = `${lid}@lid`;

// Normalise phone → JID format ("19195187626@s.whatsapp.net")
// Accepts: "+19195187626", "19195187626", "19195187626@s.whatsapp.net"
let phoneJid = phone;
if (!phoneJid.includes('@')) {
  phoneJid = phoneJid.replace(/^\+/, '') + '@s.whatsapp.net';
}

const mapPath = path.join(env.WHATSAPP_SESSION_DIR, 'lid-map.json');
fs.mkdirSync(path.dirname(mapPath), { recursive: true });

let existing: Record<string, string> = {};
if (fs.existsSync(mapPath)) {
  try {
    existing = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as Record<string, string>;
  } catch {
    console.warn('Could not parse existing lid-map.json — starting fresh');
  }
}

const alreadyHad = lid in existing;
existing[lid] = phoneJid;
fs.writeFileSync(mapPath, JSON.stringify(existing, null, 2));

console.log(alreadyHad
  ? `✅ Updated:  ${lid}  →  ${phoneJid}`
  : `✅ Registered: ${lid}  →  ${phoneJid}`);
console.log(`   File: ${mapPath}`);
console.log(`   Total entries: ${Object.keys(existing).length}`);
console.log('\nRestart the server (or it will be picked up on next boot).');
