import "./styles.css";
import { renderChart, WIND_ALERT_KNOTS } from "./chart";
import { subscribeReadings, subscribeZone, type BoardValue, type Reading, type ZoneSnapshot } from "./data";
import { currentState, disable, enable, type NotifyState } from "./notifications";
import { renderCompass } from "./compass";

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
 * than the state of the connection, and flashes only when the data actually
 * advances.
 *
 * The wind poller runs every 5 min, so anything past ~13 min means a tick was
 * missed or nothing is polling at all.
 */
const STALE_AFTER_MS = 13 * 60 * 1000;

let newestSeen = 0;
let staleTimer: number | undefined;

function paintFreshness(ts: Date): void {
  const el = $("live");
  const ageMs = Date.now() - ts.getTime();
  el.hidden = false;

  if (ageMs <= STALE_AFTER_MS) {
    el.classList.remove("stale");
    el.lastChild!.textContent = "Live";
  } else {
    el.classList.add("stale");
    const mins = Math.round(ageMs / 60000);
    el.lastChild!.textContent =
      mins < 90 ? `No update for ${mins} min` : `No update for ${Math.round(mins / 60)} h`;
  }

  // Age advances on its own, so re-evaluate even when no data arrives.
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => paintFreshness(ts), 60_000) as unknown as number;
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

  const last = rows[rows.length - 1];
  // Backfilled rows carry no ACTUAL series and can lack a direction.
  const val = (v: number | null) => (v === null ? "--" : String(v));

  $("avg").textContent = val(last.average);
  $("actual").textContent = val(last.actual);
  $("gust").textContent = val(last.gust);
  // The Direction cell holds the rose itself; the local wind name (Levante,
  // Garbí…) goes on the timestamp line, where there is room for it.
  renderCompass($("dir"), last.direction, { size: 76, compact: true });

  $("avg").parentElement!.classList.toggle(
    "alert",
    last.average !== null && last.average >= WIND_ALERT_KNOTS
  );

  const temp = last.tempC === null ? "" : ` · ${last.tempC} °C`;
  const name = last.windName ? ` · ${last.windName}` : "";
  const origin = last.backfilled ? " · from published graph" : "";
  $("stamp").textContent =
    `Updated ${stampFmt.format(last.ts)}${name}${temp} · ${rows.length} readings${origin}`;

  markLive(last.ts);

  renderChart(canvas, rows);
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
function siteStamp(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return raw;

  const [, y, mo, d, hh, mm] = m;
  const sameDay = madridDay.format(new Date()) === `${y}-${mo}-${d}`;
  return sameDay ? `${hh}:${mm}` : `${d}/${mo} ${hh}:${mm}`;
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
void initNotifications();
