/**
 * Windguru forecast reader for spot 644417 (Castelldefels — BUNKER BEACH CLUB),
 * used to build the "starred hours" calendar feed.
 *
 * Windguru has no public API, but its own front end calls /int/iapi.php, which
 * serves clean JSON. Two calls: q=forecast_spot gives the current model run
 * parameters (they rotate every few hours, so never hard-code them) and
 * q=forecast returns the hourly series.
 *
 * A "star" is defined as forecast average wind >= STAR_KNOTS. The "WG" blend
 * (id_model 100) the site shows by default cannot be fetched server-side (it
 * answers "Data not available (wgmix)"), so this uses GFS (id_model 3), its
 * primary underlying model. Wind is in knots.
 */
const IAPI = "https://www.windguru.cz/int/iapi.php";
const SPOT = 644417;
const MODEL = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** A slot is "starred" when forecast average wind is this many knots or more. */
export const STAR_KNOTS = 12;

export interface ForecastPoint {
  /** Slot start, epoch ms (UTC). */
  tsMs: number;
  /** Hours until the next forecast step (1 near-term, 3 later in GFS). */
  stepH: number;
  /** Mean wind, knots. */
  wind: number | null;
}

export interface Forecast {
  /** Model run time, epoch ms. */
  initMs: number;
  model: string;
  points: ForecastPoint[];
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/javascript, */*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `https://www.windguru.cz/${SPOT}`,
    },
  });
  if (!res.ok) throw new Error(`windguru: HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.return === "error") throw new Error(`windguru: ${String(data.message)}`);
  return data;
}

export async function fetchForecast(): Promise<Forecast> {
  const spot = await getJson(`${IAPI}?q=forecast_spot&id_spot=${SPOT}`);
  const tab = (spot.tabs as Array<Record<string, unknown>>)?.[0];
  if (!tab) throw new Error("windguru: no tab in forecast_spot");

  const models = tab.id_model_arr as Array<{
    id_model: number;
    initstr: string;
    rundef: string;
    cachefix: string;
  }>;
  const run = models?.find((m) => m.id_model === MODEL);
  if (!run) throw new Error(`windguru: model ${MODEL} not offered`);

  const data = await getJson(
    `${IAPI}?q=forecast&id_model=${MODEL}&id_spot=${SPOT}` +
      `&rundef=${encodeURIComponent(run.rundef)}` +
      `&initstr=${encodeURIComponent(run.initstr)}` +
      `&WGCACHEFIX=${encodeURIComponent(run.cachefix)}`
  );

  const f = data.fcst as Record<string, unknown> | undefined;
  const hours = f?.hours as number[] | undefined;
  const wind = f?.WINDSPD as (number | null)[] | undefined;
  const init = f?.initstamp as number | undefined;
  if (!hours?.length || !wind?.length || init == null) {
    throw new Error("windguru: forecast missing hours/WINDSPD/initstamp");
  }

  const points: ForecastPoint[] = hours.map((h, i) => ({
    tsMs: (init + h * 3600) * 1000,
    stepH: i + 1 < hours.length ? hours[i + 1] - hours[i] : 1,
    wind: typeof wind[i] === "number" ? wind[i] : null,
  }));

  return { initMs: init * 1000, model: String(data.model ?? `id_model ${MODEL}`), points };
}
