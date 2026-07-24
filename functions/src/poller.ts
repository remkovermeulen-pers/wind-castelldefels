import { getFirestore, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import { fetchWind } from "./sources/nudos";
import { fetchZoneStatus, isKiteable, label } from "./sources/mojokite";
import { fetchForecast } from "./sources/windguru";
import { gateAlerts, sendPush, WIND_ALERT_KNOTS, type AlertKind } from "./alerts";
import {
  FORECAST_DAYS,
  isUsefulForecastHour,
  LAST_ACTIVE_HOUR,
  localTime,
  shouldPollForecast,
  shouldPollWind,
  shouldPollTwintip,
} from "./time";

/** Readings older than this are pruned so the free Firestore tier stays ample. */
const RETENTION_DAYS = 30;

/**
 * One tick of the poller.
 *
 * Deliberately kept free of any Cloud Functions wiring so the exact same code
 * backs both execution hosts — the scheduled Cloud Function and the GitHub
 * Actions runner. Duplicating the alert rules across two implementations would
 * be a good way to have them quietly disagree.
 *
 * Callers are expected to have initialised firebase-admin already.
 */
export async function tick(now: Date): Promise<Record<string, unknown>> {
  const db = getFirestore();
  const t = localTime(now);
  const conditions: Partial<Record<AlertKind, boolean>> = {};
  const result: Record<string, unknown> = {
    local: `${t.day} ${t.hour}:${String(t.minute).padStart(2, "0")}`,
  };

  // --- Wind: every 5 min, 08:00–20:00 local ------------------------------
  if (shouldPollWind(t)) {
    try {
      const w = await fetchWind();
      await db.collection("readings").doc(now.toISOString()).set({
        ts: Timestamp.fromDate(now),
        actual: w.actual,
        average: w.average,
        gust: w.gust,
        direction: w.direction,
        windName: w.windName,
        tempC: w.tempC,
        pressureHpa: w.pressureHpa,
        humidityPct: w.humidityPct,
        stationTime: w.stationTime,
        source: "update_me_mdx",
      });

      conditions.wind = w.average >= WIND_ALERT_KNOTS;
      result.wind = w;
    } catch (err) {
      logger.error("Wind poll failed", err);
      result.windError = String(err);
    }
  }

  // --- Twintip: every 10 min, 12:00–21:00 local --------------------------
  let twintipLabel = "—";
  if (shouldPollTwintip(t)) {
    try {
      const z = await fetchZoneStatus();
      await db.collection("twintip").doc(now.toISOString()).set({
        ts: Timestamp.fromDate(now),
        status: z.status,
        openingTime: z.time,
        foil: z.foil,
        surf: z.surf,
        twintip: z.twintip,
        siteLastUpdate: z.lastUpdate,
        source: "get_values",
      });

      conditions.twintip = isKiteable(z.twintip);
      twintipLabel = label(z.twintip);
      result.twintip = z;
    } catch (err) {
      logger.error("Twintip poll failed", err);
      result.twintipError = String(err);
    }
  }

  // --- Windguru forecast: hourly, 08:00–24:00 local ----------------------
  // Stored as a single document that each run replaces: only the newest run is
  // of any use, and one doc keeps the client to a single read.
  if (shouldPollForecast(t)) {
    try {
      const f = await fetchForecast(FORECAST_DAYS, isUsefulForecastHour);
      await db.collection("forecast").doc("latest").set({
        fetchedAt: Timestamp.fromDate(now),
        initstamp: Timestamp.fromMillis(f.initstamp),
        model: f.model,
        source: "windguru:644417",
        points: f.points,
      });
      result.forecast = { model: f.model, points: f.points.length };
    } catch (err) {
      logger.error("Forecast poll failed", err);
      result.forecastError = String(err);
    }
  }

  // --- Alerts (rising edge only) -----------------------------------------
  const fire = await gateAlerts(t, conditions);
  result.fired = fire;

  const wind = result.wind as
    | { average: number; gust: number; direction: string }
    | undefined;

  for (const kind of fire) {
    if (kind === "twintip") {
      await sendPush({
        title: `🪁 Twintip: ${twintipLabel}`,
        body: wind
          ? `Zona kite Castelldefels · ${wind.average} kn avg, ${wind.gust} kn gusts (${wind.direction})`
          : "Zona kite Castelldefels — twintip status just improved.",
        tag: "twintip",
      });
    } else if (kind === "wind" && wind) {
      await sendPush({
        title: `💨 ${wind.average} kn average at Castelldefels`,
        body: `At or above ${WIND_ALERT_KNOTS} kn · gusts ${wind.gust} kn · ${wind.direction}`,
        tag: "wind",
      });
    }
  }

  // --- Retention: prune once a day on the last tick of the window --------
  if (t.hour === LAST_ACTIVE_HOUR && t.minute === 0) {
    const cutoff = Timestamp.fromMillis(now.getTime() - RETENTION_DAYS * 864e5);
    for (const col of ["readings", "twintip"]) {
      const old = await db.collection(col).where("ts", "<", cutoff).limit(500).get();
      if (old.empty) continue;
      const batch = db.batch();
      old.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      logger.info(`Pruned ${old.size} doc(s) from ${col}`);
    }
  }

  return result;
}
