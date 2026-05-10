/**
 * Time-awareness helpers for Core Chat.
 *
 * These are shared by orchestration.service.ts (system prompt + history rendering)
 * and can later replace the inline helpers in graph/nodes/build-prompts.node.ts.
 */

export interface TimeMeta {
  iso: string;      // ISO8601 timestamp of "now"
  human: string;    // e.g. "Sunday, May 10, 2026 at 2:45 PM IST"
  weekday: string;  // e.g. "Sunday"
  tz: string;       // e.g. "Asia/Kolkata" or the resolved server zone
}

export interface GapMeta {
  gapMs: number;
  gapLabel: string; // e.g. "2 days", "4 hours", "just now"
  isReturning: boolean; // gap > 6h
  isNewSession: boolean; // gap > 24h — triggers auto new-session
}

const RETURNING_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6h
const NEW_SESSION_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Return the current wall-clock time formatted in the given IANA timezone.
 * Falls back to the server's resolved timezone when tz is falsy or invalid.
 */
export function formatNowInTz(tz?: string | null): TimeMeta {
  const now = new Date();
  const iso = now.toISOString();

  let resolvedTz = tz && tz.trim() ? tz.trim() : Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Validate tz — fall back to server zone if invalid
  let weekday = '';
  let human = '';
  try {
    weekday = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: resolvedTz,
    }).format(now);

    const datePart = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: resolvedTz,
    }).format(now);

    const timePart = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: resolvedTz,
      timeZoneName: 'short',
    }).format(now);

    // timePart looks like "2:45 PM GMT+5:30" — extract abbreviation at the end
    human = `${datePart} at ${timePart}`;
  } catch {
    // Invalid tz — retry with server zone
    resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: resolvedTz }).format(now);
    const datePart = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: resolvedTz,
    }).format(now);
    const timePart = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: resolvedTz, timeZoneName: 'short',
    }).format(now);
    human = `${datePart} at ${timePart}`;
  }

  return { iso, human, weekday, tz: resolvedTz };
}

/**
 * Human relative time, e.g. "just now", "12 minutes ago", "2 days ago".
 * Future dates are returned as "in 3 days" etc. (defensive, rarely used).
 */
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return 'unknown';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 'unknown';

  const diffMs = Date.now() - d.getTime();
  const abs = Math.abs(diffMs);
  const suffix = diffMs >= 0 ? 'ago' : 'from now';
  const prefix = diffMs >= 0 ? '' : 'in ';

  const mins = Math.floor(abs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (mins < 1) return diffMs >= 0 ? 'just now' : 'in a moment';
  if (mins < 60) return `${prefix}${mins} minute${mins === 1 ? '' : 's'}${diffMs >= 0 ? ' ' + suffix : ''}`.trim();
  if (hours < 24) return `${prefix}${hours} hour${hours === 1 ? '' : 's'}${diffMs >= 0 ? ' ' + suffix : ''}`.trim();
  if (days < 7) return `${prefix}${days} day${days === 1 ? '' : 's'}${diffMs >= 0 ? ' ' + suffix : ''}`.trim();
  if (weeks < 5) return `${prefix}${weeks} week${weeks === 1 ? '' : 's'}${diffMs >= 0 ? ' ' + suffix : ''}`.trim();
  if (months < 12) return `${prefix}${months} month${months === 1 ? '' : 's'}${diffMs >= 0 ? ' ' + suffix : ''}`.trim();
  return `${prefix}${years} year${years === 1 ? '' : 's'}${diffMs >= 0 ? ' ' + suffix : ''}`.trim();
}

/**
 * Coarse "how long was the user silent?" label, used for the returning-user banner.
 * Returns a bare label (no "ago" suffix), e.g. "2 days", "4 hours".
 */
function gapLabel(gapMs: number): string {
  if (gapMs < 60_000) return 'a moment';
  const mins = Math.floor(gapMs / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'}`;
}

/**
 * Compute how long the user has been silent since their last turn.
 *
 * @param lastAt  Timestamp of the most recent prior message (before the one just saved).
 *                Pass `null` if there is no prior history.
 * @param now     Reference "now" (usually `new Date()`).
 */
export function computeSessionGap(lastAt: Date | string | null | undefined, now: Date = new Date()): GapMeta {
  if (!lastAt) {
    return { gapMs: 0, gapLabel: 'first message', isReturning: false, isNewSession: false };
  }
  const last = typeof lastAt === 'string' ? new Date(lastAt) : lastAt;
  const gapMs = Math.max(0, now.getTime() - last.getTime());
  return {
    gapMs,
    gapLabel: gapLabel(gapMs),
    isReturning: gapMs > RETURNING_THRESHOLD_MS,
    isNewSession: gapMs > NEW_SESSION_THRESHOLD_MS,
  };
}

/**
 * Strip any leading `[time ago]` metadata tag from assistant output.
 * Defensive: the system prompt already tells the model not to echo these,
 * but some models occasionally copy the formatting. This guarantees clean prose
 * is persisted to the DB and sent to the UI regardless.
 *
 * Matches the exact set of labels produced by `timeAgo()` and `gapLabel()`.
 */
const LEAK_PREFIX_RE =
  /^\s*\[(just now|in a moment|unknown|a moment|(?:\d+\s+(?:minute|hour|day|week|month|year)s?\s+(?:ago|from now))|in\s+\d+\s+(?:minute|hour|day|week|month|year)s?)\]\s*/i;

export function stripLeakedTimePrefix(text: string): string {
  if (!text) return text;
  // Strip up to 2 leading tags (rare double-prefix from nested replay)
  let out = text;
  for (let i = 0; i < 2; i++) {
    const m = LEAK_PREFIX_RE.exec(out);
    if (!m) break;
    out = out.slice(m[0].length);
  }
  return out;
}
