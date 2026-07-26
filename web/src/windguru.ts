/**
 * Embeds Windguru's official forecast widget for spot 644417
 * (Castelldefels (BCN), BUNKER BEACH CLUB).
 *
 * Windguru's normal embed is a loader script that injects the iframe and drives
 * an iframe-resizer to auto-size it. That resizer mis-measured the height to 0
 * here (its host/content versions disagree — it logs "enablePublicMethods has
 * been removed"), so instead the iframe is embedded directly at a fixed height.
 * The forecast page scrolls its own wide table horizontally, so no resizer is
 * needed, and dropping the loader keeps one fewer third-party script out of the
 * PWA.
 *
 * m=100 is Windguru's own "WG" super-blend — the model the site shows by
 * default and the one that cannot be fetched server-side.
 */
const IFRAME_URL = "https://www.windguru.cz/widget-fcst-iframe.php";

/** The forecast table renders to about this tall for the parameters below. */
const HEIGHT_PX = 270;

const PARAMS = new URLSearchParams({
  s: "644417", // spot
  m: "100", // WG super-blend
  uid: "wg_fwdg_644417_100_wind_castelldefels",
  wj: "knots", // wind in knots, matching the rest of the app
  tj: "c", // temperature in °C
  waj: "m",
  tij: "cm",
  odh: "0",
  doh: "24",
  fhours: "168", // 7-day horizon
  hrsm: "2",
  vt: "forecasts",
  lng: "en",
  idbs: "1", // include the "WG" blend row
  p: "WINDSPD,GUST,SMER,TMPE,CDC,APCP1s",
});

/** Injects the forecast iframe once. Safe to call repeatedly. */
export function mountWindguru(host: HTMLElement): void {
  if (host.querySelector("iframe")) return;

  const iframe = document.createElement("iframe");
  iframe.src = `${IFRAME_URL}?${PARAMS.toString()}`;
  iframe.title = "Windguru 7-day wind forecast for Castelldefels";
  iframe.loading = "lazy";
  iframe.width = "100%";
  iframe.height = String(HEIGHT_PX);
  iframe.style.height = `${HEIGHT_PX}px`;

  host.replaceChildren(iframe);
}
