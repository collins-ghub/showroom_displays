export type DisplaySettings = {
  welcome_override: string | null;
  slideshow_only: boolean;
  show_calendar: boolean;
};

export const DEFAULT_SETTINGS: DisplaySettings = {
  welcome_override: null,
  slideshow_only: false,
  show_calendar: true,
};

export function parseSettingsRows(
  rows: Array<{ key: string; value: unknown }>
): DisplaySettings {
  const out: DisplaySettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key === "welcome_override") {
      out.welcome_override = typeof r.value === "string" ? r.value : null;
    } else if (r.key === "slideshow_only") {
      out.slideshow_only = r.value === true;
    } else if (r.key === "show_calendar") {
      out.show_calendar = r.value !== false; // default true
    }
  }
  return out;
}
