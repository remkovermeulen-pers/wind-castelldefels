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
import type { ForecastPoint, Reading } from "./data";

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

/** How far back observations are shown, regardless of the forward range. */
export const HISTORY_MS = 12 * 60 * 60 * 1000;

export type Range = "12h" | "2d" | "week";

/** Milliseconds of forecast shown to the right of "now". */
const FORWARD: Record<Range, number> = {
  "12h": 0,
  "2d": 2 * 864e5,
  week: 7 * 864e5,
};

const hhmm = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dayHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

const dayOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  weekday: "short",
});

const full = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type Pt = { x: number; y: number | null };

/**
 * The forecast only keeps daytime hours (09:00–21:00), so consecutive points
 * jump across each night. Without an explicit null in the gap Chart.js draws a
 * straight line through the small hours, inventing a forecast that was never
 * issued.
 */
function breakNightGaps(points: Pt[], maxGapMs = 3.5 * 3600_000): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    out.push(points[i]);
    const next = points[i + 1];
    if (next && next.x - points[i].x > maxGapMs) {
      out.push({ x: points[i].x + (next.x - points[i].x) / 2, y: null });
    }
  }
  return out;
}

let chart: Chart | null = null;

/**
 * Current x-axis width, in ms, used to pick the tick format.
 *
 * Held at module level rather than read from the enclosing render call: the
 * tick callback is created once with the chart and would otherwise capture the
 * span from the very first render, so switching range updated the axis bounds
 * but kept formatting labels for the old one.
 */
let axisSpan = 0;

export function renderChart(
  canvas: HTMLCanvasElement,
  readings: Reading[],
  forecast: ForecastPoint[],
  range: Range
): void {
  const muted = css("--muted");
  const grid = css("--line");
  const now = Date.now();

  const min = now - HISTORY_MS;
  const max = now + FORWARD[range];
  axisSpan = max - min;

  const obs = readings.filter((r) => r.ts.getTime() >= min);
  const at = (r: Reading, v: number | null): Pt => ({ x: r.ts.getTime(), y: v });

  // Below ~40 samples the bare lines stop reading as data, so mark each one.
  const pointRadius = obs.length <= 40 ? 3 : 0;

  const fc = breakNightGaps(
    forecast
      .filter((p) => p.ts.getTime() >= min && p.ts.getTime() <= max)
      .map((p) => ({ x: p.ts.getTime(), y: p.wind }))
  );
  const fcGust = breakNightGaps(
    forecast
      .filter((p) => p.ts.getTime() >= min && p.ts.getTime() <= max)
      .map((p) => ({ x: p.ts.getTime(), y: p.gust }))
  );

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
  ];

  if (range !== "12h" && fc.length) {
    datasets.push(
      {
        label: "Forecast gusts",
        data: fcGust,
        borderColor: css("--gust"),
        borderWidth: 1,
        borderDash: [5, 4],
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        spanGaps: false,
      },
      {
        label: "Forecast",
        data: fc,
        borderColor: css("--forecast"),
        borderWidth: 2,
        borderDash: [5, 4],
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        spanGaps: false,
      }
    );
  }

  // Threshold drawn as a two-point line so it spans the axis at any range.
  datasets.push({
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
  });

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
          ticks: {
            color: muted,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            font: { size: 10 },
            callback: (v) => {
              const t = new Date(Number(v));
              if (axisSpan <= 36 * 3600_000) return hhmm.format(t);
              if (axisSpan <= 3 * 864e5) return dayHour.format(t);
              return dayOnly.format(t);
            },
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
