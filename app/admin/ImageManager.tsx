"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ImageWithUrl } from "@/lib/images";

const CLIENT_MAX_DIM = 2400;
const CLIENT_QUALITY = 0.85;

// Downscale + re-encode in the browser so we don't hit Vercel's 4.5 MB
// request body limit. The server still does its own pass to WebP at 1920px.
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, CLIENT_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", CLIENT_QUALITY)
    );
    if (!blob) return file;
    if (blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export default function ImageManager({ initialImages }: { initialImages: ImageWithUrl[] }) {
  const [images, setImages] = useState<ImageWithUrl[]>(initialImages);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const compressed = await compressImage(file);
        const fd = new FormData();
        fd.append("file", compressed, compressed.name);
        const res = await fetch("/api/admin/images", { method: "POST", body: fd });
        const text = await res.text();
        let json: { image?: ImageWithUrl; error?: string } = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          throw new Error(
            res.status === 413
              ? "File too large for the server. Try a smaller image."
              : `Upload failed (${res.status})`
          );
        }
        if (!res.ok) throw new Error(json.error ?? "Upload failed");
        const img = json.image!;
        setImages((prev) => [
          ...prev,
          {
            ...img,
            url: `${
              process.env.NEXT_PUBLIC_SUPABASE_URL
            }/storage/v1/object/public/showroom-images/${img.storage_path}`,
          },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this image?")) return;
    const prev = images;
    setImages((cur) => cur.filter((i) => i.id !== id));
    const res = await fetch(`/api/admin/images/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setImages(prev);
      setError("Delete failed");
    }
  }

  async function handleDuration(id: string, ms: number) {
    setImages((cur) => cur.map((i) => (i.id === id ? { ...i, duration_ms: ms } : i)));
    await fetch(`/api/admin/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_ms: ms }),
    });
  }

  async function handleToggleActive(id: string, is_active: boolean) {
    setImages((cur) => cur.map((i) => (i.id === id ? { ...i, is_active } : i)));
    await fetch(`/api/admin/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active }),
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = images.findIndex((i) => i.id === active.id);
    const newIdx = images.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(images, oldIdx, newIdx);
    setImages(next);
    startTransition(async () => {
      await fetch("/api/admin/images/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map((i) => i.id) }),
      });
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleUpload(e.target.files)}
          className="text-sm"
        />
        {uploading && <span className="text-sm text-neutral-400">Uploading…</span>}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {images.length === 0 ? (
        <p className="text-neutral-400 text-sm">No images yet. Upload some to get started.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={images.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {images.map((img) => (
                <SortableRow
                  key={img.id}
                  image={img}
                  onDelete={() => handleDelete(img.id)}
                  onDuration={(ms) => handleDuration(img.id, ms)}
                  onToggleActive={(v) => handleToggleActive(img.id, v)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableRow({
  image,
  onDelete,
  onDuration,
  onToggleActive,
}: {
  image: ImageWithUrl;
  onDelete: () => void;
  onDuration: (ms: number) => void;
  onToggleActive: (v: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-2 rounded border border-neutral-800 bg-neutral-950"
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab px-2 py-1 text-neutral-500 hover:text-white"
      >
        ⠠
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.file_name}
        className="w-24 h-16 object-cover rounded bg-neutral-800"
      />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm">{image.file_name}</div>
        <div className="text-xs text-neutral-500">
          {image.size_bytes ? `${Math.round(image.size_bytes / 1024)} KB` : ""}
        </div>
      </div>
      <DurationInput value={image.duration_ms} onCommit={onDuration} />
      <label className="text-xs flex items-center gap-1">
        <input
          type="checkbox"
          checked={image.is_active}
          onChange={(e) => onToggleActive(e.target.checked)}
        />
        Active
      </label>
      <button
        onClick={onDelete}
        className="text-sm text-red-400 hover:text-red-300 px-2"
      >
        Delete
      </button>
    </li>
  );
}

function DurationInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (ms: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  function commit() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 500 || n > 600_000) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  }
  return (
    <label className="text-xs text-neutral-400 flex items-center gap-1">
      Duration
      <input
        type="number"
        min={500}
        step={500}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-24 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-sm"
      />
      ms
    </label>
  );
}
