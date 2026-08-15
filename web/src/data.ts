import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type Query,
} from "firebase/firestore";
import { db } from "./firebase";

export type BoardValue = "Yes" | "No" | "Maybe";

export interface Reading {
  ts: Date;
  /**
   * Nullable purely as a guard: every row the poller writes has all three
   * series, but a null must render as a gap rather than a phantom dip at zero
   * if one ever goes missing.
   */
  actual: number | null;
  average: number | null;
  gust: number | null;
  direction: string;
  windName: string | null;
  tempC: number | null;
  stationTime: string | null;
}

export interface ZoneSnapshot {
  ts: Date;
  status: string;
  twintip: BoardValue | null;
  surf: BoardValue | null;
  foil: BoardValue | null;
  siteLastUpdate: string | null;
  /** One-off announcement scraped from under the page title, if any. */
  notice: string | null;
}

const HOURS_12 = 12 * 60 * 60 * 1000;

/** How often the sliding window is rebuilt (see `live` below). */
const WINDOW_REFRESH_MS = 15 * 60 * 1000;

function since(ms: number): Timestamp {
  return Timestamp.fromMillis(Date.now() - ms);
}

/**
 * Subscribes to a query and keeps it live.
 *
 * onSnapshot already pushes every new document to the page the moment it is
 * written, so readings appear without a refresh. The catch is that the 12-hour
 * cutoff is baked into the query when it is built — a tab left open all day
 * would keep widening its window and never drop stale points. So the query is
 * rebuilt on an interval, which re-anchors the cutoff to "now".
 */
function live<T>(build: () => Query, map: (snap: { docs: { data: () => Record<string, unknown> }[] }) => T, cb: (v: T) => void): () => void {
  let stop = onSnapshot(build(), (snap) => cb(map(snap)));

  const timer = setInterval(() => {
    stop();
    stop = onSnapshot(build(), (snap) => cb(map(snap)));
  }, WINDOW_REFRESH_MS);

  return () => {
    clearInterval(timer);
    stop();
  };
}

// Number(null) is 0, which would draw a phantom dip at zero — keep missing
// series null so Chart.js renders a gap instead.
const num = (x: unknown): number | null =>
  x === null || x === undefined ? null : Number(x);

/** Live stream of wind readings from the last 12 hours, oldest first. */
export function subscribeReadings(cb: (rows: Reading[]) => void): () => void {
  return live(
    () =>
      query(
        collection(db, "readings"),
        where("ts", ">=", since(HOURS_12)),
        orderBy("ts", "asc")
      ),
    (snap) =>
      snap.docs.map((d) => {
        const v = d.data();
        return {
          ts: (v.ts as Timestamp).toDate(),
          actual: num(v.actual),
          average: num(v.average),
          gust: num(v.gust),
          direction: String(v.direction ?? "?"),
          windName: (v.windName as string) ?? null,
          tempC: num(v.tempC),
          stationTime: (v.stationTime as string) ?? null,
        };
      }),
    cb
  );
}

/** Live stream of the most recent kite-zone board reading. */
export function subscribeZone(cb: (row: ZoneSnapshot | null) => void): () => void {
  return live(
    () =>
      query(
        collection(db, "twintip"),
        where("ts", ">=", since(HOURS_12)),
        orderBy("ts", "desc"),
        limit(1)
      ),
    (snap) => {
      const d = snap.docs[0];
      if (!d) return null;
      const v = d.data();
      return {
        ts: (v.ts as Timestamp).toDate(),
        status: String(v.status ?? "UNKNOWN"),
        twintip: (v.twintip as BoardValue) ?? null,
        surf: (v.surf as BoardValue) ?? null,
        foil: (v.foil as BoardValue) ?? null,
        siteLastUpdate: (v.siteLastUpdate as string) ?? null,
        notice: (v.notice as string) ?? null,
      };
    },
    cb
  );
}
