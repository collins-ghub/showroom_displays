import { google } from "googleapis";

export type ShowroomEvent = {
  name: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  startsAtFormatted: string; // e.g. "10:30 AM"
};

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: process.env.SHOWROOM_TIMEZONE || undefined,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

let cachedClient: ReturnType<typeof makeClient> | null = null;
function makeClient() {
  const email = required("GOOGLE_SERVICE_ACCOUNT_EMAIL", process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  // Vercel stores newlines as literal "\n" — convert back.
  const key = required("GOOGLE_SERVICE_ACCOUNT_KEY", process.env.GOOGLE_SERVICE_ACCOUNT_KEY).replace(
    /\\n/g,
    "\n"
  );
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  return google.calendar({ version: "v3", auth });
}
function calClient() {
  if (!cachedClient) cachedClient = makeClient();
  return cachedClient;
}

const LOOKBACK_MS = 5 * 60 * 1000; // grace for events that just ended

// Module-level cache: avoid hitting the Calendar API on every poll.
let cache: { at: number; events: ShowroomEvent[] } | null = null;
const CACHE_TTL_MS = 60 * 1000;

// Offset (zone - UTC) in ms for the given instant, computed from Intl so we
// don't need a tz library.
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour === 24 ? 0 : +map.hour,
    +map.minute,
    +map.second
  );
  return asUTC - date.getTime();
}

// End of the current calendar day (23:59:59.999) in the showroom timezone,
// returned as an ISO instant.
function endOfDayISO(now: Date): string {
  const tz = process.env.SHOWROOM_TIMEZONE;
  if (!tz) {
    const d = new Date(now);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of dateParts) map[p.type] = p.value;
  const offset = tzOffsetMs(now, tz);
  const endLocalAsUTC = Date.UTC(+map.year, +map.month - 1, +map.day, 23, 59, 59, 999);
  return new Date(endLocalAsUTC - offset).toISOString();
}

// All appointments from now (minus a short grace) through the end of the
// showroom's day, in chronological order. The display rotates through them.
export async function listTodaysRemainingEvents(
  now: Date = new Date()
): Promise<ShowroomEvent[]> {
  if (cache && now.getTime() - cache.at < CACHE_TTL_MS) {
    return cache.events;
  }

  const calendarId = required("GOOGLE_CALENDAR_ID", process.env.GOOGLE_CALENDAR_ID);
  const timeMin = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const timeMax = endOfDayISO(now);

  // If we're already past end of day (clock skew), nothing to show.
  if (new Date(timeMax).getTime() <= new Date(timeMin).getTime()) {
    cache = { at: now.getTime(), events: [] };
    return [];
  }

  const res = await calClient().events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });

  const events: ShowroomEvent[] = [];
  for (const ev of res.data.items ?? []) {
    const startStr = ev.start?.dateTime ?? ev.start?.date;
    const endStr = ev.end?.dateTime ?? ev.end?.date;
    if (!startStr || !endStr) continue;
    const summary = (ev.summary ?? "").trim();
    // If the title is like "Collins Showroom Visit (Test Visitor)", show just
    // the visitor name in parentheses.
    const paren = summary.match(/\(([^)]+)\)\s*$/);
    const name = (paren ? paren[1] : summary).trim() || "Guest";
    events.push({
      name,
      startsAt: startStr,
      endsAt: endStr,
      startsAtFormatted: formatTime(startStr),
    });
  }

  cache = { at: now.getTime(), events };
  return events;
}
