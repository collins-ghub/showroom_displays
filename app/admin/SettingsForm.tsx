"use client";

import { useState } from "react";
import type { DisplaySettings } from "@/lib/settings";

export default function SettingsForm({ initial }: { initial: DisplaySettings }) {
  const [settings, setSettings] = useState<DisplaySettings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Partial<DisplaySettings>) {
    setSaving(true);
    setError(null);
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setSettings(json.settings);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="text-lg font-semibold">Display settings</h2>

      <label className="block">
        <span className="text-sm text-neutral-300">Welcome message override</span>
        <input
          type="text"
          placeholder="(leave blank for default 'Welcome')"
          value={settings.welcome_override ?? ""}
          onChange={(e) =>
            setSettings({ ...settings, welcome_override: e.target.value })
          }
          onBlur={(e) =>
            save({ welcome_override: e.target.value.trim() === "" ? null : e.target.value })
          }
          className="mt-1 w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-700"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.slideshow_only}
          onChange={(e) => save({ slideshow_only: e.target.checked })}
        />
        Slideshow only (hide welcome banner)
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.show_calendar}
          onChange={(e) => save({ show_calendar: e.target.checked })}
        />
        Use Google Calendar to personalize the welcome
      </label>

      <div className="text-xs text-neutral-500 h-4">
        {saving ? "Saving…" : savedAt ? "Saved." : ""}
        {error && <span className="text-red-400 ml-2">{error}</span>}
      </div>
    </section>
  );
}
