export type DisplaySettings = {
  welcome_override: string | null;
  slideshow_only: boolean;
};

export const DEFAULT_SETTINGS: DisplaySettings = {
  welcome_override: null,
  slideshow_only: false,
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
    }
  }
  return out;
}
