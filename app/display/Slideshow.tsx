"use client";

import { useEffect, useRef, useState } from "react";
import type { ImageWithUrl } from "@/lib/images";
import type { DisplaySettings } from "@/lib/settings";

type State = {
  images: ImageWithUrl[];
  settings: DisplaySettings;
  version: string;
};

type Props = {
  initial: State;
};

const POLL_MS = 15_000;

export default function Slideshow({ initial }: Props) {
  const [state, setState] = useState<State>(initial);
  const [index, setIndex] = useState(0);
  const versionRef = useRef(initial.version);

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
    if (state.images.length === 0) return;
    const current = state.images[index] ?? state.images[0];
    const ms = Math.max(500, current.duration_ms ?? 7000);
    const id = setTimeout(() => {
      setIndex((i) => (state.images.length === 0 ? 0 : (i + 1) % state.images.length));
    }, ms);
    return () => clearTimeout(id);
  }, [index, state]);

  const welcome = state.settings.welcome_override ?? "Welcome";
  const showBanner = !state.settings.slideshow_only;

  if (state.images.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-500 bg-black">
        No slides configured. Add images in /admin.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {state.images.map((img, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={img.id}
          src={img.url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-in-out"
          style={{ opacity: i === index ? 1 : 0 }}
        />
      ))}
      {showBanner && (
        <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black/80 to-transparent">
          <div className="text-white text-5xl font-semibold drop-shadow-lg">
            {welcome}
          </div>
        </div>
      )}
    </div>
  );
}
