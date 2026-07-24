import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

export type BoardValue = "Yes" | "No" | "Maybe";

export interface Reading {
  ts: Date;
  actual: number;
  average: number;
  gust: number;
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
}

const HOURS_12 = 12 * 60 * 60 * 1000;

function since(ms: number): Timestamp {
  return Timestamp.fromMillis(Date.now() - ms);
}

/** Live stream of wind readings from the last 12 hours, oldest first. */
export function subscribeReadings(cb: (rows: Reading[]) => void): () => void {
  const q = query(
    collection(db, "readings"),
    where("ts", ">=", since(HOURS_12)),
    orderBy("ts", "asc")
  );

  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const v = d.data();
        return {
          ts: (v.ts as Timestamp).toDate(),
          actual: Number(v.actual),
          average: Number(v.average),
          gust: Number(v.gust),
          direction: String(v.direction ?? "?"),
          windName: (v.windName as string) ?? null,
          tempC: v.tempC === null || v.tempC === undefined ? null : Number(v.tempC),
          stationTime: (v.stationTime as string) ?? null,
        };
      })
    );
  });
}

/** Live stream of the most recent kite-zone board reading. */
export function subscribeZone(cb: (row: ZoneSnapshot | null) => void): () => void {
  const q = query(
    collection(db, "twintip"),
    where("ts", ">=", since(HOURS_12)),
    orderBy("ts", "desc"),
    limit(1)
  );

  return onSnapshot(q, (snap) => {
    const d = snap.docs[0];
    if (!d) {
      cb(null);
      return;
    }
    const v = d.data();
    cb({
      ts: (v.ts as Timestamp).toDate(),
      status: String(v.status ?? "UNKNOWN"),
      twintip: (v.twintip as BoardValue) ?? null,
      surf: (v.surf as BoardValue) ?? null,
      foil: (v.foil as BoardValue) ?? null,
      siteLastUpdate: (v.siteLastUpdate as string) ?? null,
    });
  });
}
