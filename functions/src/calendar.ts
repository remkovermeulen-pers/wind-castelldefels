/**
 * Builds a subscribable iCalendar (.ics) feed of the forecast "star" windows:
 * the times the Windguru forecast shows average wind >= STAR_KNOTS for
 * Castelldefels, grouped into one event per contiguous run.
 *
 * Only slots starting 09:00–21:00 local are included (up to 22:00 end), matching
 * the daytime range the app's forecast shows. Times are emitted in UTC (…Z);
 * calendar apps convert to the viewer's zone.
 */
import {
  fetchForecast,
  isStarred,
  WIND_MIN_KNOTS,
  GUST_MIN_KNOTS,
  type Forecast,
} from "./sources/windguru";

const ZONE = "Europe/Madrid";

const madridHour = (ms: number): number =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms))
  );

const isWeekend = (ms: number): boolean => {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "short" }).format(
    new Date(ms)
  );
  return day === "Sat" || day === "Sun";
};

/**
 * Slot start hours to include: weekends 09:00–22:00, weekdays 17:00–22:00.
 * The upper bound is 21 because a slot starting at 21:00 already covers 22:00.
 */
function inWindow(ms: number): boolean {
  const h = madridHour(ms);
  return isWeekend(ms) ? h >= 9 && h <= 21 : h >= 17 && h <= 21;
}

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
  maxGust: number;
}

function windows(f: Forecast): Window[] {
  const starred = f.points.filter((p) => isStarred(p.wind, p.gust) && inWindow(p.tsMs));

  const out: Window[] = [];
  for (const p of starred) {
    const endMs = p.tsMs + p.stepH * 3600_000;
    const last = out[out.length - 1];
    if (last && p.tsMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, endMs);
      last.minWind = Math.min(last.minWind, p.wind!);
      last.maxWind = Math.max(last.maxWind, p.wind!);
      last.maxGust = Math.max(last.maxGust, p.gust!);
    } else {
      out.push({ startMs: p.tsMs, endMs, minWind: p.wind!, maxWind: p.wind!, maxGust: p.gust! });
    }
  }
  return out;
}

export async function buildCalendar(): Promise<string> {
  const f = await fetchForecast();
  const wins = windows(f);
  const now = icsUtc(Date.now());
  // Monotonic sequence (hours since epoch): a stable UID keeps events matched
  // across refreshes, and a rising SEQUENCE plus LAST-MODIFIED tells calendar
  // apps the content changed, so updated wind values actually apply.
  const seq = Math.floor(Date.now() / 3600_000);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//wind-castelldefels//kite-stars//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Castelldefels kite windows",
    `X-WR-CALDESC:Forecast hours with average wind >= ${WIND_MIN_KNOTS} kn and gusts > ${GUST_MIN_KNOTS} kn (Windguru ${f.model}).`,
    "X-WR-TIMEZONE:" + ZONE,
    "REFRESH-INTERVAL;VALUE=DURATION:PT2H",
    "X-PUBLISHED-TTL:PT2H",
  ];

  for (const w of wins) {
    const range =
      w.minWind === w.maxWind ? `${w.minWind} kn` : `${w.minWind}–${w.maxWind} kn`;
    const summary = `🪁 Castelldefels ${range}, gusts ${w.maxGust} kn`;
    const desc =
      `Windguru ${f.model} forecast: average wind ${range}, gusts up to ${w.maxGust} kn.\n` +
      `Star = avg ≥ ${WIND_MIN_KNOTS} kn and gusts > ${GUST_MIN_KNOTS} kn.`;

    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:kite-${icsUtc(w.startMs)}@wind-castelldefels.web.app`),
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${now}`,
      `SEQUENCE:${seq}`,
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
