import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
  type ChartDataset,
} from "chart.js";
import type { Reading } from "./data";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  Legend,
  Filler
);

/** Average wind at or above this many knots triggers a push (mirrors alerts.ts). */
export const WIND_ALERT_KNOTS = 13;

/** How much history the observation chart shows. */
export const HISTORY_MS = 12 * 60 * 60 * 1000;

const full = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const hhmm = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type Pt = { x: number; y: number | null };

const HOUR_MS = 3600_000;

/**
 * Replaces the axis ticks with whole-hour marks across the visible range.
 * Madrid is a whole-hour offset from UTC, so a whole UTC hour is also a whole
 * local hour. The step grows with the span to keep roughly six labels.
 */
function wholeHourTicks(axis: { min: number; max: number; ticks: { value: number }[] }): void {
  const spanH = (axis.max - axis.min) / HOUR_MS;
  const step = Math.max(1, Math.ceil(spanH / 6));
  const first = Math.ceil(axis.min / HOUR_MS) * HOUR_MS;

  const ticks: { value: number }[] = [];
  for (let t = first; t <= axis.max; t += step * HOUR_MS) ticks.push({ value: t });
  axis.ticks = ticks;
}

let chart: Chart | null = null;

export function renderChart(canvas: HTMLCanvasElement, readings: Reading[]): void {
  const muted = css("--muted");
  const grid = css("--line");
  const now = Date.now();
  const min = now - HISTORY_MS;

  const obs = readings.filter((r) => r.ts.getTime() >= min);
  const max = obs.length ? Math.max(now, obs[obs.length - 1].ts.getTime()) : now;
  const at = (r: Reading, v: number | null): Pt => ({ x: r.ts.getTime(), y: v });

  // Below ~40 samples the bare lines stop reading as data, so mark each one.
  const pointRadius = obs.length <= 40 ? 3 : 0;

  const datasets: ChartDataset<"line", Pt[]>[] = [
    {
      label: "Gusts",
      data: obs.map((r) => at(r, r.gust)),
      borderColor: css("--gust"),
      borderWidth: 1.5,
      pointRadius,
      pointHoverRadius: 5,
      pointBackgroundColor: css("--gust"),
      tension: 0.3,
    },
    {
      label: "Average",
      data: obs.map((r) => at(r, r.average)),
      borderColor: css("--accent"),
      borderWidth: 2.5,
      pointRadius,
      pointHoverRadius: 5,
      pointBackgroundColor: css("--accent"),
      tension: 0.3,
    },
    {
      label: "Actual",
      data: obs.map((r) => at(r, r.actual)),
      borderColor: css("--actual"),
      borderWidth: 1.5,
      borderDash: [2, 3],
      pointRadius,
      pointHoverRadius: 5,
      pointBackgroundColor: css("--actual"),
      tension: 0.3,
    },
    {
      // Threshold drawn as a two-point line so it always spans the axis.
      label: `${WIND_ALERT_KNOTS} kn`,
      data: [
        { x: min, y: WIND_ALERT_KNOTS },
        { x: max, y: WIND_ALERT_KNOTS },
      ],
      borderColor: muted,
      borderWidth: 1,
      borderDash: [6, 5],
      pointRadius: 0,
      pointHitRadius: 0,
    },
  ];

  const data = { datasets };

  if (chart) {
    chart.data = data as never;
    const x = chart.options.scales!.x!;
    x.min = min;
    x.max = max;
    chart.update("none");
    return;
  }

  chart = new Chart(canvas, {
    type: "line",
    data: data as never,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        x: {
          type: "linear",
          min,
          max,
          grid: { display: false },
          // Place ticks on whole hours rather than wherever the data starts,
          // stepped so the ~12h span shows a handful of round-hour labels.
          afterBuildTicks: wholeHourTicks,
          ticks: {
            color: muted,
            maxRotation: 0,
            autoSkip: false,
            font: { size: 10 },
            callback: (v) => hhmm.format(new Date(Number(v))),
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: grid },
          border: { display: false },
          ticks: { color: muted, font: { size: 10 } },
          title: { display: true, text: "knots", color: muted, font: { size: 10 } },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: muted,
            boxWidth: 10,
            boxHeight: 2,
            font: { size: 10 },
            filter: (item) => item.text !== `${WIND_ALERT_KNOTS} kn`,
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => full.format(new Date(Number(items[0].parsed.x))),
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} kn`,
          },
        },
      },
    },
  });
}
