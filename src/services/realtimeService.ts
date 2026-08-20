/**
 * Supabase Realtime — one shared socket, ref-counted per-table channels.
 *
 * Realtime is an **accelerator, never the only path**. Every caller keeps the
 * poll it has today; a live channel only lets that poll stretch to a slower
 * backstop cadence (`LIVE_POLL_INTERVAL_MS`). When the socket cannot connect
 * (offline, blocked, quota exhausted) callers hear `"degraded"` and snap back
 * to their original interval, so behaviour is byte-for-byte what it is now.
 *
 * Design notes (see docs/plans/2026-08-20-realtime-design.md):
 * - `@supabase/realtime-js` standalone, **lazily imported** on first use so the
 *   ~16 KB gzip lands in its own chunk and initial JS is unchanged. The client
 *   is never constructed at module load.
 * - Auth is delegated wholesale to `ensureFreshToken()` via the library's
 *   `accessToken` callback — it already owns the 30s expiry buffer and the
 *   `_refreshPromise` dedupe, and it is the *only* thing allowed to rotate the
 *   GoTrue refresh token. No refresh logic lives here.
 * - **INSERT and UPDATE only.** DELETE is deliberately never bound: RLS does
 *   not apply to DELETE, and delete payloads reach every subscriber on the
 *   channel. Deletions stay with delta-sync's access-checked tombstone path.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";
import { ensureFreshToken } from "../api";
import type { RealtimeClient, RealtimeChannel } from "@supabase/realtime-js";

/**
 * Backstop cadence a poll may stretch to while its channel is SUBSCRIBED.
 * Deliberately still frequent enough to be a real safety net: if the feed goes
 * quiet without the socket noticing (e.g. the table is dropped from the
 * publication) nothing goes stale by more than this.
 */
export const LIVE_POLL_INTERVAL_MS = 30_000;

/**
 * Phoenix uses the endpoint verbatim when it is absolute, so the scheme must
 * already be `wss:` — `new WebSocket("https://…")` throws. Derived from
 * `SUPABASE_URL` rather than hardcoded so there is only ever one project URL.
 * `ws://` would be blocked from the `tauri://localhost` origin; Supabase is
 * wss-only anyway.
 */
const REALTIME_URL = `${SUPABASE_URL.replace(/^http/, "ws")}/realtime/v1`;

/** How long a channel with no listeners is kept alive before teardown. */
const CHANNEL_GRACE_MS = 5_000;

/** How long the socket stays up with zero channels before it disconnects. */
const IDLE_DISCONNECT_MS = 30_000;

/** A change-feed row. Postgres sends the full new row on INSERT and UPDATE. */
export type RealtimeRow = Record<string, unknown>;

/** Whether the live feed for a subscription is usable right now. */
export type RealtimeStatus = "connected" | "degraded";

export interface TableSubscription {
  /** Postgres table name in the `public` schema, e.g. `"space_messages"`. */
  table: string;
  /** PostgREST-style row filter, e.g. `` `space_id=eq.${id}` ``. */
  filter?: string;
  /** New row inserted. Apply by id — the poll may deliver the same row too. */
  onInsert?: (row: RealtimeRow) => void;
  /** Row updated. Apply by id — idempotent, same reason as `onInsert`. */
  onUpdate?: (row: RealtimeRow) => void;
  /** Fires on every transition, plus once on attach if already connected. */
  onStatus?: (status: RealtimeStatus) => void;
}

type Listener = Omit<TableSubscription, "table" | "filter">;

type ChannelEntry = {
  readonly table: string;
  readonly filter?: string;
  readonly listeners: Set<Listener>;
  channel: RealtimeChannel | null;
  status: RealtimeStatus;
  closed: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

let client: RealtimeClient | null = null;
let clientPromise: Promise<RealtimeClient> | null = null;
const entries = new Map<string, ChannelEntry>();

/**
 * The socket lives for the whole session, so every log line here is a line that
 * could repeat forever. Warn once per distinct message, and only in dev.
 * Nothing token-shaped is ever passed in — only table names and status strings.
 */
const warned = new Set<string>();
function warnOnce(message: string, detail?: unknown): void {
  if (!import.meta.env.DEV) return;
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message, detail);
}

/**
 * Token source for the socket. Delegates entirely to `ensureFreshToken()`;
 * the only thing added is a null on failure, because the library expects
 * `Promise<string | null>` and a throw here would surface as an unhandled
 * rejection. A failed refresh already triggers auto-logout inside api.ts.
 */
async function readAccessToken(): Promise<string | null> {
  try {
    return await ensureFreshToken();
  } catch {
    return null;
  }
}

async function getClient(): Promise<RealtimeClient> {
  if (client) return client;
  if (!clientPromise) {
    clientPromise = import("@supabase/realtime-js")
      .then((mod) => {
        // `params.apikey` is mandatory — the constructor throws without it.
        client = new mod.RealtimeClient(REALTIME_URL, {
          params: { apikey: SUPABASE_ANON_KEY },
          accessToken: readAccessToken,
          disconnectOnEmptyChannelsAfterMs: IDLE_DISCONNECT_MS,
        });
        return client;
      })
      .catch((err) => {
        clientPromise = null; // let a later subscription retry the import
        throw err;
      });
  }
  return clientPromise;
}

/** Channels are shared by table+filter, so two panels on one space reuse one. */
function keyOf(table: string, filter?: string): string {
  return filter ? `${table}:${filter}` : table;
}

/** Topic is opaque to the server; keep it to characters that survive a URL. */
function topicOf(key: string): string {
  return `ev:${key.replace(/[^a-zA-Z0-9_.:-]/g, "-")}`;
}

function emit(entry: ChannelEntry, kind: "onInsert" | "onUpdate", row: RealtimeRow): void {
  for (const listener of [...entry.listeners]) {
    try {
      listener[kind]?.(row);
    } catch {
      /* one throwing listener must not tear down the feed for the others */
    }
  }
}

function setStatus(entry: ChannelEntry, status: RealtimeStatus): void {
  if (entry.status === status) return;
  entry.status = status;
  for (const listener of [...entry.listeners]) {
    try {
      listener.onStatus?.(status);
    } catch {
      /* ignore */
    }
  }
}

async function openChannel(key: string, entry: ChannelEntry): Promise<void> {
  let socket: RealtimeClient;
  try {
    socket = await getClient();
  } catch (err) {
    warnOnce("realtime: client unavailable, staying on polling", err);
    setStatus(entry, "degraded");
    return;
  }
  if (entry.closed) return;

  const channel = socket.channel(topicOf(key));

  // INSERT + UPDATE only. DELETE is intentionally absent: it is not RLS-filtered
  // and its payload reaches every subscriber, so tombstones stay with delta-sync.
  channel.on<RealtimeRow>(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: entry.table, filter: entry.filter },
    (payload) => emit(entry, "onInsert", payload.new),
  );
  channel.on<RealtimeRow>(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: entry.table, filter: entry.filter },
    (payload) => emit(entry, "onUpdate", payload.new),
  );

  entry.channel = channel;
  channel.subscribe((status, err) => {
    // REALTIME_SUBSCRIBE_STATES is a runtime enum; comparing as a string keeps
    // this module free of any eager (non-lazy) import from the package.
    const state = String(status);
    if (state === "SUBSCRIBED") {
      setStatus(entry, "connected");
      return;
    }
    // CHANNEL_ERROR / TIMED_OUT / CLOSED — the client rejoins on its own backoff,
    // so all we do is put callers back on their normal polling cadence and wait.
    setStatus(entry, "degraded");
    if (state !== "CLOSED") warnOnce(`realtime: ${entry.table} ${state}`, err);
  });
}

/**
 * Tear the channel down once nothing has referenced it for `CHANNEL_GRACE_MS`.
 * The grace matters: without it, flipping between panels would remove and
 * re-add the same topic while the previous removal is still in flight, and the
 * client would hand back the leaving channel instead of a fresh one.
 */
function scheduleRelease(key: string, entry: ChannelEntry): void {
  if (entry.idleTimer) return;
  entry.idleTimer = setTimeout(() => {
    entry.idleTimer = null;
    if (entry.listeners.size > 0) return; // re-subscribed during the grace
    entry.closed = true;
    entries.delete(key);
    const channel = entry.channel;
    entry.channel = null;
    // Once the last channel goes, the client's own idle timer drops the socket.
    if (channel) void client?.removeChannel(channel);
  }, CHANNEL_GRACE_MS);
}

/**
 * Subscribe to INSERT/UPDATE on one table, optionally filtered to one row set.
 * Returns an unsubscribe function; the last unsubscriber releases the channel.
 *
 * Safe to call before the library has loaded — the socket is opened in the
 * background and `onStatus` reports `"connected"` only once it really is.
 */
export function subscribeToTable(sub: TableSubscription): () => void {
  const { table, filter, ...listener } = sub;
  const key = keyOf(table, filter);

  let entry = entries.get(key);
  if (!entry) {
    entry = {
      table,
      filter,
      listeners: new Set<Listener>(),
      channel: null,
      status: "degraded",
      closed: false,
      idleTimer: null,
    };
    entries.set(key, entry);
    void openChannel(key, entry);
  } else if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  const shared = entry;
  shared.listeners.add(listener);

  // A late joiner on an already-live channel would otherwise never hear about it.
  if (shared.status === "connected") {
    queueMicrotask(() => {
      if (shared.listeners.has(listener)) listener.onStatus?.("connected");
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    shared.listeners.delete(listener);
    if (shared.listeners.size === 0 && !shared.closed) scheduleRelease(key, shared);
  };
}
