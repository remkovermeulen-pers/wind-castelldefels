import "./styles.css";
import { renderChart, WIND_ALERT_KNOTS } from "./chart";
import { subscribeReadings, subscribeZone, type BoardValue, type Reading, type ZoneSnapshot } from "./data";
import { currentState, disable, enable, type NotifyState } from "./notifications";

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
  const kn = (v: number | null) => (v === null ? "--" : `${v} kn`);

  $("avg").textContent = last.average === null ? "--" : String(last.average);
  $("actual").textContent = kn(last.actual);
  $("gust").textContent = kn(last.gust);
  $("dir").textContent =
    last.direction === "?"
      ? "--"
      : last.windName
        ? `${last.direction} · ${last.windName}`
        : last.direction;

  $("avg").parentElement!.classList.toggle(
    "alert",
    last.average !== null && last.average >= WIND_ALERT_KNOTS
  );

  const temp = last.tempC === null ? "" : ` · ${last.tempC} °C`;
  const origin = last.backfilled ? " · from published graph" : "";
  $("stamp").textContent =
    `Updated ${stampFmt.format(last.ts)}${temp} · ${rows.length} readings${origin}`;

  renderChart(canvas, rows);
}

// --- Kite zone ----------------------------------------------------------

function renderZone(zone: ZoneSnapshot | null): void {
  if (!zone) {
    $("zone-stamp").textContent =
      "Zone status not polled yet — checks run every 10 min from 12:00.";
    return;
  }

  for (const key of ["twintip", "surf", "foil"] as const) {
    const el = $(`tt-${key}`);
    el.textContent = label(zone[key]);
    el.className = pillClass(zone[key]);
  }

  $("zone-stamp").textContent = `Zone ${zone.status} · checked ${stampFmt.format(zone.ts)}`;
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
