"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageWithUrl } from "@/lib/images";
import { renderWelcomeTemplate, type DisplaySettings } from "@/lib/settings";
import type { ShowroomEvent } from "@/lib/calendar";

function isVideo(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("video/");
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
    const next = shuffled(state.images);
    // Avoid an immediate repeat if the new first matches the previous last.
    if (shuffleEpoch > 0 && next[0]?.id === state.images.at(-1)?.id) {
      [next[0], next[1]] = [next[1], next[0]];
    }
    return next;
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
          setState(next);
          setIndex(0);
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
    const next = (indexRef.current + 1) % len;
    // Re-roll the shuffle when a full pass completes. Done here rather than
    // inside the setIndex updater: updaters must be pure and React may run
    // them more than once, which would double-bump the epoch.
    if (next === 0 && state.settings.shuffle) setShuffleEpoch((e) => e + 1);
    setIndex(next);
  }, [displayImages.length, state.settings.shuffle]);

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
    let watchdog: ReturnType<typeof setInterval> | undefined;
    videoRefs.current.forEach((el, id) => {
      if (current && id === current.id && isVideo(current.mime_type)) {
        try {
          el.currentTime = 0;
        } catch {
          // some browsers throw if metadata isn't ready yet; play() still works
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
      }
    });
    return () => {
      if (watchdog) clearInterval(watchdog);
    };
  }, [index, displayImages, advance]);

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
              // Buffer fully in the background so playback is instant when the
              // slide comes up. (Lazier preloading stalled on Safari/Fire Stick.)
              preload="auto"
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
