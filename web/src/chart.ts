import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import type { Reading } from "./data";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler
);

/** Average wind at or above this many knots triggers a push (mirrors alerts.ts). */
export const WIND_ALERT_KNOTS = 13;

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let chart: Chart | null = null;

export function renderChart(canvas: HTMLCanvasElement, readings: Reading[]): void {
  const labels = readings.map((r) => timeFmt.format(r.ts));
  const muted = css("--muted");
  const line = css("--line");

  /**
   * Mark the individual measurements while the series is sparse.
   *
   * A full day is ~145 points, where markers would just be noise — but early in
   * the day, or after a gap in polling, a handful of readings drawn as bare
   * lines look like abstract bars with nothing showing where the actual samples
   * are. Below ~40 points the markers are what make it legible as data.
   */
  const pointRadius = readings.length <= 40 ? 3 : 0;

  const data = {
    labels,
    datasets: [
      {
        label: "Gusts",
        data: readings.map((r) => r.gust),
        borderColor: css("--gust"),
        backgroundColor: "transparent",
        borderWidth: 1.5,
        pointRadius,
        pointHoverRadius: 5,
        pointBackgroundColor: css("--gust"),
        tension: 0.3,
      },
      {
        label: "Average",
        data: readings.map((r) => r.average),
        borderColor: css("--accent"),
        backgroundColor: "transparent",
        borderWidth: 2.5,
        pointRadius,
        pointHoverRadius: 5,
        pointBackgroundColor: css("--accent"),
        tension: 0.3,
      },
      {
        label: "Actual",
        data: readings.map((r) => r.actual),
        borderColor: css("--actual"),
        backgroundColor: "transparent",
        borderWidth: 1.5,
        borderDash: [2, 3],
        pointRadius,
        pointHoverRadius: 5,
        pointBackgroundColor: css("--actual"),
        tension: 0.3,
      },
      {
        label: `${WIND_ALERT_KNOTS} kn`,
        data: readings.map(() => WIND_ALERT_KNOTS),
        borderColor: muted,
        backgroundColor: "transparent",
        borderWidth: 1,
        borderDash: [6, 5],
        pointRadius: 0,
        pointHitRadius: 0,
      },
    ],
  };

  if (chart) {
    chart.data = data;
    chart.update("none");
    return;
  }

  chart = new Chart(canvas, {
    type: "line",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: muted,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            font: { size: 10 },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: line },
          border: { display: false },
          ticks: {
            color: muted,
            font: { size: 10 },
            callback: (v) => `${v}`,
          },
          title: {
            display: true,
            text: "knots",
            color: muted,
            font: { size: 10 },
          },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: muted,
            boxWidth: 10,
            boxHeight: 2,
            usePointStyle: false,
            font: { size: 10 },
            filter: (item) => item.text !== `${WIND_ALERT_KNOTS} kn`,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} kn`,
          },
        },
      },
    },
  });
}
