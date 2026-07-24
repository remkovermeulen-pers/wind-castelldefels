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

  if (rows.length === 0) {
    empty.hidden = false;
    canvas.style.display = "none";
    return;
  }

  empty.hidden = true;
  canvas.style.display = "";

  const last = rows[rows.length - 1];
  $("avg").textContent = String(last.average);
  $("actual").textContent = `${last.actual} kn`;
  $("gust").textContent = `${last.gust} kn`;
  $("dir").textContent = last.windName ? `${last.direction} · ${last.windName}` : last.direction;

  $("avg").parentElement!.classList.toggle("alert", last.average >= WIND_ALERT_KNOTS);

  const temp = last.tempC === null ? "" : ` · ${last.tempC} °C`;
  $("stamp").textContent = `Updated ${stampFmt.format(last.ts)}${temp} · ${rows.length} readings today`;

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
