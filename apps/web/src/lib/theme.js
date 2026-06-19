import api from "../config/api.js";

const STYLE_ID = "theme-overrides";

export function tokensToCss(tokens) {
  const entries = Object.entries(tokens || {});
  if (entries.length === 0) return "";
  return `:root{${entries.map(([k, v]) => `--${k}:${v};`).join("")}}`;
}

export function applyTheme(tokens) {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el); // appended last → wins over core index.css
  }
  el.textContent = tokensToCss(tokens);
}

export async function fetchTheme() {
  try {
    const { data } = await api.get("/theme");
    return data?.tokens || {};
  } catch {
    return {};
  }
}

export async function saveTheme(tokens) {
  await api.put("/theme", { tokens });
}

export async function resetTheme() {
  await api.delete("/theme");
}
