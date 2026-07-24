/**
 * Scraper for the "Estación meteorológica on-line" on https://www.17nudos.com
 *
 * The homepage embeds grafica_mdx.php (a rendered PNG of the 12-hour graph, not
 * machine readable) and update_mdx.php, which polls update_me_mdx.php over AJAX
 * every 5 seconds. That inner endpoint returns a small HTML table holding the
 * same numbers that drive the graph, so we read it directly.
 *
 * Wind speeds are in knots ("17 nudos" = 17 knots).
 */

const ENDPOINT = "https://www.17nudos.com/update_me_mdx.php";

export interface WindReading {
  /** Instantaneous wind speed, knots ("ACTUAL") */
  actual: number;
  /** Rolling average wind speed, knots ("PROMEDIO") */
  average: number;
  /** Gust, knots ("RACHA") */
  gust: number;
  /** Compass direction, e.g. "E" ("DIRECCION") */
  direction: string;
  /** Local wind name, e.g. "LEVANTE" */
  windName: string | null;
  tempC: number | null;
  pressureHpa: number | null;
  humidityPct: number | null;
  /** "Last update" string as reported by the station */
  stationTime: string | null;
}

/** Strip tags/entities and collapse whitespace. */
function clean(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellsFor(html: string, className: string): string[] {
  const re = new RegExp(`class=['"]${className}['"][^>]*>([\\s\\S]*?)</td>`, "gi");
  const out: string[] = [];
  for (const m of html.matchAll(re)) out.push(clean(m[1]));
  return out;
}

function firstNumber(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function parseNudos(html: string): WindReading {
  // ACTUAL and PROMEDIO share the .windSpeed class, in that document order.
  const speeds = cellsFor(html, "windSpeed");
  const actual = firstNumber(speeds[0]);
  const average = firstNumber(speeds[1]);
  const gust = firstNumber(cellsFor(html, "windGust")[0]);

  if (actual === null || average === null || gust === null) {
    throw new Error(
      `17nudos: could not parse wind values (actual=${actual}, average=${average}, gust=${gust})`
    );
  }

  const ph = cellsFor(html, "LabelPH");
  const update = cellsFor(html, "LabelUpdate")[0] ?? null;

  return {
    actual,
    average,
    gust,
    direction: cellsFor(html, "windDir")[0] || "?",
    windName: cellsFor(html, "NameWind")[0] || null,
    tempC: firstNumber(cellsFor(html, "LabelTemp")[0]),
    pressureHpa: firstNumber(ph.find((c) => /hPa/i.test(c))),
    humidityPct: firstNumber(ph.find((c) => /%/.test(c))),
    stationTime: update ? update.replace(/^Last update:\s*/i, "") : null,
  };
}

export async function fetchWind(): Promise<WindReading> {
  // The site's own client uses POST; the endpoint ignores the body.
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; wind-castelldefels/1.0)",
      "Accept": "text/html",
      "Referer": "https://www.17nudos.com/",
    },
  });

  if (!res.ok) throw new Error(`17nudos: HTTP ${res.status}`);
  return parseNudos(await res.text());
}
