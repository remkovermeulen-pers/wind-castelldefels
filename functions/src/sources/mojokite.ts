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

/**
 * Scrapes the announcement shown under the page title — a `<p>` inside the
 * `card-title` heading, used for one-off notices like a holiday closure. Absent
 * most days, so this returns null when there is nothing to show and never
 * throws: a missing notice must not fail the zone poll.
 */
export async function fetchZoneNotice(): Promise<string | null> {
  try {
    const res = await fetch(PAGE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; wind-castelldefels/1.0)",
        "Accept": "text/html",
        "Referer": "https://www.mojokite.com/",
      },
    });
    if (!res.ok) return null;

    const html = await res.text();
    const heading = html.match(
      /class=["']card-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i
    );
    if (!heading) return null;

    // Strip HTML comments first: mojokite "removes" a notice by commenting the
    // <p> out rather than deleting it, and the text must not leak back through.
    const inner = heading[1].replace(/<!--[\s\S]*?-->/g, "");

    const para = inner.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (!para) return null;

    const text = para[1]
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text || null;
  } catch {
    return null;
  }
}
