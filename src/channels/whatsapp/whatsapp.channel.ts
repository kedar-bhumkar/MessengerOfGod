import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import type { ChannelInterface, SendResult } from '../channel.interface.js';
import { configRepository } from '../../db/config.repository.js';
import { messageRepository } from '../../db/message.repository.js';
import { logConnectionEvent } from '../../db/events.repository.js';
import { env } from '../../env.js';
import { logger } from '../../utils/logger.js';

// Backoff: 3 s → 6 s → 12 s → 24 s → 48 s → 60 s (cap)
const BACKOFF_BASE_MS = 3_000;
const BACKOFF_MAX_MS  = 60_000;

// Codes that mean "reconnect" vs "give up"
const RECONNECTABLE_CODES = new Set([
  DisconnectReason.connectionClosed,   // 428
  DisconnectReason.connectionLost,     // 408
  DisconnectReason.connectionReplaced, // 440 — another session opened; reconnect to reclaim
  DisconnectReason.timedOut,           // 408
  DisconnectReason.restartRequired,    // 515 — server asks us to restart
  undefined,                           // unknown / network drop
]);

export class WhatsAppChannel implements ChannelInterface {
  readonly channelType = 'whatsapp' as const;

  private sock: WASocket | null = null;
  private connected = false;
  private closedByUser = false;

  /**
   * Maps WhatsApp LID → phone JID for contacts that use the new privacy routing.
   * e.g. "37693220196412@lid" → "19195187626@s.whatsapp.net"
   *
   * Persisted to whatsapp-session/lid-map.json so it survives restarts.
   * Once a contact's LID is learned it's available immediately on the next boot,
   * even if contacts.upsert hasn't fired yet in the new session.
   */
  private lidToPhone = new Map<string, string>();

  /**
   * Tracks recently-sent message IDs → the phone JID we addressed them to.
   * When Baileys echoes a sent message back with a @lid remoteJid, we use
   * the matching key.id to learn "this LID = this phone number".
   * Entries expire after 30 s so the map doesn't grow unboundedly.
   */
  private pendingSendLidMap = new Map<string, string>(); // msgId → phoneJid
  private get lidMapPath() {
    return path.join(env.WHATSAPP_SESSION_DIR, 'lid-map.json');
  }

  private loadLidMap(): void {
    try {
      if (fs.existsSync(this.lidMapPath)) {
        const raw = JSON.parse(fs.readFileSync(this.lidMapPath, 'utf8')) as Record<string, string>;
        this.lidToPhone = new Map(Object.entries(raw));
        logger.info({ entries: this.lidToPhone.size }, 'Loaded LID map from disk');
      }
    } catch (err) {
      logger.warn({ err }, 'Could not load LID map from disk — starting fresh');
    }
  }

  private saveLidMap(): void {
    try {
      fs.mkdirSync(path.dirname(this.lidMapPath), { recursive: true });
      const obj = Object.fromEntries(this.lidToPhone);
      fs.writeFileSync(this.lidMapPath, JSON.stringify(obj, null, 2));
    } catch (err) {
      logger.warn({ err }, 'Could not save LID map to disk');
    }
  }

  /**
   * Attempt to automatically resolve an unknown LID by matching the sender's
   * WhatsApp display name (pushName) against contact names in the DB.
   *
   * Returns the resolved phone JID if exactly one contact matches confidently,
   * or null if the match is ambiguous / no match found.
   */
  private async tryAutoResolveLid(lid: string, pushName: string | null | undefined): Promise<string | null> {
    if (!pushName) {
      logger.warn({ lid }, 'Unknown LID and no pushName available — cannot auto-resolve');
      return null;
    }

    let contacts: import('../../db/config.repository.js').ConfigRow[];
    try {
      contacts = await configRepository.getAllActiveContacts();
    } catch {
      return null;
    }

    const normalise = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
    const needle = normalise(pushName);

    const matches = contacts.filter(c => {
      const haystack = normalise(c.contact_name);
      // Accept if either name contains the other, or first tokens match
      return (
        haystack.includes(needle) ||
        needle.includes(haystack) ||
        haystack.split(' ')[0] === needle.split(' ')[0]
      );
    });

    if (matches.length === 1) {
      const contact = matches[0];
      const phoneJid = contact.unique_contact_id.replace(/^\+/, '') + '@s.whatsapp.net';
      this.lidToPhone.set(lid, phoneJid);
      this.saveLidMap();
      logger.info(
        { lid, phoneJid, pushName, contactName: contact.contact_name },
        'Auto-resolved LID via pushName match ✓',
      );
      return phoneJid;
    }

    if (matches.length === 0) {
      logger.warn(
        { lid, pushName, candidateCount: contacts.length },
        'Unknown LID — pushName matched no DB contacts. ' +
        'Run: npx tsx scripts/register-lid.ts ' + lid + ' +<phone>',
      );
    } else {
      // Multiple candidates — log them so the user knows which names are ambiguous
      logger.warn(
        {
          lid,
          pushName,
          candidates: matches.map(c => ({ name: c.contact_name, phone: c.unique_contact_id })),
        },
        'Unknown LID — pushName matched multiple contacts, cannot auto-resolve. ' +
        'Run: npx tsx scripts/register-lid.ts ' + lid + ' +<phone>',
      );
    }

    return null;
  }

  // Cached after the first successful fetch — avoids an HTTP round-trip
  // on every reconnect (version rarely changes, and Baileys falls back
  // gracefully if slightly stale).
  private waVersion: [number, number, number] | null = null;

  // Counts consecutive failed reconnects so we can back off intelligently.
  private reconnectAttempts = 0;

  // Timestamp of the most recent successful connection open.
  private lastConnectedAt: Date | null = null;

  // Phone number we are connected as (e.g. "919764143433").
  private connectedAs: string | null = null;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.closedByUser = false;
    this.reconnectAttempts = 0;
    this.loadLidMap();   // preload persisted LID → phone mappings before first message arrives
    await this.startSocket();
  }

  async isHealthy(): Promise<boolean> {
    return this.connected;
  }

  /** Returns a snapshot of the WhatsApp connection state for the /health endpoint. */
  getStatus() {
    return {
      connected:         this.connected,
      connectedAs:       this.connectedAs,
      reconnectAttempts: this.reconnectAttempts,
      lastConnectedAt:   this.lastConnectedAt?.toISOString() ?? null,
      lidMapSize:        this.lidToPhone.size,
    };
  }

  async shutdown(): Promise<void> {
    this.closedByUser = true;
    this.sock?.end(undefined);
    this.sock = null;
    this.connected = false;
    logger.info('WhatsApp channel shut down');
  }

  // ─── Send ─────────────────────────────────────────────────────────────────

  /**
   * Send a text message to a contact.
   * @param contactId  E.164 phone number, e.g. "+919876543210"
   */
  async sendMessage(contactId: string, message: string): Promise<SendResult> {
    if (!this.sock || !this.connected) {
      return { success: false, error: 'WhatsApp not connected' };
    }

    // "+919876543210" → "919876543210@s.whatsapp.net"
    const jid = contactId.replace(/^\+/, '') + '@s.whatsapp.net';

    try {
      const sent = await this.sock.sendMessage(jid, { text: message });

      // Track the sent message ID so we can learn the LID when Baileys
      // echoes the message back to us with fromMe=true and a @lid remoteJid.
      const msgId = sent?.key?.id;
      if (msgId) {
        this.pendingSendLidMap.set(msgId, jid);
        setTimeout(() => this.pendingSendLidMap.delete(msgId), 30_000);
      }

      logger.info({ jid, msgId }, 'WhatsApp message sent');
      return { success: true, platformMessageId: sent?.key?.id ?? undefined };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error, jid }, 'Failed to send WhatsApp message');
      return { success: false, error: msg };
    }
  }

  /**
   * Send an image file to a contact.
   * @param contactId  E.164 phone number, e.g. "+919876543210"
   * @param filePath   Absolute or relative path to the image file
   * @param caption    Optional caption shown below the image
   */
  async sendImage(contactId: string, filePath: string, caption?: string): Promise<SendResult> {
    if (!this.sock || !this.connected) {
      return { success: false, error: 'WhatsApp not connected' };
    }

    const jid = contactId.replace(/^\+/, '') + '@s.whatsapp.net';

    try {
      const sent = await this.sock.sendMessage(jid, {
        image: { url: filePath },
        caption: caption ?? '',
      });

      logger.info({ jid, filePath }, 'WhatsApp image sent');
      return { success: true, platformMessageId: sent?.key?.id ?? undefined };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error, jid, filePath }, 'Failed to send WhatsApp image');
      return { success: false, error: msg };
    }
  }

  // ─── LID probe ────────────────────────────────────────────────────────────

  /**
   * Subscribe to presence for each active DB contact.
   * presenceSubscribe triggers a server-side JID resolution that causes
   * contacts.upsert to fire with the LID mapping — without sending any message.
   */
  private async probeAllContactLids(): Promise<void> {
    if (!this.sock) return;

    const contacts = await configRepository.getAllActiveContacts();
    if (!contacts.length) return;

    logger.info({ count: contacts.length }, 'Subscribing to presence for all active contacts (LID probe)');

    for (const contact of contacts) {
      try {
        const jid = contact.unique_contact_id.replace(/^\+/, '') + '@s.whatsapp.net';
        await this.sock.presenceSubscribe(jid);
      } catch (err) {
        logger.warn({ err, contact: contact.contact_name }, 'presenceSubscribe failed (non-fatal)');
      }
    }
  }

  // ─── Internal connection management ───────────────────────────────────────

  /**
   * Resolves once the socket first reaches 'open'.
   * After that, reconnection is handled internally — no need to re-call this.
   */
  private startSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 60 s for the user to scan the QR code on first run.
      const qrTimeout = setTimeout(
        () => reject(new Error('WhatsApp QR not scanned within 60 s — restart and try again')),
        60_000,
      );
      let initialised = false;

      const boot = async () => {
        // Re-read auth state from disk on every boot so that credentials
        // saved during the previous session are picked up correctly.
        const { state, saveCreds } = await useMultiFileAuthState(env.WHATSAPP_SESSION_DIR);

        // Fetch WA version once; reuse on reconnects to avoid extra HTTP calls.
        if (!this.waVersion) {
          const { version, isLatest } = await fetchLatestBaileysVersion();
          this.waVersion = version;
          logger.info({ version: version.join('.'), isLatest }, 'WhatsApp Web version');
        }

        this.sock = makeWASocket({
          version: this.waVersion,
          auth: state,
          // warn level so Baileys' own internals can log errors/warnings
          // that affect message delivery (e.g. missing keys, decrypt failures)
          logger: logger.child({ name: 'baileys', level: 'warn' }) as never,
          // Required for WhatsApp delivery retries — without this the server
          // may silently drop messages that need a re-send confirmation.
          getMessage: async (_key) => ({ conversation: '' }),
        });

        // ── Persist credentials on every change ──────────────────────────
        this.sock.ev.on('creds.update', saveCreds);

        // ── Build LID → phone map from contact sync ───────────────────────
        // WhatsApp's multi-device privacy routing uses opaque numeric LIDs
        // instead of phone numbers. We need this map to resolve an incoming
        // message's @lid JID back to the E.164 number stored in our DB.
        const indexContact = (c: { id?: string; lid?: string }) => {
          if (c.lid && c.id && !this.lidToPhone.has(c.lid)) {
            this.lidToPhone.set(c.lid, c.id);
            logger.info({ lid: c.lid, phone: c.id }, 'LID → phone mapping learned');
            this.saveLidMap();
          }
        };

        // contacts.upsert / contacts.update — fire as contacts sync in over time
        this.sock.ev.on('contacts.upsert', (contacts) => contacts.forEach(indexContact));
        this.sock.ev.on('contacts.update', (updates) => updates.forEach(indexContact));

        // messaging-history.set — Baileys v7 full initial sync dump (contacts + chats)
        this.sock.ev.on('messaging-history.set', ({ contacts }) => {
          if (contacts?.length) {
            logger.info({ count: contacts.length }, 'messaging-history.set: indexing contacts');
            contacts.forEach(indexContact);
          }
        });

        // ── Connection state ──────────────────────────────────────────────
        this.sock.ev.on('connection.update', (update) => {
          const { connection, lastDisconnect, qr } = update;

          if (qr) {
            logger.info('Scan the QR code with WhatsApp → Settings → Linked Devices → Link a Device');
            qrcode.generate(qr, { small: true });
          }

          if (connection === 'open') {
            clearTimeout(qrTimeout);
            this.connected = true;
            this.reconnectAttempts = 0;
            this.lastConnectedAt = new Date();
            const me = this.sock?.user;
            this.connectedAs = me?.id?.split(':')[0] ?? null;
            logger.info({ connectedAs: me?.id, name: me?.name }, 'WhatsApp connected');
            console.log('[WA] Connected as:', me?.id);
            logConnectionEvent('connected', `connectedAs: ${me?.id ?? 'unknown'}`);

            if (!initialised) {
              initialised = true;
              resolve();
            }

            // Proactively probe every DB contact's phone number so we learn
            // their LID immediately — don't wait for contacts.upsert to fire.
            this.probeAllContactLids().catch(err =>
              logger.warn({ err }, 'LID probe failed (non-fatal)')
            );
          }

          if (connection === 'close') {
            this.connected = false;
            const statusCode = (lastDisconnect?.error as any)?.output?.statusCode as number | undefined;
            logger.warn({ statusCode }, 'WhatsApp connection closed');

            if (statusCode === DisconnectReason.loggedOut) {
              // Session explicitly revoked in the phone — must re-scan QR.
              clearTimeout(qrTimeout);
              const msg = `WhatsApp logged out. Delete "${env.WHATSAPP_SESSION_DIR}" and restart to re-link.`;
              logger.error(msg);
              logConnectionEvent('fatal', msg, statusCode);
              if (!initialised) reject(new Error(msg));
              return;
            }

            if (statusCode === (DisconnectReason as any).badSession) {
              // Corrupted session file — warn loudly but still try to reconnect
              // (useMultiFileAuthState will reload from disk).
              logger.error('Bad session detected — consider deleting the session dir if reconnects keep failing');
              logConnectionEvent('fatal', 'Bad session — may need QR re-scan', statusCode);
            }

            if (!this.closedByUser) {
              // Reconnect for ANY non-fatal close — known codes AND unknown ones.
              // Previously unknown codes fell off silently (connected=false, no reconnect,
              // no Supabase log). Now they are treated the same as known disconnect codes.
              const isKnownCode = RECONNECTABLE_CODES.has(statusCode);

              this.reconnectAttempts++;
              const delay = Math.min(
                BACKOFF_BASE_MS * 2 ** (this.reconnectAttempts - 1),
                BACKOFF_MAX_MS,
              );
              logger.info(
                { attempt: this.reconnectAttempts, delayMs: delay, statusCode, knownCode: isKnownCode },
                'Scheduling WhatsApp reconnect',
              );
              logConnectionEvent(
                'disconnected',
                `statusCode: ${statusCode ?? 'unknown'}${isKnownCode ? '' : ' (unrecognised code — reconnecting anyway)'}`,
                statusCode,
              );
              logConnectionEvent(
                'reconnecting',
                `attempt ${this.reconnectAttempts}, delay ${delay}ms`,
              );
              setTimeout(() => boot().catch(err => logger.error({ err }, 'Reconnect boot failed')), delay);
            }
          }
        });

        // ── Inbound messages ──────────────────────────────────────────────
        this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
          // Raw console.log bypasses pino + pipe buffering — confirms the event fired
          console.log('[WA] messages.upsert fired  type=%s  count=%d', type, messages.length);
          logger.info({ type, count: messages.length }, 'messages.upsert event received');

          for (const msg of messages) {
            const rawJid  = msg.key.remoteJid ?? '(none)';
            const fromMe  = msg.key.fromMe ?? false;
            const msgType = msg.message ? Object.keys(msg.message)[0] : '(empty)';

            if (fromMe) {
              // Echo of a message we sent — check if it reveals a LID mapping.
              // Echoes arrive as type=append so we must handle them before the
              // notify-only guard below.
              console.log('[WA] fromMe echo: type=%s rawJid=%s msgId=%s', type, rawJid, msg.key.id);
              if (rawJid.endsWith('@lid') && msg.key.id) {
                const phoneJid = this.pendingSendLidMap.get(msg.key.id);
                if (phoneJid && !this.lidToPhone.has(rawJid)) {
                  this.lidToPhone.set(rawJid, phoneJid);
                  logger.info({ lid: rawJid, phone: phoneJid }, 'Learned LID from sent-message echo ✓');
                  this.saveLidMap();
                  this.pendingSendLidMap.delete(msg.key.id);
                }
              }
              continue; // never store outbound echoes as inbound messages
            }

            // From here on we only care about live inbound messages.
            if (type !== 'notify') continue;

            logger.info({ rawJid, fromMe, msgType }, 'Processing raw message');

            const jid = msg.key.remoteJid;
            if (!jid) { logger.warn('Skipping — remoteJid is null'); continue; }

            if (jid.endsWith('@g.us')) {
              logger.info({ jid }, 'Skipping — group message');
              continue;
            }

            const text =
              msg.message?.conversation ??
              msg.message?.extendedTextMessage?.text;

            if (!text) {
              logger.info({ rawJid, msgType }, 'Skipping — no text content (image/audio/sticker/etc.)');
              continue;
            }

            // Resolve LID → phone JID if needed.
            // New WhatsApp privacy routing sends @lid instead of @s.whatsapp.net.
            let resolvedJid = jid;
            if (jid.endsWith('@lid')) {
              let phoneJid = this.lidToPhone.get(jid);

              if (!phoneJid) {
                // Not in map yet — try to auto-resolve via pushName ↔ DB contact name match.
                // presenceSubscribe may also eventually trigger contacts.upsert.
                this.sock?.presenceSubscribe(jid).catch(() => {});
                phoneJid = await this.tryAutoResolveLid(jid, msg.pushName) ?? undefined;
              }

              if (phoneJid) {
                resolvedJid = phoneJid;
                logger.info({ lid: jid, resolvedJid }, 'Resolved LID → phone JID');
              } else {
                continue; // logged inside tryAutoResolveLid
              }
            }

            // Strip device suffix if present:
            // "19195187626:0@s.whatsapp.net" → "+19195187626"
            // "919876543210@s.whatsapp.net"  → "+919876543210"
            const phone = '+' + resolvedJid.split('@')[0].split(':')[0];
            logger.info({ rawJid, resolvedJid, phone, length: text.length }, 'Inbound WhatsApp message — looking up contact');

            try {
              const config = await configRepository.findByChannelAndContact('whatsapp', phone);
              if (!config) {
                logger.warn({ phone }, 'Unknown sender — no matching config row for this number');
                continue;
              }
              logger.info({ phone, contactName: config.contact_name }, 'Contact matched in DB');

              await messageRepository.create({
                config_id: config.id,
                message: text,
                direction: 'inbound',
                status: 'delivered',
                error_details: null,
                ai_model_used: null,
                ai_prompt_tokens: null,
                ai_completion_tokens: null,
              });

              logger.info(
                { configId: config.id, contactName: config.contact_name },
                'Inbound message stored',
              );
            } catch (err) {
              logger.error({ err, from: phone }, 'Failed to store inbound message');
            }
          }
        });
      };

      boot().catch(reject);
    });
  }
}
