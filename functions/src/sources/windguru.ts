/**
 * Forecast reader for https://www.windguru.cz/644417
 * (Castelldefels (BCN), BUNKER BEACH CLUB — 41.265 N, 1.982 E).
 *
 * Windguru has no public API on the free tier, but its own front end talks to
 * /int/iapi.php, which serves clean JSON. Two calls are needed because the
 * model run parameters rotate every few hours:
 *
 *   1. q=forecast_spot  -> the models offered for this spot, each with the
 *                          current initstr / rundef / cachefix
 *   2. q=forecast       -> the actual series for one of those models
 *
 * MODEL CHOICE. The site displays a row labelled "WG", which is Windguru's own
 * multi-model blend (id_model 100, "WINDGURU DEFAULT"). That one cannot be
 * requested directly — it answers `Data not available! (wgmix)` because the
 * blend is assembled from ~70 model runs server-side. GFS 13 km (id_model 3)
 * is the primary underlying model, is returned by a single request, and covers
 * the full 16 days, so that is what we store.
 *
 * Units come back as configured for the spot: `options.wj` is "knots", which
 * matches our observations — its hour-0 value read 9.6 kn against a measured
 * 9.5 kn at the same moment.
 */

const SPOT = 644417;

/** GFS 13 km. See the note above about the "WG" blend row. */
const MODEL = 3;

const BASE = "https://www.windguru.cz/int/iapi.php";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; wind-castelldefels/1.0)",
  "Accept": "application/json, text/javascript, */*",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": `https://www.windguru.cz/${SPOT}`,
};

export interface ForecastPoint {
  /** Epoch milliseconds (UTC) for this forecast step. */
  ts: number;
  /** Mean wind, knots. */
  wind: number | null;
  /** Gust, knots. */
  gust: number | null;
  /** Direction the wind blows from, degrees. */
  dir: number | null;
  tempC: number | null;
}

export interface Forecast {
  /** Model run this came from, epoch ms. */
  initstamp: number;
  model: string;
  points: ForecastPoint[];
}

interface ModelEntry {
  id_model: number;
  initstr: string;
  rundef: string;
  cachefix: string;
}

async function getJson(query: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}?${query}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`windguru: HTTP ${res.status}`);

  const data = (await res.json()) as Record<string, unknown>;
  if (data.return === "error") {
    throw new Error(`windguru: ${String(data.message)}`);
  }
  return data;
}

/** Current run parameters for our model — these rotate, so never hard-code them. */
async function currentRun(): Promise<ModelEntry> {
  const meta = await getJson(`q=forecast_spot&id_spot=${SPOT}`);
  const tabs = meta.tabs as Array<{ id_model_arr?: ModelEntry[] }> | undefined;
  const models = tabs?.[0]?.id_model_arr;

  if (!models?.length) throw new Error("windguru: no models in forecast_spot");

  const entry = models.find((m) => m.id_model === MODEL);
  if (!entry) {
    throw new Error(
      `windguru: model ${MODEL} not offered (got ${models.map((m) => m.id_model).join(",")})`
    );
  }
  return entry;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Fetches the forecast series.
 *
 * `keepHour` decides which steps survive — used to keep only the daytime hours
 * that are actually useful for deciding whether to go out.
 */
export async function fetchForecast(
  days: number,
  keepHour: (at: Date) => boolean
): Promise<Forecast> {
  const run = await currentRun();

  const data = await getJson(
    `q=forecast&id_model=${MODEL}&id_spot=${SPOT}` +
      `&rundef=${encodeURIComponent(run.rundef)}` +
      `&initstr=${encodeURIComponent(run.initstr)}` +
      `&WGCACHEFIX=${encodeURIComponent(run.cachefix)}`
  );

  const f = data.fcst as Record<string, unknown> | undefined;
  if (!f) throw new Error("windguru: response had no fcst block");

  const hours = f.hours as number[] | undefined;
  const wind = f.WINDSPD as (number | null)[] | undefined;
  if (!hours?.length || !wind?.length) {
    throw new Error("windguru: forecast missing hours/WINDSPD");
  }

  const gust = (f.GUST ?? []) as (number | null)[];
  const dir = (f.WINDDIR ?? []) as (number | null)[];
  const temp = (f.TMPE ?? []) as (number | null)[];

  const initMs = (f.initstamp as number) * 1000;
  const horizon = initMs + days * 864e5;

  const points: ForecastPoint[] = [];
  for (let i = 0; i < hours.length; i++) {
    const ts = initMs + hours[i] * 3600_000;
    if (ts > horizon) break;
    if (!keepHour(new Date(ts))) continue;

    points.push({
      ts,
      wind: num(wind[i]),
      gust: num(gust[i]),
      dir: num(dir[i]),
      tempC: num(temp[i]),
    });
  }

  return {
    initstamp: initMs,
    model: String(data.model ?? `id_model ${MODEL}`),
    points,
  };
}
