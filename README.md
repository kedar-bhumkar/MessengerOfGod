# MessengerOfGod

A personal relationship maintenance app that uses AI to generate and send personalised WhatsApp messages to your contacts on a configurable schedule. Messages are sent from **your own phone number** via Baileys (WhatsApp Web protocol) — no Twilio, no business API, no per-message fees.

---

## How It Works

```
node-cron (every N mins)
    │
    ▼
Supabase DB ──► get_due_contacts()
    │
    ▼
OpenAI GPT-4o-mini ──► personalised message text
    │
    ▼
Baileys (WhatsApp Web) ──► sends from your phone number
    │
    ▼
Inbound replies received via same Baileys WebSocket
    │
    ▼
Supabase message_history table
```

---

## Features

- **Sends from your personal number** — recipients see messages from you, not a bot account
- **AI-generated messages** — GPT-4o-mini crafts personalised messages based on relationship context and conversation history
- **Configurable schedule per contact** — timezone-aware, frequency in days, send-window hours
- **Inbound reply storage** — replies from contacts are stored in Supabase for AI context on next send
- **Automatic LID resolution** — handles WhatsApp's privacy routing (LID) with auto name-matching against DB contacts
- **Exponential backoff reconnection** — survives network drops and WhatsApp disconnects
- **Structured JSON logging** — pino with optional pino-pretty for dev

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ / TypeScript (ESM) |
| WhatsApp | `@whiskeysockets/baileys` v7 |
| Database | Supabase (PostgreSQL) |
| AI | OpenAI GPT-4o-mini |
| Scheduler | `node-cron` |
| HTTP | Express v5 (health check only) |
| Logging | pino + pino-pretty |
| Validation | Zod v4 |

---

## Project Structure

```
src/
├── index.ts                        # Entry point — wires everything together
├── env.ts                          # Zod-validated environment variables
├── server.ts                       # Express app (health endpoint + /debug/send)
├── ai/
│   ├── client.ts                   # OpenAI client singleton
│   ├── message-generator.ts        # GPT-4o-mini message generation with retry
│   └── prompt-builder.ts           # System + user prompt construction
├── channels/
│   ├── channel.interface.ts        # ChannelInterface contract
│   ├── channel.registry.ts         # Registry — init/shutdown all channels
│   └── whatsapp/
│       └── whatsapp.channel.ts     # Baileys integration (send + receive)
├── db/
│   ├── client.ts                   # Supabase client singleton
│   ├── supabase.ts                 # Re-export
│   ├── types.ts                    # DB row types
│   ├── config.repository.ts        # contact config CRUD
│   └── message.repository.ts       # message_history CRUD
├── pipeline/
│   └── message-pipeline.ts         # Orchestrates AI gen → send → DB write
├── scheduler/
│   └── scheduler.ts                # node-cron tick — finds due contacts
└── utils/
    ├── logger.ts                   # pino logger
    ├── retry.ts                    # Exponential backoff retry helper
    └── time.ts                     # Timezone-aware time utilities

scripts/
├── send-test.ts                    # Trigger a send via the running server's HTTP endpoint
└── register-lid.ts                 # Manually map a WhatsApp LID to a phone number

sql/
├── 001_schema.sql                  # Tables: config, message_history
└── 002_functions.sql               # RPC: get_due_contacts(), view: contact_conversation

whatsapp-session/                   # Baileys session files (gitignored)
└── lid-map.json                    # LID → phone number cache (gitignored)
```

---

## Setup

### 1. Prerequisites

- Node.js 20+
- A Supabase project
- An OpenAI API key
- A WhatsApp account (personal number)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) |
| `OPENAI_API_KEY` | OpenAI API key |
| `SCHEDULER_CRON` | Cron expression (e.g. `*/30 * * * *` for every 30 min) |
| `SEND_WINDOW_START` | Earliest hour to send messages (e.g. `8`) |
| `SEND_WINDOW_END` | Latest hour to send messages (e.g. `21`) |
| `WEBHOOK_PORT` | Port for the health/debug server (default `3000`) |
| `WHATSAPP_SESSION_DIR` | Where to persist the Baileys session (default `./whatsapp-session`) |

### 4. Set up the database

Run the SQL files against your Supabase project in order:

```bash
# In the Supabase SQL editor or via psql:
sql/001_schema.sql
sql/002_functions.sql
```

### 5. Add contacts

Insert rows into the `config` table in Supabase:

```sql
INSERT INTO config (name, phone, relationship_type, channel, frequency_days, timezone, active)
VALUES ('Mandar Bhumkar', '+19195187626', 'friend', 'whatsapp', 7, 'America/New_York', true);
```

### 6. Run

```bash
# Development (with live reload)
npm run dev

# Development (with pretty logs)
npm run dev:pretty

# Production (compile first)
npm run build
npm start
```

On first run, a **QR code** will be printed in the terminal. Scan it with your WhatsApp (Linked Devices) to authenticate. The session is persisted to `whatsapp-session/` — you only need to scan once.

---

## Scripts

### Test a send on-demand

Triggers a message from within the running server (no second connection opened):

```bash
npm run send -- +19195187626 "Hey Mandar!"
# or
npx tsx scripts/send-test.ts +19195187626 "Hey Mandar!"
```

### Register an unknown WhatsApp LID

If an inbound message is dropped with "LID not in map", identify the sender's phone number from context and register it:

```bash
npx tsx scripts/register-lid.ts 37693220196412@lid +19195187626
```

Then restart the server. That contact resolves correctly forever after.

---

## WhatsApp LID Routing

WhatsApp's newer privacy routing sends inbound messages with an opaque **Linked Device ID** (`@lid`) instead of the sender's phone number. The app resolves this in two ways:

1. **Auto-resolution** — when a new LID arrives, `pushName` (the sender's WhatsApp display name) is matched against DB contact names. If a confident match is found, the LID is registered automatically.
2. **Manual registration** — if the display name doesn't match (e.g. someone uses a nickname), use the `register-lid.ts` script once. All future messages from that contact are resolved automatically.

The LID map is persisted to `whatsapp-session/lid-map.json`.

---

## Health Check

```
GET http://localhost:3000/health
```

Returns `200 OK` when the server is running.

---

## Important Notes

- **Unofficial API** — Baileys uses the WhatsApp Web protocol, which is not officially supported by Meta. Use responsibly and avoid spam-like behaviour.
- **Session security** — the `whatsapp-session/` directory contains your WhatsApp authentication credentials. Never commit it to version control.
- **One linked device** — only one instance of the app should run at a time against the same session directory. Running two instances causes a `conflict` disconnect.
