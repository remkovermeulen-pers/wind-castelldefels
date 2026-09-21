/**
 * Reader for the "ZONA KITESURF EN CASTELLDEFELS" status board on
 * https://www.mojokite.com/zonakite/castelldefels.php
 *
 * The page renders client-side from /zonakite/get_values.php, which returns
 * clean JSON — no scraping needed. Board values are the English strings
 * "Yes" | "No" | "Maybe"; the page labels them SI! / No / Quizás.
 *
 * The occasional announcement under the title (e.g. a local holiday closure) is
 * static HTML on the page, not in the JSON, so it is scraped separately.
 */

const ENDPOINT = "https://www.mojokite.com/zonakite/get_values.php";
const PAGE_URL = "https://www.mojokite.com/zonakite/castelldefels.php";

export type BoardValue = "Yes" | "No" | "Maybe";

export interface ZoneStatus {
  /** "OPEN" | "CLOSED" | "OPENING SOON" */
  status: string;
  /** Opening time, only meaningful when status is OPENING SOON */
  time: string | null;
  foil: BoardValue | null;
  surf: BoardValue | null;
  twintip: BoardValue | null;
  /** Site-reported last update, "YYYY-MM-DD HH:mm:ss" local */
  lastUpdate: string | null;
}

function asBoardValue(v: unknown): BoardValue | null {
  return v === "Yes" || v === "No" || v === "Maybe" ? v : null;
}

/** Spanish label as shown on the mojokite board. */
export function label(v: BoardValue | null): string {
  if (v === "Yes") return "SI!";
  if (v === "Maybe") return "Quizás";
  if (v === "No") return "No";
  return "—";
}

/** The alert condition the app cares about: Quizás or SI!. */
export function isKiteable(v: BoardValue | null): boolean {
  return v === "Yes" || v === "Maybe";
}

export async function fetchZoneStatus(): Promise<ZoneStatus> {
  const res = await fetch(ENDPOINT, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; wind-castelldefels/1.0)",
      "Accept": "application/json",
      "Referer": "https://www.mojokite.com/zonakite/castelldefels.php",
    },
  });

  if (!res.ok) throw new Error(`mojokite: HTTP ${res.status}`);

  const data = (await res.json()) as Record<string, unknown>;
  if (data.error) throw new Error(`mojokite: ${String(data.error)}`);

  return {
    status: typeof data.status === "string" ? data.status : "UNKNOWN",
    time: typeof data.time === "string" ? data.time : null,
    foil: asBoardValue(data.foil),
    surf: asBoardValue(data.surf),
    twintip: asBoardValue(data.twintip),
    lastUpdate: typeof data.last_update === "string" ? data.last_update : null,
  };
}

/** The season the zone operates, parsed from the page. Dates are YYYY-MM-DD. */
export interface ZoneSchedule {
  start: string;
  end: string;
  /** One-off closure dates (holidays) within the season. */
  closed: string[];
}

export interface ZonePageInfo {
  /** One-off announcement under the title, or null. */
  notice: string | null;
  /** Operating season and holiday closures, or null if not found. */
  schedule: ZoneSchedule | null;
}

/** Announcement under the title — a `<p>` in the card-title heading. */
function parseNotice(html: string): string | null {
  const heading = html.match(/class=["']card-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (!heading) return null;
  // Strip comments first: mojokite "removes" a notice by commenting the <p> out.
  const para = heading[1].replace(/<!--[\s\S]*?-->/g, "").match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!para) return null;
  const text = para[1]
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/**
 * Operating season from the rules text, e.g. "la zona estara abierta a partir
 * del lunes 01/06 hasta 18/09 … En 2026 cierra en las fechas 24/6, 14/08,
 * 11/09." Dates are DD/MM; the year comes from the same text.
 */
function parseSchedule(html: string): ZoneSchedule | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const year = text.match(/a[nñ]o\s+(\d{4})/i);
  const rng = text.match(
    /a partir del[^0-9]*(\d{1,2})\/(\d{1,2})\s+hasta\s+(\d{1,2})\/(\d{1,2})/i
  );
  if (!year || !rng) return null;

  const iso = (d: string, m: string) =>
    `${year[1]}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

  const closed: string[] = [];
  const fest = text.match(/cierra en las fechas([0-9/,\s]+)/i);
  if (fest) {
    for (const m of fest[1].matchAll(/(\d{1,2})\/(\d{1,2})/g)) closed.push(iso(m[1], m[2]));
  }

  return { start: iso(rng[1], rng[2]), end: iso(rng[3], rng[4]), closed };
}

/**
 * Fetches the page once and parses both the announcement and the operating
 * season. Never throws — a scrape failure must not fail the zone poll.
 */
export async function fetchZonePage(): Promise<ZonePageInfo> {
  try {
    const res = await fetch(PAGE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; wind-castelldefels/1.0)",
        "Accept": "text/html",
        "Referer": "https://www.mojokite.com/",
      },
    });
    if (!res.ok) return { notice: null, schedule: null };
    const html = await res.text();
    return { notice: parseNotice(html), schedule: parseSchedule(html) };
  } catch {
    return { notice: null, schedule: null };
  }
}
