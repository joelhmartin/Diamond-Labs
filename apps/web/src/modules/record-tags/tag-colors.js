/** Palette key (see TAG_COLORS in @my-app/shared) → chip classes. Literal strings so Tailwind keeps them. */
export const TAG_COLOR_CLASSES = {
  slate: "bg-slate-100 text-slate-700",
  red: "bg-red-100 text-red-700",
  orange: "bg-orange-100 text-orange-700",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-green-100 text-green-700",
  teal: "bg-teal-100 text-teal-700",
  blue: "bg-blue-100 text-blue-700",
  purple: "bg-purple-100 text-purple-700",
};

export const tagColorClass = (color) => TAG_COLOR_CLASSES[color] ?? TAG_COLOR_CLASSES.slate;
