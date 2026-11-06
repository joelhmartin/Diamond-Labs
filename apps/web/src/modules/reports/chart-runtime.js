/**
 * The Chart.js pieces the report charts use, and nothing else. Chart.jsx
 * imports this file dynamically, so it (and chart.js) lands in its own chunk;
 * named imports here let the bundler drop every controller, scale and plugin
 * not listed (a dynamic `import("chart.js")` would keep them all).
 */
import {
  Chart, BarController, LineController, CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, Tooltip, Legend,
} from "chart.js";

Chart.register(BarController, LineController, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);

export { Chart };
