export type DisplaySettings = {
  welcome_override: string | null;
  welcome_template: string;
  slideshow_only: boolean;
  show_calendar: boolean;
  shuffle: boolean;
};

export const DEFAULT_WELCOME_TEMPLATE = "Welcome {name} — {time}";

export const DEFAULT_SETTINGS: DisplaySettings = {
  welcome_override: null,
  welcome_template: DEFAULT_WELCOME_TEMPLATE,
  slideshow_only: false,
  show_calendar: true,
  shuffle: false,
};

export function parseSettingsRows(
  rows: Array<{ key: string; value: unknown }>
): DisplaySettings {
  const out: DisplaySettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key === "welcome_override") {
      out.welcome_override = typeof r.value === "string" ? r.value : null;
    } else if (r.key === "welcome_template") {
      out.welcome_template =
        typeof r.value === "string" && r.value.trim().length > 0
          ? r.value
          : DEFAULT_WELCOME_TEMPLATE;
    } else if (r.key === "slideshow_only") {
      out.slideshow_only = r.value === true;
    } else if (r.key === "show_calendar") {
      out.show_calendar = r.value !== false; // default true
    } else if (r.key === "shuffle") {
      out.shuffle = r.value === true;
    }
  }
  return out;
}

export function renderWelcomeTemplate(
  template: string,
  vars: { name: string; time: string }
): string {
  return template.replace(/\{name\}/g, vars.name).replace(/\{time\}/g, vars.time);
}
