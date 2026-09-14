/**
 * Builds a subscribable iCalendar (.ics) feed of the forecast "star" windows:
 * the times the Windguru forecast shows average wind >= STAR_KNOTS for
 * Castelldefels, grouped into one event per contiguous run.
 *
 * Only slots starting 09:00–21:00 local are included (up to 22:00 end), matching
 * the daytime range the app's forecast shows. Times are emitted in UTC (…Z);
 * calendar apps convert to the viewer's zone.
 */
import { fetchForecast, STAR_KNOTS, type Forecast } from "./sources/windguru";

const ZONE = "Europe/Madrid";

const madridHour = (ms: number): number =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms))
  );

const localStamp = (ms: number): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));

/** UTC basic format, e.g. 20260914T130000Z. */
function icsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function esc(s: string): string {
  return s.replace(/([\\,;])/g, "\\$1").replace(/\n/g, "\\n");
}

/** Fold lines to <=75 octets per RFC 5545. */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let s = line;
  parts.push(s.slice(0, 74));
  s = s.slice(74);
  while (s.length > 73) {
    parts.push(" " + s.slice(0, 73));
    s = s.slice(73);
  }
  if (s) parts.push(" " + s);
  return parts.join("\r\n");
}

interface Window {
  startMs: number;
  endMs: number;
  minWind: number;
  maxWind: number;
}

function windows(f: Forecast): Window[] {
  const starred = f.points.filter(
    (p) => p.wind != null && p.wind >= STAR_KNOTS && madridHour(p.tsMs) >= 9 && madridHour(p.tsMs) <= 21
  );

  const out: Window[] = [];
  for (const p of starred) {
    const endMs = p.tsMs + p.stepH * 3600_000;
    const last = out[out.length - 1];
    if (last && p.tsMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, endMs);
      last.minWind = Math.min(last.minWind, p.wind!);
      last.maxWind = Math.max(last.maxWind, p.wind!);
    } else {
      out.push({ startMs: p.tsMs, endMs, minWind: p.wind!, maxWind: p.wind! });
    }
  }
  return out;
}

export async function buildCalendar(): Promise<string> {
  const f = await fetchForecast();
  const wins = windows(f);
  const now = icsUtc(Date.now());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//wind-castelldefels//kite-stars//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Castelldefels kite windows",
    `X-WR-CALDESC:Forecast hours with average wind >= ${STAR_KNOTS} kn (Windguru ${f.model}).`,
    "X-WR-TIMEZONE:" + ZONE,
    "REFRESH-INTERVAL;VALUE=DURATION:PT2H",
    "X-PUBLISHED-TTL:PT2H",
  ];

  for (const w of wins) {
    const range =
      w.minWind === w.maxWind ? `${w.minWind} kn` : `${w.minWind}–${w.maxWind} kn`;
    const summary = `🪁 Castelldefels ${range}`;
    const desc =
      `Windguru forecast: average wind ${range} (star ≥ ${STAR_KNOTS} kn).\n` +
      `Model ${f.model}. Forecast run ${localStamp(f.initMs)} CET/CEST.`;

    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:kite-${icsUtc(w.startMs)}@wind-castelldefels.web.app`),
      `DTSTAMP:${now}`,
      `DTSTART:${icsUtc(w.startMs)}`,
      `DTEND:${icsUtc(w.endMs)}`,
      fold(`SUMMARY:${esc(summary)}`),
      fold(`DESCRIPTION:${esc(desc)}`),
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
