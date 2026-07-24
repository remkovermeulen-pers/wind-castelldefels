/**
 * Wind direction rose.
 *
 * Castelldefels beach faces roughly south-east, so wind arriving from E round
 * through S to WSW is the useful (onshore) range — those sectors are green,
 * everything else red. The sector the wind is currently coming from is drawn
 * at full opacity, which doubles as the needle in the compact variant.
 */

const POINTS = [
  "N", "NNE", "NE", "ENE",
  "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW",
  "W", "WNW", "NW", "NNW",
] as const;

/** Inclusive index range of the green arc: E (4) through WSW (11). */
const GOOD_FROM = 4;
const GOOD_TO = 11;

const STEP = 360 / POINTS.length; // 22.5°

function indexOf(dir: string): number {
  return POINTS.indexOf(dir.toUpperCase().trim() as (typeof POINTS)[number]);
}

export function isGoodDirection(dir: string): boolean {
  const i = indexOf(dir);
  return i >= GOOD_FROM && i <= GOOD_TO;
}

/** Compass bearing -> SVG angle (SVG 0° points along +x, bearing 0° is up). */
const toSvg = (bearing: number) => bearing - 90;

function sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const pt = (r: number, a: number) => {
    const rad = (a * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M${x0.toFixed(2)},${y0.toFixed(2)}`,
    `A${r1},${r1} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`,
    `L${x2.toFixed(2)},${y2.toFixed(2)}`,
    `A${r0},${r0} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export interface CompassOptions {
  /** Rendered edge length in px. */
  size?: number;
  /**
   * Compact fits inside the Direction stat cell: no cardinal letters or
   * needle, and the abbreviation sits in the middle instead.
   */
  compact?: boolean;
}

/**
 * Renders the rose into `host`. Pass "?" (or anything unrecognised) to draw the
 * ring with no active sector — backfilled rows have no direction.
 */
export function renderCompass(host: HTMLElement, dir: string, opts: CompassOptions = {}): void {
  const { size = 132, compact = false } = opts;
  const active = indexOf(dir);
  const c = size / 2;
  const rOut = c * (compact ? 0.95 : 0.94);
  const rIn = c * (compact ? 0.68 : 0.67);

  const wedges = POINTS.map((name, i) => {
    const good = i >= GOOD_FROM && i <= GOOD_TO;
    const bearing = i * STEP;
    const d = sector(c, c, rIn, rOut, toSvg(bearing - STEP / 2), toSvg(bearing + STEP / 2));
    const on = i === active;
    return (
      `<path d="${d}" class="sec ${good ? "good" : "bad"}${on ? " on" : ""}">` +
      `<title>${name}${good ? " — onshore" : ""}</title></path>`
    );
  }).join("");

  let inner = "";

  if (compact) {
    inner =
      `<text x="${c}" y="${c}" class="rose-dir ${active < 0 ? "" : isGoodDirection(dir) ? "good" : "bad"}">` +
      `${active < 0 ? "--" : dir.toUpperCase()}</text>`;
  } else {
    // Cardinal letters, tucked just inside the ring.
    inner = ["N", "E", "S", "W"]
      .map((l, k) => {
        const rad = (toSvg(k * 90) * Math.PI) / 180;
        const r = rIn - size * 0.085;
        return (
          `<text x="${(c + r * Math.cos(rad)).toFixed(1)}" ` +
          `y="${(c + r * Math.sin(rad)).toFixed(1)}" class="card-letter">${l}</text>`
        );
      })
      .join("");

    if (active >= 0) {
      // Arrow points to where the wind is blowing *from*, matching how the
      // station reports direction.
      const a = toSvg(active * STEP);
      const rad = (a * Math.PI) / 180;
      const tip = rIn - 3;
      const back = ((a + 180) * Math.PI) / 180;
      const left = ((a + 130) * Math.PI) / 180;
      const right = ((a - 130) * Math.PI) / 180;
      inner +=
        `<polygon points="${(c + tip * Math.cos(rad)).toFixed(1)},${(c + tip * Math.sin(rad)).toFixed(1)} ` +
        `${(c + 9 * Math.cos(left)).toFixed(1)},${(c + 9 * Math.sin(left)).toFixed(1)} ` +
        `${(c + 13 * Math.cos(back)).toFixed(1)},${(c + 13 * Math.sin(back)).toFixed(1)} ` +
        `${(c + 9 * Math.cos(right)).toFixed(1)},${(c + 9 * Math.sin(right)).toFixed(1)}" ` +
        `class="needle ${isGoodDirection(dir) ? "good" : "bad"}"/>` +
        `<circle cx="${c}" cy="${c}" r="3" class="hub"/>`;
    }
  }

  host.innerHTML =
    `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" ` +
    `aria-label="Wind direction ${active < 0 ? "unknown" : dir}">` +
    wedges +
    inner +
    `</svg>`;
}
