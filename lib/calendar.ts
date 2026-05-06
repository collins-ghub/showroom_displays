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

const LOOKAHEAD_MS = 30 * 60 * 1000;
const LOOKBACK_MS = 5 * 60 * 1000; // grace for events that just ended

// Module-level cache: avoid hitting the Calendar API on every poll.
let cache: { at: number; event: ShowroomEvent | null } | null = null;
const CACHE_TTL_MS = 60 * 1000;

export async function findCurrentOrUpcomingEvent(
  now: Date = new Date()
): Promise<ShowroomEvent | null> {
  if (cache && now.getTime() - cache.at < CACHE_TTL_MS) {
    return cache.event;
  }

  const calendarId = required("GOOGLE_CALENDAR_ID", process.env.GOOGLE_CALENDAR_ID);
  const timeMin = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const timeMax = new Date(now.getTime() + LOOKAHEAD_MS).toISOString();

  const res = await calClient().events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 10,
  });

  const events = res.data.items ?? [];
  // Prefer the event currently in progress; otherwise the soonest upcoming.
  let chosen: (typeof events)[number] | null = null;
  for (const ev of events) {
    const startStr = ev.start?.dateTime ?? ev.start?.date;
    const endStr = ev.end?.dateTime ?? ev.end?.date;
    if (!startStr || !endStr) continue;
    const start = new Date(startStr).getTime();
    const end = new Date(endStr).getTime();
    if (start <= now.getTime() && now.getTime() < end) {
      chosen = ev;
      break;
    }
    if (!chosen && start > now.getTime()) chosen = ev;
  }

  let event: ShowroomEvent | null = null;
  if (chosen) {
    const startsAt = chosen.start?.dateTime ?? chosen.start?.date ?? "";
    event = {
      name: (chosen.summary ?? "").trim() || "Guest",
      startsAt,
      endsAt: chosen.end?.dateTime ?? chosen.end?.date ?? "",
      startsAtFormatted: formatTime(startsAt),
    };
  }

  cache = { at: now.getTime(), event };
  return event;
}
