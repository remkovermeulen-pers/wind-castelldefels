/**
 * Reader for the "ZONA KITESURF EN CASTELLDEFELS" status board on
 * https://www.mojokite.com/zonakite/castelldefels.php
 *
 * The page renders client-side from /zonakite/get_values.php, which returns
 * clean JSON — no scraping needed. Board values are the English strings
 * "Yes" | "No" | "Maybe"; the page labels them SI! / No / Quizás.
 */

const ENDPOINT = "https://www.mojokite.com/zonakite/get_values.php";

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
