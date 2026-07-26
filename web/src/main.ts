import "./styles.css";
import { renderChart, WIND_ALERT_KNOTS } from "./chart";
import {
  subscribeReadings,
  subscribeZone,
  type BoardValue,
  type Reading,
  type ZoneSnapshot,
} from "./data";
import { currentState, disable, enable, type NotifyState } from "./notifications";
import { renderCompass } from "./compass";
import { mountWindguru } from "./windguru";
import { startLive } from "./live";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const stampFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Spanish labels, matching the mojokite board. */
function label(v: BoardValue | null): string {
  return v === "Yes" ? "SI!" : v === "Maybe" ? "Quizás" : v === "No" ? "No" : "—";
}

function pillClass(v: BoardValue | null): string {
  return v === "Yes" ? "pill yes" : v === "Maybe" ? "pill maybe" : v === "No" ? "pill no" : "pill";
}

// --- Wind ---------------------------------------------------------------

/**
 * Freshness indicator.
 *
 * Firestore's onSnapshot pushes every write straight to the page, so a new
 * reading appears without a refresh — but "connected" is not the same as
 * "current". If the poller is not running, the socket stays happily open while
 * the data silently ages, so this reports the age of the newest reading rather
 * than the state of the connection.
 *
 * The wind poller runs every 5 min, so 15 minutes means at least two ticks were
 * missed; an hour means nothing is polling at all.
 */
const WARN_AFTER_MIN = 15;
const BAD_AFTER_MIN = 60;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

function ago(ageMs: number): string {
  const min = Math.round(ageMs / 60_000);
  if (min < 1) return "Updated just now";
  if (min < 60) return `Updated ${rtf.format(-min, "minute")}`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `Updated ${rtf.format(-hours, "hour")}`;
  return `Updated ${rtf.format(-Math.round(hours / 24), "day")}`;
}

let newestSeen = 0;
let ageTimer: number | undefined;

function paintFreshness(ts: Date): void {
  const el = $("live");
  const min = (Date.now() - ts.getTime()) / 60_000;

  el.classList.toggle("warn", min >= WARN_AFTER_MIN && min < BAD_AFTER_MIN);
  el.classList.toggle("bad", min >= BAD_AFTER_MIN);
  $("live-text").textContent = ago(Date.now() - ts.getTime());

  // Age advances on its own, so re-evaluate even when no data arrives.
  clearTimeout(ageTimer);
  ageTimer = setTimeout(() => paintFreshness(ts), 30_000) as unknown as number;
}

function markLive(ts: Date): void {
  const el = $("live");
  const advanced = ts.getTime() > newestSeen;
  const first = newestSeen === 0;

  if (advanced) newestSeen = ts.getTime();
  paintFreshness(ts);

  if (advanced && !first) {
    el.classList.remove("tick");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("tick");
  }
}

/** Everything the hero card shows for the current moment. */
interface Current {
  average: number | null;
  actual: number | null;
  gust: number | null;
  direction: string;
  windName: string | null;
  tempC: number | null;
  ts: Date;
}

// Last reading count from Firestore, so a live update can keep showing it.
let readingCount = 0;

/**
 * Paints the hero card. Shared by the 5-minute Firestore history and the
 * ~15-second live feed, so both render identically; whichever arrived most
 * recently wins, and the live feed dominates while the app is open.
 */
function paintCurrent(c: Current): void {
  const val = (v: number | null) => (v === null ? "--" : String(v));

  $("avg").textContent = val(c.average);
  $("actual").textContent = val(c.actual);
  $("gust").textContent = val(c.gust);
  // The Direction cell holds the rose itself; the local wind name (Levante,
  // Garbí…) goes on the timestamp line, where there is room for it.
  renderCompass($("dir"), c.direction, { size: 76, compact: true });

  $("avg").parentElement!.classList.toggle(
    "alert",
    c.average !== null && c.average >= WIND_ALERT_KNOTS
  );

  const name = c.windName ? ` · ${c.windName}` : "";
  const temp = c.tempC === null ? "" : ` · ${c.tempC} °C`;
  const count = readingCount ? ` · ${readingCount} readings` : "";
  $("stamp").textContent = `Updated ${stampFmt.format(c.ts)}${name}${temp}${count}`;

  markLive(c.ts);
}

function renderWind(rows: Reading[]): void {
  const canvas = $<HTMLCanvasElement>("chart");
  const empty = $("chart-empty");
  // Collapse the fixed-height chart box entirely while empty, otherwise it
  // reserves 260px of blank space above the explanatory message.
  const wrap = canvas.parentElement as HTMLElement;

  if (rows.length === 0) {
    empty.hidden = false;
    wrap.style.display = "none";
    return;
  }

  empty.hidden = true;
  wrap.style.display = "";
  renderChart(canvas, rows);

  readingCount = rows.length;
  paintCurrent({ ...rows[rows.length - 1] });
}

// --- Kite zone ----------------------------------------------------------

/** Circular badge icons for the three states mojokite reports. */
const ICONS = {
  open: '<path d="M4.8 8.3l2.1 2.1 4.3-4.3"/>',
  closed: '<path d="M5.5 5.5l5 5M10.5 5.5l-5 5"/>',
  soon: '<path d="M8 4.4V8l2.4 1.6"/>',
} as const;

function zoneBadge(status: string): string {
  const s = status.toUpperCase();
  const kind = s === "OPEN" ? "open" : s.includes("SOON") ? "soon" : "closed";
  return (
    `<span class="zone-icon ${kind}" title="Zone ${s.toLowerCase()}" aria-label="Zone ${s.toLowerCase()}">` +
    `<svg viewBox="0 0 16 16" aria-hidden="true">` +
    `<circle cx="8" cy="8" r="7" class="disc"/>${ICONS[kind]}</svg></span>`
  );
}

const madridDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Formats mojokite's own "last_update" stamp.
 *
 * The site reports its local (Europe/Madrid) clock as a naive string, so the
 * time is shown exactly as given rather than re-parsed into the viewer's
 * timezone — which would shift it for anyone outside Spain. The date is only
 * shown when the board is stale from an earlier day.
 */
/**
 * Shifts a YYYY-MM-DD string back one calendar day.
 *
 * Done as arithmetic on the date parts rather than subtracting 24h from a
 * timestamp, so the DST changeovers cannot land it on the wrong day.
 */
function previousDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Madrid",
});

/**
 * Formats mojokite's own "last update" stamp, which is plain local time with no
 * date context.
 *
 * The board frequently sits unchanged for hours and stays stale overnight, so a
 * bare "updated 15:58" would read as current when it is really a day old. Only
 * today's stamps are shown as a bare time.
 */
function siteStamp(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return raw;

  const [, y, mo, d, hh, mm] = m;
  const stampDay = `${y}-${mo}-${d}`;
  const time = `${hh}:${mm}`;
  const today = madridDay.format(new Date());

  if (stampDay === today) return time;
  if (stampDay === previousDay(today)) return `Yesterday at ${time}`;

  // Noon UTC is safely the same calendar day in Madrid, so this cannot slip.
  return `${dayLabel.format(new Date(`${stampDay}T12:00:00Z`))} at ${time}`;
}

function renderZone(zone: ZoneSnapshot | null): void {
  if (!zone) {
    $("zone-stamp").textContent =
      "Zone status not polled yet — checks run every 10 min, 12:00–21:00.";
    return;
  }

  for (const key of ["twintip", "surf", "foil"] as const) {
    const el = $(`tt-${key}`);
    el.textContent = label(zone[key]);
    el.className = pillClass(zone[key]);
  }

  // Prefer mojokite's own update time over ours — the board often sits
  // unchanged for a while after we poll it. Fall back to the poll time only
  // if the site did not report one.
  const site = siteStamp(zone.siteLastUpdate);
  const when = site
    ? `updated ${site}`
    : `checked ${stampFmt.format(zone.ts)}`;

  $("zone-stamp").innerHTML = `Zone ${zone.status} · ${when}` + zoneBadge(zone.status);
  $("zone-head-icon").innerHTML = zoneBadge(zone.status);
}

// --- Notifications ------------------------------------------------------

function paintButton(btn: HTMLButtonElement, state: NotifyState): void {
  btn.className = "notify";
  btn.disabled = false;

  switch (state.kind) {
    case "on":
      btn.textContent = "Alerts on";
      btn.classList.add("on");
      break;
    case "off":
      btn.textContent = "Enable alerts";
      break;
    case "blocked":
      btn.textContent = "Alerts blocked";
      btn.classList.add("err");
      btn.disabled = true;
      break;
    case "unsupported":
      btn.textContent = state.reason;
      btn.disabled = true;
      break;
  }
}

async function initNotifications(): Promise<void> {
  const btn = $<HTMLButtonElement>("notify");
  let state = await currentState();
  paintButton(btn, state);

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = state.kind === "on" ? "Turning off…" : "Enabling…";
    try {
      state = state.kind === "on" ? await disable() : await enable();
    } catch (err) {
      console.error(err);
      state = { kind: "unsupported", reason: "Failed — retry" };
    }
    paintButton(btn, state);
  });
}

// --- Boot ---------------------------------------------------------------

subscribeReadings(renderWind);
subscribeZone(renderZone);
mountWindguru($("windguru"));
void initNotifications();

// Near-live current wind while the app is open, layered over the stored history.
startLive((r) =>
  paintCurrent({
    average: r.average,
    actual: r.actual,
    gust: r.gust,
    direction: r.direction,
    windName: r.windName,
    tempC: r.tempC,
    ts: new Date(r.at),
  })
);
