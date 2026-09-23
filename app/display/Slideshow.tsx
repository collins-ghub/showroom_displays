"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageWithUrl } from "@/lib/images";
import { renderWelcomeTemplate, type DisplaySettings } from "@/lib/settings";
import type { ShowroomEvent } from "@/lib/calendar";

function isVideo(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("video/");
}

// Is the video buffered well enough to play through without stalling?
// HAVE_ENOUGH_DATA: the browser estimates it can reach the end at the current
// download rate. Anything less risks starting, freezing mid-play, and getting
// cut off by the stall watchdog.
function videoReady(el: HTMLVideoElement | undefined): boolean {
  return !!el && el.readyState >= 4;
}

type State = {
  images: ImageWithUrl[];
  settings: DisplaySettings;
  version: string;
  events: ShowroomEvent[];
  build: string;
};

type Props = {
  initial: State;
};

const POLL_MS = 15_000;
const EVENT_ROTATE_MS = 8_000;
// Max time to wait for a slide's image to finish loading before starting its
// timer. Generous: on a slow showroom connection (especially while videos
// buffer) a fresh image can take a while, and starting early cuts the slide
// short. Only a safety net for a truly hung download.
const IMAGE_LOAD_CAP_MS = 30_000;
// Once loaded, how long to give the browser to decode before starting the
// timer regardless (decode() misbehaves in some embedded browsers).
const DECODE_CAP_MS = 3_000;
// How long a video may sit buffering before it first starts playing.
const VIDEO_START_GRACE_MS = 60_000;
// Once playing, if the playhead hasn't moved for this long, give up on it and
// advance rather than sitting on a black screen forever.
const VIDEO_STALL_MS = 20_000;
// Background video buffering queue: max wait per video before moving on.
const VIDEO_LOAD_TIMEOUT_MS = 90_000;

function shuffled<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Position of the next slide after `fromPos` that can be shown right now: any
// image, or a video that has buffered enough. Bounded so we always land
// somewhere even if every other slide is an unready video.
function nextShowable(
  list: ImageWithUrl[],
  fromPos: number,
  videos: Map<string, HTMLVideoElement>
): number {
  const len = list.length;
  let next = (fromPos + 1) % len;
  for (let step = 0; step < len; step++) {
    const cand = list[next];
    if (!isVideo(cand.mime_type) || videoReady(videos.get(cand.id))) break;
    next = (next + 1) % len;
  }
  return next;
}

export default function Slideshow({ initial }: Props) {
  const [state, setState] = useState<State>(initial);
  // The slide on screen, by id rather than by position. Reshuffles and list
  // refreshes can reorder the deck underneath us without ever changing what's
  // visible; only an explicit move does that.
  const [currentId, setCurrentId] = useState<string | null>(initial.images[0]?.id ?? null);
  // Bumped to re-arm the current slide's timer when a move lands back on the
  // same slide (everything else was an unready video).
  const [tick, setTick] = useState(0);
  const [eventIndex, setEventIndex] = useState(0);
  const [shuffleEpoch, setShuffleEpoch] = useState(0);
  const versionRef = useRef(initial.version);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imgRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  // Latest visible id, readable from callbacks without stale closures.
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  // Shuffle order (ids) for the current pass, kept stable while the image
  // list changes underneath us. See the displayImages memo.
  const orderRef = useRef<string[]>([]);
  const orderEpochRef = useRef(-1);
  // Set when a pass completes. The deck effect starts the next pass once the
  // reshuffled order exists; until then further moves are ignored.
  const newPassRef = useRef(false);
  // Id of the video currently playing, so a refresh doesn't rewind it.
  const playingIdRef = useRef<string | null>(null);
  // A slide to jump to once the deck has settled: carried across a reload in
  // the URL (?s=<id>) so a self-update is invisible, or a random start when
  // shuffling so a relaunch (screensaver) doesn't always open on slide one.
  // Read here rather than in an effect so it's known before the first effects
  // run; it never affects rendered output, so hydration is unaffected.
  const pendingIdRef = useRef<string | null>(
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("s")
  );
  // Videos we've already asked the browser to buffer. load() resets an element
  // and discards what it had, so never call it twice on the same video.
  const startedLoadsRef = useRef<Set<string>>(new Set());

  // Reorder slides when shuffle is on. Re-roll each time the loop completes
  // so the order isn't the same every cycle.
  const displayImages = useMemo(() => {
    // Never shuffle on the first render (epoch 0): it runs on the server too,
    // and a different random order in the browser is a hydration mismatch
    // (React errors #418/#423). A mount effect bumps the epoch to 1 so real
    // shuffling starts right after hydration.
    if (!state.settings.shuffle || state.images.length < 2 || shuffleEpoch === 0) {
      return state.images;
    }
    const byId = new Map(state.images.map((i) => [i.id, i] as const));
    let order: string[];
    if (orderEpochRef.current !== shuffleEpoch) {
      // A new pass: fresh random order.
      order = shuffled(state.images.map((i) => i.id));
      // Avoid an immediate repeat of the slide that closed out the last pass.
      const lastShown = orderRef.current.at(-1);
      if (order.length > 1 && lastShown && order[0] === lastShown) {
        [order[0], order[1]] = [order[1], order[0]];
      }
      orderEpochRef.current = shuffleEpoch;
    } else {
      // Same pass, but the image list changed (upload / removal / toggle).
      // Keep the existing order so the slide on screen doesn't move, drop ids
      // that are gone, and append the new ones (they'll show later this pass).
      order = orderRef.current.filter((id) => byId.has(id));
      const known = new Set(order);
      const fresh = state.images.filter((i) => !known.has(i.id)).map((i) => i.id);
      order = [...order, ...shuffled(fresh)];
    }
    orderRef.current = order;
    return order.map((id) => byId.get(id)!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.images, state.settings.shuffle, shuffleEpoch]);

  const currentSlide = currentId
    ? (displayImages.find((s) => s.id === currentId) ?? null)
    : null;

  // Start shuffling once mounted (see the displayImages memo). Also pick a
  // random starting slide unless one was carried in the URL.
  useEffect(() => {
    if (!state.settings.shuffle) return;
    if (!pendingIdRef.current && state.images.length > 1) {
      const pick = state.images[Math.floor(Math.random() * state.images.length)];
      pendingIdRef.current = pick?.id ?? null;
    }
    setShuffleEpoch((e) => (e === 0 ? 1 : e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings.shuffle]);

  // Poll for changes; replace state when version bumps.
  useEffect(() => {
    let stopped = false;
    async function tickPoll() {
      try {
        const res = await fetch("/api/display/state", { cache: "no-store" });
        if (!res.ok) return;
        const next: State = await res.json();
        if (stopped) return;
        // A new deploy shipped. This poll only refreshes data, never the app
        // code, so a display that's been running for days would otherwise keep
        // executing stale JavaScript indefinitely. Reload to pick it up.
        if (next.build && next.build !== initial.build) {
          // Reload via a cache-busting URL, once per new build, carrying the
          // current slide so the update is invisible. The once-per-build guard
          // prevents a loop if an embedded browser keeps serving cached HTML.
          const url = new URL(window.location.href);
          if (url.searchParams.get("b") === next.build) return;
          url.searchParams.set("b", next.build);
          const cur = currentIdRef.current;
          if (cur) url.searchParams.set("s", cur);
          else url.searchParams.delete("s");
          window.location.replace(url.toString());
          return;
        }
        if (next.version !== versionRef.current) {
          versionRef.current = next.version;
          // The visible slide is tracked by id, so replacing the list never
          // changes what's on screen (see the deck effect below).
          setState(next);
          setEventIndex(0);
        }
      } catch {
        // Fire Sticks lose Wi-Fi sometimes; just try again next interval.
      }
    }
    const id = setInterval(tickPoll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  // Move on from `fromId`. Guarded so that only the slide actually on screen
  // can advance the show: a late timer, a non-current video's `ended`, or a
  // stale stall-watchdog is ignored instead of skipping a slide.
  const advanceFrom = useCallback(
    (fromId: string | null) => {
      if (newPassRef.current || fromId !== currentIdRef.current) return;
      const list = displayImages;
      const len = list.length;
      if (len === 0) return;
      const pos = Math.max(0, list.findIndex((s) => s.id === fromId));
      const next = nextShowable(list, pos, videoRefs.current);
      if (next <= pos && state.settings.shuffle && len > 1) {
        // Pass complete: re-roll the order. The deck effect starts the new
        // pass once the reshuffled order exists; until then the current slide
        // simply stays up, so there's no stray frame of some other slide.
        newPassRef.current = true;
        setShuffleEpoch((e) => e + 1);
        return;
      }
      const nextId = list[next].id;
      if (nextId === fromId) {
        setTick((t) => t + 1);
      } else {
        // Update the ref eagerly so a second call before React re-renders
        // (timer and `ended` in the same instant, say) can't double-advance.
        currentIdRef.current = nextId;
        setCurrentId(nextId);
      }
    },
    [displayImages, state.settings.shuffle]
  );
  const advanceRef = useRef(advanceFrom);
  advanceRef.current = advanceFrom;

  // When the deck changes (refresh, reshuffle): apply a pending target, start
  // a new pass, or recover if the visible slide vanished. Otherwise leave the
  // visible slide exactly where it is.
  useEffect(() => {
    const list = displayImages;
    if (list.length === 0) return;
    // With shuffle on, the very first list is the unshuffled server order and
    // is about to be replaced; wait for the shuffled one before positioning.
    if (state.settings.shuffle && shuffleEpoch === 0) return;
    const showable = (id: string | null) => {
      if (!id) return false;
      const s = list.find((x) => x.id === id);
      return !!s && (!isVideo(s.mime_type) || videoReady(videoRefs.current.get(s.id)));
    };
    const go = (id: string) => {
      if (id === currentIdRef.current) {
        setTick((t) => t + 1);
      } else {
        currentIdRef.current = id;
        setCurrentId(id);
      }
    };
    if (pendingIdRef.current) {
      const p = pendingIdRef.current;
      pendingIdRef.current = null;
      if (showable(p)) {
        go(p);
        return;
      }
    }
    if (newPassRef.current) {
      newPassRef.current = false;
      go(list[nextShowable(list, list.length - 1, videoRefs.current)].id);
      return;
    }
    if (!list.some((s) => s.id === currentIdRef.current)) {
      go(list[nextShowable(list, list.length - 1, videoRefs.current)].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayImages]);

  // Advance photos on their duration; videos advance when they finish playing.
  //
  // The clock only starts once the image has loaded (and had a moment to
  // decode). Otherwise a slow-loading slide appears late and gets cut short —
  // it "pops up" then immediately advances. Keyed on the visible slide only,
  // so a list refresh mid-slide doesn't restart the clock.
  useEffect(() => {
    const slide = currentSlide;
    if (!slide || isVideo(slide.mime_type)) return;
    const id = slide.id;
    const ms = Math.max(500, slide.duration_ms ?? 7000);
    const el = imgRefs.current.get(id);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const caps: ReturnType<typeof setTimeout>[] = [];
    const start = () => {
      if (cancelled || timer) return;
      timer = setTimeout(() => advanceRef.current(id), ms);
    };
    // Loaded: give the browser a moment to decode so the first paint isn't
    // late on a slow machine, then start the clock. decode() is capped and
    // optional — some embedded browsers reject or never settle it.
    const onLoaded = () => {
      if (cancelled) return;
      if (el && typeof el.decode === "function") {
        caps.push(setTimeout(start, DECODE_CAP_MS));
        el.decode().then(start, start);
      } else {
        start();
      }
    };
    // `complete` is true once the fetch finished, whether it succeeded or not.
    if (!el || el.complete) {
      onLoaded();
    } else {
      el.addEventListener("load", onLoaded, { once: true });
      el.addEventListener("error", onLoaded, { once: true });
      caps.push(setTimeout(start, IMAGE_LOAD_CAP_MS));
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      caps.forEach((c) => clearTimeout(c));
      el?.removeEventListener("load", onLoaded);
      el?.removeEventListener("error", onLoaded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, tick]);

  // Play only the visible video (rewound to the start); pause the rest.
  //
  // A video slide normally advances on `ended`. But a video that never starts
  // (stalled download, refused autoplay, bad file) fires neither `ended` nor
  // `error`, which would leave a black screen indefinitely. The watchdog
  // below advances if the playhead stops moving. Keyed on the visible slide
  // only, so a list refresh mid-play neither restarts nor re-evaluates it.
  useEffect(() => {
    const slide = currentSlide;
    videoRefs.current.forEach((el, id) => {
      if (!slide || id !== slide.id) {
        el.pause();
        if (playingIdRef.current === id) playingIdRef.current = null;
      }
    });
    if (!slide || !isVideo(slide.mime_type)) return;
    const id = slide.id;
    const el = videoRefs.current.get(id);
    if (!el) return;

    // Not buffered enough and not already playing: don't sit on a black
    // frame — move on if anything else can be shown. (Covers a reload or a
    // pending target landing on a video that isn't ready yet.)
    if (playingIdRef.current !== id && !videoReady(el)) {
      const anyOther = displayImages.some(
        (s) => s.id !== id && (!isVideo(s.mime_type) || videoReady(videoRefs.current.get(s.id)))
      );
      if (anyOther) {
        advanceRef.current(id);
        return;
      }
    }

    // Only rewind when this video is newly on screen.
    if (playingIdRef.current !== id) {
      try {
        el.currentTime = 0;
      } catch {
        // some browsers throw if metadata isn't ready yet; play() still works
      }
      playingIdRef.current = id;
    }
    el.play().catch(() => {
      // autoplay can be refused momentarily; the watchdog keeps us moving
    });

    let lastTime = -1;
    let stuckSince = Date.now();
    let started = false;
    const watchdog = setInterval(() => {
      const t = el.currentTime;
      if (t !== lastTime) {
        if (t > 0) started = true;
        lastTime = t;
        stuckSince = Date.now();
        return;
      }
      // Before playback begins, allow a long grace for buffering on a slow
      // connection; once it's playing, react quickly to a real stall.
      const limit = started ? VIDEO_STALL_MS : VIDEO_START_GRACE_MS;
      if (Date.now() - stuckSince > limit) {
        clearInterval(watchdog);
        advanceRef.current(id);
      }
    }, 2_000);
    return () => clearInterval(watchdog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, tick]);

  // Buffer videos in the background one at a time, soonest-needed first, so a
  // cold start doesn't download every video at once and starve the images.
  useEffect(() => {
    const list = displayImages;
    const len = list.length;
    if (len === 0) return;
    const pos = Math.max(0, list.findIndex((s) => s.id === currentIdRef.current));
    const queue: ImageWithUrl[] = [];
    for (let k = 1; k <= len; k++) {
      const s = list[(pos + k) % len];
      if (s && isVideo(s.mime_type)) queue.push(s);
    }
    if (queue.length === 0) return;

    let cancelled = false;
    let cleanupCurrent: (() => void) | undefined;
    const loadNext = () => {
      if (cancelled) return;
      const slide = queue.shift();
      if (!slide) return;
      const el = videoRefs.current.get(slide.id);
      if (!el || el.readyState >= 4) {
        loadNext();
        return;
      }
      const done = () => {
        el.removeEventListener("canplaythrough", done);
        clearTimeout(timer);
        cleanupCurrent = undefined;
        loadNext();
      };
      const timer = setTimeout(done, VIDEO_LOAD_TIMEOUT_MS);
      cleanupCurrent = () => {
        el.removeEventListener("canplaythrough", done);
        clearTimeout(timer);
      };
      el.addEventListener("canplaythrough", done);
      // Kick off buffering once. The visible video is already being fetched
      // by play(), and load() on a video that's mid-download would throw away
      // everything it had and start over — which on a slow link meant some
      // videos never reached "ready" at all.
      if (slide.id !== currentIdRef.current && !startedLoadsRef.current.has(slide.id)) {
        startedLoadsRef.current.add(slide.id);
        el.preload = "auto";
        el.load();
      }
    };
    loadNext();
    return () => {
      cancelled = true;
      cleanupCurrent?.();
    };
  }, [displayImages]);

  const events = state.settings.show_calendar ? state.events : [];

  // Cycle through every appointment left in the day, 8s per welcome.
  useEffect(() => {
    if (events.length < 2) return;
    const id = setInterval(() => {
      setEventIndex((i) => (i + 1) % events.length);
    }, EVENT_ROTATE_MS);
    return () => clearInterval(id);
  }, [events.length, state.version]);

  const showBanner = !state.settings.slideshow_only;
  const currentEvent = events.length > 0 ? events[eventIndex % events.length] : null;
  const welcomeText = currentEvent
    ? renderWelcomeTemplate(state.settings.welcome_template, {
        name: currentEvent.name,
        time: currentEvent.startsAtFormatted,
      })
    : state.settings.welcome_override ?? "Welcome to Collins";

  if (state.images.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-500 bg-black">
        No slides configured. Add images in /admin.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {displayImages.map((img) => (
        <div
          key={img.id}
          className="absolute inset-0 transition-opacity duration-1000 ease-in-out"
          style={{ opacity: img.id === currentId ? 1 : 0 }}
        >
          {isVideo(img.mime_type) ? (
            <video
              ref={(el) => {
                if (el) videoRefs.current.set(img.id, el);
                else videoRefs.current.delete(img.id);
              }}
              src={img.url}
              muted
              playsInline
              // Only metadata up front so images win the bandwidth race on a
              // cold start; a background queue then buffers videos one at a
              // time, and unready videos are skipped rather than shown black.
              preload="metadata"
              // advanceFrom ignores these unless this video is the one on
              // screen, so a non-current video finishing can't skip a slide.
              onEnded={() => advanceRef.current(img.id)}
              onError={() => advanceRef.current(img.id)}
              className="absolute inset-0 w-full h-full object-contain"
            />
          ) : (
            <>
              {/* Blurred background fills any letterbox space */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60"
              />
              {/* Foreground: full image, no cropping */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={(el) => {
                  if (el) imgRefs.current.set(img.id, el);
                  else imgRefs.current.delete(img.id);
                }}
                src={img.url}
                alt=""
                className="absolute inset-0 w-full h-full object-contain"
              />
            </>
          )}
        </div>
      ))}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt=""
        aria-hidden
        className="absolute top-8 right-8 h-24 w-auto opacity-90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
      />
      {showBanner && (
        <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black/80 to-transparent">
          <div className="text-white text-4xl font-semibold drop-shadow-lg">
            {welcomeText}
          </div>
        </div>
      )}
    </div>
  );
}
