import { z } from "zod";

// Color tokens the editor may override (channel triplets). Keys WITHOUT the
// leading "--"; the CSS var name is `--${key}`.
export const THEME_COLOR_KEYS = [
  "brand-500", "brand-600", "accent-500", "surface-100",
  "navy", "navy-light", "navy-dark",
  "color-page", "color-text", "color-primary", "color-accent", "color-border",
  "text-on-dark", "accent-on-dark",
];

export const THEME_FONT_KEYS = [
  "font-sans", "font-heading", "font-drama", "font-mono",
];

export const CHANNEL_RE = /^\d{1,3} \d{1,3} \d{1,3}$/;
const FONT_RE = /^[^;{}<>]{1,120}$/;

const channelValue = z.string().regex(CHANNEL_RE, "Expected 'R G B' channels").refine(
  (v) => v.split(" ").every((n) => Number(n) >= 0 && Number(n) <= 255),
  "Channels must be 0–255",
);
const fontValue = z.string().regex(FONT_RE, "Invalid font-family value");

export const themeUpdateSchema = z.object({
  tokens: z.record(z.string(), z.string()).superRefine((tokens, ctx) => {
    for (const [key, value] of Object.entries(tokens)) {
      if (THEME_COLOR_KEYS.includes(key)) {
        if (!channelValue.safeParse(value).success)
          ctx.addIssue({ code: "custom", message: `Bad channel value for ${key}`, path: [key] });
      } else if (THEME_FONT_KEYS.includes(key)) {
        if (!fontValue.safeParse(value).success)
          ctx.addIssue({ code: "custom", message: `Bad font value for ${key}`, path: [key] });
      } else {
        ctx.addIssue({ code: "custom", message: `Unknown token key: ${key}`, path: [key] });
      }
    }
  }),
});
