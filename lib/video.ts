"use client";

// Client-side video compression with ffmpeg.wasm. Loaded lazily from a CDN
// (single-threaded core, so no COOP/COEP headers are required) the first time
// an admin uploads a video. Big phone/4K clips get re-encoded to ~720p H.264
// in the browser BEFORE upload, so Supabase only ever stores the small copy.

type Progress = (ratio: number) => void;

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    FFmpegWASM?: any;
    FFmpegUtil?: any;
  }
}

const FFMPEG_VER = "0.12.10";
const UTIL_VER = "0.12.1";
const CORE_VER = "0.12.6";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

let ffmpegInstance: any = null;

// Kill a stuck/hung ffmpeg worker and force a fresh instance next time.
export function resetFFmpeg() {
  try {
    ffmpegInstance?.terminate?.();
  } catch {
    // ignore
  }
  ffmpegInstance = null;
}

async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpegBase = `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VER}/dist/umd`;
  await loadScript(`${ffmpegBase}/ffmpeg.js`);
  // NB: the util UMD bundle is published as index.js (not util.js).
  await loadScript(`https://unpkg.com/@ffmpeg/util@${UTIL_VER}/dist/umd/index.js`);
  const { FFmpeg } = window.FFmpegWASM;
  const { toBlobURL } = window.FFmpegUtil;
  const ffmpeg = new FFmpeg();
  const coreBase = `https://unpkg.com/@ffmpeg/core@${CORE_VER}/dist/umd`;
  await ffmpeg.load({
    // A cross-origin URL can't be used directly as a Worker script, so load the
    // worker as a same-origin blob. (Webpack names this chunk 814.ffmpeg.js.)
    classWorkerURL: await toBlobURL(`${ffmpegBase}/814.ffmpeg.js`, "text/javascript"),
    coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

function parseClock(m: RegExpMatchArray | null): number | null {
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Returns a compressed MP4, or the original file if compression fails or
// wouldn't actually make it smaller.
export async function compressVideo(file: File, onProgress?: Progress): Promise<File> {
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = window.FFmpegUtil;

  // Safari doesn't reliably fire the "progress" event for the single-threaded
  // core, so we also derive progress from ffmpeg's log output (time= vs the
  // input Duration), and log everything for diagnostics.
  let duration = 0;
  const report = (ratio: number) => {
    if (onProgress && Number.isFinite(ratio)) {
      onProgress(Math.max(0, Math.min(1, ratio)));
    }
  };
  const logHandler = ({ message }: { message: string }) => {
    console.log("[ffmpeg]", message);
    if (!duration) {
      const d = parseClock(message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/));
      if (d && d > 0) duration = d;
    }
    if (duration) {
      const t = parseClock(message.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/));
      if (t !== null) report(t / duration);
    }
  };
  const progressHandler = ({ progress }: { progress: number }) => report(progress);
  ffmpeg.on("log", logHandler);
  ffmpeg.on("progress", progressHandler);

  const ext =
    (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inName = `input.${ext}`;
  const outName = "output.mp4";

  try {
    await ffmpeg.writeFile(inName, await fetchFile(file));
    await ffmpeg.exec([
      "-i",
      inName,
      // Cap the long edge at 1280px; -2 keeps aspect ratio and even dimensions.
      // 720p + ultrafast keeps in-browser encoding fast enough to be usable.
      "-vf",
      "scale='min(1280,iw)':-2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      // Move the moov atom up front so playback can start before full download.
      "-movflags",
      "+faststart",
      outName,
    ]);
    const data = await ffmpeg.readFile(outName);
    try {
      await ffmpeg.deleteFile(inName);
      await ffmpeg.deleteFile(outName);
    } catch {
      // best-effort FS cleanup
    }
    const blob = new Blob([data], { type: "video/mp4" });
    if (blob.size === 0 || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.mp4`, { type: "video/mp4" });
  } finally {
    if (typeof ffmpeg.off === "function") {
      ffmpeg.off("log", logHandler);
      ffmpeg.off("progress", progressHandler);
    }
  }
}
