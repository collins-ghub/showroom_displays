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
// Max time to wait for a slide's image to decode before starting its timer.
// Generous: on a slow showroom connection (especially while videos buffer)
// a fresh image can take a while, and starting early cuts the slide short.
// This is only a safety net for a truly hung download.
const DECODE_WAIT_CAP_MS = 30_000;
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

export default function Slideshow({ initial }: Props) {
  const [state, setState] = useState<State>(initial);
  const [index, setIndex] = useState(0);
  const [eventIndex, setEventIndex] = useState(0);
  const [shuffleEpoch, setShuffleEpoch] = useState(0);
  const versionRef = useRef(initial.version);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imgRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  // Latest index, readable from callbacks without stale closures.
  const indexRef = useRef(index);
  indexRef.current = index;
  // Shuffle order (ids) for the current pass, kept stable while the image
  // list changes underneath us. See the displayImages memo.
  const orderRef = useRef<string[]>([]);
  const orderEpochRef = useRef(-1);
  // Id of the slide we're showing, so a data refresh can keep it on screen
  // instead of jumping back to the first slide.
  const currentIdRef = useRef<string | null>(null);
  // Id of the video currently playing, so a data refresh doesn't rewind it.
  const playingIdRef = useRef<string | null>(null);

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

  // Start shuffling once mounted (see the displayImages memo).
  useEffect(() => {
    if (state.settings.shuffle) setShuffleEpoch((e) => (e === 0 ? 1 : e));
  }, [state.settings.shuffle]);

  // Poll for changes; replace state when version bumps.
  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const res = await fetch("/api/display/state", { cache: "no-store" });
        if (!res.ok) return;
        const next: State = await res.json();
        if (stopped) return;
        // A new deploy shipped. This poll only refreshes data, never the app
        // code, so a display that's been running for days would otherwise keep
        // executing stale JavaScript indefinitely. Reload to pick it up.
        if (next.build && next.build !== initial.build) {
          window.location.reload();
          return;
        }
        if (next.version !== versionRef.current) {
          versionRef.current = next.version;
          // Don't reset the slide index: the current slide stays on screen and
          // the list is merged underneath it (see the re-sync effect below).
          setState(next);
          setEventIndex(0);
        }
      } catch {
        // Fire Sticks lose Wi-Fi sometimes; just try again next interval.
      }
    }
    const id = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const advance = useCallback(() => {
    const len = displayImages.length;
    if (len === 0) return;
    const from = indexRef.current;
    let next = (from + 1) % len;
    // Skip videos that haven't buffered enough to play yet (typical right after
    // a cold start on a slow connection, e.g. a screensaver that relaunches the
    // page). They rejoin the rotation once ready. Bounded so we always land
    // somewhere even if every slide is an unready video.
    for (let step = 0; step < len; step++) {
      const cand = displayImages[next];
      if (!isVideo(cand.mime_type) || videoReady(videoRefs.current.get(cand.id))) break;
      next = (next + 1) % len;
    }
    // Re-roll the shuffle when a full pass completes (we wrapped around). Done
    // here rather than inside the setIndex updater: updaters must be pure and
    // React may run them more than once, which would double-bump the epoch.
    const wrapped = next <= from;
    if (wrapped && state.settings.shuffle) setShuffleEpoch((e) => e + 1);
    // Record the intended slide so the re-sync effect doesn't fight this move.
    // On a shuffle re-roll the new order isn't known yet, so leave it unset.
    currentIdRef.current =
      wrapped && state.settings.shuffle ? null : (displayImages[next]?.id ?? null);
    setIndex(next);
  }, [displayImages, state.settings.shuffle]);

  // If the slide list changed underneath us (upload, removal, calendar), keep
  // showing the same slide rather than jumping back to the first one. If the
  // slide we were on is gone, fall back to the first.
  useEffect(() => {
    const id = currentIdRef.current;
    if (!id) return;
    const pos = displayImages.findIndex((s) => s.id === id);
    if (pos < 0) setIndex(0);
    else if (pos !== indexRef.current) setIndex(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayImages]);

  // Track which slide is on screen (after any re-sync above).
  useEffect(() => {
    currentIdRef.current = displayImages[index]?.id ?? null;
  }, [index, displayImages]);

  // Advance photos on their duration; videos advance when they finish playing.
  //
  // The clock only starts once the image is decoded and paintable. Otherwise a
  // slow-loading slide (a freshly uploaded, uncached file on a Fire Stick)
  // appears late and gets cut short — it "pops up" then immediately advances.
  useEffect(() => {
    if (displayImages.length === 0) return;
    const current = displayImages[index] ?? displayImages[0];
    if (isVideo(current.mime_type)) return;
    const ms = Math.max(500, current.duration_ms ?? 7000);

    let cancelled = false;
    let id: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (!cancelled) id = setTimeout(advance, ms);
    };

    const el = imgRefs.current.get(current.id);
    if (el && typeof el.decode === "function") {
      // Cap the wait so a hung download can't stall the whole slideshow.
      const cap = new Promise<void>((r) => setTimeout(r, DECODE_WAIT_CAP_MS));
      Promise.race([el.decode().catch(() => undefined), cap]).then(start);
    } else {
      start();
    }

    return () => {
      cancelled = true;
      if (id) clearTimeout(id);
    };
  }, [index, displayImages, advance]);

  // Play only the active video (rewound to the start); pause the rest.
  //
  // A video slide normally advances on `ended`. But a video that never starts
  // (stalled download, refused autoplay, bad file) fires neither `ended` nor
  // `error`, which used to leave a black screen indefinitely. The watchdog
  // below advances if the playhead stops moving for VIDEO_STALL_MS.
  useEffect(() => {
    const current = displayImages[index];
    // If the current slide is a video that isn't ready and something else is,
    // don't sit on a black frame — move on. Covers mount and poll resets, where
    // the index lands on a slide without going through advance().
    if (current && isVideo(current.mime_type)) {
      const el = videoRefs.current.get(current.id);
      if (!videoReady(el)) {
        const anyReady = displayImages.some(
          (s) => !isVideo(s.mime_type) || videoReady(videoRefs.current.get(s.id))
        );
        if (anyReady) {
          advance();
          return;
        }
      }
    }
    let watchdog: ReturnType<typeof setInterval> | undefined;
    videoRefs.current.forEach((el, id) => {
      if (current && id === current.id && isVideo(current.mime_type)) {
        // Only rewind when this video is newly on screen. This effect also
        // re-runs when the slide list refreshes mid-play; don't restart it then.
        if (playingIdRef.current !== current.id) {
          try {
            el.currentTime = 0;
          } catch {
            // some browsers throw if metadata isn't ready yet; play() still works
          }
          playingIdRef.current = current.id;
        }
        el.play().catch(() => {
          // autoplay can be refused momentarily; the watchdog keeps us moving
        });
        let lastTime = -1;
        let stuckSince = Date.now();
        let started = false;
        watchdog = setInterval(() => {
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
            // Clear first so a slow re-render can't let this fire twice.
            if (watchdog) clearInterval(watchdog);
            advance();
          }
        }, 2_000);
      } else {
        el.pause();
        if (playingIdRef.current === id) playingIdRef.current = null;
      }
    });
    return () => {
      if (watchdog) clearInterval(watchdog);
    };
  }, [index, displayImages, advance]);

  // Buffer videos in the background one at a time, soonest-needed first, so a
  // cold start doesn't download every video at once and starve the images.
  useEffect(() => {
    const len = displayImages.length;
    const queue: ImageWithUrl[] = [];
    for (let k = 1; k <= len; k++) {
      const s = displayImages[(indexRef.current + k) % len];
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
      // The active video is already being fetched by play(); don't reset it.
      if (displayImages[indexRef.current]?.id !== slide.id) {
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
      {displayImages.map((img, i) => (
        <div
          key={img.id}
          className="absolute inset-0 transition-opacity duration-1000 ease-in-out"
          style={{ opacity: i === index ? 1 : 0 }}
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
              onEnded={advance}
              onError={() => {
                if (displayImages[index]?.id === img.id) advance();
              }}
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
