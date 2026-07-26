import { functionsBase } from "./firebase-config";

/**
 * Near-live current-wind feed.
 *
 * 17nudos refreshes every ~5 seconds. The `live` Cloud Function proxies it with
 * CORS, so the app can poll for a current reading while it is open — far fresher
 * than the 5-minute stored history. Polling only runs while the tab is visible,
 * so a backgrounded app costs nothing.
 */
const LIVE_URL = `${functionsBase}/live`;
const INTERVAL_MS = 15_000;

export interface LiveReading {
  actual: number | null;
  average: number | null;
  gust: number | null;
  direction: string;
  windName: string | null;
  tempC: number | null;
  /** Server fetch time, epoch ms. */
  at: number;
}

const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function startLive(onReading: (r: LiveReading) => void): void {
  let timer: number | undefined;

  async function poll(): Promise<void> {
    try {
      const res = await fetch(LIVE_URL, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as Record<string, unknown>;
      if (d.error) return;
      onReading({
        actual: n(d.actual),
        average: n(d.average),
        gust: n(d.gust),
        direction: typeof d.direction === "string" ? d.direction : "?",
        windName: typeof d.windName === "string" ? d.windName : null,
        tempC: n(d.tempC),
        at: typeof d.at === "number" ? d.at : Date.now(),
      });
    } catch {
      // Network blips are expected; the next tick retries.
    }
  }

  function start(): void {
    if (timer !== undefined) return;
    void poll();
    timer = window.setInterval(poll, INTERVAL_MS);
  }

  function stop(): void {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") start();
    else stop();
  });

  if (document.visibilityState === "visible") start();
}
