"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageWithUrl } from "@/lib/images";
import { renderWelcomeTemplate, type DisplaySettings } from "@/lib/settings";
import type { ShowroomEvent } from "@/lib/calendar";

type State = {
  images: ImageWithUrl[];
  settings: DisplaySettings;
  version: string;
  event: ShowroomEvent | null;
};

type Props = {
  initial: State;
};

const POLL_MS = 15_000;

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
  const [shuffleEpoch, setShuffleEpoch] = useState(0);
  const versionRef = useRef(initial.version);

  // Reorder slides when shuffle is on. Re-roll each time the loop completes
  // so the order isn't the same every cycle.
  const displayImages = useMemo(() => {
    if (!state.settings.shuffle || state.images.length < 2) return state.images;
    const next = shuffled(state.images);
    // Avoid an immediate repeat if the new first matches the previous last.
    if (shuffleEpoch > 0 && next[0]?.id === state.images.at(-1)?.id) {
      [next[0], next[1]] = [next[1], next[0]];
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.images, state.settings.shuffle, shuffleEpoch]);

  // Poll for changes; replace state when version bumps.
  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const res = await fetch("/api/display/state", { cache: "no-store" });
        if (!res.ok) return;
        const next: State = await res.json();
        if (stopped) return;
        if (next.version !== versionRef.current) {
          versionRef.current = next.version;
          setState(next);
          setIndex(0);
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

  // Advance to the next slide based on the current image's duration.
  useEffect(() => {
    if (displayImages.length === 0) return;
    const current = displayImages[index] ?? displayImages[0];
    const ms = Math.max(500, current.duration_ms ?? 7000);
    const id = setTimeout(() => {
      setIndex((i) => {
        if (displayImages.length === 0) return 0;
        const next = (i + 1) % displayImages.length;
        if (next === 0 && state.settings.shuffle) setShuffleEpoch((e) => e + 1);
        return next;
      });
    }, ms);
    return () => clearTimeout(id);
  }, [index, displayImages, state.settings.shuffle]);

  const showBanner = !state.settings.slideshow_only;
  const event = state.settings.show_calendar ? state.event : null;
  const welcomeText = event
    ? renderWelcomeTemplate(state.settings.welcome_template, {
        name: event.name,
        time: event.startsAtFormatted,
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
            src={img.url}
            alt=""
            className="absolute inset-0 w-full h-full object-contain"
          />
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
          <div className="text-white text-5xl font-semibold drop-shadow-lg">
            {welcomeText}
          </div>
        </div>
      )}
    </div>
  );
}
