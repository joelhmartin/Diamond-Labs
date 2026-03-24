import project from "../../../../project.config.js";

// Derive display name from project.config.js (my-app → My App)
const displayName = project.name
  .split("-")
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(" ");

export const brand = {
  name: displayName,
  tagline: project.description || "Your application scaffold",
  logo: null,
  colors: {
    primary: "#2563eb",
    primaryHover: "#1d4ed8",
  },
};
