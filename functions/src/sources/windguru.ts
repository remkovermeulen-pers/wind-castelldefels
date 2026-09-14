/**
 * Windguru forecast reader for spot 644417 (Castelldefels — BUNKER BEACH CLUB),
 * used to build the "starred hours" calendar feed.
 *
 * We reproduce Windguru's "WG" blend (the model the app shows). That blend
 * (id_model 100) has no server endpoint — q=forecast for it returns
 * "Data not available (wgmix)" because Windguru assembles it in the browser
 * from ~11 member models. So we fetch the same members via /int/iapi.php and
 * combine them with a resolution-weighted average: weight ∝ (1/resolution)^1.5,
 * which reproduces the on-site blend to within a few tenths of a knot.
 *
 * A slot is "starred" when the blended average wind >= WIND_MIN_KNOTS AND the
 * blended gust > GUST_MIN_KNOTS. Wind is in knots.
 */
const IAPI = "https://www.windguru.cz/int/iapi.php";
const SPOT = 644417;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** Resolution weighting exponent — calibrated so the mix matches the WG blend. */
const BLEND_EXP = 1.5;
/** Fallback resolution (km) for a member we can't look up. */
const DEFAULT_RES_KM = 15;

/** Star when average wind is at least this many knots… */
export const WIND_MIN_KNOTS = 11;
/** …and gusts are strictly more than this many knots. */
export const GUST_MIN_KNOTS = 12;

/** True when a slot's forecast qualifies as a star. */
export function isStarred(wind: number | null, gust: number | null): boolean {
  return (
    wind != null && gust != null && wind >= WIND_MIN_KNOTS && gust > GUST_MIN_KNOTS
  );
}

export interface ForecastPoint {
  /** Slot start, epoch ms (UTC). */
  tsMs: number;
  /** Hours until the next forecast step. */
  stepH: number;
  /** Blended mean wind, knots. */
  wind: number | null;
  /** Blended gust, knots. */
  gust: number | null;
}

export interface Forecast {
  model: string;
  points: ForecastPoint[];
}

interface Member {
  id_model: number;
  initstr: string;
  rundef: string;
  cachefix: string;
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

/** One member's series, keyed by epoch seconds. */
async function fetchMember(m: Member): Promise<Map<number, { wind: number | null; gust: number | null }>> {
  const data = await getJson(
    `${IAPI}?q=forecast&id_model=${m.id_model}&id_spot=${SPOT}` +
      `&rundef=${encodeURIComponent(m.rundef)}` +
      `&initstr=${encodeURIComponent(m.initstr)}` +
      `&WGCACHEFIX=${encodeURIComponent(m.cachefix)}`
  );
  const f = data.fcst as Record<string, unknown> | undefined;
  const hours = f?.hours as number[] | undefined;
  const wind = f?.WINDSPD as (number | null)[] | undefined;
  const gust = (f?.GUST ?? []) as (number | null)[];
  const init = f?.initstamp as number | undefined;

  const out = new Map<number, { wind: number | null; gust: number | null }>();
  if (!hours || !wind || init == null) return out;
  hours.forEach((h, i) => {
    out.set(init + h * 3600, {
      wind: typeof wind[i] === "number" ? wind[i] : null,
      gust: typeof gust[i] === "number" ? gust[i] : null,
    });
  });
  return out;
}

/**
 * Reproduces the WG blend by fetching every member model and taking a
 * resolution-weighted average per hour.
 */
export async function fetchForecast(): Promise<Forecast> {
  const [spot, info] = await Promise.all([
    getJson(`${IAPI}?q=forecast_spot&id_spot=${SPOT}`),
    getJson(`${IAPI}?q=model_info_full&virtual=1&sst=1&user_priority=1`),
  ]);

  const tab = (spot.tabs as Array<Record<string, unknown>>)?.[0];
  const members = tab?.id_model_arr as Member[] | undefined;
  if (!members?.length) throw new Error("windguru: no member models");

  const resOf = (id: number): number => {
    const rec = (info[String(id)] ?? {}) as Record<string, number>;
    return rec.resolution ?? rec.resolution_real ?? DEFAULT_RES_KM;
  };
  const weightOf = (id: number): number => Math.pow(1 / resOf(id), BLEND_EXP);

  const settled = await Promise.allSettled(members.map((m) => fetchMember(m)));
  const series = settled
    .map((r, i) => ({ ok: r.status === "fulfilled", data: r.status === "fulfilled" ? r.value : null, id: members[i].id_model }))
    .filter((s) => s.ok && s.data && s.data.size > 0) as Array<{
    data: Map<number, { wind: number | null; gust: number | null }>;
    id: number;
  }>;
  if (!series.length) throw new Error("windguru: no member forecasts fetched");

  const allTs = [...new Set(series.flatMap((s) => [...s.data.keys()]))].sort((a, b) => a - b);

  const points: ForecastPoint[] = allTs.map((ts, i) => {
    let wNum = 0, wDen = 0, gNum = 0, gDen = 0;
    for (const s of series) {
      const v = s.data.get(ts);
      if (!v) continue;
      const w = weightOf(s.id);
      if (v.wind != null) {
        wNum += v.wind * w;
        wDen += w;
      }
      if (v.gust != null) {
        gNum += v.gust * w;
        gDen += w;
      }
    }
    return {
      tsMs: ts * 1000,
      stepH: i + 1 < allTs.length ? Math.round((allTs[i + 1] - ts) / 3600) : 1,
      wind: wDen ? Math.round((wNum / wDen) * 10) / 10 : null,
      gust: gDen ? Math.round((gNum / gDen) * 10) / 10 : null,
    };
  });

  return { model: "WG blend", points };
}
