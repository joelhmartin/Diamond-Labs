// hex defaults mirror the core channel values in index.css (for the color picker UI)
export const EDITOR_TOKENS = [
  { key: "brand-500",   label: "Primary",         group: "Palette",       type: "color",  default: "#13AEEF" },
  { key: "brand-600",   label: "Primary (dark)",  group: "Palette",       type: "color",  default: "#1393C9" },
  { key: "accent-500",  label: "Accent",          group: "Palette",       type: "color",  default: "#F79D1E" },
  { key: "color-page",  label: "Page background", group: "Palette",       type: "color",  default: "#F7F7F5" },
  { key: "color-text",  label: "Body text",       group: "Palette",       type: "color",  default: "#0B1A2E" },
  { key: "surface-300", label: "Borders",         group: "Palette",       type: "color",  default: "#E2E0DB" },
  { key: "navy",        label: "Navy (dark bg)",  group: "Palette",       type: "color",  default: "#0B1A2E" },
  { key: "navy-dark",   label: "Navy dark",       group: "Palette",       type: "color",  default: "#060D17" },

  { key: "font-sans",    label: "Body font",    group: "Typography", type: "font", default: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { key: "font-heading", label: "Heading font", group: "Typography", type: "font", default: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { key: "font-drama",   label: "Drama font",   group: "Typography", type: "font", default: '"Cormorant Garamond", Georgia, serif' },
  { key: "font-mono",    label: "Mono font",    group: "Typography", type: "font", default: '"IBM Plex Mono", monospace' },

  { key: "text-on-dark", label: "Dark-section text", group: "Dark sections", type: "toggle", default: "255 255 255" },
];

export const FONT_OPTIONS = [
  '"Plus Jakarta Sans", system-ui, sans-serif',
  '"Inter", system-ui, sans-serif',
  '"Cormorant Garamond", Georgia, serif',
  '"Playfair Display", Georgia, serif',
  '"IBM Plex Mono", monospace',
  '"Space Grotesk", system-ui, sans-serif',
];

// toggle endpoints for text-on-dark
export const ON_DARK_WHITE = "255 255 255";
export const ON_DARK_NAVY = "11 26 46";
