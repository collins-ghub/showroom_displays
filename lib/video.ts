"use client";

// Client-side video compression with ffmpeg.wasm. Loaded lazily from a CDN
// (single-threaded core, so no COOP/COEP headers are required) the first time
// an admin uploads a video. Big phone/4K clips get re-encoded to ~1080p H.264
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

async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  await loadScript(`https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VER}/dist/umd/ffmpeg.js`);
  await loadScript(`https://unpkg.com/@ffmpeg/util@${UTIL_VER}/dist/umd/util.js`);
  const { FFmpeg } = window.FFmpegWASM;
  const { toBlobURL } = window.FFmpegUtil;
  const ffmpeg = new FFmpeg();
  const base = `https://unpkg.com/@ffmpeg/core@${CORE_VER}/dist/umd`;
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

// Returns a compressed MP4, or the original file if compression fails or
// wouldn't actually make it smaller.
export async function compressVideo(file: File, onProgress?: Progress): Promise<File> {
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = window.FFmpegUtil;

  const handler = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, progress)));
  };
  ffmpeg.on("progress", handler);

  const ext =
    (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inName = `input.${ext}`;
  const outName = "output.mp4";

  try {
    await ffmpeg.writeFile(inName, await fetchFile(file));
    await ffmpeg.exec([
      "-i",
      inName,
      // Cap the long edge at 1920px; -2 keeps aspect ratio and even dimensions.
      "-vf",
      "scale='min(1920,iw)':-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
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
    if (typeof ffmpeg.off === "function") ffmpeg.off("progress", handler);
  }
}
